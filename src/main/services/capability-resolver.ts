import type {
  CapabilityBinding,
  CapabilityDiagnostic,
  CapabilityPreview,
  CapabilityScopeType,
  EffectiveMcpServer,
  EffectiveSkill,
  RuntimeConfig,
} from '@shared/types'
import type { CapabilityStore } from '../db/capability-store'
import type { McpService } from './mcp-service'
import {
  discoverRuntimeMcpServers,
  type LocalMcpProvider,
} from './runtime-local-config'
import type { SkillService } from './skill-service'

export interface ResolveInput {
  workspaceId: string
  agentId: string
  teamMemberId?: string
  disabledSkillIds?: string[]
  runtime?: RuntimeConfig
}

interface ScopedBinding {
  binding: CapabilityBinding
  priority: number
}

function scopePriority(type: CapabilityScopeType): number {
  if (type === 'workspace') return 0
  if (type === 'agent') return 1
  return 2
}

function mergeBindings(bindings: CapabilityBinding[]): Map<string, CapabilityBinding> {
  const result = new Map<string, ScopedBinding>()
  for (const binding of bindings) {
    const priority = scopePriority(binding.scopeType)
    const existing = result.get(binding.targetId)
    // 同一目标被多个层级绑定时，以更具体的作用域为准；同级后写覆盖。
    if (!existing || priority >= existing.priority) {
      result.set(binding.targetId, { binding, priority })
    }
  }
  return new Map(Array.from(result, ([key, value]) => [key, value.binding]))
}

/**
 * 统一解析「工作区默认 → 智能体 → 团队成员」的能力集合。
 *
 * 解析结果与注入分离：运行时只消费 EffectiveSkill / EffectiveMcpServer，
 * 团队覆盖、单次禁用和默认值都走同一套规则。
 */
export class CapabilityResolver {
  constructor(
    private readonly store: CapabilityStore,
    private readonly skills: SkillService,
    private readonly mcp: McpService,
    private readonly localMcp: LocalMcpProvider = discoverRuntimeMcpServers,
  ) {}

