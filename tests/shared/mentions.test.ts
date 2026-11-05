import { describe, expect, it } from 'vitest'
import {
  parseMentions,
  routeAgentMessage,
  routeUserMessage,
  serializeMention,
  serializeUserMention,
} from '../../src/shared/mentions'

const leader = { id: 'agent-leader', name: '主持人' }
const architect = { id: 'agent-architect', name: '架构师' }
const researcher = { id: 'agent-researcher', name: '研究员' }
const duplicateA = { id: 'agent-dup-a', name: '助手' }
const duplicateB = { id: 'agent-dup-b', name: '助手' }

function context(overrides: Partial<Parameters<typeof parseMentions>[2]> = {}) {
  return {
    sessionAgents: [leader, architect],
    teamAgents: [leader, architect, researcher],
    allAgents: [leader, architect, researcher, duplicateA, duplicateB],
    ...overrides,
  }
}

describe('mention serialization', () => {
  it('serializes agent and user mentions with stable identifiers', () => {
    expect(serializeMention(architect)).toBe(
      '[@架构师](mention://agent/agent-architect)',
    )
    expect(serializeUserMention('我')).toBe('[@我](mention://user)')
  })

  it('escapes square brackets in display names', () => {
    expect(serializeMention({ id: 'id', name: 'A]B' })).toBe(
      '[@A\\]B](mention://agent/id)',
    )
  })
})

describe('parseMentions', () => {
  it('parses user chips and records positions and raw syntax', () => {
    const content = `请 ${serializeMention(architect)} 看看`
    const result = parseMentions(content, 'user', context())
    expect(result.mentions).toHaveLength(1)
    expect(result.mentions[0]).toMatchObject({
      targetType: 'agent',
      targetAgentId: architect.id,
      displayName: '架构师',
      start: 2,
      end: 2 + serializeMention(architect).length,
      raw: serializeMention(architect),
      resolved: true,
    })
    expect(result.targets.map((target) => target.id)).toEqual([architect.id])
  })

  it('only lets agents trigger through exact links', () => {
    const exact = parseMentions(
      `请 ${serializeMention(architect)} 评估`,
      'agent',
      context({ selfAgentId: leader.id }),
    )
    expect(exact.targets.map((target) => target.id)).toEqual([architect.id])

    const plain = parseMentions('请 @架构师 评估', 'agent', context({ selfAgentId: leader.id }))
    expect(plain.targets).toHaveLength(0)
  })

  it('resolves plain user mentions by session, team, then unique global name', () => {
    const sessionHit = parseMentions('请 @主持人 说明', 'user', context())
    expect(sessionHit.targets[0].id).toBe(leader.id)

    const teamOnly = parseMentions('请 @研究员 补充', 'user', context())
    expect(teamOnly.targets[0].id).toBe(researcher.id)

    const globalOnly = parseMentions('请 @研究员 补充', 'user', {
      sessionAgents: [leader],
      teamAgents: [leader],
      allAgents: [leader, researcher],
    })
    expect(globalOnly.targets[0].id).toBe(researcher.id)
  })

  it('reports ambiguous names without guessing', () => {
    const result = parseMentions('请 @助手 回答', 'user', {
      sessionAgents: [],
      teamAgents: [],
      allAgents: [duplicateA, duplicateB],
    })
    expect(result.targets).toHaveLength(0)
    expect(result.ambiguous).toHaveLength(1)
    expect(result.ambiguous[0].displayName).toBe('助手')
    expect(result.mentions[0].resolved).toBe(false)
  })

  it('keeps unknown targets and deduplicates repeated targets', () => {
    const result = parseMentions(
      `@不存在 ${serializeMention(architect)} ${serializeMention(architect)}`,
      'user',
      context(),
    )
    expect(result.unknown).toHaveLength(1)
    expect(result.targets.map((target) => target.id)).toEqual([architect.id])
    expect(result.mentions).toHaveLength(3)
  })

  it('marks self mentions and removes them from targets', () => {
    const result = parseMentions(
      `${serializeMention(leader)} ${serializeMention(architect)}`,
      'agent',
      context({ selfAgentId: leader.id }),
    )
    expect(result.selfMentions).toHaveLength(1)
    expect(result.targets.map((target) => target.id)).toEqual([architect.id])
  })

  it('parses user mentions as a waiting signal', () => {
    const result = parseMentions(
      `${serializeUserMention('我')} 请确认`,
      'agent',
      context(),
    )
    expect(result.mentions[0].targetType).toBe('user')
    expect(result.userMentioned).toBe(true)
  })
})

