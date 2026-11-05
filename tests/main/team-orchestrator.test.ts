import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { Agent, RuntimeConfig, TeamDetail } from '@shared/types'
import { openDatabase } from '../../src/main/db/database'
import { Store } from '../../src/main/db/store'
import { TeamService } from '../../src/main/services/team-service'
import {
  TeamOrchestrator,
  type TeamRunExecutorLike,
} from '../../src/main/services/team-orchestrator'
import type { AgentRunInput, AgentRunResult } from '../../src/main/services/agent-run-executor'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-team-'))
  roots.push(root)
  return root
}

interface FakeBehavior {
  (input: AgentRunInput, callIndex: number): string
}

class FakeExecutor implements TeamRunExecutorLike {
  calls: AgentRunInput[] = []
  active = 0
  maxActive = 0
  stopped = false
  delayMs = 0
  failAgents = new Set<string>()
  constructor(private readonly behavior: FakeBehavior) {}

  hasActiveSession(): boolean {
    return this.active > 0
  }

  isRunning(): boolean {
    return this.active > 0
  }

  stop(): boolean {
    this.stopped = true
    return true
  }

  async execute(input: AgentRunInput): Promise<AgentRunResult> {
    this.active += 1
    this.maxActive = Math.max(this.maxActive, this.active)
    this.calls.push(input)
    const index = this.calls.length - 1
    if (this.delayMs) await new Promise((resolve) => setTimeout(resolve, this.delayMs))
    const text = this.behavior(input, index)
    this.active -= 1
    if (this.failAgents.has(input.agent.id)) {
      return {
        status: 'failed',
        text,
        tokensIn: 1,
        tokensOut: 0,
        cost: 0,
        runtimeSessionId: null,
        error: '成员崩溃',
      }
    }
    return {
      status: 'completed',
      text,
      tokensIn: 10,
      tokensOut: 20,
      cost: 0,
      runtimeSessionId: null,
      error: null,
    }
  }
}

function setup(
  options: {
    fanout?: 'parallel' | 'serial'
    delayMs?: number
    behavior?: FakeBehavior
    language?: () => 'zh-CN' | 'en'
  } = {},
) {
  const db = openDatabase(':memory:')
  const store = new Store(db)
  const teams = new TeamService(store)
  const workspace = store.ensureDefaultWorkspace(tempWorkspace())
  const runtime = store.createRuntime({
    name: 'Claude Code',
    adapter: 'claude-code',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'claude',
  })
  store.setRuntimeStatus(runtime.id, 'online')
  const names = ['主持人', '架构师', '研究员', '产品经理', '唱反调者', '用户研究员']
  const agents = names.map((name) =>
    store.createAgent({
            name,
      runtimeId: runtime.id,
      prompt: `${name}的职责。`,
    }),
  )
  const team: TeamDetail = teams.create({
    workspaceId: workspace.id,
    name: '评审团',
    leaderAgentId: agents[0].id,
    fanoutStrategy: options.fanout ?? 'parallel',
    maxConcurrency: 3,
    members: agents.map((agent) => ({ agentId: agent.id })),
  })
  const session = store.createTeamSession({
    workspaceId: workspace.id,
    teamId: team.id,
    workspacePath: workspace.rootPath,
  })

  const behavior: FakeBehavior =
    options.behavior ??
    ((input, index) => {
      const agent = input.agent
      if (agent.id === team.leaderAgentId) {
        if (index === 0) {
          return `[@架构师](mention://agent/${agents[1].id}) [@研究员](mention://agent/${agents[2].id}) 请分别评估。`
        }
        return '## 结论\n采用分两步迁移。\n\n## 关键依据\n架构师与研究员均支持。'
      }
      return `${agent.name}结论：可以分两步。`
    })

  const executor = new FakeExecutor(behavior)
  executor.delayMs = options.delayMs ?? 0
  const artifacts: Array<{ path: string; sessionId: string }> = []
  const orchestrator = new TeamOrchestrator({
    store,
    teams,
    executor,
    runtimeFor: () => store.getRuntime(runtime.id) as RuntimeConfig,
    saveAttachment: (input) => ({
      name: input.name,
      path: `/tmp/${input.name}`,
      mime: input.mime,
      size: input.data.byteLength,
    }),
    artifacts: {
      recordFile(input) {
        artifacts.push({ path: input.path, sessionId: input.sessionId })
        return null
      },
    },
    language: options.language,
  })

  return { db, store, teams, workspace, runtime, agents, team, session, executor, artifacts, orchestrator }
}

