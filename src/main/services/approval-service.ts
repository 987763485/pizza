import { randomUUID } from 'node:crypto'
import type {
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  ApprovalRisk,
} from '@shared/types'
import type { CapabilityStore } from '../db/capability-store'
import { McpService } from './mcp-service'

export const DEFAULT_APPROVAL_TIMEOUT_MS = 120_000

const DANGEROUS_TOOL = /(^|__)(bash|shell|exec|write|edit|delete|remove|move|mcp__)/i

export interface ApprovalInput {
  workspaceId: string
  runId: string | null
  sessionId: string
  agentId: string | null
  agentName: string | null
  toolName: string
  toolInput: Record<string, unknown>
  /** 来自 MCP 工具允许/拒绝清单的限制；undefined 表示未限制。 */
  toolPolicy?: { allowed: boolean; source: string } | null
}

type Waiter = {
  resolve: (decision: ApprovalDecision) => void
  timer: NodeJS.Timeout
}

/**
 * 统一审批服务。
 *
 * ACP 的 session/request_permission 与 Claude CLI 的 PreToolUse hook 都调用
 * 这里；渲染层只能提交决定，不能直接放行工具。超时、策略拒绝和运行取消
 * 都会向运行时返回明确的 deny，避免静默放行。
 */
export class ApprovalService {
  private readonly waiters = new Map<string, Waiter>()

  constructor(
    private readonly store: CapabilityStore,
    private readonly onEvent: (request: ApprovalRequest) => void = () => undefined,
    private readonly timeoutMs = DEFAULT_APPROVAL_TIMEOUT_MS,
  ) {}

