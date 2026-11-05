import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/migrations'
import { Store } from '../../src/main/db/store'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-team-db-'))
  roots.push(root)
  return join(root, 'pizza.db')
}

function setup() {
  const db = openDatabase(':memory:')
  const store = new Store(db)
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
    prompt: '给出架构建议。',
  })
  return { db, store, workspace, runtime, leader, architect }
}

describe('team data model', () => {
  it('upgrades a version 2 database without losing agent data', () => {
    const path = tempDbPath()
    const legacy = new DatabaseSync(path)
    legacy.exec(`
      CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
    `)
    for (const migration of MIGRATIONS.filter((item) => item.version <= 2)) {
      legacy.exec(migration.sql)
      legacy
        .prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
        .run(migration.version, new Date().toISOString())
    }
    legacy
      .prepare(
        'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
      )
      .run('legacy-workspace', 'Pizza', '/Users/test/Pizza', new Date().toISOString())
    legacy
      .prepare(
        `INSERT INTO runtime (id, name, adapter, protocol, transport, args_json, env_json, created_at)
         VALUES (?, ?, 'claude-code', 'CLI', 'stdio', '[]', '{}', ?)`,
      )
      .run('legacy-runtime', 'Claude', new Date().toISOString())
    legacy
      .prepare(
        `INSERT INTO agent (id, workspace_id, name, description, runtime_id, prompt, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, '旧助手', ?, ?)`,
      )
      .run('legacy-agent', 'legacy-workspace', '旧助手', 'legacy-runtime', new Date().toISOString(), new Date().toISOString())
    legacy.close()

    const db = openDatabase(path)
    const store = new Store(db)
    expect(store.getAgent('legacy-agent')?.name).toBe('旧助手')
    expect(store.listAgents()).toHaveLength(1)
    expect(
      (db.prepare('PRAGMA table_info(agent)').all() as Array<{ name: string }>).map(
        (column) => column.name,
      ),
    ).not.toContain('workspace_id')
    expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    expect(store.listTeams('legacy-workspace')).toEqual([])
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => String((row as { name: string }).name))
    expect(tables).toEqual(
      expect.arrayContaining([
        'team',
        'team_member',
        'message_mention',
        'team_turn',
        'team_turn_event',
      ]),
    )
    db.close()
  })

  it('creates a team with ordered members and reads it back', () => {
    const { store, workspace, leader, architect } = setup()
    const team = store.createTeam({
      workspaceId: workspace.id,
      name: '产品评审团',
      description: '评审产品方案',
      leaderAgentId: leader.id,
      orchestrationPrompt: '先拆解任务，再汇总。',
      fanoutStrategy: 'serial',
      maxConcurrency: 2,
      maxHops: 10,
      tokenBudget: 200_000,
      members: [
        { agentId: leader.id, role: '主持讨论' },
        { agentId: architect.id, role: '评估技术可行性', promptMode: 'append', prompt: '关注数据迁移。' },
      ],
    })

    expect(team.members).toHaveLength(2)
    expect(team.members[0].position).toBe(0)
    expect(team.members[1].position).toBe(1)
    expect(team.members[1].promptMode).toBe('append')
    expect(team.maxHops).toBe(10)
    expect(store.listTeams(workspace.id)).toHaveLength(1)
    expect(store.getTeamDetail(team.id)?.members[1].agentId).toBe(architect.id)
  })

  it('rolls back the whole team when a member write fails', () => {
    const { store, workspace, leader } = setup()
    expect(() =>
      store.createTeam({
        workspaceId: workspace.id,
        name: '重复成员团队',
        leaderAgentId: leader.id,
        members: [
          { agentId: leader.id },
          { agentId: leader.id },
        ],
      }),
    ).toThrow()
    expect(store.listTeams(workspace.id)).toHaveLength(0)
  })

  it('creates a team session and exposes its participants', () => {
    const { store, workspace, leader, architect } = setup()
    const team = store.createTeam({
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [{ agentId: leader.id }, { agentId: architect.id }],
    })
    const session = store.createTeamSession({
      workspaceId: workspace.id,
      teamId: team.id,
      workspacePath: workspace.rootPath,
    })
    expect(session.mode).toBe('team')
    expect(session.agentId).toBeNull()
    expect(session.teamId).toBe(team.id)
    expect(session.interjectionMode).toBe('queue')

    const detail = store.getSessionDetail(session.id)
    expect(detail?.team?.id).toBe(team.id)
    expect(detail?.participants.map((item) => item.agent.name)).toEqual([
      '主持人',
      '架构师',
    ])
    expect(store.getSessionSummary(session.id)?.teamName).toBe('评审团')
  })

  it('persists mentions, turns, turn events and run links', () => {
    const { store, workspace, leader, architect } = setup()
    const team = store.createTeam({
      workspaceId: workspace.id,
      name: '评审团',
      leaderAgentId: leader.id,
      members: [{ agentId: leader.id }, { agentId: architect.id }],
    })
    const session = store.createTeamSession({
      workspaceId: workspace.id,
      teamId: team.id,
      workspacePath: workspace.rootPath,
    })
    const message = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '请 @架构师 评估迁移',
    })
    const mention = store.addMention({
      messageId: message.id,
      targetType: 'agent',
      targetAgentId: architect.id,
      displayName: '架构师',
      start: 2,
      end: 6,
      raw: '@架构师',
      resolved: true,
    })
    expect(store.listMentions(message.id)).toEqual([mention])
    expect(store.getMessage(message.id)?.mentions[0].displayName).toBe('架构师')

    const turn = store.createTeamTurn({
      sessionId: session.id,
      triggerMessageId: message.id,
      leaderAgentId: leader.id,
    })
    expect(turn.seq).toBe(1)
    expect(turn.status).toBe('dispatching')
    const event = store.addTeamTurnEvent({
      turnId: turn.id,
      type: 'turn_started',
      participantAgentId: leader.id,
      payload: { reason: 'user_message' },
    })
    expect(event.seq).toBe(1)
    expect(store.listTeamTurnEvents(turn.id)).toHaveLength(1)
    expect(store.listTeamTurns(session.id)).toHaveLength(1)

    const run = store.createRun({
      sessionId: session.id,
      triggerMessageId: message.id,
      agentId: architect.id,
      teamTurnId: turn.id,
    })
    expect(store.getRun(run.id)?.teamTurnId).toBe(turn.id)

    store.updateTeamTurn(turn.id, { status: 'debating', hops: 2, rounds: 1 })
    expect(store.getTeamTurn(turn.id)?.status).toBe('debating')
  })

  it('marks unfinished turns as interrupted on restart', () => {
    const { store, workspace, leader } = setup()
    const team = store.createTeam({
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
    const message = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '开始',
    })
    const turn = store.createTeamTurn({
      sessionId: session.id,
      triggerMessageId: message.id,
      leaderAgentId: leader.id,
    })

    expect(store.markInterruptedRuns()).toBe(0)
    expect(store.getTeamTurn(turn.id)?.status).toBe('interrupted')
    expect(store.listTeamTurnEvents(turn.id).at(-1)?.type).toBe('turn_interrupted')
  })
})
