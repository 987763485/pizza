import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { Store } from '../../src/main/db/store'

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
    timeoutMs: 45_000,
    autoReconnect: false,
  })
  return { db, store, workspace, runtime }
}

describe('Store', () => {
  it('creates a default workspace and preserves it on repeated startup', () => {
    const { store, workspace } = setup()
    expect(workspace.isDefault).toBe(true)
    expect(store.ensureDefaultWorkspace('/Users/test/Pizza').id).toBe(workspace.id)
    expect(store.listWorkspaces()).toHaveLength(1)
  })

  it('persists runtime timeout and auto-reconnect settings', () => {
    const { store, runtime } = setup()
    expect(runtime.timeoutMs).toBe(45_000)
    expect(runtime.autoReconnect).toBe(false)
    const updated = store.updateRuntime(runtime.id, {
      name: runtime.name,
      adapter: runtime.adapter,
      protocol: runtime.protocol,
      transport: runtime.transport,
      command: runtime.command,
      timeoutMs: 60_000,
      autoReconnect: true,
    })
    expect(updated.timeoutMs).toBe(60_000)
    expect(updated.autoReconnect).toBe(true)
  })

  it('creates agents and rejects duplicate names globally', () => {
    const { store, workspace, runtime } = setup()
    const input = {
      workspaceId: workspace.id,
      name: '通用助手',
      runtimeId: runtime.id,
      prompt: '你是一个通用助手。',
    }
    const agent = store.createAgent(input)
    expect(agent.name).toBe('通用助手')
    // 单个智能体的并发上限默认 3，并可独立于全局设置保存。
    expect(agent.maxConcurrency).toBe(3)
    const updated = store.updateAgent(agent.id, { ...input, maxConcurrency: 5 })
    expect(updated.maxConcurrency).toBe(5)
    expect(() => store.createAgent(input)).toThrow('AGENT_NAME_EXISTS')

    // 智能体不绑定工作区：新建工作区不会产生第二份智能体列表。
    store.createWorkspace('/Users/test/Other')
    expect(store.listAgents().map((item) => item.id)).toEqual([agent.id])

    // 复制智能体时保留并发配置。
    expect(store.duplicateAgent(agent.id).maxConcurrency).toBe(5)

    // 指令来源模式持久化，并在复制时保留。
    const dynamic = store.updateAgent(agent.id, {
      ...input,
      prompt: '',
      instructionMode: 'leader',
      maxConcurrency: 5,
    })
    expect(dynamic.instructionMode).toBe('leader')
    expect(store.duplicateAgent(agent.id).instructionMode).toBe('leader')
  })

  it('deletes non-default workspaces while protecting the default one', () => {
    const { store, workspace } = setup()
    const other = store.createWorkspace('/Users/test/Other')
    expect(() => store.deleteWorkspace(workspace.id)).toThrow('WORKSPACE_DEFAULT')
    expect(store.deleteWorkspace(other.id)?.id).toBe(workspace.id)
    expect(store.listWorkspaces()).toHaveLength(1)
  })

  it('persists messages and finds them through full-text search', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '研究员',
      runtimeId: runtime.id,
      prompt: '做研究。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
      title: '离线场景评估',
    })
    store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '请评估离线场景下的同步策略',
    })

    const hits = store.searchSessions(workspace.id, '离线场景')
    expect(hits).toHaveLength(1)
    expect(hits[0].session.id).toBe(session.id)
    expect(hits[0].snippet).toContain('离线场景')
  })

  it('forks a session up to the selected message without changing the source', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '架构师',
      runtimeId: runtime.id,
      prompt: '做架构。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    const first = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '第一问',
    })
    store.createMessage({
      sessionId: session.id,
      senderType: 'agent',
      senderAgentId: agent.id,
      content: '第一答',
    })
    const third = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '第三问',
    })

    const forked = store.forkSession(session.id, first.id)
    expect(forked.id).not.toBe(session.id)
    expect(forked.forkedFromId).toBe(session.id)
    expect(forked.messages).toHaveLength(1)
    expect(forked.messages[0].content).toBe('第一问')
    expect(store.listMessages(session.id)).toHaveLength(3)
    expect(store.getMessage(third.id)?.content).toBe('第三问')
  })

  it('finds sessions by agent name', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '研究员',
      runtimeId: runtime.id,
      prompt: '做研究。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
      title: '普通会话',
    })
    store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '与搜索词无关的内容',
    })

    const hits = store.searchSessions(workspace.id, '研究员')
    expect(hits.map((hit) => hit.session.id)).toContain(session.id)
  })

  it('marks unfinished runs, messages and sessions as interrupted', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '助手',
      runtimeId: runtime.id,
      prompt: '帮助用户。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    const userMessage = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: '开始',
    })
    const assistant = store.createMessage({
      sessionId: session.id,
      senderType: 'agent',
      senderAgentId: agent.id,
      content: '部分输出',
      status: 'running',
    })
    const run = store.createRun({
      sessionId: session.id,
      triggerMessageId: userMessage.id,
      agentId: agent.id,
      status: 'running',
    })
    store.setSessionStatus(session.id, 'running')

    expect(store.markInterruptedRuns()).toBe(1)
    expect(store.getRun(run.id)?.status).toBe('failed')
    expect(store.getMessage(assistant.id)?.status).toBe('failed')
    expect(store.getSession(session.id)?.status).toBe('error')
  })

  it('orders sessions by creation time, not by recent activity', () => {
    const { db, store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '助手',
      runtimeId: runtime.id,
      prompt: '帮助用户。',
    })
    const first = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    const second = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    const third = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    const stamp = (id: string, created: string, updated: string) =>
      db
        .prepare('UPDATE session SET created_at = ?, updated_at = ? WHERE id = ?')
        .run(created, updated, id)
    stamp(first.id, '2026-01-01T00:00:00.000Z', '2026-01-04T00:00:00.000Z')
    stamp(second.id, '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z')
    stamp(third.id, '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z')

    expect(store.listSessions(workspace.id).map((session) => session.id)).toEqual([
      third.id,
      second.id,
      first.id,
    ])
  })

  it('does not count archived sessions as active agent references', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
      name: '助手',
      runtimeId: runtime.id,
      prompt: '帮助用户。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    expect(store.countActiveSessionsForAgent(agent.id)).toBe(1)
    store.archiveSession(session.id)
    expect(store.countActiveSessionsForAgent(agent.id)).toBe(0)
  })

  it('archives and restores sessions', () => {
    const { store, workspace, runtime } = setup()
    const agent = store.createAgent({
            name: '助手',
      runtimeId: runtime.id,
      prompt: '帮助用户。',
    })
    const session = store.createSession({
      workspaceId: workspace.id,
      agentId: agent.id,
      workspacePath: workspace.rootPath,
    })
    store.archiveSession(session.id)
    expect(store.listSessions(workspace.id)).toHaveLength(0)
    expect(store.listSessions(workspace.id, true)).toHaveLength(1)
    store.restoreSession(session.id)
    expect(store.listSessions(workspace.id)).toHaveLength(1)
  })
})
