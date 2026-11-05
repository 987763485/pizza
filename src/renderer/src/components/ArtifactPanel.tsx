import { useEffect, useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Artifact, SessionDetail, TeamTurnEvent } from '@shared/types'
import { useAppStore } from '../store'
import { Avatar } from './Avatar'
import { TeamAvatar } from './TeamAvatar'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface ArtifactPanelProps {
  session: SessionDetail
  onClose: () => void
  requestedArtifactId?: string | null
  onRequestedHandled?: () => void
}

type PanelTab = 'artifacts' | 'trajectory' | 'changes' | 'git' | 'audit'

const TABS: Array<[PanelTab, string]> = [
  ['artifacts', '产出物'],
  ['trajectory', '轨迹'],
  ['changes', '变更'],
  ['git', 'Git'],
  ['audit', '审计'],
]

const TITLES: Record<PanelTab, string> = {
  artifacts: '产出物',
  trajectory: '运行轨迹',
  changes: '变更记录',
  git: 'Git',
  audit: '审计日志',
}

interface ArtifactWithRelative extends Artifact {
  relative: string
}

interface TreeFolder {
  folders: Map<string, TreeFolder>
  files: ArtifactWithRelative[]
}

// 只预览浏览器能安全展示的文本与图片；其他类型给出明确降级提示，
// 避免把二进制内容当作 UTF-8 文本渲染成乱码。
const PREVIEWABLE_EXTENSIONS = new Set([
  'md',
  'mdx',
  'txt',
  'json',
  'ts',
  'tsx',
  'js',
  'jsx',
  'css',
  'html',
  'py',
  'go',
  'rs',
  'yaml',
  'yml',
  'toml',
  'csv',
  'log',
  'sh',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'svg',
])

function normalizePrivate(path: string): string {
  // macOS 的 /tmp 可能是 /private/tmp 的符号链接；统一后再计算相对路径。
  return path.replace(/^\/private(?=\/)/, '').replace(/\\/g, '/')
}

function relativePath(workspacePath: string, path: string): string {
  const root = normalizePrivate(workspacePath)
  const absolute = normalizePrivate(path)
  if (absolute === root) return ''
  if (absolute.startsWith(`${root}/`)) return absolute.slice(root.length + 1)
  return absolute
}

function buildTree(artifacts: Array<Artifact & { relative: string }>): TreeFolder {
  const root: TreeFolder = { folders: new Map(), files: [] }
  for (const artifact of artifacts) {
    const parts = artifact.relative.split('/')
    const file = parts.pop()
    if (!file) continue
    let node = root
    for (const part of parts) {
      const existing = node.folders.get(part)
      if (existing) {
        node = existing
      } else {
        const created: TreeFolder = { folders: new Map(), files: [] }
        node.folders.set(part, created)
        node = created
      }
    }
    node.files.push({ ...artifact, title: file })
  }
  return root
}

function statusOf(artifact: Artifact): { className: string; label: string } {
  if (artifact.kind === 'added') return { className: 'a', label: 'A' }
  if (artifact.kind === 'modified') return { className: 'm', label: 'M' }
  return { className: 'info', label: 'i' }
}

function formatTime(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function turnEventStatus(status: string, t: TFunction): string {
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
    default:
      return status
  }
}

function teamEventText(event: TeamTurnEvent, session: SessionDetail, t: TFunction): string {
  const participant = event.participantAgentId
    ? session.participants.find((item) => item.agent.id === event.participantAgentId)?.agent.name
    : null
  switch (event.type) {
    case 'turn_started':
      return t('ui.回合开始')
    case 'dispatch':
      return `${t('ui.分派给 {{name}}', { name: participant ?? t('ui.成员') })}${event.payload.convergence ? t('ui.（收敛总结）') : ''}`
    case 'run_started':
      return t('ui.{{name}} 开始运行', { name: participant ?? t('ui.成员') })
    case 'run_completed':
      return t('ui.{{name}} 完成运行', { name: participant ?? t('ui.成员') })
    case 'run_failed':
      return t('ui.{{name}} 运行失败', { name: participant ?? t('ui.成员') })
    case 'run_cancelled':
      return t('ui.{{name}} 已停止', { name: participant ?? t('ui.成员') })
    case 'user_interjection':
      return event.payload.queued === false
        ? t('ui.你回复了团队，回合继续')
        : t('ui.你插入了一条消息（已排队）')
    case 'waiting_user':
      return t('ui.等待你的回复')
    case 'protection_triggered':
      return t('ui.保护触发：{{reason}}', { reason: String(event.payload.reason ?? '') })
    case 'converging':
      return t('ui.进入收敛阶段')
    case 'turn_completed':
      return t('ui.回合完成，已生成收敛产出物')
    case 'turn_failed':
      return t('ui.回合失败')
    case 'turn_cancelled':
      return t('ui.回合已停止')
    case 'turn_interrupted':
      return t('ui.回合因应用重启中断')
    case 'mention_ignored':
      return t('ui.忽略自引用提及')
    default:
      return String(event.payload.kind ?? event.type)
  }
}

