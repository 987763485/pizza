import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Artifact, EditorId, RunEvent } from '@shared/types'
import { useAppStore } from '../store'
import { Avatar } from './Avatar'
import { Composer } from './Composer'
import { MessageList } from './MessageList'
import { ArtifactPanel } from './ArtifactPanel'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { TeamAvatar } from './TeamAvatar'
import { workspaceLabel } from '../workspace-label'

interface ChatViewProps {
  onOpenSettings: (page: string) => void
}

function turnLabel(status: string, t: TFunction): string {
  switch (status) {
    case 'dispatching':
      return t('ui.分派中')
    case 'debating':
      return t('ui.讨论中')
    case 'waiting_user':
      return t('ui.等待你回复')
    case 'converging':
      return t('ui.收敛中')
    default:
      return t('ui.已完成')
  }
}

function editorName(id: EditorId, t: TFunction): string {
  switch (id) {
    case 'system':
      return t('ui.系统默认')
    case 'finder':
      return t('ui.访达')
    case 'cursor':
      return 'Cursor'
    case 'vscode':
      return 'VS Code'
    case 'zed':
      return 'Zed'
    case 'sublimetext':
      return 'Sublime Text'
    case 'xcode':
      return 'Xcode'
    case 'idea':
      return 'IntelliJ IDEA'
    case 'goland':
      return 'GoLand'
    case 'rustrover':
      return 'RustRover'
    case 'sourcetree':
      return 'Sourcetree'
    case 'terminal':
      return t('ui.终端')
    case 'warp':
      return 'Warp'
    default:
      return t('ui.编辑器')
  }
}

// 编辑器角标与原型一致：不同编辑器使用各自的识别色，避免纯文字下拉
// 破坏会话头部右侧的视觉节奏。
function EditorGlyph({
  editor,
  icon,
  size = 18,
}: {
  editor: EditorId
  icon?: string | null
  size?: number
}) {
  if (icon) {
    return (
      <img
        className="editor-app-icon"
        src={icon}
        width={size}
        height={size}
        alt=""
        draggable={false}
      />
    )
  }
  const style = {
    width: size,
    height: size,
    borderRadius: Math.round(size * 0.24),
    display: 'grid',
    placeItems: 'center',
    flex: 'none',
    fontSize: Math.round(size * 0.42),
    fontWeight: 700,
    lineHeight: 1,
  } as const
  switch (editor) {
    case 'finder':
      return (
        <span style={{ ...style, background: '#EAF1FF', color: '#2F6FED' }}>
          <Icon name="folder" size={Math.round(size * 0.62)} />
        </span>
      )
    case 'cursor':
      return (
        <span style={{ ...style, background: '#171717', color: '#fff' }}>
          <Icon name="box" size={Math.round(size * 0.58)} />
        </span>
      )
    case 'vscode':
      return (
        <span style={{ ...style, background: '#1F8EFA', color: '#fff' }}>
          <Icon name="code" size={Math.round(size * 0.6)} />
        </span>
      )
    case 'zed':
      return <span style={{ ...style, background: '#1C1C1C', color: '#fff' }}>Z</span>
    case 'idea':
      return (
        <span
          style={{
            ...style,
            background: 'linear-gradient(135deg,#FC4C4C,#A64CFF)',
            color: '#fff',
          }}
        >
          IJ
        </span>
      )
    case 'terminal':
      return (
        <span
          style={{
            ...style,
            background: '#151515',
            color: '#EDEDED',
            fontFamily: 'var(--font-mono)',
          }}
        >
          &gt;_
        </span>
      )
    case 'warp':
      return (
        <span style={{ ...style, background: '#B9D4E8', color: '#1E3A52' }}>
          <Icon name="wave" size={Math.round(size * 0.58)} />
        </span>
      )
    default:
      return (
        <span style={{ ...style, background: 'var(--surface-2)', color: 'var(--ink-2)' }}>
          <Icon name="code" size={Math.round(size * 0.6)} />
        </span>
      )
  }
}

