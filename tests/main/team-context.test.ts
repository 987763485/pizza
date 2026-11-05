import { describe, expect, it } from 'vitest'
import type { Agent, Message, TeamDetail } from '@shared/types'
import {
  buildTeamRunContext,
  compactTranscript,
} from '../../src/main/services/team-context-builder'

function message(id: string, senderType: Message['senderType'], content: string, senderAgentId?: string): Message {
  return {
    id,
    sessionId: 'session',
    senderType,
    senderAgentId: senderAgentId ?? null,
    content,
    contentFormat: 'markdown',
    replyToId: null,
    status: 'completed',
    roundNo: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    attachments: [],
    mentions: [],
  }
}

function agent(id: string, name: string, prompt: string): Agent {
  return {
    id,
    workspaceId: 'workspace',
    name,
    description: `${name} 描述`,
    avatar: null,
    runtimeId: 'runtime',
    prompt,
    instructionMode: 'self',
    thinkingLevel: 'medium',
    contextLimit: 200_000,
    model: null,
    isArchived: false,
    createdAt: '',
    updatedAt: '',
  }
}

describe('compactTranscript', () => {
  it('keeps the original task, recent messages and artifact paths', () => {
    const messages = [
      message('m1', 'user', '原始任务：评估移动端方案'),
      message('m2', 'agent', '很长的中间讨论'.repeat(400), 'a'),
      message('m3', 'agent', '继续讨论'.repeat(400), 'b'),
      message('m4', 'agent', '产出物：.pizza/artifacts/team-turn-1.md', 'a'),
      message('m5', 'user', '补充约束：必须离线可用'),
    ]
    const result = compactTranscript(messages, 600)
    expect(result).toContain('原始任务：评估移动端方案')
    expect(result).toContain('补充约束：必须离线可用')
    expect(result).toContain('.pizza/artifacts/team-turn-1.md')
    expect(result.length).toBeLessThan(2000)
    expect(result).toContain('已压缩')
  })
})

