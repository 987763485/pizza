import type { Agent, TeamDetail, TeamInput, TeamSummary } from '@shared/types'
import type { Store } from '../db/store'

/**
 * 团队校验集中在这里，而不是散落在 IPC 和 UI 中：
 * - 指挥者必须属于成员列表，P0 不允许团队嵌套；
 * - 成员只能引用未归档的全局智能体；
 * - 阈值与数据库 CHECK 保持一致，提前返回可读错误码。
 */
function assertValid(store: Store, input: TeamInput, currentTeamId?: string): void {
  if (!store.getWorkspace(input.workspaceId)) throw new Error('WORKSPACE_NOT_FOUND')
  const name = input.name.trim()
  if (!name || name.length > 60) throw new Error('TEAM_NAME_INVALID')

  const leader = store.getAgent(input.leaderAgentId)
  if (!leader) throw new Error('TEAM_LEADER_NOT_FOUND')
  if (!input.members || input.members.length === 0) throw new Error('TEAM_LEADER_NOT_MEMBER')
  if (!input.members.some((member) => member.agentId === input.leaderAgentId)) {
    throw new Error('TEAM_LEADER_NOT_MEMBER')
  }

  const seen = new Set<string>()
  for (const member of input.members) {
    if (seen.has(member.agentId)) throw new Error('TEAM_DUPLICATE_MEMBER')
    seen.add(member.agentId)
    const agent = store.getAgent(member.agentId)
    if (!agent) throw new Error('TEAM_MEMBER_NOT_FOUND')
    if (agent.isArchived) throw new Error('TEAM_MEMBER_ARCHIVED')
    if (member.promptMode && !['inherit', 'append', 'replace'].includes(member.promptMode)) {
      throw new Error('TEAM_PROMPT_MODE_INVALID')
    }
  }

  const maxConcurrency = input.maxConcurrency ?? 3
  const maxHops = input.maxHops ?? 64
  const tokenBudget = input.tokenBudget ?? 0
  if (
    !Number.isInteger(maxConcurrency) ||
    maxConcurrency < 1 ||
    maxConcurrency > 10 ||
    !Number.isInteger(maxHops) ||
    maxHops < 1 ||
    maxHops > 100 ||
    !Number.isInteger(tokenBudget) ||
    tokenBudget < 0
  ) {
    throw new Error('TEAM_LIMIT_INVALID')
  }

  const existing = store
    .listTeams(input.workspaceId, true)
    .find((team) => team.name === name && team.id !== currentTeamId)
  if (existing) throw new Error('TEAM_NAME_EXISTS')
}

export class TeamService {
  constructor(private readonly store: Store) {}

  list(workspaceId: string, includeArchived = false): TeamSummary[] {
    return this.store.listTeams(workspaceId, includeArchived)
  }

  get(id: string): TeamDetail {
    const team = this.store.getTeamDetail(id)
    if (!team) throw new Error('TEAM_NOT_FOUND')
    return team
  }

  create(input: TeamInput): TeamDetail {
    assertValid(this.store, input)
    return this.store.createTeam({ ...input, name: input.name.trim() })
  }

  update(id: string, input: TeamInput): TeamDetail {
    if (!this.store.getTeam(id)) throw new Error('TEAM_NOT_FOUND')
    assertValid(this.store, input, id)
    return this.store.updateTeam(id, { ...input, name: input.name.trim() })
  }

  archive(id: string, archived: boolean): TeamDetail {
    this.store.setTeamArchived(id, archived)
    return this.get(id)
  }

  remove(id: string): void {
    if (!this.store.getTeam(id)) throw new Error('TEAM_NOT_FOUND')
    // 删除采用软删除：历史会话仍能解析团队名称和头像，列表与选择器不再出现。
    this.store.deleteTeam(id)
  }

  countSessions(id: string): number {
    return this.store.countSessionsForTeam(id)
  }

  /** 返回成员最终生效的 Prompt；通过模式组合而不是修改智能体本体。 */
  resolveMemberPrompt(teamId: string, agentId: string): string {
    const team = this.get(teamId)
    const member = team.members.find((item) => item.agentId === agentId)
    if (!member) throw new Error('TEAM_MEMBER_NOT_FOUND')
    const agent = this.store.getAgent(agentId)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    return resolvePrompt(agent, member.promptMode, member.prompt)
  }

  participants(teamId: string): Array<{ agent: Agent; role: 'leader' | 'member'; roleDescription: string }> {
    const team = this.get(teamId)
    return team.members.flatMap((member) => {
      const agent = this.store.getAgent(member.agentId)
      if (!agent) return []
      return [
        {
          agent,
          role: member.agentId === team.leaderAgentId ? ('leader' as const) : ('member' as const),
          roleDescription: member.role,
        },
      ]
    })
  }
}

export function resolvePrompt(
  agent: Pick<Agent, 'prompt'>,
  mode: 'inherit' | 'append' | 'replace',
  override: string,
): string {
  if (mode === 'replace') return override
  if (mode === 'append') return `${agent.prompt}\n\n${override}`.trim()
  return agent.prompt
}
