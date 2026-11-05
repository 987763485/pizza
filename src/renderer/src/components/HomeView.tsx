import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import type { TFunction } from 'i18next'
import type { AttachmentInput, SessionSummary } from '@shared/types'
import { useAppStore } from '../store'
import { togglePinnedWorkspace, usePinnedWorkspaces } from '../pinned'
import { workspaceLabel } from '../workspace-label'
import { Avatar } from './Avatar'
import { BrandMark } from './Brand'
import { HomeComposer } from './HomeComposer'
import { Icon, type IconName } from './Icon'

interface HomeViewProps {
  onOpenSettings: (page: string) => void
  onOpenSearch: () => void
}

const SUGGESTIONS: Array<{ id: string; icon: IconName; title: string; sub: string }> = [
  {
    id: 'review',
    icon: 'users',
    title: '让团队评审这段代码',
    sub: '指挥者会分派给评审与测试角色',
  },
  {
    id: 'brainstorm',
    icon: 'sparkle',
    title: '创建一个头脑风暴队',
    sub: '产品、架构、研究与反方',
  },
  { id: 'claude-code', icon: 'plug', title: '接入 Claude Code', sub: '检测本机 CLI 并测试连接' },
  { id: 'summarize', icon: 'folder', title: '总结这个仓库', sub: '从 README 与目录结构开始' },
]

function compactPath(path: string): string {
  return path.replace(/^\/Users\/[^/]+/, '~').replace(/^\/home\/[^/]+/, '~')
}

function recentTime(value: string, t: TFunction): string {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(date.getTime())) return ''
  if (diff < 60_000) return t('ui.刚刚')
  if (diff < 3_600_000) return t('ui.{{count}} 分钟前', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('ui.{{count}} 小时前', { count: Math.floor(diff / 3_600_000) })
  return date.toLocaleDateString(i18n.language === 'en' ? 'en-US' : 'zh-CN', {
    month: 'numeric',
    day: 'numeric',
  })
}