describe('buildTeamRunContext', () => {
  const leader = agent('leader', '主持人', '主持讨论。')
  const architect = agent('architect', '架构师', '评估架构。')
  const team = {
    id: 'team',
    workspaceId: 'workspace',
    name: '评审团',
    description: '',
    avatar: null,
    leaderAgentId: leader.id,
    orchestrationPrompt: '先拆解任务，再汇总。',
    fanoutStrategy: 'parallel',
    maxConcurrency: 3,
    maxHops: 64,
    tokenBudget: 0,
    isArchived: false,
    lastUsedAt: null,
    createdAt: '',
    updatedAt: '',
    members: [
      { id: 'm1', teamId: 'team', agentId: leader.id, position: 0, role: '主持', promptMode: 'inherit', prompt: '', capabilityOverrides: { skills: [], mcpServers: [] }, createdAt: '' },
      { id: 'm2', teamId: 'team', agentId: architect.id, position: 1, role: '技术', promptMode: 'append', prompt: '关注迁移。', capabilityOverrides: { skills: [], mcpServers: [] }, createdAt: '' },
    ],
  } satisfies TeamDetail

  it('gives members the capability catalog and a single-task protocol', () => {
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, architect],
      agent: architect,
      effectivePrompt: '评估架构。\n\n关注迁移。',
      messages: [message('m1', 'user', '评估移动端')],
      task: '评估移动端',
      callerAgentName: '主持人',
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: null,
    })
    expect(result.systemPrompt).toContain('参与者能力目录')
    expect(result.systemPrompt).toContain('架构师 描述')
    expect(result.systemPrompt).toContain('团队职责：技术')
    expect(result.systemPrompt).toContain('你只完成本次分派给你的单轮任务')
    expect(result.systemPrompt).toContain('不要调度其他成员')
    expect(result.systemPrompt).toContain('不能代替成员作答')
    expect(result.systemPrompt).not.toContain('唯一的调度中枢')
    expect(result.systemPrompt).toContain('状态：当前运行')
    expect(result.systemPrompt).toContain('状态：空闲')
    expect(result.systemPrompt).not.toContain('团队编排规则')
    expect(result.systemPrompt).toContain('关注迁移。')
    expect(result.prompt).toContain('评估移动端')
    expect(result.prompt).toContain('主持人')
  })

  it('gives the leader the capability catalog and dispatch protocol', () => {
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, architect],
      agent: leader,
      effectivePrompt: '主持讨论。',
      messages: [message('m1', 'user', '评估移动端')],
      task: '评估移动端',
      callerAgentName: null,
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: null,
      participantStatus: { [architect.id]: 'queued' },
    })
    expect(result.systemPrompt).toContain('参与者能力目录')
    expect(result.systemPrompt).toContain('架构师 描述')
    expect(result.systemPrompt).toContain('团队职责：技术')
    expect(result.systemPrompt).toContain('唯一的调度中枢')
    expect(result.systemPrompt).toContain('mention://agent/')
    expect(result.systemPrompt).toContain('状态：排队中')
    expect(result.systemPrompt).toContain('状态：当前运行')
    expect(result.systemPrompt).toContain('团队编排规则')
    expect(result.systemPrompt).toContain('先拆解任务，再汇总。')
    expect(result.systemPrompt).not.toContain('你只完成本次分派给你的单轮任务')
  })

  it('uses the leader-provided instruction for a dynamic-prompt member', () => {
    const dynamicArchitect = { ...architect, instructionMode: 'leader' as const }
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, dynamicArchitect],
      agent: dynamicArchitect,
      effectivePrompt: '',
      messages: [message('m1', 'user', '评估移动端')],
      task: '评估移动端',
      callerAgentName: '主持人',
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: null,
      instructionMode: 'leader',
      dispatchInstruction: '以架构师身份评估移动端，输出风险清单。',
    })
    expect(result.systemPrompt).toContain('没有预设角色 Prompt')
    expect(result.systemPrompt).toContain('指令来源：指挥者动态下发')
    expect(result.systemPrompt).not.toContain('评估架构。')
    expect(result.prompt).toContain('本轮角色指令')
    expect(result.prompt).toContain('输出风险清单')
  })

  it('tells the leader which members need a dynamically assigned role', () => {
    const dynamicArchitect = { ...architect, instructionMode: 'leader' as const }
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, dynamicArchitect],
      agent: leader,
      effectivePrompt: '主持讨论。',
      messages: [message('m1', 'user', '评估移动端')],
      task: '评估移动端',
      callerAgentName: null,
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: null,
    })
    expect(result.systemPrompt).toContain('指令来源：指挥者动态下发')
    expect(result.systemPrompt).toContain('本轮 @ 必须写清角色、职责边界、输出格式与完成标准')
  })

  it('injects member summaries since the last leader message', () => {
    const messages = [
      message('m1', 'user', '评估移动端'),
      message('m2', 'agent', '主持人开场', leader.id),
      message('m3', 'agent', '架构师结论：分两步迁移。', architect.id),
      message('m4', 'agent', '研究员补充：用户需要离线。', 'researcher'),
    ]
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, architect],
      agent: leader,
      effectivePrompt: '主持讨论。',
      messages,
      task: '评估移动端',
      callerAgentName: null,
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: 'self',
    })
    expect(result.prompt).toContain('架构师结论')
    expect(result.prompt).toContain('研究员补充')
    const updateSection = result.prompt.split('会话上下文：')[0]
    expect(updateSection).not.toContain('主持人开场')
  })

  it('adds the previous serial member result', () => {
    const result = buildTeamRunContext({
      team,
      participantAgents: [leader, architect],
      agent: architect,
      effectivePrompt: '评估架构。',
      messages: [message('m1', 'user', '评估移动端')],
      task: '评估移动端',
      callerAgentName: '主持人',
      workspacePath: '/Users/test/Pizza',
      leaderUpdate: null,
      previousSerialResult: '产品经理：先做离线版本。',
    })
    expect(result.prompt).toContain('产品经理：先做离线版本。')
  })
})