function byName(agents: Agent[], name: string): Agent {
  const agent = agents.find((item) => item.name === name)
  if (!agent) throw new Error(name)
  return agent
}

describe('TeamOrchestrator', () => {
  it('dispatches mentions, returns results to the leader and converges', async () => {
    const { store, agents, session, executor, artifacts, orchestrator } = setup()
    const result = await orchestrator.send({ sessionId: session.id, content: '请评估移动端方案' })
    expect(result.queued).toBe(false)
    await orchestrator.whenIdle(session.id)

    const turn = store.listTeamTurns(session.id)[0]
    expect(turn.status).toBe('completed')
    expect(executor.calls.map((call) => call.agent.name)).toEqual([
      '主持人',
      '架构师',
      '研究员',
      '主持人',
    ])
    const events = store.listTeamTurnEvents(turn.id).map((event) => event.type)
    expect(events).toContain('turn_started')
    expect(events).toContain('dispatch')
    expect(events).toContain('run_completed')
    expect(events).toContain('turn_completed')

    // 先启动的成员能看到后续成员处于排队状态，后启动的成员能看到前者正在运行。
    const architectCall = executor.calls.find((call) => call.agent.name === '架构师')
    const researcherCall = executor.calls.find((call) => call.agent.name === '研究员')
    expect(architectCall?.systemPrompt).toContain('状态：排队中')
    expect(researcherCall?.systemPrompt).toContain('状态：运行中')

    const messages = store.listMessages(session.id)
    expect(messages.some((message) => message.content.includes('主持人结论'))).toBe(false)
    expect(messages.at(-1)?.content).toContain('采用分两步迁移')
    expect(artifacts).toHaveLength(1)
    const artifactPath = join(session.workspacePath, '.pizza', 'artifacts', `team-turn-${turn.seq}.md`)
    expect(existsSync(artifactPath)).toBe(true)
    expect(readFileSync(artifactPath, 'utf8')).toContain('采用分两步迁移')
  })

  it('writes the convergence artifact heading in English when requested', async () => {
    const { store, session, artifacts, orchestrator } = setup({ language: () => 'en' })
    await orchestrator.send({ sessionId: session.id, content: '请评估移动端方案' })
    await orchestrator.whenIdle(session.id)

    const turn = store.listTeamTurns(session.id)[0]
    const artifactPath = join(
      session.workspacePath,
      '.pizza',
      'artifacts',
      `team-turn-${turn.seq}.md`,
    )
    expect(readFileSync(artifactPath, 'utf8')).toMatch(/^# Team turn 1/)
    expect(turn.status).toBe('completed')
    expect(artifacts).toHaveLength(1)
  })

  it('returns member-to-member mentions to the leader instead of dispatching', async () => {
    const { store, agents, session, executor, orchestrator } = setup({
      behavior: (input) => {
        if (input.agent.name === '主持人') {
          return executor.calls.length === 1
            ? `[@架构师](mention://agent/${agents[1].id}) 请评估。`
            : '## 结论\n完成。'
        }
        if (input.agent.name === '架构师') {
          return `[@研究员](mention://agent/${agents[2].id}) 请补充。`
        }
        return `${input.agent.name}完成`
      },
    })
    await orchestrator.send({ sessionId: session.id, content: '请评估移动端' })
    await orchestrator.whenIdle(session.id)

    expect(executor.calls.map((call) => call.agent.name)).toEqual([
      '主持人',
      '架构师',
      '主持人',
    ])
    const turn = store.listTeamTurns(session.id)[0]
    const events = store.listTeamTurnEvents(turn.id)
    expect(
      events.some(
        (event) =>
          event.type === 'notice' &&
          (event.payload as { kind?: string }).kind ===
            'member_mention_not_dispatched',
      ),
    ).toBe(true)
  })

  it('assigns the leader message as the role instruction for a dynamic-prompt member', async () => {
    const { store, agents, session, executor, orchestrator } = setup({
      behavior: (input) => {
        if (input.agent.name === '主持人') {
          return executor.calls.length === 1
            ? `[@架构师](mention://agent/${agents[1].id}) 本轮以架构师身份审查数据流，输出风险清单。`
            : '## 结论\n完成。'
        }
        return '架构师结果'
      },
    })
    const architect = agents[1]
    store.updateAgent(architect.id, {
      name: architect.name,
      description: architect.description,
      avatar: architect.avatar,
      runtimeId: architect.runtimeId,
      prompt: '预设角色 Prompt 不应生效',
      instructionMode: 'leader',
      thinkingLevel: architect.thinkingLevel,
      contextLimit: architect.contextLimit,
      model: architect.model,
      maxConcurrency: architect.maxConcurrency,
    })

    await orchestrator.send({ sessionId: session.id, content: '请评估移动端' })
    await orchestrator.whenIdle(session.id)

    const architectCall = executor.calls.find((call) => call.agent.id === architect.id)
    expect(architectCall?.systemPrompt).not.toContain('预设角色 Prompt 不应生效')
    expect(architectCall?.systemPrompt).toContain('没有预设角色 Prompt')
    expect(architectCall?.prompt).toContain('本轮角色指令')
    expect(architectCall?.prompt).toContain('输出风险清单')
  })

  it('caps parallel runs at the team concurrency limit', async () => {
    const { agents, session, executor, orchestrator } = setup({
      delayMs: 20,
      behavior: (input) => {
        if (input.agent.name === '主持人' && executor.calls.length === 1) {
          return agents
            .slice(1)
            .map((agent) => `[@${agent.name}](mention://agent/${agent.id})`)
            .join(' ')
        }
        return `${input.agent.name}完成`
      },
    })
    await orchestrator.send({ sessionId: session.id, content: '全员评估' })
    await orchestrator.whenIdle(session.id)
    expect(executor.maxActive).toBeLessThanOrEqual(3)
  })

  it('passes the previous member result in serial fanout', async () => {
    const { agents, session, executor, orchestrator } = setup({ fanout: 'serial' })
    await orchestrator.send({ sessionId: session.id, content: '串行评估' })
    await orchestrator.whenIdle(session.id)
    const memberCalls = executor.calls.filter((call) => call.agent.id !== agents[0].id)
    expect(memberCalls[0].prompt).not.toContain('架构师结论')
    expect(memberCalls[1].prompt).toContain('架构师结论')
  })

  it('queues user interjections and delivers them before the next final answer', async () => {
    const { store, agents, session, executor, orchestrator } = setup({ delayMs: 20 })
    await orchestrator.send({ sessionId: session.id, content: '请评估移动端' })
    const interjection = await orchestrator.send({
      sessionId: session.id,
      content: '补充约束：必须离线可用',
    })
    expect(interjection.queued).toBe(true)
    await orchestrator.whenIdle(session.id)
    const turn = store.listTeamTurns(session.id)[0]
    const events = store.listTeamTurnEvents(turn.id)
    expect(events.some((event) => event.type === 'user_interjection')).toBe(true)
    const leaderCalls = executor.calls.filter((call) => call.agent.id === agents[0].id)
    expect(leaderCalls.at(-1)?.prompt).toContain('必须离线可用')
    expect(store.listMessages(session.id).some((message) => message.content.includes('必须离线可用'))).toBe(
      true,
    )
  })

  it('ignores a workspace agent that is not a team member without stalling', async () => {
    const { store, workspace, runtime, session, executor, orchestrator } = setup()
    const outsider = store.createAgent({
            name: '外部顾问',
      runtimeId: runtime.id,
      prompt: '外部顾问。',
    })
    await orchestrator.send({
      sessionId: session.id,
      content: `[@外部顾问](mention://agent/${outsider.id}) 请看一下`,
    })
    await orchestrator.whenIdle(session.id)
    expect(executor.calls.some((call) => call.agent.id === outsider.id)).toBe(false)
    expect(store.listTeamTurns(session.id)[0].status).toBe('completed')
    expect(
      store.listMessages(session.id).some((message) =>
        message.content.includes('不是当前团队成员'),
      ),
    ).toBe(true)
  })

  it('retries a member message in a new turn', async () => {
    const { store, agents, session, orchestrator } = setup()
    await orchestrator.send({ sessionId: session.id, content: '请评估移动端' })
    await orchestrator.whenIdle(session.id)
    const memberMessage = store
      .listMessages(session.id)
      .find((message) => message.senderAgentId === byName(agents, '架构师').id)
    expect(memberMessage).toBeTruthy()
    const result = await orchestrator.retry(memberMessage!.id)
    expect(result.queued).toBe(false)
    await orchestrator.whenIdle(session.id)
    expect(store.listTeamTurns(session.id)).toHaveLength(2)
    expect(store.listTeamTurns(session.id)[1].status).toBe('completed')
  })

  it('isolates a failed member and still lets the leader summarize', async () => {
    const { store, agents, session, executor, orchestrator } = setup()
    executor.failAgents.add(byName(agents, '架构师').id)
    await orchestrator.send({ sessionId: session.id, content: '评估失败隔离' })
    await orchestrator.whenIdle(session.id)
    const turn = store.listTeamTurns(session.id)[0]
    expect(turn.status).toBe('completed')
    const events = store.listTeamTurnEvents(turn.id)
    expect(events.some((event) => event.type === 'run_failed')).toBe(true)
    expect(executor.calls.filter((call) => call.agent.id === agents[0].id).length).toBeGreaterThan(1)
    expect(
      executor.calls.filter((call) => call.agent.name === '研究员').length,
    ).toBeGreaterThan(0)
  })

  it('delivers a targeted interjection only to the mentioned member', async () => {
    const { store, agents, session, executor, orchestrator } = setup({ delayMs: 20 })
    await orchestrator.send({ sessionId: session.id, content: '请评估移动端' })
    await orchestrator.send({
      sessionId: session.id,
      content: `[@研究员](mention://agent/${byName(agents, '研究员').id}) 只补充给你：必须离线`,
    })
    await orchestrator.whenIdle(session.id)
    const researcherCalls = executor.calls.filter(
      (call) => call.agent.id === byName(agents, '研究员').id,
    )
    expect(
      researcherCalls.some((call) => call.prompt.includes('必须离线')),
    ).toBe(true)
    // 其他成员可能在上下文中看到这条消息，但只应把研究员作为送达目标。
    const turn = store.listTeamTurns(session.id)[0]
    const interjection = store
      .listTeamTurnEvents(turn.id)
      .find((event) => event.type === 'user_interjection')
    expect(interjection?.payload.targets).toEqual([byName(agents, '研究员').id])
  })

  it('stops all runs in a turn without deleting produced text', async () => {
    const { store, agents, session, orchestrator } = setup({ delayMs: 100 })
    await orchestrator.send({ sessionId: session.id, content: '开始' })
    await new Promise((resolve) => setTimeout(resolve, 10))
    const turn = store.listTeamTurns(session.id)[0]
    orchestrator.stopTurn(turn.id)
    expect(store.getTeamTurn(turn.id)?.status).toBe('cancelled')
    expect(orchestrator.isTurnCancelled(turn.id)).toBe(true)
  })
})
