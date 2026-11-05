import type { MentionTargetType } from './types'

export interface MentionAgent {
  id: string
  name: string
}

export interface MentionResolutionContext {
  /** 当前会话里的参与者，用于第一优先级精确匹配。 */
  sessionAgents?: MentionAgent[]
  /** 当前团队成员，用于第二优先级匹配。 */
  teamAgents?: MentionAgent[]
  /** 工作区全部可见智能体，只在名称全局唯一时兜底。 */
  allAgents?: MentionAgent[]
  /** 发送者自身；自引用会被忽略并写入审计。 */
  selfAgentId?: string | null
}

export interface ParsedMention {
  targetType: MentionTargetType
  targetAgentId: string | null
  displayName: string
  start: number
  end: number
  raw: string
  resolved: boolean
}

export interface MentionIssue {
  displayName: string
  start: number
  end: number
  raw: string
  candidates?: MentionAgent[]
}

export interface MentionParseResult {
  mentions: ParsedMention[]
  /** 已解析、去重且排除自引用后的智能体目标。 */
  targets: MentionAgent[]
  unknown: MentionIssue[]
  ambiguous: MentionIssue[]
  selfMentions: ParsedMention[]
  userMentioned: boolean
}

export type MentionMode = 'user' | 'agent'

export interface TeamRouteShape {
  leaderAgentId: string
  members: Array<{ agentId: string }>
}

export interface TeamRoute {
  dispatchAgentIds: string[]
  notifyLeader: boolean
  waitingUser: boolean
  reason:
    | 'default_leader'
    | 'user_mention'
    | 'agent_mention'
    | 'return_to_caller'
    | 'leader_finished'
    | 'waiting_user'
    | 'unresolved_mention'
  ignoredSelf: boolean
}

const LINK_PATTERN = /\[@([^\]]+)\]\(mention:\/\/(agent|user)(?:\/([^)]+))?\)/g
const PLAIN_PATTERN = /@([\p{L}\p{N}_-]+)/gu
const SELF_NAMES = new Set(['我', 'user'])

function escapeName(name: string): string {
  return name.replace(/\\/g, '\\\\').replace(/\]/g, '\\]')
}

function unescapeName(name: string): string {
  return name.replace(/\\\]/g, ']').replace(/\\\\/g, '\\')
}

/** 生成主进程可稳定解析的精确提及语法；名称只影响展示。 */
export function serializeMention(agent: Pick<MentionAgent, 'id' | 'name'>): string {
  return `[@${escapeName(agent.name)}](mention://agent/${agent.id})`
}

export function serializeUserMention(name = '我'): string {
  return `[@${escapeName(name)}](mention://user)`
}

function resolveByName(
  name: string,
  context: MentionResolutionContext,
): { agent?: MentionAgent; candidates?: MentionAgent[] } {
  const levels = [context.sessionAgents ?? [], context.teamAgents ?? [], context.allAgents ?? []]
  for (const level of levels) {
    const matches = level.filter((agent) => agent.name === name)
    if (matches.length === 1) return { agent: matches[0] }
    if (matches.length > 1) {
      const unique = Array.from(new Map(matches.map((agent) => [agent.id, agent])).values())
      return { candidates: unique }
    }
  }
  return {}
}

function resolveById(
  id: string,
  context: MentionResolutionContext,
): MentionAgent | undefined {
  const pool = [
    ...(context.sessionAgents ?? []),
    ...(context.teamAgents ?? []),
    ...(context.allAgents ?? []),
  ]
  return pool.find((agent) => agent.id === id)
}

/**
 * 解析消息中的提及。
 *
 * 用户消息同时接受 chip 序列化与文本 `@名称`；智能体消息只接受
 * `[@名称](mention://agent/<id>)`，避免模型在普通文本里写 @ 就触发调度。
 */