export function HomeView({ onOpenSettings, onOpenSearch }: HomeViewProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const workspaces = useAppStore((state) => state.workspaces)
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId)
  const agents = useAppStore((state) => state.agents)
  const teams = useAppStore((state) => state.teams)
  const runtimes = useAppStore((state) => state.runtimes)
  const sessions = useAppStore((state) => state.sessions)
  const createSession = useAppStore((state) => state.createSession)
  const createTeamSession = useAppStore((state) => state.createTeamSession)
  const sendMessage = useAppStore((state) => state.sendMessage)
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null)
  const [participantsOpen, setParticipantsOpen] = useState(false)
  const pinned = usePinnedWorkspaces()

  const workspace =
    workspaces.find((item) => item.id === currentWorkspaceId) ?? workspaces[0] ?? null
  const activeAgents = useMemo(
    () => agents.filter((agent) => !agent.isArchived),
    [agents],
  )
  const onlineRuntime = runtimes.some((runtime) => runtime.status === 'online')
  const activeTeams = useMemo(
    () => teams.filter((team) => !team.isArchived),
    [teams],
  )
  const selectedTeam =
    activeTeams.find((team) => team.id === selectedTeamId) ?? null
  const selectedAgent = selectedTeam
    ? null
    : activeAgents.find((agent) => agent.id === selectedAgentId) ?? activeAgents[0] ?? null
  const activeCount = sessions.filter(
    (session) => session.status === 'running' || session.status === 'waiting_user',
  ).length
  const recentSessions = useMemo(
    () =>
      [...sessions]
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, 3),
    [sessions],
  )

  useEffect(() => {
    if (!selectedAgentId && !selectedTeamId && activeAgents[0]) {
      setSelectedAgentId(activeAgents[0].id)
    }
  }, [activeAgents, selectedAgentId, selectedTeamId])

  async function handleSend(content: string, attachments: AttachmentInput[]) {
    if (!selectedAgent && !selectedTeam) return
    const session = selectedTeam
      ? await createTeamSession(selectedTeam.id)
      : selectedAgent
        ? await createSession(selectedAgent.id)
        : null
    if (!session) return
    try {
      await sendMessage(content, attachments)
      navigate(`/session/${session.id}`)
    } catch {
      // store 已显示错误；留在首页并保留输入，避免丢失草稿。
    }
  }

  function fillPrompt(prompt: string) {
    window.dispatchEvent(new CustomEvent('pizza:fill-prompt', { detail: prompt }))
  }

  function openRecent(session: SessionSummary) {
    navigate(`/session/${session.id}`)
  }

  return (
    <main className="main">
      <div className="home">
        {workspace ? (
          <div className="workspace-hero">
            <div className="workspace-hero-left">
              <span className="workspace-hero-icon">
                <Icon name="folder" size={16} />
              </span>
              <div>
                <div className="workspace-hero-name">{workspaceLabel(workspace, t)}</div>
                <div className="workspace-hero-path">{compactPath(workspace.rootPath)}</div>
              </div>
            </div>
            <div className="workspace-hero-right">
              <span className="badge">
                {t('ui.{{count}} 个活跃', { count: activeCount })}
              </span>
              <button
                className={`icon-btn ${pinned.includes(workspace.id) ? 'active' : ''}`}
                onClick={() => togglePinnedWorkspace(workspace.id)}
                title={t('ui.置顶工作区')}
                aria-label={t('ui.置顶工作区')}
              >
                <Icon name="pin" size={15} />
              </button>
            </div>
          </div>
        ) : null}

        <div className="home-inner">
          <div className="home-mark">
            <BrandMark size={46} />
          </div>
          <h1 className="home-title">{t('ui.今天想切成哪一块？')}</h1>
          <p className="home-sub">{t('ui.选一个智能体，或拉一支团队，从一句话开始。')}</p>

          {participantsOpen ? (
            <div
              className="popover-layer"
              onClick={() => setParticipantsOpen(false)}
              aria-hidden="true"
            />
          ) : null}
          <HomeComposer
            agents={activeAgents}
            teams={activeTeams}
            selectedAgent={selectedAgent}
            selectedTeam={selectedTeam}
            participantsOpen={participantsOpen}
            onToggleParticipants={() => setParticipantsOpen((open) => !open)}
            onSelectAgent={(id) => {
              setSelectedAgentId(id)
              setSelectedTeamId(null)
              setParticipantsOpen(false)
            }}
            onSelectTeam={(id) => {
              setSelectedTeamId(id)
              setSelectedAgentId(null)
              setParticipantsOpen(false)
            }}
            onOpenSettings={(page) => {
              setParticipantsOpen(false)
              onOpenSettings(page)
            }}
            workspace={workspace}
            canSend={!!(selectedAgent || selectedTeam) && onlineRuntime}
            onSend={handleSend}
          />

          <div className="suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                className="suggestion"
                key={suggestion.title}
                onClick={() => {
                  if (suggestion.id === 'claude-code') {
                    onOpenSettings('runtimes')
                  } else {
                    fillPrompt(suggestion.title)
                  }
                }}
              >
                <span className="suggestion-icon">
                  <Icon name={suggestion.icon} size={17} />
                </span>
                <span>
                  <span>{t(`ui.${suggestion.title}`)}</span>
                  <span className="suggestion-sub">{t(`ui.${suggestion.sub}`)}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="recent-block">
            <div className="recent-head">
              <span>{t('ui.最近会话')}</span>
              <button
                className="settings-link"
                onClick={onOpenSearch}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
              >
                {t('ui.查看全部')} <Icon name="chevron-right" size={10} />
              </button>
            </div>
            <div className="recent-list">
              {recentSessions.length ? (
                recentSessions.map((session) => (
                  <div
                    className="recent-item"
                    key={session.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => openRecent(session)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        openRecent(session)
                      }
                    }}
                  >
                    <Avatar
                      name={
                        session.mode === 'team'
                          ? (session.teamName ?? t('ui.团队'))
                          : (session.agentName ?? 'Pizza')
                      }
                      src={
                        session.mode === 'team' ? session.teamAvatar : session.agentAvatar
                      }
                      size={24}
                    />
                    <span className="recent-title">{session.title}</span>
                    <span className="badge">
                      {session.mode === 'team' ? t('ui.团队') : t('ui.智能体')}
                    </span>
                    <span className="recent-time">{recentTime(session.updatedAt, t)}</span>
                  </div>
                ))
              ) : (
                <div className="ws-empty" style={{ margin: '4px 2px' }}>
                  {t('ui.这个工作区还没有会话 :)')}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