  async resolve(input: ResolveInput): Promise<CapabilityPreview> {
    const diagnostics: CapabilityDiagnostic[] = []
    const scopes: Array<{ type: CapabilityScopeType; id: string }> = [
      { type: 'workspace', id: input.workspaceId },
      { type: 'agent', id: input.agentId },
    ]
    if (input.teamMemberId) {
      scopes.push({ type: 'team_member', id: input.teamMemberId })
    }

    const allSkills = this.skills.list(input.workspaceId)
    const skillById = new Map(allSkills.map((skill) => [skill.id, skill]))
    const byName = new Map(allSkills.map((skill) => [skill.name, skill]))

    const skillBindings = mergeBindings(this.store.listSkillBindingsForScopes(scopes))
    const effectiveSkillIds = new Set<string>()
    for (const binding of skillBindings.values()) {
      if (binding.enabled) effectiveSkillIds.add(binding.targetId)
    }

    // 内置协作 Skill 默认生效，不要求用户先绑定。
    for (const skill of allSkills) {
      if (skill.builtin && skill.enabled && !skillBindings.has(skill.id)) {
        effectiveSkillIds.add(skill.id)
      }
    }

    if (input.teamMemberId) {
      const overrides = this.store.getTeamMemberCapabilities(input.teamMemberId)
      for (const nameOrId of overrides.skills) {
        const skill = byName.get(nameOrId) ?? skillById.get(nameOrId)
        if (skill) effectiveSkillIds.add(skill.id)
      }
    }

    const disabled = new Set(input.disabledSkillIds ?? [])
    const effectiveSkills: EffectiveSkill[] = []
    for (const id of effectiveSkillIds) {
      if (disabled.has(id)) continue
      const skill = skillById.get(id)
      if (!skill) {
        diagnostics.push({ capability: 'skill', target: id, message: '绑定的 Skill 不存在' })
        continue
      }
      if (!skill.enabled) continue
      const content = this.store.getSkillContent(id)
      if (!skill.builtin && (!content?.contentDir || content.contentDir === '')) {
        diagnostics.push({
          capability: 'skill',
          target: skill.name,
          message: 'Skill 内容目录缺失，已跳过注入',
        })
        continue
      }
      effectiveSkills.push({
        id: skill.id,
        name: skill.name,
        description: skill.description,
        version: skill.version,
        path: skill.builtin ? `builtin:${skill.name}` : (content?.contentDir ?? ''),
        builtin: skill.builtin,
        sourceType: skill.sourceType,
      })
    }

    const mcpBindings = mergeBindings(this.store.listMcpBindingsForScopes(scopes))
    const effectiveMcp: EffectiveMcpServer[] = []
    for (const binding of mcpBindings.values()) {
      if (!binding.enabled) continue
      const server = this.store.getMcpServer(binding.targetId)
      if (!server) {
        diagnostics.push({
          capability: 'mcp',
          target: binding.targetId,
          message: '绑定的 MCP 服务不存在',
        })
        continue
      }
      if (!server.enabled) continue
      if (
        server.transport !== 'stdio' &&
        input.runtime?.protocol === 'ACP' &&
        !input.runtime.capabilities.remoteMcp
      ) {
        diagnostics.push({
          capability: 'mcp',
          target: server.name,
          message: '该 ACP 运行时未声明远程 MCP 支持，已跳过 SSE/HTTP 服务',
        })
        continue
      }
      try {
        const config = await this.mcp.launchConfigWithBinding(binding)
        effectiveMcp.push(config)
      } catch (error) {
        diagnostics.push({
          capability: 'mcp',
          target: server.name,
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }

    if (input.teamMemberId) {
      const overrides = this.store.getTeamMemberCapabilities(input.teamMemberId)
      for (const nameOrId of overrides.mcpServers) {
        if (effectiveMcp.some((server) => server.id === nameOrId || server.name === nameOrId)) {
          continue
        }
        const server =
          this.store.listMcpServers(input.workspaceId).find(
            (item) => item.id === nameOrId || item.name === nameOrId,
          ) ?? null
        if (!server) {
          diagnostics.push({
            capability: 'mcp',
            target: nameOrId,
            message: '团队成员覆盖引用的 MCP 服务不存在',
          })
          continue
        }
        if (!server.enabled) continue
        if (
          server.transport !== 'stdio' &&
          input.runtime?.protocol === 'ACP' &&
          !input.runtime.capabilities.remoteMcp
        ) {
          diagnostics.push({
            capability: 'mcp',
            target: server.name,
            message: '该 ACP 运行时未声明远程 MCP 支持，已跳过 SSE/HTTP 服务',
          })
          continue
        }
        effectiveMcp.push(await this.mcp.launchConfig(server.id))
      }
    }

    // 运行时本地配置是最底层来源；同名的显式绑定覆盖它。
    const merged = new Map<string, EffectiveMcpServer>()
    for (const server of input.runtime ? await this.localMcp(input.runtime) : []) {
      if (
        server.transport !== 'stdio' &&
        input.runtime?.protocol === 'ACP' &&
        !input.runtime.capabilities.remoteMcp
      ) {
        diagnostics.push({
          capability: 'mcp',
          target: server.name,
          message: '运行时本地配置的远程 MCP 未被 ACP 支持，已跳过',
        })
        continue
      }
      merged.set(server.name, server)
    }
    // 更具体作用域的禁用必须压住运行时本地同名配置。
    for (const binding of mcpBindings.values()) {
      if (binding.enabled) continue
      const server = this.store.getMcpServer(binding.targetId)
      if (server) merged.delete(server.name)
    }
    for (const server of effectiveMcp) merged.set(server.name, server)

    return {
      skills: effectiveSkills.sort((a, b) => a.name.localeCompare(b.name)),
      mcpServers: Array.from(merged.values()).sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
      diagnostics,
    }
  }

  /** 判断某个工具是否被允许；返回 null 表示没有限制。 */
  static toolPolicy(
    server: EffectiveMcpServer | undefined,
    toolName: string,
  ): { allowed: boolean; source: string } | null {
    if (!server) return null
    if (server.toolDeny.includes(toolName)) {
      return { allowed: false, source: `mcp:${server.name}:deny` }
    }
    if (server.toolAllow.length > 0) {
      return {
        allowed: server.toolAllow.includes(toolName),
        source: `mcp:${server.name}:allow`,
      }
    }
    return null
  }
}
