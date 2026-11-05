import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import type {
  Agent,
  Artifact,
  Attachment,
  Message,
  TeamParticipant,
  TeamTurn,
} from '@shared/types'
import type { ToolCallView } from '../store'
import { agentColor } from '../avatar'
import { useProfile } from '../profile'
import { Avatar } from './Avatar'
import { AvatarImage } from './AvatarImage'
import { Icon } from './Icon'

interface MessageListProps {
  messages: Message[]
  agent: Agent | null
  participants?: TeamParticipant[]
  turns?: TeamTurn[]
  toolEvents: Record<string, ToolCallView[]>
  artifactsByMessage: Record<string, Artifact[]>
  runIdByMessage: Record<string, string>
  onRetry: (messageId: string) => void
  onStopRun: (runId: string) => void
  onOpenArtifact: (artifact: Artifact) => void
  onViewLog: (runId: string) => void
}

function deliveryTargetLabel(
  message: Message,
  participants: TeamParticipant[],
  t: TFunction,
): string {
  const agentNames = message.mentions
    .filter((mention) => mention.targetType === 'agent' && mention.targetAgentId)
    .map(
      (mention) =>
        participants.find((participant) => participant.agent.id === mention.targetAgentId)
          ?.agent.name ?? mention.displayName,
    )
  if (agentNames.length) return Array.from(new Set(agentNames)).join('、')
  if (message.mentions.some((mention) => mention.targetType === 'user')) return t('ui.你')
  return (
    participants.find((participant) => participant.role === 'leader')?.agent.name ??
    t('ui.指挥者')
  )
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function durationLabel(tool: ToolCallView): string {
  if (!tool.startedAt) return ''
  const end = tool.endedAt ?? Date.now()
  const seconds = Math.max(0.1, (end - tool.startedAt) / 1000)
  return `${seconds.toFixed(1)}s`
}

export function MessageList({
  messages,
  agent,
  participants = [],
  turns = [],
  toolEvents,
  artifactsByMessage,
  runIdByMessage,
  onRetry,
  onStopRun,
  onOpenArtifact,
  onViewLog,
}: MessageListProps) {
  const { t } = useTranslation()
  const profile = useProfile()
  const participantByAgent = new Map(
    participants.map((participant) => [participant.agent.id, participant]),
  )
  const turnBySeq = new Map(turns.map((turn) => [turn.seq, turn]))
  let lastRound: number | null = null
  let lastAgentId: string | null = null

  return (
    <div className="messages">
      {messages.map((message) => {
        const showRound =
          participants.length > 0 && message.roundNo !== lastRound
        lastRound = message.roundNo
        const participant = message.senderAgentId
          ? participantByAgent.get(message.senderAgentId)
          : undefined
        const turn = turnBySeq.get(message.roundNo)
        const continued =
          message.senderType === 'agent' &&
          !!message.senderAgentId &&
          message.senderAgentId === lastAgentId &&
          !showRound
        lastAgentId = message.senderType === 'agent' ? message.senderAgentId : null
        return (
          <div key={message.id}>
            {showRound ? (
              <div className="turn-divider">
                <span>{t('ui.第 {{round}} 轮', { round: message.roundNo })}</span>
                {turn ? <span className={`turn-state ${turn.status}`}>{turnStatusLabel(turn.status, t)}</span> : null}
              </div>
            ) : null}
            {message.senderType === 'system' ? (
              <div className="system-msg" id={`msg-${message.id}`}>
                {message.content}
              </div>
            ) : message.senderType === 'user' ? (
              <div className="msg msg-user" id={`msg-${message.id}`}>
                <div className="msg-user-main">
                  {message.attachments.length ? (
                    <AttachmentList attachments={message.attachments} align="right" />
                  ) : null}
                  <div className="bubble">{renderMentionChips(message.content)}</div>
                  {participants.length > 0 ? (
                    <div className="msg-state" style={{ justifyContent: 'flex-end' }}>
                      <Icon name={message.status === 'queued' ? 'clock' : 'check'} size={11} />
                      {message.status === 'queued' ? t('ui.已排队 · 待送达') : t('ui.已发送 · 送达')}
                      {deliveryTargetLabel(message, participants, t)}
                    </div>
                  ) : null}
                </div>
                <span className="msg-user-avatar" title={profile.name}>
                  {profile.avatar ? (
                    <AvatarImage src={profile.avatar} name={profile.name} />
                  ) : (
                    t('ui.你')
                  )}
                </span>
              </div>
            ) : (
              <AgentMessage
                message={message}
                agent={participant?.agent ?? agent}
                role={participant?.role}
                roleDescription={participant?.roleDescription}
                continued={continued}
                tools={toolEvents[message.id] ?? []}
                artifacts={artifactsByMessage[message.id] ?? []}
                runId={runIdByMessage[message.id]}
                onRetry={onRetry}
                onStopRun={onStopRun}
                onOpenArtifact={onOpenArtifact}
                onViewLog={onViewLog}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function turnStatusLabel(status: TeamTurn['status'], t: TFunction): string {
  switch (status) {
    case 'dispatching':
      return t('ui.分派中')
    case 'debating':
      return t('ui.讨论中')
    case 'waiting_user':
      return t('ui.等待你回复')
    case 'converging':
      return t('ui.收敛中')
    case 'completed':
      return t('ui.已完成')
    case 'failed':
      return t('ui.失败')
    case 'cancelled':
      return t('ui.已停止')
    case 'interrupted':
      return t('ui.已中断')
  }
}

/** 将精确提及链接渲染为不可点击的 chip，避免用户误以为 mention:// 是网页。 */
function renderMentionChips(content: string): ReactNode {
  const parts = content.split(/(\[@[^\]]+\]\(mention:\/\/(?:agent|user)(?:\/[^)]+)?\))/g)
  if (parts.length === 1) return content
  return parts.map((part, index) => {
    const match = part.match(/^\[@([^\]]+)\]\(mention:\/\/[^)]+\)$/)
    if (!match) return <span key={index}>{part}</span>
    return (
      <span className="mention-chip" key={index}>
        @{match[1]}
      </span>
    )
  })
}

function AgentMessage({
  message,
  agent,
  role,
  roleDescription,
  continued,
  allowRetry = true,
  tools,
  artifacts,
  runId,
  onRetry,
  onStopRun,
  onOpenArtifact,
  onViewLog,
}: {
  message: Message
  agent: Agent | null
  role?: 'leader' | 'member'
  roleDescription?: string
  continued?: boolean
  allowRetry?: boolean
  tools: ToolCallView[]
  artifacts: Artifact[]
  runId?: string
  onRetry: (messageId: string) => void
  onStopRun: (runId: string) => void
  onOpenArtifact: (artifact: Artifact) => void
  onViewLog: (runId: string) => void
}) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const streaming = message.status === 'running' || message.status === 'streaming'
  const cancelled = message.status === 'cancelled'

  useEffect(() => {
    if (streaming) bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [message.content, streaming])

  return (
    <div
      className={`msg msg-agent ${continued ? 'continued' : ''}`}
      data-msg-id={message.id}
      id={`msg-${message.id}`}
    >
      <div className="msg-avatar">
        {continued ? null : (
          <Avatar
            name={agent?.name ?? t('ui.智能体')}
            src={agent?.avatar}
            size={40}
            presence={streaming ? 'running' : 'online'}
          />
        )}
      </div>
      <div className="msg-main">
        <div className="msg-head" style={continued ? { display: 'none' } : undefined}>
          <span className="msg-name">{agent?.name ?? t('ui.智能体')}</span>
          <span
            className={`role-tag ${role === 'leader' ? 'leader' : ''}`}
            title={roleDescription || undefined}
            style={{ '--c': agentColor(agent?.name ?? t('ui.智能体')) } as CSSProperties}
          >
            {role === 'leader' ? t('ui.指挥者') : roleDescription || t('ui.成员')}
          </span>
          <span className="msg-time">{formatTime(message.createdAt)}</span>
          {streaming ? (
            <span className="msg-state">
              <Icon name="loader" size={11} /> {t('ui.正在工作')}
            </span>
          ) : null}
          {message.status === 'queued' ? (
            <span className="msg-state">
              <Icon name="clock" size={11} /> {t('ui.排队中')}
            </span>
          ) : null}
          {cancelled ? (
            <span className="msg-state">
              {message.content.includes('运行超时') ? t('ui.已超时') : t('ui.已停止')}
            </span>
          ) : null}
        </div>

        {message.content ? (
          <div className="msg-content markdown">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={{
                a: ({ href, children }) =>
                  href?.startsWith('mention://') ? (
                    <span className="mention-chip">{children}</span>
                  ) : (
                    <a href={href}>{children}</a>
                  ),
              }}
            >
              {message.content}
            </ReactMarkdown>
            {streaming ? <span className="stream-cursor" /> : null}
          </div>
        ) : streaming ? (
          <div className="typing-dots">
            <i />
            <i />
            <i />
          </div>
        ) : null}

        {message.attachments.length ? <AttachmentList attachments={message.attachments} /> : null}
        {tools.map((tool) => (
          <ToolCall key={tool.id} tool={tool} />
        ))}
        {artifacts.length ? (
          <div className="artifact-callout-group">
            {artifacts.map((artifact) => (
              <button
                className="artifact-callout"
                key={artifact.id}
                onClick={() => onOpenArtifact(artifact)}
              >
                <span className="artifact-icon">
                  <Icon name="file-text" size={17} />
                </span>
                <div>
                  <div className="artifact-name">{artifact.title}</div>
                  <div className="artifact-meta">
                    {artifact.kind === 'added'
                      ? t('ui.新建文件')
                      : artifact.kind === 'modified'
                        ? t('ui.修改文件')
                        : t('ui.信息文件')}{' '}
                    · {t('ui.刚刚')}
                  </div>
                </div>
                <Icon name="chevron-right" size={15} className="chev" />
              </button>
            ))}
          </div>
        ) : null}

        <div className="msg-actions">
          <button
            className="mini-btn"
            onClick={async () => {
              await navigator.clipboard.writeText(message.content)
              setCopied(true)
              setTimeout(() => setCopied(false), 1200)
            }}
          >
            <Icon name={copied ? 'check' : 'copy'} size={12} />
            {copied ? t('ui.已复制') : t('ui.复制')}
          </button>
          <button
            className="mini-btn"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent('pizza:quote', { detail: message.content }),
              )
            }
          >
            <Icon name="chat" size={12} /> {t('ui.引用')}
          </button>
          {streaming && runId ? (
            <button className="mini-btn" onClick={() => onStopRun(runId)}>
              <Icon name="stop" size={12} /> {t('ui.停止此运行')}
            </button>
          ) : null}
          {!streaming && allowRetry ? (
            <button className="mini-btn" onClick={() => onRetry(message.id)}>
              <Icon name="refresh" size={12} /> {t('ui.重试')}
            </button>
          ) : null}
          {message.status === 'failed' && runId ? (
            <button className="mini-btn" onClick={() => onViewLog(runId)}>
              <Icon name="file-text" size={12} /> {t('ui.查看日志')}
            </button>
          ) : null}
        </div>
        <div ref={bottomRef} />
      </div>
    </div>
  )
}

function ToolCall({ tool }: { tool: ToolCallView }) {
  const { t } = useTranslation()
  const failed = tool.status === 'failed'
  const [open, setOpen] = useState(failed)
  const target = tool.detail?.split('\n')[0] ?? ''

  // 失败的工具调用需要直接展开错误摘要，而不是要求用户再点一次。
  useEffect(() => {
    if (failed) setOpen(true)
  }, [failed])

  return (
    <div className={`tool-call ${open ? 'open' : ''} ${failed ? 'failed' : ''}`}>
      <div className="tool-call-head" onClick={() => setOpen((value) => !value)}>
        <Icon name="terminal" size={13} />
        <span className="tool-call-name">{tool.name}</span>
        <span
          style={{
            color: 'var(--muted)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {target}
        </span>
        <span className={`tool-call-status ${failed ? '' : 'ok'}`}>
          {tool.status === 'running' ? (
            <>{t('ui.运行中')}</>
          ) : (
            <>
              <Icon name={failed ? 'alert' : 'check'} size={11} /> {durationLabel(tool)}
            </>
          )}
        </span>
      </div>
      <div className="tool-call-body">{tool.detail || t('ui.工具参数和输出由运行时管理。')}</div>
    </div>
  )
}

function AttachmentList({
  attachments,
  align,
}: {
  attachments: Attachment[]
  align?: 'right'
}) {
  return (
    <div className={`attachment-list ${align === 'right' ? 'right' : ''}`}>
      {attachments.map((attachment) => (
        <AttachmentPreview attachment={attachment} key={attachment.id} />
      ))}
    </div>
  )
}

function AttachmentPreview({ attachment }: { attachment: Attachment }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null)
  const isImage = attachment.mime.startsWith('image/')

  useEffect(() => {
    if (!isImage) return
    let cancelled = false
    void window.pizza.artifact
      .read(attachment.path)
      .then((result) => {
        if (!cancelled && result.kind === 'image') setDataUrl(result.content)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [attachment.path, isImage])

  if (isImage && dataUrl) {
    return (
      <figure className="attachment-image">
        <img src={dataUrl} alt={attachment.name} />
        <figcaption>{attachment.name}</figcaption>
      </figure>
    )
  }

  return (
    <span className="composer-chip attachment-chip" title={attachment.name}>
      <Icon name="file" size={11} />
      {attachment.name}
    </span>
  )
}
