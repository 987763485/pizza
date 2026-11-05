import { BrowserWindow } from 'electron'
import type {
  Agent,
  Message,
  Run,
  RunEvent,
  RuntimeConfig,
  SendMessageInput,
  SendMessageResult,
  Session,
} from '@shared/types'
import { IPC } from '@shared/ipc'
import type { Store } from '../db/store'
import { broadcast } from '../events'
import type { AttachmentService } from './attachment-service'
import type { AgentRunExecutor } from './agent-run-executor'
import type { RuntimeService } from './runtime-service'
import type { SessionService } from './session-service'

interface PendingRun {
  runId: string
  session: Session
  agent: Agent
  runtime: RuntimeConfig
  userMessage: Message
  assistantMessageId: string
  attachmentPaths: string[]
}

/**
 * 单智能体会话服务：保留会话级派发与公开 API。
 *
 * 队列与单飞已经下沉到 RuntimeSupervisor/SessionRuntimeActor：
 * 消息落库后直接提交，Actor 负责顺序、复用和回收。团队调度不经过这里。
 */
export class RunService {
  constructor(
    private readonly store: Store,
    private readonly sessions: SessionService,
    private readonly runtimeService: RuntimeService,
    private readonly attachments: AttachmentService,
    private readonly executor: AgentRunExecutor,
  ) {}

  recoverInterrupted(): void {
    this.store.markInterruptedRuns()
  }

  events(runId: string): RunEvent[] {
    const run = this.store.getRun(runId)
    if (!run) throw new Error('RUN_NOT_FOUND')
    return this.store.listRunEvents(runId)
  }

  message(messageId: string): Message | null {
    return this.store.getMessage(messageId)
  }

  shutdown(): void {
    // 活跃与排队任务都登记在执行器的 active 表中；调度器关闭时会统一取消。
    this.executor.shutdown()
  }

  async send(input: SendMessageInput): Promise<SendMessageResult> {
    const session = this.store.getSession(input.sessionId)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    if (session.mode === 'team') throw new Error('TEAM_SESSION_REQUIRES_ORCHESTRATOR')
    const agent = session.agentId ? this.store.getAgent(session.agentId) : null
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    if (agent.isArchived) throw new Error('AGENT_ARCHIVED')
    const runtime = this.runtimeService.getForRun(agent.runtimeId)
    if (runtime.status !== 'online') throw new Error('RUNTIME_OFFLINE')

    const hadMessages = this.store.listMessages(session.id).length > 0
    const shouldQueue = this.executor.hasActiveSession(session.id)
    const savedAttachments = (input.attachments ?? []).map((attachment) =>
      this.attachments.save(attachment),
    )

    const userMessage = this.store.createMessage({
      sessionId: session.id,
      senderType: 'user',
      content: input.content,
      status: 'completed',
      roundNo: 1,
    })
    for (const attachment of savedAttachments) {
      this.store.addAttachment(userMessage.id, attachment)
    }

    if (!hadMessages && session.title === '新会话') {
      const title =
        input.content.length > 24 ? `${input.content.slice(0, 24)}…` : input.content
      this.store.renameSession(session.id, title)
    }
    this.store.touchSession(session.id)

    const assistantMessage = this.store.createMessage({
      sessionId: session.id,
      senderType: 'agent',
      senderAgentId: agent.id,
      content: '',
      status: shouldQueue ? 'queued' : 'running',
      replyToId: userMessage.id,
      roundNo: 1,
    })
    const run = this.store.createRun({
      sessionId: session.id,
      triggerMessageId: userMessage.id,
      agentId: agent.id,
      status: 'queued',
    })
    this.store.setSessionStatus(session.id, 'running')
    this.store.setSessionUnread(session.id, false)
    this.broadcastSession(session.id)

    const pending: PendingRun = {
      runId: run.id,
      session,
      agent,
      runtime,
      userMessage,
      assistantMessageId: assistantMessage.id,
      attachmentPaths: savedAttachments.map((attachment) => attachment.path),
    }
    void this.executeRun(pending).catch((error) => {
      // executeRun 内部已记录失败；这里只防止未处理的 Promise 拒绝。
      console.error('run failed', error)
    })

    return {
      userMessage: this.store.getMessage(userMessage.id) as Message,
      assistantMessage: this.store.getMessage(assistantMessage.id) as Message,
      runId: run.id,
    }
  }

