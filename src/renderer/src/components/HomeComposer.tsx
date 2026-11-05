import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Agent, AttachmentInput, TeamSummary, Workspace } from '@shared/types'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { TeamAvatar } from './TeamAvatar'
import { workspaceLabel } from '../workspace-label'

interface HomeComposerProps {
  agents: Agent[]
  teams: TeamSummary[]
  selectedAgent: Agent | null
  selectedTeam: TeamSummary | null
  participantsOpen: boolean
  onToggleParticipants: () => void
  onSelectAgent: (id: string) => void
  onSelectTeam: (id: string) => void
  onOpenSettings: (page: string) => void
  workspace: Workspace | null
  canSend: boolean
  onSend: (content: string, attachments: AttachmentInput[]) => Promise<void>
}

const MAX_BYTES = 20 * 1024 * 1024

// 首页输入卡片沿用原型的 18px 大圆角结构；附件、发送与参与者
// 选择都使用真实数据，避免为了视觉一致引入不可用的假控件。
export function HomeComposer({
  agents,
  teams,
  selectedAgent,
  selectedTeam,
  participantsOpen,
  onToggleParticipants,
  onSelectAgent,
  onSelectTeam,
  onOpenSettings,
  workspace,
  canSend,
  onSend,
}: HomeComposerProps) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<AttachmentInput[]>([])
  const [error, setError] = useState<string | null>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const participantBtnRef = useRef<HTMLButtonElement>(null)
  const participantSearchRef = useRef<HTMLInputElement>(null)
  const [participantQuery, setParticipantQuery] = useState('')
  const [menuPosition, setMenuPosition] = useState<{
    left: number
    top?: number
    bottom?: number
    maxHeight: number
  } | null>(null)

  // 参与者菜单用 fixed 定位，避免长列表把首页滚动容器撑高。
  useLayoutEffect(() => {
    if (!participantsOpen) {
      setMenuPosition(null)
      return
    }
    const update = () => {
      const rect = participantBtnRef.current?.getBoundingClientRect()
      if (!rect) return
      const gap = 6
      const margin = 12
      const below = window.innerHeight - rect.bottom - margin
      const above = rect.top - margin
      const openAbove = below < 240 && above > below
      setMenuPosition({
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 350)),
        ...(openAbove
          ? { bottom: window.innerHeight - rect.top + gap, maxHeight: Math.min(520, Math.max(180, above)) }
          : { top: rect.bottom + gap, maxHeight: Math.min(520, Math.max(180, below)) }),
      })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [participantsOpen])

  useLayoutEffect(() => {
    if (!participantsOpen) {
      setParticipantQuery('')
      return
    }
    participantSearchRef.current?.focus()
  }, [participantsOpen])

  const normalizedQuery = participantQuery.trim().toLowerCase()
  const matchesQuery = (...values: Array<string | null | undefined>) =>
    !normalizedQuery ||
    values.some((value) => value?.toLowerCase().includes(normalizedQuery))
  const activeTeams = teams.filter((team) => !team.isArchived)
  const visibleAgents = agents.filter((agent) =>
    matchesQuery(agent.name, agent.description),
  )
  const visibleTeams = activeTeams.filter((team) =>
    matchesQuery(team.name, team.leaderName),
  )

  useEffect(() => {
    const element = textRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`
  }, [text])

  useEffect(() => {
    const quote = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (!detail) return
      setText((current) => `${current}${current ? '\n\n' : ''}> ${detail.replace(/\n/g, '\n> ')}\n\n`)
      textRef.current?.focus()
    }
    const fill = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail
      if (!detail) return
      setText(detail)
      requestAnimationFrame(() => textRef.current?.focus())
    }
    window.addEventListener('pizza:quote', quote)
    window.addEventListener('pizza:fill-prompt', fill)
    return () => {
      window.removeEventListener('pizza:quote', quote)
      window.removeEventListener('pizza:fill-prompt', fill)
    }
  }, [])

  async function addFiles(files: FileList | File[]) {
    setError(null)
    const next: AttachmentInput[] = []
    for (const file of Array.from(files)) {
      if (file.size > MAX_BYTES) {
        setError(t('ui.「{{name}}」超过 20 MB，未添加', { name: file.name }))
        continue
      }
      const buffer = await file.arrayBuffer()
      next.push({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data: new Uint8Array(buffer),
      })
    }
    if (next.length) setAttachments((current) => [...current, ...next])
  }

  async function submit() {
    const content = text.trim()
    if (!content || !canSend) return
    try {
      await onSend(content, attachments)
      setText('')
      setAttachments([])
      setError(null)
    } catch {
      // 失败时保留内容，用户可以直接重试。
    }
  }

  return (
    <div className="home-card">
      <div className="home-card-top">
        <div className="participant-wrap" style={{ position: 'relative' }}>
          <button
            ref={participantBtnRef}
            className="participant-btn"
            onClick={onToggleParticipants}
            title={t('ui.选择参与者')}
          >
            {selectedTeam ? (
              <TeamAvatar
                name={selectedTeam.name}
                src={selectedTeam.avatar}
                members={selectedTeam.memberAvatars}
                size={26}
              />
            ) : selectedAgent ? (
              <Avatar
                name={selectedAgent.name}
                src={selectedAgent.avatar}
                size={26}
              />
            ) : (
              <Avatar name="Pizza" size={26} />
            )}
            <span className="participant-text">
              <span className="participant-label">{selectedTeam ? t('ui.团队') : t('ui.参与者')}</span>
              <span className="participant-name">
                {selectedTeam?.name ?? selectedAgent?.name ?? t('ui.选择智能体或团队')}
              </span>
            </span>
            <Icon name="chevron-down" size={12} />
          </button>
          {participantsOpen ? (
            <div
              className="participant-menu home-participant-menu"
              style={{
                position: 'fixed',
                left: menuPosition?.left ?? 0,
                top: menuPosition?.top,
                bottom: menuPosition?.bottom,
                maxHeight: menuPosition?.maxHeight ?? 520,
              }}
            >
              <div className="participant-search">
                <Icon name="search" size={13} />
                <input
                  ref={participantSearchRef}
                  value={participantQuery}
                  placeholder={t('ui.搜索智能体或团队')}
                  aria-label={t('ui.搜索智能体或团队')}
                  onChange={(event) => setParticipantQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') onToggleParticipants()
                  }}
                />
              </div>
              <div className="participant-list">
              {visibleAgents.length ? (
                <>
                  <div className="pm-group">{t('ui.智能体')}</div>
                  {visibleAgents.map((agent) => (
                    <button
                      key={agent.id}
                      className={`pm-item ${agent.id === selectedAgent?.id ? 'active' : ''}`}
                      onClick={() => onSelectAgent(agent.id)}
                    >
                      <Avatar name={agent.name} src={agent.avatar} size={24} />
                      <span>
                        <span className="pm-name">{agent.name}</span>
                        <span className="pm-desc">{agent.description || t('ui.通用助手')}</span>
                      </span>
                    </button>
                  ))}
                </>
              ) : !normalizedQuery && agents.length === 0 ? (
                <>
                  <div className="pm-group">{t('ui.智能体')}</div>
                  <div className="pm-desc" style={{ padding: '7px 8px' }}>
                    {t('ui.还没有智能体，先在设置中创建一个。')}
                  </div>
                </>
              ) : null}
              {visibleTeams.length ? (
                <>
                  <div className="pm-group">{t('ui.智能体团队')}</div>
                  {visibleTeams.map((team) => (
                    <button
                      key={team.id}
                      className={`pm-item ${team.id === selectedTeam?.id ? 'active' : ''}`}
                      onClick={() => onSelectTeam(team.id)}
                    >
                      <TeamAvatar
                        name={team.name}
                        src={team.avatar}
                        members={team.memberAvatars}
                        size={24}
                      />
                      <span>
                        <span className="pm-name">{team.name}</span>
                        <span className="pm-desc">
                          {t('ui.指挥者')} {team.leaderName ?? t('ui.未设置')} · {t('ui.{{count}} 名成员', { count: team.memberCount })}
                        </span>
                      </span>
                    </button>
                  ))}
                </>
              ) : !normalizedQuery && activeTeams.length === 0 ? (
                <>
                  <div className="pm-group">{t('ui.智能体团队')}</div>
                  <div className="pm-desc" style={{ padding: '7px 8px' }}>
                    {t('ui.还没有团队，可从头脑风暴模板创建。')}
                  </div>
                </>
              ) : null}
              {normalizedQuery &&
              visibleAgents.length === 0 &&
              visibleTeams.length === 0 ? (
                <div className="participant-empty">
                  {t('ui.没有匹配的智能体或团队')}
                </div>
              ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <span className="composer-spacer" />
        <span className="badge">
          {!canSend
            ? t('ui.尚未连接运行时')
            : selectedTeam
              ? t('ui.团队 · 指挥者分派')
              : t('ui.单智能体 · 直接对话')}
        </span>
      </div>

      {attachments.length ? (
        <div className="composer-chips">
          {attachments.map((attachment, index) => (
            <span className="composer-chip" key={`${attachment.name}-${index}`}>
              <Icon name="file" size={11} />
              {attachment.name}
              <button
                onClick={() =>
                  setAttachments((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
                aria-label={t('ui.移除 {{name}}', { name: attachment.name })}
              >
                <Icon name="x" size={10} />
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <textarea
        ref={textRef}
        rows={3}
        value={text}
        placeholder={t('home.placeholder')}
        onChange={(event) => setText(event.target.value)}
        onPaste={(event) => {
          if (event.clipboardData.files.length) void addFiles(event.clipboardData.files)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            void submit()
          }
        }}
      />

      {error ? <div className="composer-error">{error}</div> : null}

      <div className="home-card-bottom">
        <button
          className="tool-btn"
          onClick={() => fileRef.current?.click()}
          title={t('ui.添加文件、Skill 或上下文')}
          aria-label={t('ui.添加附件')}
        >
          <Icon name="plus" size={17} />
        </button>
        <button
          className="tool-btn"
          onClick={onToggleParticipants}
          title={t('ui.@ 指定智能体')}
          aria-label={t('ui.@ 指定智能体')}
        >
          <Icon name="at" size={17} />
        </button>
        <button
          className="tool-btn"
          onClick={() => {
            setText((current) => `${current}/`)
            textRef.current?.focus()
          }}
          title={t('ui./ 引用 Skill')}
          aria-label={t('ui./ 引用 Skill')}
        >
          <Icon name="slash" size={17} />
        </button>
        <button
          className="home-workspace"
          onClick={() => onOpenSettings('system')}
          title={t('ui.选择工作区文件夹')}
        >
          <Icon name="folder" size={14} /> {workspaceLabel(workspace, t)}
        </button>
        <span className="composer-spacer" />
        <button
          className="send-btn"
          onClick={() => void submit()}
          title={t('ui.开始对话')}
          aria-label={t('ui.开始对话')}
        >
          <Icon name="arrow-up" size={16} />
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          hidden
          accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.css,.html,.py,.go,.rs,.yaml,.yml,.toml,.csv,.pdf"
          onChange={(event) => {
            if (event.target.files) void addFiles(event.target.files)
            event.target.value = ''
          }}
        />
      </div>
    </div>
  )
}