export function ChatView({ onOpenSettings }: ChatViewProps) {
  const { t } = useTranslation()
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const targetMessageId = searchParams.get('message')
  const navigate = useNavigate()
  const activeSession = useAppStore((state) => state.activeSession)
  const openSession = useAppStore((state) => state.openSession)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const stopRun = useAppStore((state) => state.stopRun)
  const stopMessageRun = useAppStore((state) => state.stopMessageRun)
  const stopTurn = useAppStore((state) => state.stopTurn)
  const teamTurns = useAppStore((state) => state.teamTurns)
  const retryMessage = useAppStore((state) => state.retryMessage)
  const toolEvents = useAppStore((state) => state.toolEvents)
  const runToMessage = useAppStore((state) => state.runToMessage)
  const settings = useAppStore((state) => state.settings)
  const editors = useAppStore((state) => state.editors)
  const workspaces = useAppStore((state) => state.workspaces)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const [panelOpen, setPanelOpen] = useState(true)
  const [editorMenuOpen, setEditorMenuOpen] = useState(false)
  const [focusArtifactId, setFocusArtifactId] = useState<string | null>(null)
  const [logRunId, setLogRunId] = useState<string | null>(null)
  const [editorError, setEditorError] = useState<{
    editor: EditorId
    path: string
    message: string
  } | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)
  const [findOpen, setFindOpen] = useState(false)
  const [stopPhase, setStopPhase] = useState<'idle' | 'stopping' | 'stopped'>('idle')
  const [findQuery, setFindQuery] = useState('')
  const [findCount, setFindCount] = useState(0)
  const [findIndex, setFindIndex] = useState(0)
  const findRanges = useRef<Range[]>([])

  const session = activeSession?.id === id ? activeSession : null
  const team = session?.team ?? null
  const activeTurn = useMemo(() => {
    const turn = [...teamTurns].reverse().find(
      (item) =>
        item.status === 'dispatching' ||
        item.status === 'debating' ||
        item.status === 'waiting_user' ||
        item.status === 'converging',
    )
    return turn ?? null
  }, [teamTurns])
  const hasRunning = useMemo(
    () =>
      (session?.messages.some(
        (message) => message.status === 'running' || message.status === 'streaming',
      ) ??
        false) ||
      (!!activeTurn && activeTurn.status !== 'waiting_user'),
    [session, activeTurn],
  )
  // 等待用户回复的团队回合仍可停止。
  const canStop = hasRunning || Boolean(team && activeTurn)

  useEffect(() => {
    if (stopPhase === 'stopping' && !canStop) setStopPhase('stopped')
  }, [canStop, stopPhase])

  useEffect(() => {
    if (stopPhase !== 'stopped') return
    const timer = setTimeout(() => setStopPhase('idle'), 1600)
    return () => clearTimeout(timer)
  }, [stopPhase])

  useEffect(() => {
    if (stopPhase !== 'stopping') return
    // 停止请求没有回执时不要永久卡在“正在停止”。
    const timer = setTimeout(() => setStopPhase('idle'), 10_000)
    return () => clearTimeout(timer)
  }, [stopPhase])

  useEffect(() => {
    if (canStop && stopPhase === 'stopped') setStopPhase('idle')
  }, [canStop, stopPhase])

  async function handleStop() {
    if (stopPhase === 'stopping' || !canStop) return
    setStopPhase('stopping')
    if (team && activeTurn) await stopTurn(activeTurn.id)
    else await stopRun()
  }

  useEffect(() => {
    if (id) void openSession(id)
  }, [id, openSession])

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [session?.messages.length, hasRunning])

  useEffect(() => {
    if (!session || !targetMessageId) return
    const target = document.getElementById(`msg-${targetMessageId}`)
    if (target) {
      target.scrollIntoView({ block: 'center' })
      target.classList.add('message-highlight')
      const timer = setTimeout(() => target.classList.remove('message-highlight'), 1800)
      return () => clearTimeout(timer)
    }
  }, [session, targetMessageId])

  useEffect(() => {
    if (!editorMenuOpen) return
    const close = () => setEditorMenuOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [editorMenuOpen])

  // 对话内搜索：用 CSS Custom Highlight 标记命中片段，避免改动 Markdown 渲染结果。
  function applyFindHighlights(ranges: Range[], active: number) {
    const highlights = (
      CSS as unknown as {
        highlights?: { delete: (name: string) => void; set: (name: string, value: unknown) => void }
      }
    ).highlights
    const HighlightCtor = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight
    if (!highlights || !HighlightCtor) return
    highlights.delete('pizza-find')
    highlights.delete('pizza-find-active')
    if (ranges.length) highlights.set('pizza-find', new HighlightCtor(...ranges))
    if (ranges[active]) highlights.set('pizza-find-active', new HighlightCtor(ranges[active]))
  }

  function clearFindHighlights() {
    const highlights = (
      CSS as unknown as {
        highlights?: { delete: (name: string) => void; set: (name: string, value: unknown) => void }
      }
    ).highlights
    highlights?.delete('pizza-find')
    highlights?.delete('pizza-find-active')
  }

  function scrollToRange(range: Range) {
    const container = bodyRef.current
    const element = range.startContainer.parentElement
    if (!container || !element) return
    const elementRect = element.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()
    const top = elementRect.top - containerRect.top + container.scrollTop
    container.scrollTo({
      top: Math.max(0, top - container.clientHeight / 2 + elementRect.height / 2),
      behavior: 'smooth',
    })
  }

  function stepFind(delta: number) {
    const ranges = findRanges.current
    if (!ranges.length) return
    const next = (findIndex + delta + ranges.length) % ranges.length
    setFindIndex(next)
    applyFindHighlights(ranges, next)
    scrollToRange(ranges[next])
  }

  useEffect(() => {
    setFindOpen(false)
    setFindQuery('')
  }, [id])

  useEffect(() => {
    const root = bodyRef.current
    const query = findQuery.trim().toLowerCase()
    if (!findOpen || !root || !query) {
      findRanges.current = []
      setFindCount(0)
      setFindIndex(0)
      clearFindHighlights()
      return
    }
    const ranges: Range[] = []
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let node = walker.nextNode()
    while (node) {
      const parent = node.parentElement
      const text = node.textContent ?? ''
      if (parent?.closest('.msg-content, .bubble, .system-msg') && text) {
        const haystack = text.toLowerCase()
        let from = 0
        let index = haystack.indexOf(query, from)
        while (index !== -1) {
          const range = document.createRange()
          range.setStart(node, index)
          range.setEnd(node, index + query.length)
          ranges.push(range)
          from = index + query.length
          index = haystack.indexOf(query, from)
        }
      }
      node = walker.nextNode()
    }
    findRanges.current = ranges
    setFindCount(ranges.length)
    setFindIndex(0)
    applyFindHighlights(ranges, 0)
    if (ranges[0]) scrollToRange(ranges[0])
    return () => clearFindHighlights()
    // 搜索范围随会话与消息数量更新；流式内容由用户重新触发查询时刷新。
  }, [findOpen, findQuery, id, session?.messages.length])


  const artifactsByMessage = useMemo(() => {
    const result: Record<string, Artifact[]> = {}
    if (!session) return result
    const runMap = new Map(Object.entries(runToMessage))
    for (const artifact of session.artifacts) {
      if (!artifact.runId) continue
      const messageId = runMap.get(artifact.runId)
      if (!messageId) continue
      const list = result[messageId] ?? []
      list.push(artifact)
      result[messageId] = list
    }
    return result
  }, [runToMessage, session])

  const runIdByMessage = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(runToMessage).map(([runId, messageId]) => [messageId, runId]),
      ),
    [runToMessage],
  )

  if (!id) return null

  if (!session) {
    return (
      <main className="main">
        <div className="chat-loading">
          <span className="status-dot running" /> {t('ui.正在打开会话…')}
        </div>
      </main>
    )
  }

  const agent = session.agent
  const editorOption =
    editors.find((option) => option.id === settings?.defaultEditor) ?? editors[0] ?? null
  const editor = editorOption?.id ?? settings?.defaultEditor ?? 'vscode'
  const workspace =
    workspaces.find((item) => item.id === session.workspaceId) ?? workspaces[0] ?? null

  async function openWorkspace() {
    if (!session) return
    try {
      await window.pizza.artifact.openWorkspace(session.workspacePath, editor)
    } catch (error) {
      setEditorError({
        editor,
        path: session.workspacePath,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  function openArtifact(artifact: Artifact) {
    setPanelOpen(true)
    setFocusArtifactId(artifact.id)
  }

  const forkBadge = session.forkedFromId ? (
    <span className="badge" title={t('ui.分叉会话')}>
      <Icon name="fork" size={10} /> {t('ui.分叉')}
    </span>
  ) : null

  return (
    <>
      <main className="main">
        <div className="chat-shell">
          <header className="chat-header">
            <div className="chat-head-main">
              {team ? (
                <TeamAvatar
                  name={team.name}
                  src={team.avatar}
                  members={session.participants.map((participant) => participant.agent)}
                  size={38}
                />
              ) : agent ? (
                <Avatar
                  name={agent.name}
                  src={agent.avatar}
                  size={38}
                  presence={hasRunning ? 'running' : 'online'}
                />
              ) : null}
              <div className="chat-head-text">
                <div className="chat-head-title">
                  {team?.name ?? agent?.name ?? t('ui.智能体')}
                  <span className="badge">{team ? t('ui.团队模式') : t('ui.智能体模式')}</span>
                  {forkBadge}
                </div>
                <div className="chat-head-sub">
                  <span className={`status-dot ${hasRunning ? 'running' : 'online'}`} />
                  {team
                    ? `${t('ui.指挥者')} ${session.participants.find((item) => item.role === 'leader')?.agent.name ?? t('ui.未设置')} · ${t('ui.{{count}} 名成员', { count: session.participants.length })}${activeTurn ? ` · ${turnLabel(activeTurn.status, t)}` : ''}`
                    : agent?.description || t('ui.直接对话，输入任务开始工作')}
                </div>
              </div>
            </div>

            <div className="chat-head-actions">
              <div className="editor-pill-wrap" style={{ position: 'relative' }}>
                <div className="editor-pill" title={t('ui.用 {{editor}} 打开工作区', { editor: editorName(editor, t) })}>
                  <button className="editor-pill-icon" onClick={() => void openWorkspace()}>
                    <EditorGlyph editor={editor} icon={editorOption?.icon} size={16} />
                  </button>
                  <span className="editor-pill-divider" />
                  <button
                    className="editor-pill-caret"
                    onClick={(event) => {
                      event.stopPropagation()
                      setEditorMenuOpen((open) => !open)
                    }}
                    aria-label={t('ui.选择编辑器')}
                  >
                    <Icon name="chevron-down" size={11} />
                  </button>
                </div>
                {editorMenuOpen ? (
                  <div
                    className="editor-menu"
                    style={{ position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 95 }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    {editors.map((option) => (
                      <button
                        className="editor-item"
                        key={option.id}
                        onClick={() => {
                          void updateSettings({ defaultEditor: option.id })
                          setEditorMenuOpen(false)
                        }}
                      >
                        <EditorGlyph editor={option.id} icon={option.icon} size={14} />
                        <span className="editor-name">
                          {option.id === 'system'
                            ? t('ui.系统默认')
                            : option.id === 'finder'
                              ? t('ui.访达')
                              : option.id === 'terminal'
                                ? t('ui.终端')
                                : option.name}
                        </span>
                        {option.id === editor ? (
                          <span className="editor-default">{t('ui.（默认）')}</span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
              <button
                className="icon-btn"
                onClick={() => {
                  setFindOpen((open) => !open)
                  setFindQuery('')
                }}
                title={findOpen ? t('ui.关闭搜索') : t('ui.在对话中搜索')}
                aria-label={findOpen ? t('ui.关闭搜索') : t('ui.在对话中搜索')}
              >
                <Icon name="search" size={16} />
              </button>
              <button
                className={`btn btn-sm ${stopPhase === 'stopped' ? 'btn-stopped' : ''}`}
                disabled={stopPhase === 'stopping' || (!canStop && stopPhase === 'idle')}
                onClick={() => void handleStop()}
              >
                <Icon
                  name={
                    stopPhase === 'stopping'
                      ? 'loader'
                      : stopPhase === 'stopped'
                        ? 'check'
                        : 'stop'
                  }
                  size={12}
                  className={stopPhase === 'stopping' ? 'spin' : undefined}
                />
                {stopPhase === 'stopping'
                  ? t('ui.正在停止…')
                  : stopPhase === 'stopped'
                    ? t('ui.已停止')
                    : team
                      ? t('ui.停止回合')
                      : t('ui.停止')}
              </button>
              <button
                className="icon-btn"
                onClick={() => setPanelOpen((open) => !open)}
                title={t('ui.右侧栏')}
                aria-label={t('ui.右侧栏')}
              >
                <Icon name="panel-right" size={16} />
              </button>
            </div>
          </header>

          {findOpen ? (
            <div className="chat-find" role="search">
              <Icon name="search" size={14} />
              <input
                autoFocus
                value={findQuery}
                onChange={(event) => setFindQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    setFindOpen(false)
                    setFindQuery('')
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    stepFind(event.shiftKey ? -1 : 1)
                  }
                }}
                placeholder={t('ui.在对话中搜索…')}
                aria-label={t('ui.在对话中搜索…')}
              />
              <span className="chat-find-count">
                {findQuery.trim()
                  ? findCount
                    ? `${findIndex + 1}/${findCount}`
                    : t('ui.无匹配')
                  : ''}
              </span>
              <button
                className="icon-btn"
                onClick={() => stepFind(-1)}
                disabled={!findCount}
                title={t('ui.上一个匹配')}
                aria-label={t('ui.上一个匹配')}
              >
                <Icon name="arrow-up" size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => stepFind(1)}
                disabled={!findCount}
                title={t('ui.下一个匹配')}
                aria-label={t('ui.下一个匹配')}
              >
                <Icon name="chevron-down" size={14} />
              </button>
              <button
                className="icon-btn"
                onClick={() => {
                  setFindOpen(false)
                  setFindQuery('')
                }}
                title={t('ui.关闭搜索')}
                aria-label={t('ui.关闭搜索')}
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ) : null}

          <div className="chat-body" ref={bodyRef}>
            {session.messages.length === 0 ? (
              <div className="chat-empty">
                <div className="chat-empty-avatar">
                  {team ? (
                    <TeamAvatar
                      name={team.name}
                      src={team.avatar}
                      members={session.participants.map((participant) => participant.agent)}
                      size={44}
                    />
                  ) : (
                    <Avatar name={agent?.name ?? 'Pizza'} src={agent?.avatar} size={44} />
                  )}
                </div>
                <h2>
                  {team ? t('ui.把任务交给「{{name}}」', { name: team.name }) : t('ui.开始和 {{name}} 对话', { name: agent?.name ?? t('ui.智能体') })}
                </h2>
                <p>
                  {team
                    ? t('ui.指挥者会拆解任务并分派给 {{count}} 名成员；输入 @ 可指定成员或我。', { count: session.participants.length - 1 })
                    : agent?.description || t('ui.描述你的任务，智能体会开始工作。')}
                </p>
                {!agent && !team ? (
                  <button className="btn btn-primary" onClick={() => onOpenSettings('agents')}>
                    {t('ui.管理智能体')}
                  </button>
                ) : null}
              </div>
            ) : (
              <MessageList
                messages={session.messages}
                agent={agent}
                participants={session.participants}
                turns={teamTurns}
                toolEvents={toolEvents}
                artifactsByMessage={artifactsByMessage}
                runIdByMessage={runIdByMessage}
                onRetry={(messageId) => void retryMessage(messageId)}
                onStopRun={(runId) => void stopMessageRun(runId)}
                onOpenArtifact={openArtifact}
                onViewLog={(runId) => setLogRunId(runId)}
              />
            )}
          </div>

          {team && activeTurn?.status === 'waiting_user' ? (
            <div className="waiting-card">
              <span className="waiting-icon">
                <Icon name="clock" size={15} />
              </span>
              <div>
                <div className="waiting-title">{t('ui.团队在等你回复')}</div>
                <div className="waiting-desc">
                  {t('ui.在输入框中补充约束，或直接回答成员的问题；回合会继续而不是新建。')}
                </div>
              </div>
            </div>
          ) : null}

          <Composer
            agentName={team?.name ?? agent?.name ?? t('ui.智能体')}
            workspaceName={workspaceLabel(workspace, t)}
            running={hasRunning}
            participants={session.participants}
            onSend={sendMessage}
            onStop={() => void handleStop()}
          />
        </div>
      </main>
      {panelOpen ? (
        <ArtifactPanel
          session={session}
          onClose={() => setPanelOpen(false)}
          requestedArtifactId={focusArtifactId}
          onRequestedHandled={() => setFocusArtifactId(null)}
        />
      ) : null}
      {logRunId ? <RunLogModal runId={logRunId} onClose={() => setLogRunId(null)} /> : null}
      {editorError ? (
        <Modal
          title={t('ui.{{name}} 无法打开', { name: editorName(editorError.editor, t) })}
          width={560}
          onClose={() => setEditorError(null)}
          footer={
            <>
              <button
                className="btn"
                onClick={() => navigator.clipboard.writeText(editorError.path)}
              >
                {t('ui.复制工作区路径')}
              </button>
              <button className="btn btn-primary" onClick={() => setEditorError(null)}>
                {t('ui.完成')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {editorError.message}。
            {t('ui.请确认已安装 {{editor}}，并检查它在「应用程序」中可用。你也可以先在访达中打开下面的路径：', { editor: editorName(editorError.editor, t) })}
          </p>
          <div className="boot-error-path" style={{ marginTop: 12 }}>
            {editorError.path}
          </div>
        </Modal>
      ) : null}
    </>
  )
}

function maskSecrets(value: string): string {
  return value.replace(
    /("(?:token|key|secret|password|authorization)"\s*:\s*")[^"]*(")/gi,
    '$1***$2',
  )
}

function RunLogModal({ runId, onClose }: { runId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const [events, setEvents] = useState<RunEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.pizza.run
      .events(runId)
      .then((result) => {
        if (!cancelled) setEvents(result)
      })
      .catch((caught) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      })
    return () => {
      cancelled = true
    }
  }, [runId])

  return (
    <Modal title={t('ui.运行日志（已脱敏）')} width={720} onClose={onClose}>
      {error ? (
        <div className="rp-empty">{error}</div>
      ) : events === null ? (
        <div className="rp-empty">{t('ui.正在读取运行事件…')}</div>
      ) : events.length === 0 ? (
        <div className="rp-empty">{t('ui.这次运行没有留下事件记录。')}</div>
      ) : (
        <pre className="audit-pre">
          {maskSecrets(
            events
              .map(
                (event) =>
                  `{"seq":${event.seq},"type":"${event.type}","payload":${JSON.stringify(
                    event.payload,
                  )}}`,
              )
              .join('\n'),
          )}
        </pre>
      )}
    </Modal>
  )
}
