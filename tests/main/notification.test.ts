import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CapabilityStore } from '../../src/main/db/capability-store'
import { Store } from '../../src/main/db/store'
import { NotificationService } from '../../src/main/services/notification-service'
import { DEFAULT_SETTINGS } from '../../src/main/services/settings-service'
import type { AppNotification, AppSettings } from '../../src/shared/types'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const RUNTIME = '22222222-2222-4222-8222-222222222222'
const AGENT = '33333333-3333-4333-8333-333333333333'
const SESSION = '44444444-4444-4444-8444-444444444444'
const MESSAGE = '55555555-5555-4555-8555-555555555555'

function setup(overrides: Partial<AppSettings['notifications']> = {}) {
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
     VALUES (?, ?, 'Session', ?, '/tmp/w', ?, ?)`,
  ).run(SESSION, WORKSPACE, AGENT, stamp, stamp)
  db.prepare(
    `INSERT INTO message (id, session_id, sender_type, sender_agent_id, content, created_at, updated_at)
     VALUES (?, ?, 'agent', ?, '[@我](mention://user) 请确认', ?, ?)`,
  ).run(MESSAGE, SESSION, AGENT, stamp, stamp)
  db.prepare(
    `INSERT INTO message_mention (
      id, message_id, target_type, display_name, start_index, end_index, raw, resolved, created_at
    ) VALUES ('mention-1', ?, 'user', '我', 0, 14, '[@我](mention://user)', 1, ?)`,
  ).run(MESSAGE, stamp)

  const store = new Store(db)
  const capabilities = new CapabilityStore(db)
  const shown: AppNotification[] = []
  const opened: string[] = []
  const settings = {
    ...DEFAULT_SETTINGS,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...overrides },
  }
  const service = new NotificationService(
    capabilities,
    store,
    () => settings,
    {
      show: (notification) => {
        shown.push(notification)
        return true
      },
    },
    () => undefined,
    (sessionId) => opened.push(sessionId),
  )
  return { db, service, shown, opened }
}

describe('notification service', () => {
  it('records a mention once and sends a system notification', () => {
    const { db, service, shown } = setup()
    const first = service.handleMessage(SESSION, MESSAGE)
    const second = service.handleMessage(SESSION, MESSAGE)
    expect(first?.title).toContain('Agent')
    expect(second?.id).toBe(first?.id)
    expect(service.list(WORKSPACE)).toHaveLength(1)
    expect(shown).toHaveLength(1)
    db.close()
  })

  it('suppresses system notifications under do-not-disturb but keeps the in-app record', () => {
    const { db, service, shown } = setup({ doNotDisturb: true })
    const notification = service.handleMessage(SESSION, MESSAGE)
    expect(notification).not.toBeNull()
    expect(service.list(WORKSPACE)).toHaveLength(1)
    expect(shown).toHaveLength(0)
    db.close()
  })

  it('does not notify when notifications are disabled', () => {
    const { db, service } = setup({ enabled: false })
    expect(service.handleMessage(SESSION, MESSAGE)).toBeNull()
    db.close()
  })

  it('marks notifications read and opens the session', () => {
    const { db, service, opened } = setup()
    const notification = service.handleMessage(SESSION, MESSAGE) as AppNotification
    service.open(notification.id)
    expect(opened).toEqual([SESSION])
    expect(service.list(WORKSPACE)[0].status).toBe('read')
    db.close()
  })
})
