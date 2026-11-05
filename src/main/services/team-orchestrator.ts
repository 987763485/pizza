import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Agent,
  Message,
  RuntimeConfig,
  SendMessageInput,
  Session,
  TeamDetail,
  TeamSendResult,
  TeamTurn,
  TeamTurnEvent,
  TeamTurnStatus,
} from '@shared/types'
import type { Store } from '../db/store'
import type { AgentRunInput, AgentRunResult } from './agent-run-executor'
import { buildTeamRunContext } from './team-context-builder'
import { detectAba, evaluateLimits, isSimilarInvocation, type InteractionEdge } from './team-protections'
import {
  parseMentions,
  routeAgentMessage,
  routeUserMessage,
  type MentionAgent,
  type MentionParseResult,
} from '@shared/mentions'
import { canTransitionTeamTurn } from '@shared/team-state'
import type { TeamService } from './team-service'

export interface TeamRunExecutorLike {
  execute(input: AgentRunInput): Promise<AgentRunResult>
  hasActiveSession(sessionId: string): boolean
  isRunning(runId: string): boolean
  stop(runId: string): boolean
}

export interface TeamOrchestratorDeps {
  store: Store
  teams: TeamService
  executor: TeamRunExecutorLike
  runtimeFor: (agent: Agent) => RuntimeConfig
  saveAttachment: (input: {
    name: string
    mime: string
    data: Uint8Array
  }) => { name: string; path: string; mime: string; size: number }
  artifacts: {
    recordFile(input: {
      sessionId: string
      runId: string
      agentId: string
      path: string
    }): unknown
  }
  globalMaxConcurrency?: number
  /** 收敛产出物的标题跟随界面语言；缺省保持中文。 */
  language?: () => 'zh-CN' | 'en'
  onTurnEvent?: (event: TeamTurnEvent) => void
  onSessionUpdated?: (sessionId: string) => void
  /** 成员消息与提及落库后触发通知扫描。 */
  onAssistantCompleted?: (sessionId: string, messageId: string) => void
}

interface DispatchItem {
  agentId: string
  triggerMessageId: string
  triggerRunId: string | null
  callerAgentId: string | null
  task: string
  note?: string
  serialPrevious?: string | null
  convergence?: boolean
}

interface ActiveTeamRun {
  runId: string
  agentId: string
  assistantMessageId: string
  triggerRunId: string | null
  callerAgentId: string | null
  triggerMessageId: string
}

interface QueuedUserMessage {
  message: Message
  task: string
  targets: string[]
  waitingUser: boolean
}

interface SessionState {
  turnId: string | null
  queue: DispatchItem[]
  active: Map<string, ActiveTeamRun>
  queuedUser: QueuedUserMessage[]
  busy: boolean
  waitingUser: boolean
  /** 成员运行结束后才生效的等待用户标记。 */
  pendingWaiting: boolean
  cancelled: boolean
  rounds: number
  hops: number
  tokensIn: number
  tokensOut: number
  leaderRuns: number
  leaderFinished: boolean
  convergenceDispatched: boolean
  edges: InteractionEdge[]
  recentDispatches: Array<{
    from: string
    to: string
    content: string
    at: number
  }>
  serialPrevious: string | null
  lastText: string | null
  lastRunId: string | null
  lastLeaderText: string | null
  lastLeaderRunId: string | null
  task: string
  lastTriggerMessageId: string | null
}

function createState(): SessionState {
  return {
    turnId: null,
    queue: [],
    active: new Map(),
    queuedUser: [],
    busy: false,
    waitingUser: false,
    pendingWaiting: false,
    cancelled: false,
    rounds: 0,
    hops: 0,
    tokensIn: 0,
    tokensOut: 0,
    leaderRuns: 0,
    leaderFinished: false,
    convergenceDispatched: false,
    edges: [],
    recentDispatches: [],
    serialPrevious: null,
    lastText: null,
    lastRunId: null,
    lastLeaderText: null,
    lastLeaderRunId: null,
    task: '',
    lastTriggerMessageId: null,
  }
}

function resetTurnState(state: SessionState): void {
  state.queue = []
  state.active.clear()
  state.queuedUser = []
  state.waitingUser = false
  state.pendingWaiting = false
  state.cancelled = false
  state.rounds = 0
  state.hops = 0
  state.tokensIn = 0
  state.tokensOut = 0
  state.leaderRuns = 0
  state.leaderFinished = false
  state.convergenceDispatched = false
  state.edges = []
  state.recentDispatches = []
  state.serialPrevious = null
  state.lastText = null
  state.lastRunId = null
  state.lastLeaderText = null
  state.lastLeaderRunId = null
}

const TERMINAL_STATUSES = new Set<TeamTurnStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])

/**
 * 团队会话调度器：每个会话一个串行状态机、一个内存队列和一组活动运行。
 * 数据库中的 team_turn / team_turn_event 是恢复和审计的事实来源。
 */
export class TeamOrchestrator {
  private readonly states = new Map<string, SessionState>()
  private readonly waiters = new Map<string, Array<() => void>>()
  private readonly turnSessions = new Map<string, string>()

  constructor(private readonly deps: TeamOrchestratorDeps) {}

