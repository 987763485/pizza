import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CapabilityStore } from '../../src/main/db/capability-store'
import {
  ApprovalService,
  assessRisk,
} from '../../src/main/services/approval-service'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const RUNTIME = '22222222-2222-4222-8222-222222222222'
const AGENT = '33333333-3333-4333-8333-333333333333'
const SESSION = '44444444-4444-4444-8444-444444444444'
const RUN = '55555555-5555-4555-8555-555555555555'

function setup(timeoutMs = 2_000) {
  const db = openDatabase(':memory:')
  const stamp = new Date().toISOString()
  db.prepare(
    'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run(WORKSPACE, 'W', '/tmp/w', stamp)
  db.prepare(
    `INSERT INTO runtime (id, name, adapter, protocol, transport, args_json, created_at)
     VALUES (?, 'R', 'claude-code', 'CLI', 'stdio', '[]', ?)`,
  ).run(RUNTIME, stamp)
  db.prepare(
    `INSERT INTO agent (id, name, runtime_id, prompt, created_at, updated_at)
     VALUES (?, 'Agent', ?, 'p', ?, ?)`,
  ).run(AGENT, RUNTIME, stamp, stamp)
  db.prepare(
    `INSERT INTO session (id, workspace_id, title, agent_id, workspace_path, created_at, updated_at)
     VALUES (?, ?, 'S', ?, '/tmp/w', ?, ?)`,
  ).run(SESSION, WORKSPACE, AGENT, stamp, stamp)
  db.prepare(
    `INSERT INTO run (id, session_id, trigger_message_id, agent_id, status, created_at)
     VALUES (?, ?, 'trigger', ?, 'running', ?)`,
  ).run(RUN, SESSION, AGENT, stamp)
  const store = new CapabilityStore(db)
  const events: string[] = []
  const service = new ApprovalService(
    store,
    (request) => events.push(`${request.id}:${request.status}`),
    timeoutMs,
  )
  return { db, store, service, events }
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    workspaceId: WORKSPACE,
    runId: RUN,
    sessionId: SESSION,
    agentId: AGENT,
    agentName: 'Agent',
    toolName: 'Write',
    toolInput: { path: '/tmp/w/a.md', content: 'x' },
    ...overrides,
  }
}

describe('approval service', () => {
  it('waits for a decision and returns allow_once', async () => {
    const { db, service, events } = setup()
    const decision = service.request(input())
    const pending = service.pending()
    expect(pending).toHaveLength(1)
    expect(pending[0].toolName).toBe('Write')
    service.decide(pending[0].id, 'allow_once')
    await expect(decision).resolves.toBe('allow_once')
    expect(service.list(SESSION)[0]).toMatchObject({ status: 'allowed', decision: 'allow_once' })
    expect(events.length).toBeGreaterThanOrEqual(2)
    db.close()
  })

  it('denies on timeout', async () => {
    const { db, service } = setup(30)
    await expect(service.request(input())).resolves.toBe('deny')
    expect(service.list(SESSION)[0]).toMatchObject({ status: 'timeout', decision: 'deny' })
    db.close()
  })

  it('does not show the dialog when a deny policy exists', async () => {
    const { db, store, service } = setup()
    store.upsertPolicy({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      toolName: 'Bash',
      decision: 'deny',
      scope: 'test',
    })
    await expect(service.request(input({ toolName: 'Bash' }))).resolves.toBe('deny')
    expect(service.pending()).toHaveLength(0)
    expect(service.list(SESSION)[0]).toMatchObject({ status: 'denied' })
    db.close()
  })

  it('takes the stricter policy when agent and workspace conflict', async () => {
    const { db, store, service } = setup()
    store.upsertPolicy({
      workspaceId: WORKSPACE,
      agentId: null,
      toolName: 'Bash',
      decision: 'deny',
      scope: 'workspace',
    })
    store.upsertPolicy({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      toolName: 'Bash',
      decision: 'allow',
      scope: 'agent',
    })
    await expect(service.request(input({ toolName: 'Bash' }))).resolves.toBe('deny')
    expect(service.pending()).toHaveLength(0)
    db.close()
  })

  it('always_allow persists a policy for subsequent calls', async () => {
    const { db, service } = setup()
    const first = service.request(input())
    const pending = service.pending()[0]
    service.decide(pending.id, 'always_allow')
    await first
    await expect(service.request(input())).resolves.toBe('allow_once')
    expect(service.pending()).toHaveLength(0)
    expect(service.policies(WORKSPACE)).toHaveLength(1)
    db.close()
  })

  it('honours MCP tool allow/deny lists and keeps FIFO order', async () => {
    const { db, service } = setup()
    await expect(
      service.request(
        input({
          toolName: 'mcp__search__delete',
          toolPolicy: { allowed: false, source: 'mcp:search:deny' },
        }),
      ),
    ).resolves.toBe('deny')

    const a = service.request(input({ toolName: 'Read' }))
    const b = service.request(input({ toolName: 'Edit' }))
    const pending = service.pending()
    expect(pending).toHaveLength(2)
    expect(pending[0].createdAt <= pending[1].createdAt).toBe(true)
    service.decide(pending[0].id, 'deny')
    service.decide(pending[1].id, 'allow_once')
    await expect(a).resolves.toBe('deny')
    await expect(b).resolves.toBe('allow_once')
    db.close()
  })

  it('classifies risk by tool name', () => {
    expect(assessRisk('Read')).toBe('low')
    expect(assessRisk('Write')).toBe('medium')
    expect(assessRisk('Bash')).toBe('high')
  })
})