export function parseMentions(
  content: string,
  mode: MentionMode,
  context: MentionResolutionContext = {},
): MentionParseResult {
  const mentions: ParsedMention[] = []
  const unknown: MentionIssue[] = []
  const ambiguous: MentionIssue[] = []
  const selfMentions: ParsedMention[] = []
  const covered: Array<{ start: number; end: number }> = []
  let userMentioned = false

  for (const match of content.matchAll(LINK_PATTERN)) {
    const raw = match[0]
    const displayName = unescapeName(match[1])
    const kind = match[2] as 'agent' | 'user'
    const id = match[3] ?? null
    const start = match.index ?? 0
    const end = start + raw.length
    covered.push({ start, end })

    if (kind === 'user') {
      mentions.push({
        targetType: 'user',
        targetAgentId: null,
        displayName,
        start,
        end,
        raw,
        resolved: true,
      })
      userMentioned = true
      continue
    }

    const agent = id ? resolveById(id, context) : undefined
    if (!agent) {
      const issue: MentionIssue = { displayName, start, end, raw }
      unknown.push(issue)
      mentions.push({
        targetType: 'agent',
        targetAgentId: id,
        displayName,
        start,
        end,
        raw,
        resolved: false,
      })
      continue
    }

    const mention: ParsedMention = {
      targetType: 'agent',
      targetAgentId: agent.id,
      displayName,
      start,
      end,
      raw,
      resolved: true,
    }
    mentions.push(mention)
    if (context.selfAgentId && agent.id === context.selfAgentId) {
      selfMentions.push(mention)
    }
  }

  if (mode === 'user') {
    for (const match of content.matchAll(PLAIN_PATTERN)) {
      const start = match.index ?? 0
      const end = start + match[0].length
      if (covered.some((range) => start >= range.start && start < range.end)) continue
      const name = match[1]
      const { agent, candidates } = resolveByName(name, context)
      if (agent) {
        mentions.push({
          targetType: 'agent',
          targetAgentId: agent.id,
          displayName: name,
          start,
          end,
          raw: match[0],
          resolved: true,
        })
        continue
      }
      if (candidates && candidates.length > 1) {
        ambiguous.push({ displayName: name, start, end, raw: match[0], candidates })
        mentions.push({
          targetType: 'agent',
          targetAgentId: null,
          displayName: name,
          start,
          end,
          raw: match[0],
          resolved: false,
        })
        continue
      }
      if (SELF_NAMES.has(name)) {
        mentions.push({
          targetType: 'user',
          targetAgentId: null,
          displayName: name,
          start,
          end,
          raw: match[0],
          resolved: true,
        })
        userMentioned = true
        continue
      }
      unknown.push({ displayName: name, start, end, raw: match[0] })
      mentions.push({
        targetType: 'unknown',
        targetAgentId: null,
        displayName: name,
        start,
        end,
        raw: match[0],
        resolved: false,
      })
    }
  }

  mentions.sort((left, right) => left.start - right.start)
  const seen = new Set<string>()
  const targets: MentionAgent[] = []
  for (const mention of mentions) {
    if (mention.targetType !== 'agent' || !mention.resolved || !mention.targetAgentId) continue
    if (context.selfAgentId && mention.targetAgentId === context.selfAgentId) continue
    if (seen.has(mention.targetAgentId)) continue
    seen.add(mention.targetAgentId)
    const agent =
      resolveById(mention.targetAgentId, context) ??
      ({ id: mention.targetAgentId, name: mention.displayName } satisfies MentionAgent)
    targets.push(agent)
  }

  return {
    mentions,
    targets,
    unknown,
    ambiguous,
    selfMentions,
    userMentioned,
  }
}

/** 用户消息：未提及时默认指挥者；直接 @ 成员时抄送指挥者。 */
export function routeUserMessage(team: TeamRouteShape, parsed: MentionParseResult): TeamRoute {
  if (parsed.targets.length === 0) {
    if (parsed.userMentioned) {
      return {
        dispatchAgentIds: [],
        notifyLeader: false,
        waitingUser: true,
        reason: 'waiting_user',
        ignoredSelf: false,
      }
    }
    if (parsed.unknown.length > 0 || parsed.ambiguous.length > 0) {
      // 提及不明确时不能静默回落给指挥者，否则用户会以为目标已收到任务。
      return {
        dispatchAgentIds: [],
        notifyLeader: false,
        waitingUser: false,
        reason: 'unresolved_mention',
        ignoredSelf: false,
      }
    }
    return {
      dispatchAgentIds: [team.leaderAgentId],
      notifyLeader: false,
      waitingUser: false,
      reason: 'default_leader',
      ignoredSelf: false,
    }
  }

  const ids = parsed.targets.map((target) => target.id)
  const mentionsLeader = ids.includes(team.leaderAgentId)
  return {
    dispatchAgentIds: ids,
    notifyLeader: !mentionsLeader,
    waitingUser: parsed.userMentioned,
    reason: 'user_mention',
    ignoredSelf: false,
  }
}

/**
 * 智能体消息：显式提及优先；成员没有提及时回到调用者；
 * 指挥者没有提及时视为本轮收敛结束。
 */
export function routeAgentMessage(
  team: TeamRouteShape,
  parsed: MentionParseResult,
  input: { senderAgentId: string; callerAgentId: string | null },
): TeamRoute {
  const ignoredSelf = parsed.selfMentions.some(
    (mention) => mention.targetAgentId === input.senderAgentId,
  )
  const ids = parsed.targets.map((target) => target.id)

  if (ids.length > 0) {
    return {
      dispatchAgentIds: ids,
      notifyLeader: false,
      waitingUser: parsed.userMentioned,
      reason: 'agent_mention',
      ignoredSelf,
    }
  }

  if (parsed.userMentioned) {
    return {
      dispatchAgentIds: [],
      notifyLeader: false,
      waitingUser: true,
      reason: 'waiting_user',
      ignoredSelf,
    }
  }

  if (input.senderAgentId === team.leaderAgentId) {
    return {
      dispatchAgentIds: [],
      notifyLeader: false,
      waitingUser: false,
      reason: 'leader_finished',
      ignoredSelf,
    }
  }

  const caller =
    input.callerAgentId && input.callerAgentId !== input.senderAgentId
      ? input.callerAgentId
      : team.leaderAgentId
  return {
    dispatchAgentIds: caller === input.senderAgentId ? [] : [caller],
    notifyLeader: false,
    waitingUser: false,
    reason: 'return_to_caller',
    ignoredSelf,
  }
}