  async send(input: SendMessageInput): Promise<TeamSendResult> {
    const store = this.deps.store
    const session = store.getSession(input.sessionId)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    if (session.mode !== 'team' || !session.teamId) throw new Error('NOT_TEAM_SESSION')
    const team = this.deps.teams.get(session.teamId)
    if (team.deletedAt) throw new Error('TEAM_DELETED')
    if (team.isArchived) throw new Error('TEAM_ARCHIVED')

    const savedAttachments = (input.attachments ?? []).map((attachment) =>
      this.deps.saveAttachment(attachment),
    )
    const existing = store.listMessages(session.id)
    const parsed = this.parseForSession(session, team, input.content, 'user')

    const state = this.state(session.id)
    const activeTurn = this.activeTurn(session.id)
    const continuing =
      activeTurn?.status === 'waiting_user' &&
      state.active.size === 0 &&
      state.queue.length === 0
    const queued = !!activeTurn && !continuing
    const userMessage = store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: input.content,
      status: queued ? 'queued' : 'completed',
      roundNo: activeTurn?.seq ?? 1,
    })
    for (const attachment of savedAttachments) {
      store.addAttachment(userMessage.id, attachment)
    }
    this.persistMentions(userMessage.id, parsed)
    const mentionIssues = [
      ...parsed.unknown.map((issue) => `未找到智能体「${issue.displayName}」。`),
      ...parsed.ambiguous.map(
        (issue) => `提及「${issue.displayName}」不明确，请使用提及选择器指定成员。`,
      ),
    ]
    if (mentionIssues.length) {
      store.createMessage({
        sessionId: session.id,
        senderType: 'system',
        content: mentionIssues.join('\n'),
        status: 'completed',
      })
    }

    if (existing.length === 0 && session.title === '新团队会话') {
      const title =
        input.content.length > 24 ? `${input.content.slice(0, 24)}…` : input.content
      store.renameSession(session.id, title)
    }
    store.touchSession(session.id)
    store.touchTeam(team.id)

    const route = routeUserMessage(team, parsed)
    const memberIds = new Set(team.members.map((member) => member.agentId))
    const dispatchTargets = route.dispatchAgentIds.filter((id) => memberIds.has(id))
    const ignoredTargets = route.dispatchAgentIds.filter((id) => !memberIds.has(id))
    if (ignoredTargets.length) {
      const names = ignoredTargets
        .map((id) => store.getAgent(id)?.name ?? id)
        .join('、')
      store.createMessage({
        sessionId: session.id,
        senderType: 'system',
        content: `「${names}」不是当前团队成员，已忽略该提及。请使用提及选择器选择团队成员。`,
        status: 'completed',
      })
    }
    state.lastTriggerMessageId = userMessage.id

    if (continuing && activeTurn) {
      // 团队在等待用户时，回复应继续当前回合，而不是被当成排队插话。
      state.waitingUser = false
      this.updateTurnStatus(activeTurn.id, 'debating', {})
      this.event(activeTurn.id, 'user_interjection', {
        messageId: userMessage.id,
        targets: dispatchTargets,
        ignoredTargets,
        waitingUser: route.waitingUser,
        queued: false,
        reason: 'waiting_user_reply',
      })
      this.enqueueTargets(state, dispatchTargets, {
        triggerMessageId: userMessage.id,
        triggerRunId: null,
        callerAgentId: null,
        task: input.content,
      })
      state.task = input.content
      if (route.waitingUser) this.setWaitingUser(session, state, activeTurn, false)
      store.setSessionStatus(
        session.id,
        route.waitingUser ? 'waiting_user' : 'running',
      )
      this.notifySession(session.id)
      void this.pump(session.id)
      return { userMessage, turn: activeTurn, queued: false }
    }

    if (queued) {
      store.updateMessageStatus(userMessage.id, 'queued')
      this.event(activeTurn.id, 'user_interjection', {
        messageId: userMessage.id,
        targets: dispatchTargets,
        ignoredTargets,
        waitingUser: route.waitingUser,
        queued: true,
        reason: 'runtime_append_unsupported',
      })
      state.queuedUser.push({
        message: userMessage,
        task: input.content,
        targets: dispatchTargets,
        waitingUser: route.waitingUser,
      })
    } else {
      resetTurnState(state)
      const turn = store.createTeamTurn({
        sessionId: session.id,
        triggerMessageId: userMessage.id,
        leaderAgentId: team.leaderAgentId,
      })
      this.turnSessions.set(turn.id, session.id)
      state.turnId = turn.id
      state.task = input.content
      state.rounds = 1
      this.event(turn.id, 'turn_started', {
        triggerMessageId: userMessage.id,
        route: route.reason,
      })
      if (route.waitingUser && dispatchTargets.length === 0) {
        this.setWaitingUser(session, state, turn)
      } else {
        this.setTurnStatus(turn, 'debating')
        this.enqueueTargets(state, dispatchTargets, {
          triggerMessageId: userMessage.id,
          triggerRunId: null,
          callerAgentId: null,
          task: input.content,
        })
        if (route.notifyLeader) {
          this.event(turn.id, 'notice', {
            kind: 'leader_passive_notification',
            messageId: userMessage.id,
            targetAgentIds: dispatchTargets,
          })
        }
        if (route.waitingUser) this.setWaitingUser(session, state, turn, false)
      }
      store.setSessionStatus(session.id, route.waitingUser ? 'waiting_user' : 'running')
      this.notifySession(session.id)
      void this.pump(session.id)
      return { userMessage, turn, queued: false }
    }

    store.setSessionStatus(session.id, 'running')
    this.notifySession(session.id)
    void this.pump(session.id)
    return {
      userMessage,
      turn: activeTurn,
      queued: true,
    }
  }

  /** 重试一条团队消息：新开回合，只把原触发消息重新交给该成员。 */
  async retry(messageId: string): Promise<TeamSendResult> {
    const store = this.deps.store
    const message = store.getMessage(messageId)
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    if (message.senderType !== 'agent' || !message.senderAgentId) {
      throw new Error('MESSAGE_NOT_RETRYABLE')
    }
    const session = store.getSession(message.sessionId)
    if (!session || session.mode !== 'team' || !session.teamId) {
      throw new Error('NOT_TEAM_SESSION')
    }
    if (this.activeTurn(session.id)) throw new Error('TEAM_TURN_ACTIVE')
    const team = this.deps.teams.get(session.teamId)
    if (team.deletedAt) throw new Error('TEAM_DELETED')
    if (!team.members.some((member) => member.agentId === message.senderAgentId)) {
      throw new Error('TEAM_MEMBER_NOT_FOUND')
    }
    const trigger =
      (message.replyToId ? store.getMessage(message.replyToId) : null) ??
      store
        .listMessages(session.id)
        .slice()
        .reverse()
        .find((item) => item.senderType === 'user')
    if (!trigger) throw new Error('RETRY_SOURCE_NOT_FOUND')

    const state = this.state(session.id)
    resetTurnState(state)
    const turn = store.createTeamTurn({
      sessionId: session.id,
      triggerMessageId: trigger.id,
      leaderAgentId: team.leaderAgentId,
    })
    this.turnSessions.set(turn.id, session.id)
    state.turnId = turn.id
    state.task = trigger.content
    state.rounds = 1
    state.lastTriggerMessageId = trigger.id
    this.event(turn.id, 'turn_started', {
      triggerMessageId: trigger.id,
      route: 'retry',
      retryOf: message.id,
    })
    this.setTurnStatus(turn, 'debating')
    this.enqueueTargets(state, [message.senderAgentId], {
      triggerMessageId: trigger.id,
      triggerRunId: null,
      callerAgentId: null,
      task: trigger.content,
    })
    store.setSessionStatus(session.id, 'running')
    this.notifySession(session.id)
    void this.pump(session.id)
    return { userMessage: trigger, turn, queued: false }
  }

  turns(sessionId: string): TeamTurn[] {
    return this.deps.store.listTeamTurns(sessionId)
  }

  turnEvents(turnId: string): TeamTurnEvent[] {
    return this.deps.store.listTeamTurnEvents(turnId)
  }

  stopTurn(turnId: string): void {
    const turn = this.deps.store.getTeamTurn(turnId)
    if (!turn || TERMINAL_STATUSES.has(turn.status)) return
    const sessionId = this.turnSessions.get(turnId) ?? turn.sessionId
    const state = this.state(sessionId)
    state.cancelled = true
    for (const active of state.active.values()) {
      this.deps.executor.stop(active.runId)
      const message = this.deps.store.getMessage(active.assistantMessageId)
      if (message && !message.content.trim()) {
        this.deps.store.updateMessageContent(active.assistantMessageId, '已停止')
        this.deps.store.updateMessageStatus(active.assistantMessageId, 'cancelled')
      }
    }
    for (const item of state.queue) {
      // 尚未启动的队列项没有运行和消息记录，直接丢弃并写审计事件。
      this.event(turnId, 'notice', { kind: 'queued_dispatch_cancelled', agentId: item.agentId })
    }
    state.queue = []
    state.active.clear()
    for (const queued of state.queuedUser) {
      // 回合已停止，排队插话不会再有送达机会，必须显式标记而不是永久 queued。
      this.deps.store.updateMessageStatus(queued.message.id, 'cancelled')
    }
    state.queuedUser = []
    state.waitingUser = false
    this.updateTurnStatus(turnId, 'cancelled', { endedAt: new Date().toISOString(), error: '用户停止回合' })
    this.event(turnId, 'turn_cancelled', { reason: 'user' })
    this.deps.store.setSessionStatus(sessionId, 'idle')
    this.notifySession(sessionId)
    this.notifyIdle(sessionId)
  }

  stopRun(runId: string): boolean {
    return this.deps.executor.stop(runId)
  }

  isTurnCancelled(turnId: string): boolean {
    const turn = this.deps.store.getTeamTurn(turnId)
    return turn?.status === 'cancelled'
  }

  whenIdle(sessionId: string): Promise<void> {
    const state = this.states.get(sessionId)
    if (!state || this.isIdle(state)) return Promise.resolve()
    return new Promise((resolve) => {
      const list = this.waiters.get(sessionId) ?? []
      list.push(resolve)
      this.waiters.set(sessionId, list)
    })
  }

  shutdown(): void {
    for (const state of this.states.values()) {
      state.cancelled = true
      for (const active of state.active.values()) this.deps.executor.stop(active.runId)
    }
  }

  // ---------- state ----------

  private state(sessionId: string): SessionState {
    let state = this.states.get(sessionId)
    if (!state) {
      state = createState()
      this.states.set(sessionId, state)
      const turns = this.deps.store.listTeamTurns(sessionId)
      const last = turns.at(-1)
      if (last && !TERMINAL_STATUSES.has(last.status)) {
        state.turnId = last.id
        this.turnSessions.set(last.id, sessionId)
      }
    }
    return state
  }

  private activeTurn(sessionId: string): TeamTurn | null {
    const turns = this.deps.store.listTeamTurns(sessionId)
    const last = turns.at(-1)
    if (!last || TERMINAL_STATUSES.has(last.status)) return null
    return last
  }

  private setTurnStatus(turn: TeamTurn, status: TeamTurnStatus): TeamTurn {
    if (!canTransitionTeamTurn(turn.status, status)) return turn
    return this.updateTurnStatus(turn.id, status, {})
  }

  private updateTurnStatus(
    turnId: string,
    status: TeamTurnStatus,
    patch: Parameters<Store['updateTeamTurn']>[1],
  ): TeamTurn {
    const current = this.deps.store.getTeamTurn(turnId)
    if (!current) throw new Error('TEAM_TURN_NOT_FOUND')
    if (!canTransitionTeamTurn(current.status, status)) return current
    return this.deps.store.updateTeamTurn(turnId, { ...patch, status })
  }

  private event(
    turnId: string,
    type: TeamTurnEvent['type'],
    payload: Record<string, unknown>,
    options: { participantAgentId?: string | null; runId?: string | null } = {},
  ): TeamTurnEvent {
    const event = this.deps.store.addTeamTurnEvent({
      turnId,
      type,
      participantAgentId: options.participantAgentId ?? null,
      runId: options.runId ?? null,
      payload,
    })
    this.deps.onTurnEvent?.(event)
    return event
  }

  private notifySession(sessionId: string): void {
    this.deps.onSessionUpdated?.(sessionId)
  }

  private notifyIdle(sessionId: string): void {
    const list = this.waiters.get(sessionId)
    if (!list?.length) return
    this.waiters.delete(sessionId)
    for (const resolve of list) resolve()
  }

  private isIdle(state: SessionState): boolean {
    if (state.busy || state.active.size > 0) return false
    if (state.queue.length > 0 || state.queuedUser.length > 0) return false
    if (!state.turnId) return true
    const turn = this.deps.store.getTeamTurn(state.turnId)
    return !turn || TERMINAL_STATUSES.has(turn.status)
  }

  // ---------- pumping ----------

  private async pump(sessionId: string): Promise<void> {
    const state = this.state(sessionId)
    if (state.busy) return
    state.busy = true
    try {
      const session = this.deps.store.getSession(sessionId)
      if (!session) return
      const team = session.teamId ? this.deps.teams.get(session.teamId) : null
      if (!team) return
      const maxConcurrency = Math.max(
        1,
        Math.min(team.maxConcurrency, this.deps.globalMaxConcurrency ?? team.maxConcurrency),
      )

      while (state.turnId) {
        const turn = this.deps.store.getTeamTurn(state.turnId)
        if (!turn || TERMINAL_STATUSES.has(turn.status) || state.cancelled) break

        // 用户已经插话时优先送达，而不是继续停在等待用户状态。
        if (
          state.queuedUser.length > 0 &&
          state.active.size === 0 &&
          state.queue.length === 0
        ) {
          const next = state.queuedUser.shift() as QueuedUserMessage
          this.deps.store.updateMessageStatus(next.message.id, 'completed')
          this.event(turn.id, 'notice', {
            kind: 'interjection_delivered',
            messageId: next.message.id,
          })
          state.waitingUser = false
          state.pendingWaiting = false
          if (state.turnId) this.setTurnStatus(turn, 'debating')
          if (next.targets.length === 0 && !next.waitingUser) {
            this.enqueueTargets(state, [team.leaderAgentId], {
              triggerMessageId: next.message.id,
              triggerRunId: null,
              callerAgentId: null,
              task: next.task,
            })
          } else {
            this.enqueueTargets(state, next.targets, {
              triggerMessageId: next.message.id,
              triggerRunId: null,
              callerAgentId: null,
              task: next.task,
            })
          }
          state.task = next.task
          state.lastTriggerMessageId = next.message.id
          if (next.waitingUser) this.setWaitingUser(session, state, turn, false)
          continue
        }

        if (
          state.pendingWaiting &&
          state.active.size === 0 &&
          state.queue.length === 0
        ) {
          state.pendingWaiting = false
          this.setWaitingUser(session, state, turn)
          break
        }

        if (state.waitingUser && state.active.size === 0 && state.queue.length === 0) {
          this.deps.store.setSessionStatus(sessionId, 'waiting_user')
          break
        }

        const serialBlocked =
          team.fanoutStrategy === 'serial' && state.active.size > 0
        if (serialBlocked || state.active.size >= maxConcurrency) break

        if (state.queue.length > 0) {
          const item = state.queue.shift() as DispatchItem
          this.prepareDispatch(state, session, turn, item)
          continue
        }

        if (state.active.size > 0) break

        if (state.waitingUser) break
        await this.finishTurn(session, state, turn)
      }
    } finally {
      state.busy = false
      if (this.isIdle(state) || (state.turnId && TERMINAL_STATUSES.has(this.deps.store.getTeamTurn(state.turnId)?.status ?? 'completed'))) {
        this.notifyIdle(sessionId)
      }
    }
  }

  private prepareDispatch(
    state: SessionState,
    session: Session,
    turn: TeamTurn,
    item: DispatchItem,
  ): void {
    // 同一智能体同时只允许一个运行；重复目标直接抑制。
    const alreadyActive = Array.from(state.active.values()).some(
      (active) => active.agentId === item.agentId,
    )
    const alreadyQueued = state.queue.some((queued) => queued.agentId === item.agentId)
    if (alreadyActive || alreadyQueued) {
      this.event(turn.id, 'notice', {
        kind: 'duplicate_target_suppressed',
        agentId: item.agentId,
      })
      return
    }

    if (!item.convergence) {
      const team = this.deps.teams.get(session.teamId as string)
      const limits = evaluateLimits({
        hops: state.hops,
        maxHops: team.maxHops,
        tokens: state.tokensIn + state.tokensOut,
        tokenBudget: team.tokenBudget,
      })
      if (limits.action === 'stop') {
        this.triggerConvergence(session, state, turn, limits.reasons.join(','))
        return
      }
      if (limits.action === 'warn') {
        this.event(turn.id, 'protection_triggered', {
          reason: limits.reasons.join(','),
          action: 'warn',
        })
      }

      const now = Date.now()
      const duplicate = state.recentDispatches.find(
        (dispatch) =>
          dispatch.from === (item.callerAgentId ?? 'user') &&
          dispatch.to === item.agentId &&
          now - dispatch.at <= 2 * 60_000 &&
          isSimilarInvocation(dispatch.content, item.task),
      )
      if (duplicate) {
        this.event(turn.id, 'protection_triggered', {
          reason: 'duplicate_invocation',
          agentId: item.agentId,
        })
        return
      }
      state.recentDispatches.push({
        from: item.callerAgentId ?? 'user',
        to: item.agentId,
        content: item.task,
        at: now,
      })
      if (item.callerAgentId) {
        state.edges.push({ from: item.callerAgentId, to: item.agentId })
        if (detectAba(state.edges)) {
          this.event(turn.id, 'protection_triggered', { reason: 'aba_loop' })
          this.triggerConvergence(session, state, turn, 'aba_loop')
          return
        }
      }
      state.hops += 1
      if (item.agentId === this.deps.teams.get(session.teamId as string).leaderAgentId) {
        if (state.leaderRuns > 0) state.rounds += 1
        state.leaderRuns += 1
      }
    }

    this.startDispatch(state, session, turn, item)
  }

  private startDispatch(
    state: SessionState,
    session: Session,
    turn: TeamTurn,
    item: DispatchItem,
  ): void {
    const store = this.deps.store
    const team = this.deps.teams.get(session.teamId as string)
    if (!team.members.some((member) => member.agentId === item.agentId)) {
      // 用户或模型可能指向工作区中的非团队成员；不创建运行，写审计事件后
      // 让泵继续处理其他目标或收敛。
      this.event(turn.id, 'notice', {
        kind: 'non_member_target_ignored',
        agentId: item.agentId,
      })
      return
    }
    const agent = store.getAgent(item.agentId)
    if (!agent) {
      this.event(turn.id, 'run_failed', { agentId: item.agentId, error: '成员不存在' })
      return
    }
    let runtime: RuntimeConfig
    try {
      runtime = this.deps.runtimeFor(agent)
    } catch (error) {
      this.event(turn.id, 'run_failed', {
        agentId: item.agentId,
        error: error instanceof Error ? error.message : String(error),
      })
      this.handleMemberFailure(
        state,
        session,
        turn,
        item,
        agent,
        error instanceof Error ? error.message : String(error),
      )
      return
    }
    if (runtime.status !== 'online') {
      this.event(turn.id, 'run_failed', {
        agentId: item.agentId,
        error: 'RUNTIME_OFFLINE',
      })
      this.handleMemberFailure(state, session, turn, item, agent, '运行时离线')
      return
    }
    const triggerMessage = store.getMessage(item.triggerMessageId)
    if (!triggerMessage) return
    const isLeader = agent.id === team.leaderAgentId
    const dynamicInstruction = !isLeader && agent.instructionMode === 'leader'

    const assistantMessage = store.createMessage({
      sessionId: session.id,
      senderType: 'agent',
      senderAgentId: agent.id,
      content: '',
      status: 'running',
      replyToId: item.triggerMessageId,
      roundNo: turn.seq,
    })
    const run = store.createRun({
      sessionId: session.id,
      triggerMessageId: item.triggerMessageId,
      agentId: agent.id,
      parentRunId: item.triggerRunId,
      teamTurnId: turn.id,
      status: 'queued',
    })
    state.active.set(run.id, {
      runId: run.id,
      agentId: agent.id,
      assistantMessageId: assistantMessage.id,
      triggerRunId: item.triggerRunId,
      callerAgentId: item.callerAgentId,
      triggerMessageId: item.triggerMessageId,
    })
    this.event(
      turn.id,
      'dispatch',
      {
        agentId: agent.id,
        triggerMessageId: item.triggerMessageId,
        convergence: !!item.convergence,
        note: item.note ?? null,
      },
      { participantAgentId: agent.id, runId: run.id },
    )
    this.event(
      turn.id,
      'run_started',
      { agentId: agent.id, assistantMessageId: assistantMessage.id },
      { participantAgentId: agent.id, runId: run.id },
    )

    let context: ReturnType<typeof buildTeamRunContext>
    try {
      const participants = this.deps.teams.participants(team.id)
      // 模式二成员不使用自己的初始 Prompt，也不使用团队 Prompt 覆盖；
      // 角色指令完全来自本轮触发消息。
      const effectivePrompt = dynamicInstruction
        ? ''
        : this.deps.teams.resolveMemberPrompt(team.id, agent.id)
      const messages = store
        .listMessages(session.id)
        .filter((message) => message.id !== assistantMessage.id)
      const caller = item.callerAgentId ? store.getAgent(item.callerAgentId) : null
      // 指挥者需要知道谁在运行、谁在排队，才能避免重复派发或决定等待。
      const participantStatus: Record<string, 'running' | 'queued'> = {}
      for (const active of state.active.values()) {
        participantStatus[active.agentId] = 'running'
      }
      for (const queued of state.queue) {
        participantStatus[queued.agentId] = 'queued'
      }
      context = buildTeamRunContext({
        team,
        participantAgents: participants.map((participant) => participant.agent),
        agent,
        effectivePrompt,
        messages,
        task: item.note ? `${item.task}\n\n${item.note}` : item.task,
        callerAgentName: caller?.name ?? null,
        workspacePath: session.workspacePath,
        leaderUpdate: isLeader ? 'self' : null,
        previousSerialResult: item.serialPrevious ?? state.serialPrevious,
        participantStatus,
        instructionMode: agent.instructionMode,
        dispatchInstruction: dynamicInstruction ? triggerMessage.content : null,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      store.updateMessageStatus(assistantMessage.id, 'failed')
      store.updateRun(run.id, {
        status: 'failed',
        endedAt: new Date().toISOString(),
        error: message,
      })
      state.active.delete(run.id)
      this.handleMemberFailure(state, session, turn, item, agent, message)
      return
    }

    void this.deps.executor
      .execute({
        runId: run.id,
        session,
        agent,
        runtime,
        userMessage: triggerMessage,
        assistantMessageId: assistantMessage.id,
        attachmentPaths: triggerMessage.attachments.map((attachment) => attachment.path),
        prompt: context.prompt,
        systemPrompt: context.systemPrompt,
        useSessionRuntimeSession: false,
        runtimeSessionId: null,
        // 每个成员槽位一个独立运行时 Actor；指挥者优先拿到全局启动/turn 名额。
        actorKey: `${session.id}:${agent.id}`,
        priority: agent.id === team.leaderAgentId ? 1 : 2,
        timeoutMs: 30 * 60_000,
        manageRuntimeHealth: false,
        // 团队成员覆盖按成员记录解析，而不是按智能体 ID。
        teamMemberId: team.members.find((member) => member.agentId === agent.id)?.id,
        onEvent: (event) => {
          if (event.type === 'usage') {
            state.tokensIn = Number(event.payload.tokensIn ?? state.tokensIn)
            state.tokensOut = Number(event.payload.tokensOut ?? state.tokensOut)
          }
        },
      })
      .then((result) =>
        this.handleRunCompleted(state, session, turn, item, agent, run.id, assistantMessage.id, result),
      )
      .catch((error) => {
        this.handleMemberFailure(
          state,
          session,
          turn,
          item,
          agent,
          error instanceof Error ? error.message : String(error),
        )
      })
      .finally(() => {
        void this.pump(session.id)
      })
  }

  private handleRunCompleted(
    state: SessionState,
    session: Session,
    turn: TeamTurn,
    item: DispatchItem,
    agent: Agent,
    runId: string,
    assistantMessageId: string,
    result: AgentRunResult,
  ): void {
    state.active.delete(runId)
    if (state.cancelled) return
    // 旧回合的延迟回调不得污染新回合的状态。
    if (state.turnId !== turn.id) return
    const store = this.deps.store
    const team = this.deps.teams.get(session.teamId as string)
    const isLeader = agent.id === team.leaderAgentId
    state.lastText = result.text
    state.lastRunId = runId
    if (isLeader) {
      state.lastLeaderText = result.text
      state.lastLeaderRunId = runId
    }
    let status: TeamTurnStatus = turn.status
    if (result.status !== 'completed') {
      if (result.status === 'cancelled') {
        this.event(
          turn.id,
          'run_cancelled',
          { agentId: agent.id },
          { participantAgentId: agent.id, runId },
        )
      }
      if (isLeader) {
        this.failTurn(session, state, turn, result.error ?? '指挥者运行失败')
        return
      }
      if (result.status === 'cancelled') {
        // 用户只停止了这一名成员：保留已产生文本，其他成员继续；没有
        // 其他工作时让指挥者基于当前进展做阶段性总结。
        if (state.queue.length === 0 && state.active.size === 0 && !state.waitingUser) {
          this.enqueueTargets(state, [team.leaderAgentId], {
            triggerMessageId: item.triggerMessageId,
            triggerRunId: runId,
            callerAgentId: null,
            task: state.task,
            note: `成员 ${agent.name} 的运行被用户停止。请基于当前进展给出阶段性总结或重新分派。`,
            convergence: true,
          })
        }
        return
      }
      this.handleMemberFailure(state, session, turn, item, agent, result.error ?? '成员运行失败')
      return
    }

    const completedMessage = this.deps.store.getMessage(assistantMessageId)
    if (completedMessage && !completedMessage.content.trim()) {
      // 兼容测试执行器或未来不直接写消息的实现；正式执行器已写入同一文本。
      this.deps.store.updateMessageContent(assistantMessageId, result.text)
      this.deps.store.updateMessageStatus(assistantMessageId, 'completed')
    }
    this.event(
      turn.id,
      'run_completed',
      {
        agentId: agent.id,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        text: result.text.slice(0, 2000),
      },
      { participantAgentId: agent.id, runId },
    )
    this.deps.store.updateTeamTurn(turn.id, {
      tokensIn: state.tokensIn,
      tokensOut: state.tokensOut,
      hops: state.hops,
      rounds: state.rounds,
    })
    if (team.fanoutStrategy === 'serial') state.serialPrevious = result.text

    const parsed = this.parseForSession(session, team, result.text, 'agent', agent.id)
    this.persistMentions(assistantMessageId, parsed)
    // 提及先落库，再触发通知；否则通知服务读不到 message_mention。
    if (result.status === 'completed') {
      this.deps.onAssistantCompleted?.(session.id, assistantMessageId)
    }
    for (const mention of parsed.selfMentions) {
      this.event(
        turn.id,
        'mention_ignored',
        { kind: 'self_mention', targetAgentId: mention.targetAgentId },
        { participantAgentId: agent.id, runId },
      )
    }
    for (const issue of parsed.unknown) {
      this.event(
        turn.id,
        'notice',
        { kind: 'unknown_mention', displayName: issue.displayName, raw: issue.raw },
        { participantAgentId: agent.id, runId },
      )
    }
    for (const issue of parsed.ambiguous) {
      this.event(
        turn.id,
        'notice',
        {
          kind: 'ambiguous_mention',
          displayName: issue.displayName,
          candidates: issue.candidates?.map((candidate) => candidate.id) ?? [],
        },
        { participantAgentId: agent.id, runId },
      )
    }

    const route = routeAgentMessage(team, parsed, {
      senderAgentId: agent.id,
      callerAgentId: item.callerAgentId,
    })
    const memberIds = new Set(team.members.map((member) => member.agentId))
    // 团队调度权属于指挥者：成员之间的 @ 不直接派发，只把结果交回调用者。
    const requestedTargets = route.dispatchAgentIds
    const memberBlocked = !isLeader && route.reason === 'agent_mention'
    const fallbackCaller =
      item.callerAgentId && item.callerAgentId !== agent.id
        ? item.callerAgentId
        : team.leaderAgentId
    const dispatchTargets = memberBlocked
      ? route.waitingUser || fallbackCaller === agent.id
        ? []
        : [fallbackCaller]
      : requestedTargets.filter((id) => memberIds.has(id))
    const ignoredTargets = requestedTargets.filter((id) => !memberIds.has(id))
    if (memberBlocked) {
      this.event(
        turn.id,
        'notice',
        { kind: 'member_mention_not_dispatched', targets: requestedTargets },
        { participantAgentId: agent.id, runId },
      )
    }
    for (const ignored of ignoredTargets) {
      this.event(
        turn.id,
        'notice',
        { kind: 'non_member_target_ignored', agentId: ignored },
        { participantAgentId: agent.id, runId },
      )
    }
    const previousStatus = this.deps.store.getTeamTurn(turn.id)?.status ?? status
    status = previousStatus

    if (
      route.waitingUser &&
      dispatchTargets.length === 0 &&
      !(isLeader && item.convergence)
    ) {
      this.setWaitingUser(session, state, this.deps.store.getTeamTurn(turn.id) as TeamTurn)
    } else if (dispatchTargets.length > 0) {
      // 还有工作要分派时先完成这些运行，再进入等待用户；不能把
      // 用户提及直接丢掉，否则回合会继续在无人决策的情况下推进。
      state.waitingUser = false
      state.pendingWaiting = route.waitingUser
      this.enqueueTargets(state, dispatchTargets, {
        triggerMessageId: assistantMessageId,
        triggerRunId: runId,
        callerAgentId: agent.id,
        task: state.task,
      })
      if (status === 'waiting_user' && canTransitionTeamTurn(status, 'debating')) {
        this.updateTurnStatus(turn.id, 'debating', {})
      }
    } else if (route.reason === 'leader_finished' || (isLeader && item.convergence)) {
      state.leaderFinished = true
      state.waitingUser = false
    }

    const limits = evaluateLimits({
      hops: state.hops,
      maxHops: team.maxHops,
      tokens: state.tokensIn + state.tokensOut,
      tokenBudget: team.tokenBudget,
    })
    if (limits.action === 'stop' && !item.convergence) {
      this.triggerConvergence(session, state, turn, limits.reasons.join(','))
    }
  }

  private handleMemberFailure(
    state: SessionState,
    session: Session,
    turn: TeamTurn,
    item: DispatchItem,
    agent: Agent,
    error: string,
  ): void {
    state.active.delete(
      Array.from(state.active.entries()).find(([, active]) => active.agentId === agent.id)?.[0] ??
        '',
    )
    state.lastText = `成员 ${agent.name} 运行失败：${error}`
    this.deps.store.updateMessageStatus(this.findAssistantMessageId(agent.id, turn), 'failed')
    this.event(
      turn.id,
      'run_failed',
      { agentId: agent.id, error },
      { participantAgentId: agent.id },
    )
    if (state.queue.length === 0 && state.active.size === 0 && !state.waitingUser) {
      const team = this.deps.teams.get(session.teamId as string)
      if (agent.id !== team.leaderAgentId) {
        this.enqueueTargets(state, [team.leaderAgentId], {
          triggerMessageId: item.triggerMessageId,
          triggerRunId: state.lastRunId,
          callerAgentId: null,
          task: state.task,
          note: `${agent.name} 运行失败：${error}。请结合当前进展给出阶段性总结，或重新分派。`,
          convergence: true,
        })
      } else {
        this.failTurn(session, state, turn, error)
      }
    }
  }

  private findAssistantMessageId(agentId: string, turn: TeamTurn): string {
    const messages = this.deps.store.listMessages(turn.sessionId)
    const message = messages
      .slice()
      .reverse()
      .find(
        (item) => item.senderAgentId === agentId && item.status === 'running',
      )
    return message?.id ?? ''
  }

  private triggerConvergence(
    session: Session,
    state: SessionState,
    turn: TeamTurn,
    reason: string,
  ): void {
    if (TERMINAL_STATUSES.has(turn.status)) return
    this.event(turn.id, 'protection_triggered', { reason })
    this.updateTurnStatus(turn.id, 'converging', { convergenceReason: reason })
    this.event(turn.id, 'converging', { reason })
    state.queue = []
    if (!state.convergenceDispatched) {
      state.convergenceDispatched = true
      const team = this.deps.teams.get(session.teamId as string)
      this.enqueueTargets(state, [team.leaderAgentId], {
        triggerMessageId: state.lastTriggerMessageId ?? turn.triggerMessageId,
        triggerRunId: state.lastRunId,
        callerAgentId: null,
        task: state.task,
        note:
          '停止辩论并输出结构化总结。必须包含：结论、关键依据、分歧与未决问题、建议下一步。',
        convergence: true,
      })
    }
  }

  private async finishTurn(
    session: Session,
    state: SessionState,
    turn: TeamTurn,
  ): Promise<void> {
    if (state.waitingUser) return
    const status = turn.status
    if (status === 'converging' || state.leaderFinished || status === 'dispatching' || status === 'debating') {
      // 收敛产出物必须来自指挥者最后一段文本；成员后完成的文本只能作为
      // 上下文，不能覆盖结构化总结。
      const text = state.lastLeaderText
      const artifactRunId = state.lastLeaderRunId ?? state.lastRunId
      let artifactPath: string | null = null
      try {
        if (!text) throw new Error('指挥者没有产生可保存的收敛文本')
        const dir = join(session.workspacePath, '.pizza', 'artifacts')
        mkdirSync(dir, { recursive: true })
        artifactPath = join(dir, `team-turn-${turn.seq}.md`)
        const heading = this.deps.language?.() === 'en' ? 'Team turn' : '团队回合'
        writeFileSync(
          artifactPath,
          `# ${heading} ${turn.seq}\n\n${text}\n`,
          'utf8',
        )
        if (artifactRunId) {
          this.deps.artifacts.recordFile({
            sessionId: session.id,
            runId: artifactRunId,
            agentId: turn.leaderAgentId,
            path: artifactPath,
          })
        }
      } catch (error) {
        this.deps.store.createMessage({
          sessionId: session.id,
          senderType: 'system',
          content: artifactPath
            ? `收敛产出物写入失败：${artifactPath}（${
                error instanceof Error ? error.message : String(error)
              }）`
            : '本回合没有可保存的收敛总结。',
          status: 'completed',
        })
        artifactPath = null
      }
      this.updateTurnStatus(turn.id, 'completed', {
        endedAt: new Date().toISOString(),
        convergenceReason: turn.convergenceReason,
        hops: state.hops,
        rounds: state.rounds,
        tokensIn: state.tokensIn,
        tokensOut: state.tokensOut,
      })
      this.event(turn.id, 'turn_completed', {
        artifactPath,
        tokensIn: state.tokensIn,
        tokensOut: state.tokensOut,
      })
      this.deps.store.setSessionStatus(session.id, 'idle')
      state.turnId = null
      state.leaderFinished = false
      state.convergenceDispatched = false
      this.notifySession(session.id)
    }
  }

  private failTurn(
    session: Session,
    state: SessionState,
    turn: TeamTurn,
    error: string,
  ): void {
    if (TERMINAL_STATUSES.has(turn.status)) return
    // 指挥者失败时不能留下仍在运行的成员；否则旧回调会污染下一回合。
    for (const active of state.active.values()) {
      this.deps.executor.stop(active.runId)
    }
    state.active.clear()
    state.queue = []
    for (const queued of state.queuedUser) {
      this.deps.store.updateMessageStatus(queued.message.id, 'cancelled')
    }
    state.queuedUser = []
    state.waitingUser = false
    state.pendingWaiting = false
    this.deps.store.createMessage({
      sessionId: session.id,
      senderType: 'system',
      content: `团队回合失败：${error}。已完成内容已保留，可重试或继续补充。`,
      status: 'completed',
    })
    this.updateTurnStatus(turn.id, 'failed', {
      endedAt: new Date().toISOString(),
      error,
    })
    this.event(turn.id, 'turn_failed', { error })
    this.deps.store.setSessionStatus(session.id, 'error')
    state.turnId = null
    this.notifySession(session.id)
    this.notifyIdle(session.id)
  }

  private setWaitingUser(
    session: Session,
    state: SessionState,
    turn: TeamTurn,
    updateStatus = true,
  ): void {
    state.waitingUser = true
    if (updateStatus && canTransitionTeamTurn(turn.status, 'waiting_user')) {
      this.updateTurnStatus(turn.id, 'waiting_user', {})
    }
    this.event(turn.id, 'waiting_user', {})
    this.deps.store.setSessionStatus(session.id, 'waiting_user')
    this.notifySession(session.id)
  }

  private enqueueTargets(
    state: SessionState,
    agentIds: string[],
    input: Omit<DispatchItem, 'agentId'>,
  ): void {
    const seen = new Set<string>()
    for (const agentId of agentIds) {
      if (seen.has(agentId)) continue
      seen.add(agentId)
      state.queue.push({ ...input, agentId })
    }
  }

  private parseForSession(
    session: Session,
    team: TeamDetail,
    content: string,
    mode: 'user' | 'agent',
    selfAgentId?: string | null,
  ): MentionParseResult {
    const agents = this.deps.store
      .listAgents()
      .filter((agent) => !agent.isArchived)
    const participants = this.deps.teams.participants(team.id).map((item) => item.agent)
    const toMentionAgent = (agent: Agent): MentionAgent => ({ id: agent.id, name: agent.name })
    return parseMentions(content, mode, {
      sessionAgents: participants.map(toMentionAgent),
      teamAgents: participants.map(toMentionAgent),
      allAgents: agents.map(toMentionAgent),
      selfAgentId: selfAgentId ?? null,
    })
  }

  private persistMentions(messageId: string, parsed: MentionParseResult): void {
    for (const mention of parsed.mentions) {
      this.deps.store.addMention({
        messageId,
        targetType: mention.targetType,
        targetAgentId: mention.targetAgentId,
        displayName: mention.displayName,
        start: mention.start,
        end: mention.end,
        raw: mention.raw,
        resolved: mention.resolved,
      })
    }
  }
}