  stop(runId: string): void {
    if (this.executor.stop(runId)) return
    const run = this.store.getRun(runId)
    if (run && ['queued', 'starting', 'running'].includes(run.status)) {
      this.store.updateRun(runId, {
        status: 'cancelled',
        endedAt: new Date().toISOString(),
        error: '用户停止',
      })
      const message = this.store.findRunningAssistant(run.sessionId)
      if (message) this.store.updateMessageStatus(message.id, 'cancelled')
      this.store.setSessionStatus(run.sessionId, 'idle')
      this.broadcastSession(run.sessionId)
    }
  }

  async retry(messageId: string): Promise<SendMessageResult> {
    const message = this.store.getMessage(messageId)
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    if (message.senderType !== 'agent') throw new Error('MESSAGE_NOT_RETRYABLE')
    const session = this.store.getSession(message.sessionId)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    if (session.mode === 'team') throw new Error('TEAM_SESSION_REQUIRES_ORCHESTRATOR')
    const agent = session.agentId ? this.store.getAgent(session.agentId) : null
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    const runtime = this.runtimeService.getForRun(agent.runtimeId)
    if (runtime.status !== 'online') throw new Error('RUNTIME_OFFLINE')

    let userMessage = message.replyToId
      ? this.store.getMessage(message.replyToId)
      : null
    if (!userMessage) {
      const messages = this.store.listMessages(session.id)
      const index = messages.findIndex((item) => item.id === message.id)
      for (let i = index - 1; i >= 0; i -= 1) {
        if (messages[i].senderType === 'user') {
          userMessage = messages[i]
          break
        }
      }
    }
    if (!userMessage) throw new Error('RETRY_SOURCE_NOT_FOUND')

    const shouldQueue = this.executor.hasActiveSession(session.id)
    const assistantMessage = this.store.createMessage({
      sessionId: session.id,
      senderType: 'agent',
      senderAgentId: agent.id,
      content: '',
      status: shouldQueue ? 'queued' : 'running',
      replyToId: userMessage.id,
      roundNo: message.roundNo,
    })
    const run = this.store.createRun({
      sessionId: session.id,
      triggerMessageId: userMessage.id,
      agentId: agent.id,
      status: 'queued',
    })
    this.store.setSessionStatus(session.id, 'running')
    this.broadcastSession(session.id)

    const pending: PendingRun = {
      runId: run.id,
      session,
      agent,
      runtime,
      userMessage,
      assistantMessageId: assistantMessage.id,
      attachmentPaths: userMessage.attachments.map((attachment) => attachment.path),
    }
    void this.executeRun(pending).catch((error) => console.error('retry failed', error))

    return {
      userMessage,
      assistantMessage: this.store.getMessage(assistantMessage.id) as Message,
      runId: run.id,
    }
  }

  private async executeRun(input: PendingRun): Promise<void> {
    const result = await this.executor.execute({
      runId: input.runId,
      session: input.session,
      agent: input.agent,
      runtime: input.runtime,
      userMessage: input.userMessage,
      assistantMessageId: input.assistantMessageId,
      attachmentPaths: input.attachmentPaths,
    })
    // 有排队任务时，会话仍由调度器标记为忙碌，不要提前把状态改回 idle。
    const busy = this.executor.hasActiveSession(input.session.id)
    this.store.setSessionStatus(
      input.session.id,
      busy
        ? 'running'
        : result.status === 'completed' || result.status === 'cancelled'
          ? 'idle'
          : 'error',
    )
    if (result.status === 'completed') {
      this.store.setSessionUnread(input.session.id, !this.hasFocusedWindow())
    }
    this.broadcastSession(input.session.id)
  }

  private broadcastSession(sessionId: string): void {
    const summary = this.store.getSessionSummary(sessionId)
    if (summary) broadcast(IPC.eventSession, summary)
  }

  private hasFocusedWindow(): boolean {
    return BrowserWindow.getAllWindows().some((window) => window.isFocused())
  }
}