const team = {
  leaderAgentId: leader.id,
  members: [{ agentId: leader.id }, { agentId: architect.id }, { agentId: researcher.id }],
}

describe('team routing', () => {
  it('routes user messages without mentions to the leader', () => {
    const parsed = parseMentions('帮我评估方案', 'user', context())
    const route = routeUserMessage(team, parsed)
    expect(route.dispatchAgentIds).toEqual([leader.id])
    expect(route.notifyLeader).toBe(false)
    expect(route.waitingUser).toBe(false)
  })

  it('routes direct member mentions only and copies the leader', () => {
    const parsed = parseMentions(
      `${serializeMention(architect)} ${serializeMention(researcher)}`,
      'user',
      context(),
    )
    const route = routeUserMessage(team, parsed)
    expect(route.dispatchAgentIds).toEqual([architect.id, researcher.id])
    expect(route.notifyLeader).toBe(true)
    expect(route.reason).toBe('user_mention')
  })

  it('does not copy the leader when the leader is explicitly mentioned', () => {
    const parsed = parseMentions(serializeMention(leader), 'user', context())
    const route = routeUserMessage(team, parsed)
    expect(route.dispatchAgentIds).toEqual([leader.id])
    expect(route.notifyLeader).toBe(false)
  })

  it('does not silently fall back to the leader for an unresolved mention', () => {
    const parsed = parseMentions('@不存在 请处理', 'user', context())
    const route = routeUserMessage(team, parsed)
    expect(route.dispatchAgentIds).toEqual([])
    expect(route.reason).toBe('unresolved_mention')
  })

  it('enters waiting_user when a user mention is present', () => {
    const parsed = parseMentions(serializeUserMention('我'), 'user', context())
    const route = routeUserMessage(team, parsed)
    expect(route.waitingUser).toBe(true)
  })

  it('returns member replies to the caller when no explicit mention exists', () => {
    const parsed = parseMentions('我认为可以分两步。', 'agent', context({ selfAgentId: architect.id }))
    const route = routeAgentMessage(team, parsed, {
      senderAgentId: architect.id,
      callerAgentId: leader.id,
    })
    expect(route.dispatchAgentIds).toEqual([leader.id])
    expect(route.reason).toBe('return_to_caller')
  })

  it('lets explicit member mentions win over returning to the caller', () => {
    const parsed = parseMentions(
      serializeMention(researcher),
      'agent',
      context({ selfAgentId: architect.id }),
    )
    const route = routeAgentMessage(team, parsed, {
      senderAgentId: architect.id,
      callerAgentId: leader.id,
    })
    expect(route.dispatchAgentIds).toEqual([researcher.id])
    expect(route.notifyLeader).toBe(false)
    expect(route.reason).toBe('agent_mention')
  })

  it('ends the turn when the leader speaks without mentioning anyone', () => {
    const parsed = parseMentions('## 结论\n可以上线。', 'agent', context({ selfAgentId: leader.id }))
    const route = routeAgentMessage(team, parsed, {
      senderAgentId: leader.id,
      callerAgentId: null,
    })
    expect(route.dispatchAgentIds).toEqual([])
    expect(route.reason).toBe('leader_finished')
  })

  it('marks waiting_user when an agent mentions the user', () => {
    const parsed = parseMentions(serializeUserMention('我'), 'agent', context({ selfAgentId: architect.id }))
    const route = routeAgentMessage(team, parsed, {
      senderAgentId: architect.id,
      callerAgentId: leader.id,
    })
    expect(route.waitingUser).toBe(true)
  })
})