  async request(input: ApprovalInput): Promise<ApprovalDecision> {
    const risk = assessRisk(input.toolName)
    const policy = this.resolvePolicy(input)
    const source = input.toolPolicy?.source ?? policy?.policy.scope ?? 'default'

    if (input.toolPolicy && !input.toolPolicy.allowed) {
      return this.recordImmediate(input, risk, source, 'deny')
    }
    if (policy?.decision === 'deny') {
      return this.recordImmediate(
        input,
        risk,
        `policy:${policy.policy.scope}`,
        'deny',
      )
    }
    if (policy?.decision === 'allow') {
      return this.recordImmediate(
        input,
        risk,
        `policy:${policy.policy.scope}`,
        'allow_once',
      )
    }

    const expiresAt = new Date(Date.now() + this.timeoutMs).toISOString()
    const record = this.store.createApproval({
      runId: input.runId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      agentName: input.agentName,
      toolName: input.toolName,
      toolInput: redactToolInput(input.toolInput),
      toolInputSummary: McpService.summarizeToolInput(input.toolInput),
      risk,
      policySource: source,
      expiresAt,
    })
    this.onEvent(record)

    return new Promise<ApprovalDecision>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(record.id)
        this.store.updateApproval(record.id, 'timeout', 'deny')
        const updated = this.store.getApproval(record.id)
        if (updated) this.onEvent(updated)
        resolve('deny')
      }, this.timeoutMs)
      timer.unref?.()
      this.waiters.set(record.id, { resolve, timer })
    })
  }

  pending(): ApprovalRequest[] {
    return this.store.listPendingApprovals()
  }

  list(sessionId?: string): ApprovalRequest[] {
    return this.store.listApprovals(sessionId)
  }

  policies(workspaceId: string): ApprovalPolicy[] {
    return this.store.listPolicies(workspaceId)
  }

  setPolicy(input: {
    workspaceId: string
    agentId?: string | null
    toolName: string
    decision: 'allow' | 'ask' | 'deny'
  }): ApprovalPolicy {
    return this.store.upsertPolicy({
      workspaceId: input.workspaceId,
      agentId: input.agentId ?? null,
      toolName: input.toolName,
      decision: input.decision,
      scope: input.agentId ? 'agent' : 'workspace',
    })
  }

  decide(approvalId: string, decision: ApprovalDecision): ApprovalRequest {
    const record = this.store.getApproval(approvalId)
    if (!record) throw new Error('APPROVAL_NOT_FOUND')
    if (record.status !== 'pending') throw new Error('APPROVAL_ALREADY_DECIDED')

    const status = decision === 'deny' ? 'denied' : 'allowed'
    const updated = this.store.updateApproval(approvalId, status, decision)
    if (!updated) throw new Error('APPROVAL_NOT_FOUND')

    if (decision === 'always_allow') {
      const agentId = record.agentId
      this.store.upsertPolicy({
        workspaceId: this.workspaceForSession(record.sessionId),
        agentId,
        toolName: record.toolName,
        decision: 'allow',
        scope: 'always_allow',
      })
    }

    const waiter = this.waiters.get(approvalId)
    if (waiter) {
      clearTimeout(waiter.timer)
      this.waiters.delete(approvalId)
      waiter.resolve(decision)
    }
    this.onEvent(updated)
    return updated
  }

  /** 运行被停止或失败时，挂起的审批统一拒绝，避免 UI 留下永远待处理的请求。 */
  cancelForRun(runId: string): void {
    for (const record of this.store.listPendingApprovals()) {
      if (record.runId !== runId) continue
      const waiter = this.waiters.get(record.id)
      if (waiter) {
        clearTimeout(waiter.timer)
        this.waiters.delete(record.id)
        waiter.resolve('deny')
      }
      const updated = this.store.updateApproval(record.id, 'cancelled', 'deny')
      if (updated) this.onEvent(updated)
    }
  }

  private recordImmediate(
    input: ApprovalInput,
    risk: ApprovalRisk,
    source: string,
    decision: ApprovalDecision,
  ): ApprovalDecision {
    const record = this.store.createApproval({
      runId: input.runId,
      sessionId: input.sessionId,
      agentId: input.agentId,
      agentName: input.agentName,
      toolName: input.toolName,
      toolInput: redactToolInput(input.toolInput),
      toolInputSummary: McpService.summarizeToolInput(input.toolInput),
      risk,
      policySource: source,
      expiresAt: new Date().toISOString(),
    })
    const status = decision === 'deny' ? 'denied' : 'allowed'
    const updated = this.store.updateApproval(record.id, status, decision)
    if (updated) this.onEvent(updated)
    return decision
  }

  /**
   * 同时读取智能体级与工作区级策略，冲突时取更严格者：deny > ask > allow。
   * 不能只取“最具体”的一条，否则工作区禁止会被智能体允许绕过。
   */
  private resolvePolicy(
    input: ApprovalInput,
  ): { policy: ApprovalPolicy; decision: 'allow' | 'ask' | 'deny' } | null {
    if (!input.agentId) return null
    const workspaceId = this.workspaceForSession(input.sessionId)
    const policies = [
      this.store.findPolicy(workspaceId, input.agentId, input.toolName),
      this.store.findPolicy(workspaceId, null, input.toolName),
    ].filter((policy): policy is ApprovalPolicy => Boolean(policy))
    if (policies.length === 0) return null
    const rank = { deny: 3, ask: 2, allow: 1 } as const
    const strictest = policies.reduce((left, right) =>
      rank[right.decision] > rank[left.decision] ? right : left,
    )
    return { policy: strictest, decision: strictest.decision }
  }

  private workspaceForSession(sessionId: string): string {
    // CapabilityStore 不持有会话仓储，这里用一个轻量查询避免循环依赖。
    return this.store.getSessionWorkspaceId(sessionId)
  }
}

export function assessRisk(toolName: string): ApprovalRisk {
  if (DANGEROUS_TOOL.test(toolName)) {
    if (/bash|shell|exec|delete|remove/i.test(toolName)) return 'high'
    return 'medium'
  }
  return 'low'
}

function redactToolInput(input: Record<string, unknown>): Record<string, unknown> {
  const sensitive = /token|secret|password|key|authorization|cookie/i
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (sensitive.test(key)) {
      result[key] = '••••'
    } else if (typeof value === 'string' && value.length > 2000) {
      result[key] = `${value.slice(0, 2000)}…`
    } else {
      result[key] = value
    }
  }
  return result
}

export function newApprovalId(): string {
  return randomUUID()
}
