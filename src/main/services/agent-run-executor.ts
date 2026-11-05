import { randomUUID } from 'node:crypto'
import { realpathSync, statSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type {
  Agent,
  CapabilityPreview,
  Message,
  Run,
  RuntimeConfig,
  Session,
} from '@shared/types'
import { IPC } from '@shared/ipc'
import { DEFAULT_AGENT_PROMPT } from '@shared/agent-defaults'
import { JobCancelledError, type RuntimeSupervisor } from '@runtime-sdk'
import type { Store } from '../db/store'
import { broadcast } from '../events'
import { getDataDir } from '../paths'
import { prepareRuntimeCapabilities } from '../runtime/injection'
import { toRuntimeSpec } from '../runtime/registry'
import type {
  NormalizedRuntimeEvent,
  RuntimePermissionRequest,
} from '../runtime/types'
import type { ApprovalService } from './approval-service'
import { AgentConcurrencyGate } from './agent-concurrency-gate'
import type { ArtifactService } from './artifact-service'
import { CapabilityResolver } from './capability-resolver'
import type { RuntimeService } from './runtime-service'

export interface RunCapabilityProvider {
  resolve(input: {
    workspaceId: string
    agentId: string
    teamMemberId?: string
    runtime: RuntimeConfig
  }): Promise<CapabilityPreview>
  runtimeRoot: string
  approvals?: ApprovalService
  /** 运行完成后触发通知扫描；团队路径也复用同一个执行器。 */
  onAssistantCompleted?: (sessionId: string, messageId: string) => void
}

export interface ActiveRun {
  controller: AbortController
  sessionId: string
  assistantMessageId: string
  actorKey: string
}

export interface AgentRunInput {
  runId: string
  session: Session
  agent: Agent
  runtime: RuntimeConfig
  userMessage: Message
  assistantMessageId: string
  attachmentPaths: string[]
  /** 团队上下文由 TeamContextBuilder 生成；单智能体缺省使用会话历史。 */
  prompt?: string
  systemPrompt?: string
  runtimeSessionId?: string | null
  /** 团队会话不能共享单智能体的 runtimeSessionId。 */
  useSessionRuntimeSession?: boolean
  /** 团队运行中的单成员失败不应把整个运行时标记为离线。 */
  manageRuntimeHealth?: boolean
  timeoutMs?: number
  /**
   * 运行时 Actor 的隔离键。单智能体默认使用会话 ID；
   * 团队成员必须使用独立键，避免多个成员共用同一运行时会话。
   */
  actorKey?: string
  /** 调度优先级：用户消息 0，团队指挥者 1，团队成员 2。 */
  priority?: number
  /** 团队成员的 Skill/MCP 覆盖按成员 ID 解析。 */
  teamMemberId?: string
  onEvent?: (event: NormalizedRuntimeEvent) => void
}

export interface AgentRunResult {
  status: 'completed' | 'failed' | 'cancelled' | 'timeout'
  text: string
  tokensIn: number
  tokensOut: number
  cost: number
  runtimeSessionId: string | null
  error: string | null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function collectPathStrings(value: unknown, output: string[] = []): string[] {
  if (typeof value === 'string') {
    if (value.includes('/') && !value.startsWith('http')) output.push(value)
    return output
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPathStrings(item, output)
    return output
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectPathStrings(item, output)
  }
  return output
}

/**
 * 一次运行的共享执行器。
 *
 * 它只负责运行时生命周期、流式事件、消息/运行落库、用量、产出物扫描和失败处理；
 * 不决定会话队列、团队调度或会话状态。单智能体 RunService 与 TeamOrchestrator
 * 都调用它，避免出现第二套运行时通道。
 */
export class AgentRunExecutor {
  private readonly active = new Map<string, ActiveRun>()
  /** 单个智能体的并发闸门；与 Supervisor 的全局限制互不替代。 */
  private readonly agentGate = new AgentConcurrencyGate()

  constructor(
    private readonly store: Store,
    private readonly runtimeService: RuntimeService,
    private readonly artifacts: ArtifactService,
    private readonly supervisor: RuntimeSupervisor,
    private readonly capabilities?: RunCapabilityProvider,
  ) {}

  /** 会话是否已有运行或排队任务；单智能体用它决定新消息是否标记为排队。 */
  hasActiveSession(sessionId: string): boolean {
    return this.supervisor.isBusy(sessionId)
  }

  isRunning(runId: string): boolean {
    return this.active.has(runId)
  }

  stop(runId: string): boolean {
    const active = this.active.get(runId)
    if (!active) return false
    // 先让正在飞的 prompt 收到取消；排队中的任务由调度器直接移除。
    active.controller.abort()
    this.supervisor.cancelJob(active.actorKey, runId)
    return true
  }

  shutdown(): void {
    for (const [runId, active] of this.active) {
      const run = this.store.getRun(runId)
      // 运行已经写入终态时，退出不应把 completed 覆盖成 cancelled。
      if (
        run &&
        ['completed', 'failed', 'cancelled', 'timeout'].includes(run.status)
      ) {
        this.active.delete(runId)
        continue
      }
      active.controller.abort()
      this.store.updateRun(runId, {
        status: 'cancelled',
        endedAt: new Date().toISOString(),
        error: '应用退出，运行已停止',
      })
      const message = this.store.getMessage(active.assistantMessageId)
      if (message && !message.content.trim()) {
        this.store.updateMessageContent(active.assistantMessageId, '已停止')
      }
      this.store.updateMessageStatus(active.assistantMessageId, 'cancelled')
      this.store.setSessionStatus(active.sessionId, 'idle')
    }
    this.active.clear()
    this.supervisor.dispose()
  }

  async execute(input: AgentRunInput): Promise<AgentRunResult> {
    const controller = new AbortController()
    const actorKey = input.actorKey ?? input.session.id
    this.active.set(input.runId, {
      controller,
      sessionId: input.session.id,
      assistantMessageId: input.assistantMessageId,
      actorKey,
    })

    let assistantContent = ''
    let timedOut = false
    let releaseAgentSlot: (() => void) | null = null
    let preview: CapabilityPreview | null = null
    // 用持有对象保存回调内写入的中间结果，避免 TypeScript 把闭包外的变量
    // 过度收窄成初始值（null）。
    const latestRunRef: { current: Run | null } = { current: null }
    const preparedRef: {
      current: Awaited<ReturnType<typeof prepareRuntimeCapabilities>> | null
    } = { current: null }

    // 超时基于“无活动”而不是总时长：文本、工具、用量事件都会重置计时；
    // 工具执行中与等待审批期间不触发。团队显式传入更长的 30 分钟。
    const inactivityMs = input.timeoutMs ?? 5 * 60_000
    let inactivityTimer: NodeJS.Timeout | null = null
    let inFlightTools = 0
    let approvalPending = 0
    let lastEventWasTool = false
    const disarmInactivity = () => {
      if (inactivityTimer) clearTimeout(inactivityTimer)
      inactivityTimer = null
    }
    const armInactivity = (ms = inactivityMs) => {
      disarmInactivity()
      if (approvalPending > 0) return
      inactivityTimer = setTimeout(() => {
        // 长工具调用期间没有事件是正常的。工具事件之后给一个更长的宽限期，
        // 避免把仍在执行的命令误判为“无活动”。
        if (inFlightTools > 0 || lastEventWasTool) {
          lastEventWasTool = false
          armInactivity(30 * 60_000)
          return
        }
        timedOut = true
        controller.abort()
      }, ms)
      inactivityTimer.unref?.()
    }

    const emit = (event: NormalizedRuntimeEvent) => {
      armInactivity()
      lastEventWasTool =
        event.type === 'tool_started' ||
        event.type === 'tool_updated' ||
        event.type === 'tool_finished'
      if (event.type === 'tool_started') inFlightTools += 1
      if (event.type === 'tool_finished') {
        inFlightTools = Math.max(0, inFlightTools - 1)
      }

      const seq = this.store.nextRunEventSeq(input.runId)
      this.store.addRunEvent(input.runId, seq, event.type, event.payload)

      if (event.type === 'text_delta') {
        const delta = String(event.payload.text ?? '')
        assistantContent += delta
        this.store.updateMessageContent(input.assistantMessageId, assistantContent)
        this.store.updateMessageStatus(input.assistantMessageId, 'streaming')
      }

      if (event.type === 'usage') {
        latestRunRef.current = this.store.updateRun(input.runId, {
          tokensIn: Number(event.payload.tokensIn ?? 0),
          tokensOut: Number(event.payload.tokensOut ?? 0),
          cost: Number(event.payload.cost ?? 0),
        })
      }

      if (
        event.type === 'tool_started' ||
        event.type === 'tool_updated' ||
        event.type === 'tool_finished'
      ) {
        this.recordArtifactPaths(event.payload, input)
      }

      input.onEvent?.(event)
      broadcast(IPC.eventRun, {
        runId: input.runId,
        seq,
        type: event.type,
        payload: event.payload,
      })
    }

    // Pi/OMP 的会话文件必须跨应用重启保留，不能用启动时清空的 runtime 临时目录。
    const spec = toRuntimeSpec(input.runtime, join(getDataDir(), 'sessions'))
    const priority = input.priority ?? 0

    try {
      // 同一智能体的并发上限先于运行时调度生效；排队期间不启动空闲计时。
      releaseAgentSlot = await this.agentGate.acquire({
        agentId: input.agent.id,
        runId: input.runId,
        limit: input.agent.maxConcurrency,
        signal: controller.signal,
        onQueued: () => {
          this.store.updateMessageStatus(input.assistantMessageId, 'queued')
        },
      })

      return await this.supervisor.run(actorKey, spec, {
        id: input.runId,
        priority,
        signal: controller.signal,
        run: async (runtimeSession) => {
          armInactivity()
          this.artifacts.start({
            sessionId: input.session.id,
            runId: input.runId,
            agentId: input.agent.id,
            workspacePath: input.session.workspacePath,
          })
          this.store.updateRun(input.runId, {
            status: 'starting',
            startedAt: new Date().toISOString(),
          })
          this.store.updateMessageStatus(input.assistantMessageId, 'running')
          this.store.updateRun(input.runId, { status: 'running' })

          emit({
            type: 'status',
            payload: { status: 'running', messageId: input.assistantMessageId },
          })

          if (this.capabilities) {
            preview = await this.capabilities.resolve({
              workspaceId: input.session.workspaceId,
              agentId: input.agent.id,
              teamMemberId: input.teamMemberId,
              runtime: input.runtime,
            })
            preparedRef.current = await prepareRuntimeCapabilities({
              runtimeRoot: this.capabilities.runtimeRoot,
              runId: input.runId,
              session: input.session,
              agent: input.agent,
              runtime: input.runtime,
              preview,
              approvals: this.capabilities.approvals,
            })
            if (preview.diagnostics.length > 0) {
              emit({
                type: 'status',
                payload: { capabilityDiagnostics: preview.diagnostics },
              })
            }
          }

          const prompt = input.prompt ?? this.buildSoloPrompt(input)
          // 团队并行运行不能共用单智能体的 runtimeSessionId；每个运行使用独立
          // CLI 会话，否则 Claude Code 会以 “Session ID is already in use” 拒绝并发。
          const promptSessionId =
            input.useSessionRuntimeSession === false ? randomUUID() : input.session.id
          const result = await runtimeSession.prompt({
            prompt,
            systemPrompt:
              input.systemPrompt ?? (input.agent.prompt || DEFAULT_AGENT_PROMPT),
            sessionId: promptSessionId,
            runtimeSessionId:
              input.useSessionRuntimeSession === false
                ? (input.runtimeSessionId ?? null)
                : input.session.runtimeSessionId,
            cwd: input.session.workspacePath,
            model: input.agent.model,
            thinkingLevel: input.agent.thinkingLevel,
            attachmentPaths: input.attachmentPaths,
            signal: controller.signal,
            onEvent: emit,
            capabilities: preparedRef.current?.injection,
            requestPermission:
              this.capabilities?.approvals && preview
                ? async (request) => {
                    approvalPending += 1
                    disarmInactivity()
                    try {
                      return await this.authorizePermission(
                        preview as CapabilityPreview,
                        input,
                        request,
                      )
                    } finally {
                      approvalPending = Math.max(0, approvalPending - 1)
                      armInactivity()
                    }
                  }
                : undefined,
          })

          if (controller.signal.aborted) {
            throw new Error(timedOut ? '运行超时' : '用户停止了运行')
          }

          if (!assistantContent && result.text) {
            assistantContent = result.text
            this.store.updateMessageContent(input.assistantMessageId, assistantContent)
          }
          if (!assistantContent) {
            assistantContent = '（运行完成，但没有返回文本内容）'
            this.store.updateMessageContent(input.assistantMessageId, assistantContent)
          }

          this.store.updateMessageStatus(input.assistantMessageId, 'completed')
          // 团队消息的提及由编排器在运行结束后写入，通知也由编排器触发。
          if (input.session.mode !== 'team') {
            this.capabilities?.onAssistantCompleted?.(
              input.session.id,
              input.assistantMessageId,
            )
          }
          latestRunRef.current = this.store.updateRun(input.runId, {
            status: 'completed',
            endedAt: new Date().toISOString(),
            tokensIn: result.tokensIn,
            tokensOut: result.tokensOut,
            cost: result.cost,
          })
          if (result.runtimeSessionId && input.useSessionRuntimeSession !== false) {
            this.store.setSessionRuntimeId(input.session.id, result.runtimeSessionId)
          }
          this.artifacts.scanArtifactsFolder({
            sessionId: input.session.id,
            runId: input.runId,
            agentId: input.agent.id,
            workspacePath: input.session.workspacePath,
          })
          broadcast(IPC.eventRun, {
            runId: input.runId,
            seq: this.store.nextRunEventSeq(input.runId),
            type: 'completed',
            payload: {
              messageId: input.assistantMessageId,
              tokensIn: latestRunRef.current?.tokensIn ?? result.tokensIn,
              tokensOut: latestRunRef.current?.tokensOut ?? result.tokensOut,
              cost: latestRunRef.current?.cost ?? result.cost,
            },
          })

          return {
            status: 'completed' as const,
            text: assistantContent,
            tokensIn: latestRunRef.current?.tokensIn ?? result.tokensIn,
            tokensOut: latestRunRef.current?.tokensOut ?? result.tokensOut,
            cost: latestRunRef.current?.cost ?? result.cost,
            runtimeSessionId: result.runtimeSessionId ?? null,
            error: null,
          }
        },
      })
    } catch (error) {
      const cancelled = controller.signal.aborted || error instanceof JobCancelledError
      const message = cancelled
        ? timedOut
          ? '运行超时'
          : error instanceof JobCancelledError && !controller.signal.aborted
            ? '排队任务已取消'
            : '用户停止了运行'
        : errorMessage(error)
      const finalContent = assistantContent
        ? `${assistantContent}\n\n> ${cancelled ? (timedOut ? '已超时' : '已停止') : `运行失败：${message}`}`
        : cancelled
          ? timedOut
            ? '运行超时'
            : '已停止'
          : `运行失败：${message}`
      this.store.updateMessageContent(input.assistantMessageId, finalContent)
      this.store.updateMessageStatus(
        input.assistantMessageId,
        cancelled ? 'cancelled' : 'failed',
      )
      this.store.updateRun(input.runId, {
        status: timedOut ? 'timeout' : cancelled ? 'cancelled' : 'failed',
        endedAt: new Date().toISOString(),
        error: message,
      })
      if (!cancelled && input.manageRuntimeHealth !== false) {
        this.runtimeService.setStatus(input.runtime.id, 'error')
        this.runtimeService.scheduleReconnect(input.runtime.id)
      }
      this.artifacts.scanArtifactsFolder({
        sessionId: input.session.id,
        runId: input.runId,
        agentId: input.agent.id,
        workspacePath: input.session.workspacePath,
      })
      broadcast(IPC.eventRun, {
        runId: input.runId,
        seq: this.store.nextRunEventSeq(input.runId),
        type: cancelled ? 'cancelled' : 'failed',
        payload: { messageId: input.assistantMessageId, error: message },
      })

      return {
        status: timedOut ? 'timeout' : cancelled ? 'cancelled' : 'failed',
        text: finalContent,
        tokensIn: latestRunRef.current?.tokensIn ?? 0,
        tokensOut: latestRunRef.current?.tokensOut ?? 0,
        cost: latestRunRef.current?.cost ?? 0,
        runtimeSessionId: null,
        error: message,
      }
    } finally {
      releaseAgentSlot?.()
      disarmInactivity()
      preparedRef.current?.cleanup()
      // 运行结束后不留悬空审批；未决请求统一按拒绝处理。
      this.capabilities?.approvals?.cancelForRun(input.runId)
      this.artifacts.stop(input.runId)
      this.active.delete(input.runId)
    }
  }

  /** 把 ACP 选项映射成统一审批决定，再返回对应的 optionId。 */
  private async authorizePermission(
    preview: CapabilityPreview,
    input: AgentRunInput,
    request: RuntimePermissionRequest,
  ): Promise<string | null> {
    const mcpName = request.toolName.startsWith('mcp__')
      ? request.toolName.split('__')[1]
      : null
    const server = mcpName
      ? preview.mcpServers.find((item) => item.name === mcpName)
      : undefined
    const policy = server
      ? CapabilityResolver.toolPolicy(
          server,
          request.toolName.split('__').slice(2).join('__'),
        )
      : null
    const decision = await this.capabilities?.approvals?.request({
      workspaceId: input.session.workspaceId,
      runId: input.runId,
      sessionId: input.session.id,
      agentId: input.agent.id,
      agentName: input.agent.name,
      toolName: request.toolName,
      toolInput: request.toolInput,
      toolPolicy: policy,
    })
    if (!decision) return null
    // 先按 kind 精确匹配，再允许有限的别名；不能用 includes('allow')
    // 之类的宽泛匹配，否则「允许一次」可能选中 allow_always。
    const wanted =
      decision === 'deny'
        ? ['reject_once', 'reject', 'deny', 'denied']
        : decision === 'always_allow'
          ? ['allow_always', 'always']
          : ['allow_once', 'allow']
    const exact = request.options.find((option) =>
      wanted.includes((option.kind ?? '').toLowerCase()),
    )
    if (exact) return exact.optionId
    // 兼容没有 kind 的运行时：按名称精确匹配，仍不选 always。
    const byName = request.options.find((option) => {
      const name = option.name.toLowerCase()
      if (decision === 'deny') return /拒绝|deny|reject/.test(name)
      if (decision === 'always_allow') return /总是|always/.test(name)
      return /一次|once/.test(name) && !/总是|always/.test(name)
    })
    return byName?.optionId ?? null
  }

  private buildSoloPrompt(input: AgentRunInput): string {
    if (input.session.runtimeSessionId) return input.userMessage.content
    const history = this.store
      .listMessages(input.session.id)
      .filter(
        (message) =>
          message.id !== input.assistantMessageId &&
          message.id !== input.userMessage.id &&
          message.content.trim(),
      )
      .slice(-20)
    if (history.length === 0) return input.userMessage.content
    const transcript = history
      .map((message) => {
        const sender =
          message.senderType === 'user'
            ? '用户'
            : message.senderType === 'system'
              ? '系统'
              : '智能体'
        return `[${sender}] ${message.content}`
      })
      .join('\n\n')
    return `以下是本次会话已有的上下文：\n\n${transcript}\n\n当前任务：\n${input.userMessage.content}`
  }

  private recordArtifactPaths(
    payload: Record<string, unknown>,
    input: { session: Session; runId: string; agent: Agent },
  ): void {
    const root = canonical(input.session.workspacePath)
    for (const candidate of collectPathStrings(payload)) {
      const absolute = canonical(candidate)
      if (!absolute.startsWith(`${root}${sep}`)) continue
      try {
        const stat = statSync(absolute, { throwIfNoEntry: false })
        if (!stat?.isFile()) continue
        this.artifacts.recordFile({
          sessionId: input.session.id,
          runId: input.runId,
          agentId: input.agent.id,
          path: absolute,
        })
      } catch {
        // 工具参数中的路径可能只是文本，不是真实文件。
      }
    }
  }
}
