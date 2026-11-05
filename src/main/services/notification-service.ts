import type { AppNotification, AppSettings } from '@shared/types'
import type { CapabilityStore } from '../db/capability-store'
import type { Store } from '../db/store'

export interface SystemNotifier {
  show(
    notification: AppNotification,
    onClick: () => void,
  ): boolean
}

/**
 * 指向用户的提及会写入待处理通知，并按设置发送系统通知。
 *
 * 免打扰只抑制系统通知，不抑制应用内标记；同一会话同一消息只记录一次。
 */
export class NotificationService {
  constructor(
    private readonly capabilities: CapabilityStore,
    private readonly store: Store,
    private readonly settings: () => AppSettings,
    private readonly notifier: SystemNotifier,
    private readonly onEvent: (notification: AppNotification) => void = () => undefined,
    private readonly onOpen: (sessionId: string, messageId: string | null) => void = () =>
      undefined,
  ) {}

  handleMessage(sessionId: string, messageId: string): AppNotification | null {
    const preferences = this.settings().notifications
    if (!preferences.enabled) return null

    const message = this.store.getMessage(messageId)
    if (!message) return null
    const mention = message.mentions.find((item) => item.targetType === 'user')
    if (!mention) return null

    const session = this.store.getSession(sessionId)
    if (!session) return null
    // 同一消息重复扫描时不再弹系统通知。
    const existing = this.capabilities.findNotification(sessionId, messageId)
    if (existing) return existing
    const agent = message.senderAgentId
      ? this.store.getAgent(message.senderAgentId)
      : null
    const title = agent ? `${agent.name} 提到了你` : '有智能体提到了你'
    const body = message.content
      .replace(/\[@[^\]]+\]\(mention:\/\/user\)/g, '@我')
      .slice(0, 180)

    const notification = this.capabilities.createNotification({
      workspaceId: session.workspaceId,
      sessionId,
      messageId,
      title,
      body,
    })
    this.onEvent(notification)

    if (preferences.system && !preferences.doNotDisturb) {
      this.notifier.show(notification, () =>
        this.onOpen(notification.sessionId, notification.messageId),
      )
    }
    return notification
  }

  list(workspaceId: string): AppNotification[] {
    return this.capabilities.listNotifications(workspaceId)
  }

  markRead(id: string): void {
    this.capabilities.markNotificationRead(id)
  }

  markAllRead(workspaceId: string): void {
    this.capabilities.markAllNotificationsRead(workspaceId)
  }

  clear(workspaceId: string): void {
    this.capabilities.clearNotifications(workspaceId)
  }

  open(id: string): void {
    const notification = this.capabilities.getNotification(id)
    if (!notification) throw new Error('NOTIFICATION_NOT_FOUND')
    this.capabilities.markNotificationRead(id)
    this.onOpen(notification.sessionId, notification.messageId)
  }
}
