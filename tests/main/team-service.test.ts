import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { Store } from '../../src/main/db/store'
import { TeamService } from '../../src/main/services/team-service'

function setup() {
  const db = openDatabase(':memory:')
  const store = new Store(db)
  const teams = new TeamService(store)
  const workspace = store.ensureDefaultWorkspace('/Users/test/Pizza')
  const runtime = store.createRuntime({
    name: 'Claude Code',
    adapter: 'claude-code',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'claude',
  })
  const leader = store.createAgent({
        name: '主持人',
    runtimeId: runtime.id,
    prompt: '主持讨论。',
  })
  const architect = store.createAgent({
        name: '架构师',
    runtimeId: runtime.id,
    prompt: '评估架构。',
  })
  return { db, store, teams, workspace, runtime, leader, architect }
}

describe('TeamService', () => {
  it('creates a valid team and rejects a leader who is not a member', () => {
    const { teams, workspace, leader, architect } = setup()
    expect(() =>
      teams.create({
        workspaceId: workspace.id,
        name: '缺少指挥者',
        leaderAgentId: leader.id,
        members: [{ agentId: architect.id }],
      }),
    ).toThrow('TEAM_LEADER_NOT_MEMBER')

    const team = teams.create({
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [{ agentId: leader.id }, { agentId: architect.id }],
    })
    expect(team.members).toHaveLength(2)
    // 团队不再有轮次上限；跳数保护默认 64，可通过团队配置覆盖。
    expect(team.maxHops).toBe(64)
  })

  it('rejects duplicate members and archived agents', () => {
    const { teams, store, workspace, leader, architect } = setup()
    expect(() =>
      teams.create({
        workspaceId: workspace.id,
        name: '重复成员',
        leaderAgentId: leader.id,
        members: [{ agentId: leader.id }, { agentId: leader.id }],
      }),
    ).toThrow('TEAM_DUPLICATE_MEMBER')

    store.archiveAgent(architect.id, true)
    expect(() =>
      teams.create({
        workspaceId: workspace.id,
        name: '归档成员',
        leaderAgentId: leader.id,
        members: [{ agentId: leader.id }, { agentId: architect.id }],
      }),
    ).toThrow('TEAM_MEMBER_ARCHIVED')
  })

  it('rejects invalid limits and duplicate team names', () => {
    const { teams, workspace, leader } = setup()
    expect(() =>
      teams.create({
        workspaceId: workspace.id,
        name: '并发超限',
        leaderAgentId: leader.id,
        maxConcurrency: 11,
        members: [{ agentId: leader.id }],
      }),
    ).toThrow('TEAM_LIMIT_INVALID')

    teams.create({
      workspaceId: workspace.id,
      name: '重名团队',
      leaderAgentId: leader.id,
      members: [{ agentId: leader.id }],
    })
    expect(() =>
      teams.create({
        workspaceId: workspace.id,
        name: '重名团队',
        leaderAgentId: leader.id,
        members: [{ agentId: leader.id }],
      }),
    ).toThrow('TEAM_NAME_EXISTS')
  })

  it('soft-deletes a team that still owns sessions and keeps history readable', () => {
    const { teams, store, workspace, leader } = setup()
    const team = teams.create({
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [{ agentId: leader.id }],
    })
    const session = store.createTeamSession({
      workspaceId: workspace.id,
      teamId: team.id,
      workspacePath: workspace.rootPath,
    })
    expect(teams.countSessions(team.id)).toBe(1)
    teams.remove(team.id)
    expect(teams.list(workspace.id, true)).toHaveLength(0)
    expect(store.getSessionDetail(session.id)?.team?.name).toBe('评审团')
    expect(store.getTeam(team.id)?.deletedAt).toBeTruthy()
  })

  it('resolves inherited, appended and replaced member prompts', () => {
    const { teams, workspace, leader, architect } = setup()
    const team = teams.create({
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [
        { agentId: leader.id, role: '主持' },
        {
          agentId: architect.id,
          promptMode: 'append',
          prompt: '补充：关注数据迁移。',
        },
      ],
    })
    const inherited = teams.resolveMemberPrompt(team.id, leader.id)
    expect(inherited).toBe('主持讨论。')
    const appended = teams.resolveMemberPrompt(team.id, architect.id)
    expect(appended).toContain('评估架构。')
    expect(appended).toContain('关注数据迁移。')

    const replaced = teams.update(team.id, {
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [
        { agentId: leader.id },
        { agentId: architect.id, promptMode: 'replace', prompt: '只做迁移评审。' },
      ],
    })
    expect(
      teams.resolveMemberPrompt(replaced.id, architect.id),
    ).toBe('只做迁移评审。')
  })
})