export function ArtifactPanel({
  session,
  onClose,
  requestedArtifactId,
  onRequestedHandled,
}: ArtifactPanelProps) {
  const { t } = useTranslation()
  const [tab, setTab] = useState<PanelTab>('artifacts')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<Artifact['kind'] | 'all'>('all')
  const [openFolders, setOpenFolders] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(
        localStorage.getItem(`pizza:artifact-folders:${session.id}`) ?? '{}',
      ) as Record<string, boolean>
    } catch {
      return {}
    }
  })
  const teamTurns = useAppStore((state) => state.teamTurns)
  const teamTurnEvents = useAppStore((state) => state.teamTurnEvents)
  const latestTurn = teamTurns.at(-1) ?? null
  const latestEvents = latestTurn ? (teamTurnEvents[latestTurn.id] ?? []) : []
  const [preview, setPreview] = useState<Artifact | null>(null)
  const [previewState, setPreviewState] = useState<{
    kind: 'text' | 'image'
    content: string
    error: string | null
  } | null>(null)
  const [markdownRaw, setMarkdownRaw] = useState(false)
  const [imageZoom, setImageZoom] = useState(false)

  const normalizedArtifacts = useMemo(
    () =>
      session.artifacts.map((artifact) => ({
        ...artifact,
        relative: relativePath(session.workspacePath, artifact.path),
      })),
    [session.artifacts, session.workspacePath],
  )

  useEffect(() => {
    try {
      setOpenFolders(
        JSON.parse(
          localStorage.getItem(`pizza:artifact-folders:${session.id}`) ?? '{}',
        ) as Record<string, boolean>,
      )
    } catch {
      setOpenFolders({})
    }
  }, [session.id])

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    return normalizedArtifacts.filter(
      (artifact) =>
        (kindFilter === 'all' || artifact.kind === kindFilter) &&
        (!normalized || artifact.relative.toLowerCase().includes(normalized)),
    )
  }, [kindFilter, normalizedArtifacts, query])

  const tree = useMemo(() => buildTree(filtered), [filtered])

  useEffect(() => {
    if (!requestedArtifactId) return
    const artifact = session.artifacts.find((item) => item.id === requestedArtifactId)
    if (artifact) {
      setTab('artifacts')
      setPreview(artifact)
      onRequestedHandled?.()
    }
  }, [onRequestedHandled, requestedArtifactId, session.artifacts])

  useEffect(() => {
    setMarkdownRaw(false)
    setImageZoom(false)
  }, [preview?.id])

  useEffect(() => {
    if (!preview) {
      setPreviewState(null)
      return
    }
    let cancelled = false
    const extension = preview.path.split('.').pop()?.toLowerCase() ?? ''
    if (!PREVIEWABLE_EXTENSIONS.has(extension)) {
      setPreviewState({
        kind: 'text',
        content: '',
        error: t('ui.该文件类型暂不支持预览，请使用会话头部的编辑器入口打开。'),
      })
      return
    }
    setPreviewState({ kind: 'text', content: '', error: null })
    void window.pizza.artifact
      .read(preview.path)
      .then((result) => {
        if (!cancelled) {
          setPreviewState({ kind: result.kind, content: result.content, error: null })
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPreviewState({
            kind: 'text',
            content: '',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      cancelled = true
    }
  }, [preview])

  function isOpen(path: string, name: string): boolean {
    if (query.trim()) return true
    return openFolders[path] ?? name === 'docs'
  }

  function toggleFolder(path: string, open: boolean) {
    setOpenFolders((current) => {
      const next = { ...current, [path]: !open }
      localStorage.setItem(
        `pizza:artifact-folders:${session.id}`,
        JSON.stringify(next),
      )
      return next
    })
  }

  function renderFolder(node: TreeFolder, path = ''): React.ReactNode {
    const folders = Array.from(node.folders.entries()).sort(([a], [b]) =>
      a.localeCompare(b, 'zh'),
    )
    const files = [...node.files].sort((a, b) => a.title.localeCompare(b.title, 'zh'))
    return (
      <>
        {folders.map(([name, child]) => {
          const full = path ? `${path}/${name}` : name
          const open = isOpen(full, name)
          return (
            <div key={full}>
              <div
                className="tree-row tree-folder"
                onClick={() => toggleFolder(full, open)}
              >
                <span className="tree-caret">
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} size={11} />
                </span>
                <span className="tree-folder-icon">
                  <Icon name="folder" size={14} />
                </span>
                <span className="tree-name">{name}</span>
              </div>
              {open ? (
                <div className="tree-children">{renderFolder(child, full)}</div>
              ) : null}
            </div>
          )
        })}
        {files.map((artifact) => {
          const status = statusOf(artifact)
          return (
            <div
              className="tree-row tree-file"
              key={artifact.id}
              title={`${artifact.relative} · ${artifact.kind}`}
              onClick={() => setPreview(artifact)}
            >
              <span className="tree-caret" />
              <span className={`tree-status ${status.className}`}>{status.label}</span>
              <span className="tree-name">{artifact.title}</span>
            </div>
          )
        })}
      </>
    )
  }

  const agent = session.agent
  const trajectory = session.messages.slice(-14)
  const rosterStatus =
    session.status === 'running'
      ? 'running'
      : session.status === 'waiting_user'
        ? 'waiting'
        : session.status === 'error'
          ? 'offline'
          : 'done'
  const rosterText =
    session.status === 'running'
      ? t('ui.工作中')
      : session.status === 'waiting_user'
        ? t('ui.等待你')
        : session.status === 'error'
          ? t('ui.运行失败')
          : t('ui.已完成')

  return (
    <aside className="rightpanel" aria-label={t('ui.产出物与运行信息')}>
      <div className="rp-head">
        <span className="rp-title">{t(`ui.${TITLES[tab]}`)}</span>
        <button className="icon-btn" onClick={onClose} aria-label={t('ui.关闭右侧栏')}>
          <Icon name="x" size={15} />
        </button>
      </div>
      <div className="rp-tabs">
        {TABS.map(([id, label]) => (
          <button
            className={`rp-tab ${tab === id ? 'active' : ''}`}
            key={id}
            onClick={() => setTab(id)}
            title={id === 'changes' || id === 'git' || id === 'audit' ? 'P1' : undefined}
          >
            {t(`ui.${label}`)}
          </button>
        ))}
      </div>
      <div className="rp-body">
        {tab === 'artifacts' ? (
          <>
            <div className="rp-section">
              <div className="rp-section-title">
                <span>{t('ui.产出物')}</span>
                <span>{session.artifacts.length}</span>
              </div>
              <label className="search-input file-filter">
                <Icon name="search" size={12} />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('ui.筛选文件…')}
                  aria-label={t('ui.筛选产出物')}
                />
              </label>
              <div className="artifact-filters">
                {(
                  [
                    ['all', '全部'],
                    ['added', '新增'],
                    ['modified', '修改'],
                    ['info', '信息'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`filter-chip ${kindFilter === value ? 'active' : ''}`}
                    onClick={() => setKindFilter(value)}
                  >
                    {t(`ui.${label}`)}
                  </button>
                ))}
              </div>
              <div className="file-tree">
                {filtered.length ? (
                  renderFolder(tree)
                ) : (
                  <div className="rp-empty">
                    {session.artifacts.length
                      ? t('ui.没有匹配的文件')
                      : t('ui.智能体写入工作区文件后，产出物会出现在这里。')}
                  </div>
                )}
              </div>
            </div>
            <div className="rp-note">
              {t('ui.文件产出按目录结构展示；点击文件预览，展开文件夹查看全部。变更、Git 与审计为 P1。')}
            </div>
          </>
        ) : null}

        {tab === 'trajectory' ? (
          session.team ? (
            <>
              <div className="rp-section">
                <div className="rp-section-title">
                  <span>{t('ui.本回合')}</span>
                  <span>
                    {latestTurn
                      ? `${t('ui.第 {{round}} 轮', { round: latestTurn.seq })} · ${turnEventStatus(latestTurn.status, t)}`
                      : t('ui.尚未开始')}
                  </span>
                </div>
                {session.participants.map((participant) => (
                  <div className="roster-row" key={participant.agent.id}>
                    <Avatar
                      name={participant.agent.name}
                      src={participant.agent.avatar}
                      size={24}
                    />
                    <span
                      className={`status-dot ${
                        latestTurn &&
                        latestTurn.status !== 'completed' &&
                        latestTurn.status !== 'failed' &&
                        latestTurn.status !== 'cancelled' &&
                        latestTurn.status !== 'interrupted'
                          ? 'running'
                          : 'online'
                      }`}
                    />
                    <span className="roster-name">{participant.agent.name}</span>
                    <span className="roster-state">
                      {participant.role === 'leader' ? t('ui.指挥者') : participant.roleDescription || t('ui.成员')}
                    </span>
                  </div>
                ))}
              </div>
              <div className="rp-divider" />
              <div className="rp-section">
                <div className="rp-section-title">
                  <span>{t('ui.对话轨迹')}</span>
                  <span>{latestEvents.length}</span>
                </div>
                {latestEvents.length ? (
                  latestEvents.map((event) => (
                    <div
                      className={`trajectory-item ${event.type === 'user_interjection' ? 'interject' : ''}`}
                      key={event.id}
                    >
                      <span className="trajectory-time">{formatTime(event.createdAt)}</span>
                      <span className="trajectory-dot" />
                      <span className="trajectory-text">{teamEventText(event, session, t)}</span>
                    </div>
                  ))
                ) : (
                  <div className="rp-empty">{t('ui.发送第一条消息后，这里会出现调度轨迹。')}</div>
                )}
              </div>
              <div className="rp-note">
                {latestTurn
                  ? t('ui.跳数 {{hops}} · 轮次 {{rounds}} · Token {{tokens}}', { hops: latestTurn.hops, rounds: latestTurn.rounds, tokens: latestTurn.tokensIn + latestTurn.tokensOut })
                  : t('ui.团队轨迹由主进程事件驱动，不在前端推断。')}
              </div>
            </>
          ) : (
            <>
              <div className="rp-section">
                <div className="rp-section-title">
                  <span>{t('ui.本回合')}</span>
                  <span>{session.status === 'running' ? t('ui.1 工作中') : t('ui.1 已完成')}</span>
                </div>
                <div className="roster-row">
                  <Avatar
                    name={agent?.name ?? t('ui.智能体')}
                    src={agent?.avatar}
                    size={24}
                  />
                  <span className={`status-dot ${rosterStatus === 'done' ? 'online' : rosterStatus}`} />
                  <span className="roster-name">{agent?.name ?? t('ui.智能体')}</span>
                  <span className={`roster-state ${rosterStatus}`}>{rosterText}</span>
                </div>
              </div>
              <div className="rp-divider" />
              <div className="rp-section">
                <div className="rp-section-title">
                  <span>{t('ui.轨迹')}</span>
                  <span>{trajectory.length}</span>
                </div>
                {trajectory.length ? (
                  trajectory.map((message) => (
                    <div
                      className={`trajectory-item ${message.senderType === 'user' ? 'interject' : ''}`}
                      key={message.id}
                    >
                      <span className="trajectory-time">{formatTime(message.createdAt)}</span>
                      <span className="trajectory-dot" />
                      <span className="trajectory-text">
                        {message.senderType === 'user'
                          ? t('ui.你：{{text}}', { text: message.content.slice(0, 60) })
                          : t('ui.{{name}}：{{text}}', { name: agent?.name ?? t('ui.智能体'), text: message.content.slice(0, 60) })}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rp-empty">{t('ui.发送第一条消息后，这里会出现运行轨迹。')}</div>
                )}
              </div>
              <div className="rp-note">{t('ui.Token 与成本统计将在 P1 提供。')}</div>
            </>
          )
        ) : null}

        {tab === 'changes' ? (
          <>
            <div className="rp-note" style={{ marginTop: 0 }}>
              {t('ui.P1 预览 · 来自本会话的运行')}
            </div>
            <div className="rp-section" style={{ marginTop: 10 }}>
              <div className="rp-section-title">
                <span>{t('ui.文件变更')}</span>
                <span>{session.artifacts.length}</span>
              </div>
              {session.artifacts.length ? (
                session.artifacts.map((artifact) => (
                  <button
                    className="artifact-item"
                    key={artifact.id}
                    onClick={() => setPreview(artifact)}
                  >
                    <span className="artifact-icon">
                      <Icon name="file-text" size={15} />
                    </span>
                    <div className="artifact-text">
                      <div className="artifact-name">{artifact.title}</div>
                      <div className="artifact-meta">
                        {relativePath(session.workspacePath, artifact.path)}
                      </div>
                    </div>
                    <Icon name="chevron-right" size={13} />
                  </button>
                ))
              ) : (
                <div className="rp-empty">{t('ui.本会话还没有文件变更。')}</div>
              )}
            </div>
            <div className="rp-note">{t('ui.变更记录只展示本会话运行产生的文件；不会修改工作区。')}</div>
          </>
        ) : null}

        {tab === 'git' ? (
          <>
            <div className="rp-note" style={{ marginTop: 0 }}>
              {t('ui.P1 预览 · 只读状态 + 基础提交')}
            </div>
            <div className="team-summary" style={{ marginTop: 10 }}>
              <div className="summary-row">
                <span className="k">{t('ui.分支')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10.5 }}>
                  {session.workspacePath.split('/').pop() ?? 'main'}
                </span>
              </div>
              <div className="summary-row">
                <span className="k">{t('ui.状态')}</span>
                <span>{t('ui.{{count}} 个文件已修改', { count: session.artifacts.length })}</span>
              </div>
              <div className="summary-row">
                <span className="k">{t('ui.工作区')}</span>
                <span>{session.workspacePath}</span>
              </div>
            </div>
            <div className="rp-note">
              {t('ui.Git 面板为 P1；完整仓库操作请使用会话头部的编辑器入口。')}
            </div>
          </>
        ) : null}

        {tab === 'audit' ? (
          <>
            <div className="rp-note" style={{ marginTop: 0 }}>
              {t('ui.P1 预览 · 敏感字段已脱敏')}
            </div>
            <pre className="audit-pre">
              {session.messages
                .slice(-5)
                .map(
                  (message) =>
                    `{"ts":"${message.createdAt}","actor":"${message.senderType === 'user' ? 'user' : (agent?.name ?? 'agent')}","event":"${message.senderType === 'user' ? 'user.interject' : 'agent.message'}","session":"${session.id.slice(0, 8)}"}`,
                )
                .join('\n') || t('ui.暂无审计事件')}
            </pre>
            <div className="rp-note">{t('ui.审计事件按追加写保存为 JSONL；可按会话、运行与智能体筛选。')}</div>
          </>
        ) : null}
      </div>

      {preview ? (
        <Modal
          title={preview.title}
          width={760}
          onClose={() => setPreview(null)}
          footer={
            <>
              <button
                className="btn"
                onClick={() => void window.pizza.artifact.reveal(preview.path)}
              >
                <Icon name="folder" size={13} /> {t('ui.显示文件')}
              </button>
              <button className="btn btn-primary" onClick={() => setPreview(null)}>
                {t('ui.完成')}
              </button>
            </>
          }
        >
          <div className="artifact-preview-meta">
            {relativePath(session.workspacePath, preview.path)}
          </div>
          {!previewState ? (
            <div className="rp-empty">{t('ui.正在读取产出物…')}</div>
          ) : previewState.error ? (
            <div className="rp-empty">{previewState.error}</div>
          ) : previewState.kind === 'image' ? (
            <button
              className={`artifact-image-button ${imageZoom ? 'zoomed' : ''}`}
              onClick={() => setImageZoom((value) => !value)}
              title={imageZoom ? t('ui.点击缩小') : t('ui.点击放大')}
            >
              <img className="artifact-image" src={previewState.content} alt={preview.title} />
            </button>
          ) : preview.path.endsWith('.md') ? (
            <>
              <div className="preview-mode-toggle">
                <button
                  className={markdownRaw ? '' : 'active'}
                  onClick={() => setMarkdownRaw(false)}
                >
                  {t('ui.渲染')}
                </button>
                <button
                  className={markdownRaw ? 'active' : ''}
                  onClick={() => setMarkdownRaw(true)}
                >
                  {t('ui.原文')}
                </button>
              </div>
              {markdownRaw ? (
                <pre className="artifact-code">{previewState.content}</pre>
              ) : (
                <div className="msg-content markdown artifact-markdown">
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    rehypePlugins={[rehypeHighlight]}
                  >
                    {previewState.content}
                  </ReactMarkdown>
                </div>
              )}
            </>
          ) : (
            <pre className="artifact-code">{previewState.content}</pre>
          )}
        </Modal>
      ) : null}
    </aside>
  )
}
