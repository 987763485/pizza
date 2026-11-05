import { useEffect, useRef, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { RuntimeConfig, SessionSummary } from '@shared/types'
import i18n from '../i18n'
import { localizeError } from '../locales/errors'
import { formatDateTime } from '../format'
import { useAppStore } from '../store'
import { cropSquareDataUrl } from '../avatar'
import { saveProfile, useProfile } from '../profile'
import { AvatarImage } from './AvatarImage'
import { AgentEditor } from './AgentEditor'
import { AgentSettings } from './AgentSettings'
import { RuntimeEditor } from './RuntimeEditor'
import { RuntimeSettings } from './RuntimeSettings'
import { TeamEditor } from './TeamEditor'
import { TeamSettings } from './TeamSettings'
import { SkillSettings } from './SkillSettings'
import { McpSettings } from './McpSettings'
import { Brand } from './Brand'
import { Icon, type IconName } from './Icon'
import { Modal } from './Modal'

interface SettingsViewProps {
  page?: string
}

interface NavGroup {
  group: string
  items: Array<{ id: string; labelKey: string; icon: IconName }>
}

const NAV: NavGroup[] = [
  {
    group: 'personal',
    items: [
      { id: 'profile', labelKey: 'settings.nav.profile', icon: 'user' },
      { id: 'appearance', labelKey: 'settings.nav.appearance', icon: 'sun' },
    ],
  },
  {
    group: 'data',
    items: [
      { id: 'memory', labelKey: 'settings.nav.memory', icon: 'database' },
      { id: 'archived', labelKey: 'settings.nav.archived', icon: 'archive' },
      { id: 'stats', labelKey: 'settings.nav.stats', icon: 'chart' },
    ],
  },
  {
    group: 'team',
    items: [
      { id: 'agents', labelKey: 'settings.nav.agents', icon: 'cpu' },
      { id: 'teams', labelKey: 'settings.nav.teams', icon: 'users' },
    ],
  },
  {
    group: 'resources',
    items: [
      { id: 'skills', labelKey: 'settings.nav.skills', icon: 'wand' },
      { id: 'mcp', labelKey: 'settings.nav.mcp', icon: 'plug' },
      { id: 'runtimes', labelKey: 'settings.nav.runtimes', icon: 'box' },
      { id: 'plugins', labelKey: 'settings.nav.plugins', icon: 'layers' },
    ],
  },
  {
    group: 'systemGroup',
    items: [
      { id: 'system', labelKey: 'settings.nav.system', icon: 'settings' },
      { id: 'reset', labelKey: 'settings.nav.reset', icon: 'refresh' },
      { id: 'about', labelKey: 'settings.nav.about', icon: 'help' },
    ],
  },
]

const PAGE_IDS = new Set([
  ...NAV.flatMap((group) => group.items.map((item) => item.id)),
  'agent-edit',
  'team-edit',
  'runtime-new',
])
const LOCAL_PAGES = new Set([
  'agents',
  'teams',
  'skills',
  'mcp',
  'runtimes',
  'plugins',
  'stats',
  'agent-edit',
  'team-edit',
  'runtime-new',
])
// 记忆与归档列表同样需要横向空间，但不改变顶栏的工作区标记。
const WIDE_PAGES = new Set([...LOCAL_PAGES, 'memory', 'archived'])

export function SettingsView({ page = 'profile' }: SettingsViewProps) {
  const navigate = useNavigate()
  const { t } = useTranslation()
  const agents = useAppStore((state) => state.agents)
  const teams = useAppStore((state) => state.teams)
  const runtimes = useAppStore((state) => state.runtimes)
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const current = PAGE_IDS.has(page) ? page : null

  const pageLabels: Record<string, string> = Object.fromEntries([
    ...NAV.flatMap((group) =>
      group.items.map((item) => [item.id, t(item.labelKey)]),
    ),
    ['agent-edit', t('settings.nav.agents')],
    ['team-edit', t('settings.nav.teams')],
    ['runtime-new', t('settings.nav.runtimes')],
  ])

  if (!current) return <Navigate to="/settings/profile" replace />

  const activeNav =
    current === 'agent-edit'
      ? 'agents'
      : current === 'team-edit'
        ? 'teams'
        : current === 'runtime-new'
          ? 'runtimes'
          : current
  const counts: Record<string, number> = {
    agents: agents.filter((agent) => !agent.isArchived).length,
    teams: teams.filter((team) => !team.isArchived).length,
    skills: 0,
    mcp: 0,
    runtimes: runtimes.length,
  }
  const theme = settings?.theme ?? 'light'

  function toggleTheme() {
    void updateSettings({ theme: theme === 'dark' ? 'light' : 'dark' })
  }

  return (
    <div className="settings-shell">
      <nav className="settings-nav">
        <div className="brand-row">
          <button className="brand brand-button" onClick={() => navigate('/')}>
            <Brand />
          </button>
        </div>
        <div className="settings-nav-scroll">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="settings-group">{t(`settings.${group.group}`)}</div>
              {group.items.map((item) => (
                <button
                  key={item.id}
                  className={`settings-nav-item ${activeNav === item.id ? 'active' : ''}`}
                  onClick={() => navigate(`/settings/${item.id}`)}
                >
                  <Icon name={item.icon} size={15} />
                  {t(item.labelKey)}
                  {counts[item.id] !== undefined ? (
                    <span className="nav-count">{counts[item.id]}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
        <div className="settings-nav-foot">
          <button className="settings-return" onClick={() => navigate('/')}>
            <Icon name="chevron-left" size={14} /> {t('nav.backToChat')}
          </button>
          <button
            className="settings-theme"
            onClick={toggleTheme}
            title={t('titlebar.theme')}
            aria-label={t('titlebar.theme')}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={15} />
          </button>
        </div>
      </nav>

      <div className="settings-content">
        <div className="settings-topbar">
          <span>{t('nav.settings')}</span>
          <Icon name="chevron-right" size={11} />
          <strong>{pageLabels[current]}</strong>
          <span className="badge" style={{ marginLeft: 6 }}>
            {LOCAL_PAGES.has(current) ? t('settings.localWorkspace') : t('nav.settings')}
          </span>
        </div>
        {current === 'agents' ? (
          <div className="settings-inner wide">
            <AgentSettings
              onOpenPage={(next) => navigate(`/settings/${next}`)}
              onEditAgent={(agentId) =>
                navigate(
                  agentId
                    ? `/settings/agent-edit?id=${encodeURIComponent(agentId)}`
                    : '/settings/agent-edit',
                )
              }
            />
          </div>
        ) : current === 'runtimes' ? (
          <div className="settings-inner wide">
            <RuntimeSettings
              onEditRuntime={(runtimeId) =>
                navigate(
                  runtimeId
                    ? `/settings/runtime-new?id=${encodeURIComponent(runtimeId)}`
                    : '/settings/runtime-new',
                )
              }
            />
          </div>
        ) : current === 'teams' ? (
          <div className="settings-inner wide">
            <TeamSettings
              onEditTeam={(teamId) =>
                navigate(
                  teamId
                    ? `/settings/team-edit?id=${encodeURIComponent(teamId)}`
                    : '/settings/team-edit',
                )
              }
            />
          </div>
        ) : current === 'team-edit' ? (
          <div className="settings-inner wide" style={{ maxWidth: 1240 }}>
            <TeamEditor />
          </div>
        ) : current === 'agent-edit' ? (
          <div className="settings-inner wide" style={{ maxWidth: 1240 }}>
            <AgentEditor onOpenPage={(next) => navigate(`/settings/${next}`)} />
          </div>
        ) : current === 'runtime-new' ? (
          <div className="settings-inner wide" style={{ maxWidth: 1180 }}>
            <RuntimeEditor />
          </div>
        ) : (
          <div className={`settings-inner ${WIDE_PAGES.has(current) ? 'wide' : ''}`}>
            {current === 'profile' ? <ProfileSettings /> : null}
            {current === 'appearance' ? <AppearanceSettings /> : null}
            {current === 'memory' ? <MemorySettings /> : null}
            {current === 'archived' ? <ArchivedSettings /> : null}
            {current === 'system' ? <SystemSettings /> : null}
            {current === 'reset' ? <ResetSettings /> : null}
            {current === 'about' ? <AboutSettings /> : null}
            {current === 'skills' ? <SkillSettings /> : null}
            {current === 'mcp' ? <McpSettings /> : null}
            {current === 'plugins' ? <PluginSettings /> : null}
            {current === 'stats' ? <StatsSettings /> : null}
          </div>
        )}
      </div>
    </div>
  )
}

function ProfileSettings() {
  const { t } = useTranslation()
  const profile = useProfile()
  const fileRef = useRef<HTMLInputElement>(null)
  const [about, setAbout] = useState(profile.about)
  const [name, setName] = useState(profile.name)

  useEffect(() => {
    setAbout(profile.about)
  }, [profile.about])

  useEffect(() => {
    setName(profile.name)
  }, [profile.name])

  // 输入期间只更新本地值，失焦或回车时再落库，避免 IPC 响应乱序回退字符。
  function commitName() {
    const trimmed = name.trim()
    if (!trimmed) {
      setName(profile.name)
      return
    }
    if (trimmed !== profile.name) {
      setName(trimmed)
      saveProfile({ name: trimmed })
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('settings.profileTitle')}</h1>
      <p className="settings-sub">
        {t('ui.每次运行都会提供给为你工作的智能体，用来调整语气与协作方式。')}
      </p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.头像')}</div>
              <div className="settings-row-desc">{t('ui.点击上传头像')}</div>
            </div>
            <div className="settings-row-control">
              <button
                className="profile-avatar"
                title={t('ui.点击上传头像')}
                onClick={() => fileRef.current?.click()}
              >
                {profile.avatar ? (
                  <AvatarImage className="profile-avatar-img" src={profile.avatar} name={profile.name} />
                ) : (
                  t('ui.你')
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    const avatar = await cropSquareDataUrl(file, 160)
                    saveProfile({ avatar })
                  }
                  event.target.value = ''
                }}
              />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.姓名')}</div>
              <div className="settings-row-desc">{t('ui.显示在会话与通知中。')}</div>
            </div>
            <div className="settings-row-control">
              <input
                className="input"
                style={{ width: 280 }}
                maxLength={80}
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') event.currentTarget.blur()
                }}
              />
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'flex-start' }}>
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.关于你')}</div>
              <div className="settings-row-desc">{t('ui.每次运行都会提供给为你工作的智能体。')}</div>
            </div>
            <div className="settings-row-control">
              <div>
                <textarea
                  className="textarea"
                  style={{ width: 340, minHeight: 82 }}
                  value={about}
                  maxLength={2000}
                  onChange={(event) => {
                    setAbout(event.target.value)
                    saveProfile({ about: event.target.value })
                  }}
                  placeholder={t('ui.例如：后端工程师，喜欢简洁的 PR，改动需要同时附上测试。')}
                />
                <div className="field-help" style={{ textAlign: 'right' }}>
                  {about.length}/2000
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function AppearanceSettings() {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const theme = settings?.theme ?? 'light'
  const fontSize = settings?.fontSize ?? 'standard'
  const density = settings?.density ?? 'comfortable'
  const reducedMotion = settings?.reducedMotion ?? 'system'

  return (
    <>
      <h1 className="settings-title">{t('settings.appearanceTitle')}</h1>
      <p className="settings-sub">{t('ui.立即生效，并保存在本机。')}</p>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.主题')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.外观')}</div>
              <div className="settings-row-desc">{t('ui.浅色、深色或跟随系统。')}</div>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    ['light', '浅色'],
                    ['dark', '深色'],
                    ['system', '跟随系统'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={theme === value ? 'active' : ''}
                    onClick={() => void updateSettings({ theme: value })}
                  >
                    {t(`ui.${label}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.字号')}</div>
              <div className="settings-row-desc">{t('ui.影响正文与消息流。')}</div>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    ['compact', '紧凑'],
                    ['standard', '标准'],
                    ['comfortable', '宽松'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={fontSize === value ? 'active' : ''}
                    onClick={() => void updateSettings({ fontSize: value })}
                  >
                    {t(`ui.${label}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.密度')}</div>
              <div className="settings-row-desc">{t('ui.调整列表与设置行的间距。')}</div>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    ['comfortable', '舒适'],
                    ['compact', '紧凑'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={density === value ? 'active' : ''}
                    onClick={() => void updateSettings({ density: value })}
                  >
                    {t(`ui.${label}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.减少动效')}</div>
              <div className="settings-row-desc">
                {t('ui.关闭非必要动画；跟随系统时读取系统偏好。流式文本仍会更新。')}
              </div>
            </div>
            <div className="settings-row-control">
              <div className="segmented">
                {(
                  [
                    ['system', '跟随系统'],
                    ['reduce', '减少'],
                    ['full', '完整'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={reducedMotion === value ? 'active' : ''}
                    onClick={() => void updateSettings({ reducedMotion: value })}
                  >
                    {t(`ui.${label}`)}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.语言')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.界面语言')}</div>
              <div className="settings-row-desc">{t('ui.切换后无需重启。')}</div>
            </div>
            <div className="settings-row-control">
              <select
                className="select"
                style={{ width: 160 }}
                value={settings?.language ?? 'zh-CN'}
                onChange={(event) =>
                  void updateSettings({ language: event.target.value as 'zh-CN' | 'en' })
                }
              >
                <option value="zh-CN">{t('ui.简体中文')}</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>
        </div>
      </div>
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.通知')}</div>
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.应用内通知')}</div>
              <div className="settings-row-desc">{t('ui.智能体精确提及你时记录并标记会话。')}</div>
            </div>
            <div className="settings-row-control">
              <button
                className={`switch ${settings?.notifications.enabled ? 'on' : ''}`}
                onClick={() =>
                  void updateSettings({
                    notifications: { enabled: !settings?.notifications.enabled },
                  })
                }
                aria-label={t('ui.应用内通知')}
              />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.系统通知')}</div>
              <div className="settings-row-desc">{t('ui.权限不可用时自动降级为应用内通知。')}</div>
            </div>
            <div className="settings-row-control">
              <button
                className={`switch ${settings?.notifications.system ? 'on' : ''}`}
                onClick={() =>
                  void updateSettings({
                    notifications: { system: !settings?.notifications.system },
                  })
                }
                aria-label={t('ui.系统通知')}
              />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.免打扰')}</div>
              <div className="settings-row-desc">{t('ui.只抑制系统通知，不抑制应用内标记。')}</div>
            </div>
            <div className="settings-row-control">
              <button
                className={`switch ${settings?.notifications.doNotDisturb ? 'on' : ''}`}
                onClick={() =>
                  void updateSettings({
                    notifications: {
                      doNotDisturb: !settings?.notifications.doNotDisturb,
                    },
                  })
                }
                aria-label={t('ui.免打扰')}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function MemorySettings() {
  const { t } = useTranslation()
  return (
    <>
      <h1 className="settings-title">{t('settings.memoryTitle')}</h1>
      <p className="settings-sub">{t('ui.Pizza 在会话中可引用的长期事实与偏好。')}</p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.还没有记忆')}</div>
              <div className="settings-row-desc">
                {t('ui.记忆会按工作区保存，并在后续版本中支持编辑与导出。')}
              </div>
            </div>
            <span className="badge">P1</span>
          </div>
        </div>
      </div>
      <button className="btn" disabled>
        <Icon name="download" size={14} /> {t('ui.导出全部记忆')}
      </button>
    </>
  )
}

function ArchivedSettings() {
  const { t } = useTranslation()
  const archived = useAppStore((state) => state.archivedSessions)
  const loadArchived = useAppStore((state) => state.loadArchived)
  const restoreSession = useAppStore((state) => state.restoreSession)
  const deleteSession = useAppStore((state) => state.deleteSession)
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)
  const [clearAll, setClearAll] = useState(false)

  useEffect(() => {
    void loadArchived()
  }, [loadArchived])

  return (
    <>
      <h1 className="settings-title">{t('settings.archivedTitle')}</h1>
      <p className="settings-sub">{t('ui.归档会话只读；可恢复或永久删除。')}</p>
      {archived.length ? (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button className="btn btn-sm btn-danger" onClick={() => setClearAll(true)}>
            <Icon name="trash" size={13} /> {t('ui.清理全部')}
          </button>
        </div>
      ) : null}
      <div className="settings-section">
        <div className="settings-card">
          {archived.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-title">{t('ui.还没有归档会话')}</div>
                <div className="settings-row-desc">{t('ui.从会话菜单归档后，会出现在这里。')}</div>
              </div>
            </div>
          ) : (
            archived.map((session) => (
              <div className="settings-row" key={session.id}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{session.title}</div>
                  <div className="settings-row-desc">
                    {session.agentName ?? (session.mode === 'team' ? t('ui.团队') : t('ui.智能体'))} ·{' '}
                    {formatDateTime(session.updatedAt, i18n.language)}
                  </div>
                </div>
                <div className="settings-row-control">
                  <button
                    className="btn btn-sm"
                    onClick={() => void restoreSession(session.id)}
                  >
                    {t('ui.恢复')}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setDeleteTarget(session)}
                  >
                    {t('ui.永久删除')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {deleteTarget ? (
        <Modal
          title={t('ui.永久删除归档会话')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  await deleteSession(deleteTarget.id)
                  setDeleteTarget(null)
                  await loadArchived()
                }}
              >
                {t('ui.永久删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.删除「{{title}}」后，消息与运行记录无法恢复。', { title: deleteTarget.title })}
          </p>
        </Modal>
      ) : null}

      {clearAll ? (
        <Modal
          title={t('ui.清理全部归档会话')}
          onClose={() => setClearAll(false)}
          footer={
            <>
              <button className="btn" onClick={() => setClearAll(false)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  for (const session of archived) {
                    await window.pizza.session.delete(session.id)
                  }
                  setClearAll(false)
                  await loadArchived()
                }}
              >
                {t('ui.全部永久删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.将永久删除 {{count}} 个归档会话及其消息，操作不可撤销。', { count: archived.length })}
          </p>
        </Modal>
      ) : null}
    </>
  )
}

function SystemSettings() {
  const { t } = useTranslation()
  const settings = useAppStore((state) => state.settings)
  const runtimes = useAppStore((state) => state.runtimes)
  const appInfo = useAppStore((state) => state.appInfo)
  const dataDirStatus = useAppStore((state) => state.dataDirStatus)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const refreshDataDir = useAppStore((state) => state.refreshDataDir)

  async function chooseDefaultWorkspace() {
    const workspace = await window.pizza.workspace.pick()
    if (workspace) {
      await updateSettings({ defaultWorkspacePath: workspace.rootPath })
    }
  }

  async function chooseDataDir() {
    const path = await window.pizza.dialog.pickDirectory()
    if (!path) return
    try {
      await window.pizza.settings.setDataDir(path)
      await refreshDataDir()
    } catch (error) {
      useAppStore
        .getState()
        .setError(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('settings.systemTitle')}</h1>
      <p className="settings-sub">{t('ui.影响本机运行与数据存储。')}</p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.默认工作区')}</div>
              <div className="settings-row-desc">
                {settings?.defaultWorkspacePath ?? '~/Pizza'}
              </div>
            </div>
            <div className="settings-row-control">
              <button className="btn btn-sm" onClick={() => void chooseDefaultWorkspace()}>
                {t('ui.选择…')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.默认运行时')}</div>
              <div className="settings-row-desc">{t('ui.新建智能体时预选。')}</div>
            </div>
            <div className="settings-row-control">
              <select
                className="select"
                style={{ width: 170 }}
                value={settings?.defaultRuntimeId ?? ''}
                onChange={(event) =>
                  void updateSettings({ defaultRuntimeId: event.target.value || null })
                }
              >
                <option value="">{t('ui.未选择')}</option>
                {runtimes.map((runtime: RuntimeConfig) => (
                  <option value={runtime.id} key={runtime.id}>
                    {runtime.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.最大并发运行')}</div>
              <div className="settings-row-desc">{t('ui.全局上限；单个智能体还有自己的并发限制。')}</div>
            </div>
            <div className="settings-row-control">
              <input
                className="input"
                style={{ width: 70 }}
                type="number"
                min={1}
                max={10}
                value={settings?.maxConcurrency ?? 3}
                onChange={(event) =>
                  void updateSettings({
                    maxConcurrency: Math.min(
                      10,
                      Math.max(1, Number(event.target.value) || 1),
                    ),
                  })
                }
              />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.日志级别')}</div>
              <div className="settings-row-desc">{t('ui.仅影响本机诊断日志。')}</div>
            </div>
            <div className="settings-row-control">
              <select
                className="select"
                style={{ width: 130 }}
                value={settings?.logLevel ?? 'info'}
                onChange={(event) =>
                  void updateSettings({
                    logLevel: event.target.value as 'error' | 'warn' | 'info' | 'debug',
                  })
                }
              >
                <option value="error">{t('ui.错误')}</option>
                <option value="warn">{t('ui.警告')}</option>
                <option value="info">{t('ui.信息')}</option>
                <option value="debug">{t('ui.调试')}</option>
              </select>
            </div>
          </div>
          <div className="settings-row" style={{ alignItems: 'flex-start' }}>
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.数据目录')}</div>
              <div className="settings-row-desc mono">
                {dataDirStatus?.current ?? appInfo?.dataDir ?? '~/.pizza'}
              </div>
              {dataDirStatus?.pending ? (
                <div className="settings-row-desc">
                  {t('ui.下次启动切换到：{{path}}', { path: dataDirStatus.pending })}
                </div>
              ) : null}
              {dataDirStatus?.error ? (
                <div className="inline-error compact" role="alert">
                  {localizeError(dataDirStatus.error)}
                </div>
              ) : null}
            </div>
            <div className="settings-row-control">
              {dataDirStatus?.pending ? (
                <button
                  className="btn btn-sm btn-primary"
                  onClick={() => void window.pizza.settings.restart()}
                >
                  {t('ui.立即重启')}
                </button>
              ) : null}
              <button className="btn btn-sm" onClick={() => void chooseDataDir()}>
                {t('ui.更改…')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.匿名统计')}</div>
              <div className="settings-row-desc">{t('ui.默认关闭。Pizza 不收集会话内容。')}</div>
            </div>
            <div className="settings-row-control">
              <button
                className={`switch ${settings?.anonymousStats ? 'on' : ''}`}
                onClick={() =>
                  void updateSettings({ anonymousStats: !settings?.anonymousStats })
                }
                aria-label={t('ui.匿名统计')}
              />
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.自动更新')}</div>
              <div className="settings-row-desc">
                {t('ui.P0 只记录偏好；自动更新在后续变更接入。')}
              </div>
            </div>
            <div className="settings-row-control">
              <button
                className={`switch ${settings?.autoUpdate ? 'on' : ''}`}
                onClick={() => void updateSettings({ autoUpdate: !settings?.autoUpdate })}
                aria-label={t('ui.自动更新')}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function AboutSettings() {
  const { t } = useTranslation()
  const appInfo = useAppStore((state) => state.appInfo)
  return (
    <>
      <h1 className="settings-title">{t('settings.aboutTitle')}</h1>
      <p className="settings-sub">{t('ui.把问题切开，@ 给合适的智能体，再拼回完整答案。')}</p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.版本')}</div>
              <div className="settings-row-desc">
                {appInfo?.version ?? '1.0.0'} · {t('ui.构建')} {appInfo?.build ?? 'dev'} ·{' '}
                {appInfo?.platform ?? t('ui.本机')}
              </div>
            </div>
            <div className="settings-row-control">
              <button className="btn btn-sm" disabled>
                {t('ui.检查更新（后续版本）')}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.开源协议')}</div>
              <div className="settings-row-desc">
                {t('ui.发布包随附 LICENSE；第三方依赖与归属见 THIRD-PARTY.md。')}
              </div>
            </div>
            <div className="settings-row-control">
              <span className="badge">{t('ui.随包提供')}</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.反馈与文档')}</div>
              <div className="settings-row-desc">
                {t('ui.使用手册与问题反馈入口随发布渠道提供。')}
              </div>
            </div>
            <div className="settings-row-control">
              <span className="badge">{t('ui.发布渠道')}</span>
            </div>
          </div>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.数据目录')}</div>
              <div className="settings-row-desc mono">{appInfo?.dataDir ?? '~/.pizza'}</div>
            </div>
            <span className="badge">{t('ui.仅本机')}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function ResetSettings() {
  const { t } = useTranslation()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      await window.pizza.app.reset()
    } catch (caught) {
      setBusy(false)
      setError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('settings.nav.reset')}</h1>
      <p className="settings-sub">
        {t('ui.清理所有本地数据并恢复首次启动状态。此操作不可撤销。')}
      </p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.重置 Pizza')}</div>
              <div className="settings-row-desc">
                {t(
                  'ui.删除会话、智能体、团队、运行时、Skill、MCP、设置与附件记录；工作区中的磁盘文件不会被删除。',
                )}
              </div>
            </div>
            <div className="settings-row-control">
              <button className="btn btn-danger" onClick={() => setConfirmOpen(true)}>
                {t('ui.清理所有数据并重置')}
              </button>
            </div>
          </div>
          {error ? (
            <div className="inline-error" role="alert">
              {localizeError(error)}
            </div>
          ) : null}
        </div>
      </div>

      {confirmOpen ? (
        <Modal
          title={t('ui.初始化 Pizza')}
          onClose={() => (busy ? undefined : setConfirmOpen(false))}
          footer={
            <>
              <button
                className="btn"
                disabled={busy}
                onClick={() => setConfirmOpen(false)}
              >
                {t('ui.取消')}
              </button>
              <button className="btn btn-danger" disabled={busy} onClick={() => void reset()}>
                {busy ? t('ui.正在清理…') : t('ui.清理并重启')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t(
              'ui.将永久删除本机的全部 Pizza 数据，并重启应用。工作区中的文件不会被删除。此操作不可撤销。',
            )}
          </p>
        </Modal>
      ) : null}
    </>
  )
}

function ComingSoonSettings({
  title,
  sub,
  description,
}: {
  title: string
  sub: string
  description: string
}) {
  const { t } = useTranslation()
  return (
    <>
      <h1 className="settings-title">{title}</h1>
      <p className="settings-sub">{sub}</p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.即将开放')}</div>
              <div className="settings-row-desc">{description}</div>
            </div>
            <span className="badge">{t('ui.规划中')}</span>
          </div>
        </div>
      </div>
    </>
  )
}

function PluginSettings() {
  const { t } = useTranslation()
  return (
    <>
      <h1 className="settings-title">{t('settings.pluginsTitle')}</h1>
      <p className="settings-sub">{t('ui.扩展 Pizza 能力的统一入口。')}</p>
      <div className="settings-section">
        <div className="settings-card">
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">{t('ui.插件将在 P1 阶段迭代')}</div>
              <div className="settings-row-desc">
                {t('ui.当前版本先提供 Skills、MCP 与运行时的资源接入。')}
              </div>
            </div>
            <div className="settings-row-control">
              <span className="badge">P1</span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

function StatsSettings() {
  const { t } = useTranslation()
  const [range, setRange] = useState<'today' | '7d' | '30d'>('7d')
  return (
    <>
      <h1 className="settings-title">{t('ui.统计')}</h1>
      <p className="settings-sub">
        {t('ui.按智能体与会话查看 token 使用与运行情况。P1 功能。')}
      </p>
      <div className="toolbar">
        {(
          [
            ['today', '今天'],
            ['7d', '近 7 天'],
            ['30d', '近 30 天'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            className={`filter-chip ${range === value ? 'active' : ''}`}
            onClick={() => setRange(value)}
          >
            {t(`ui.${label}`)}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        <span className="badge">{t('ui.按本机数据统计')}</span>
      </div>
      <div className="settings-section">
        <div className="settings-card" style={{ padding: 16 }}>
          <div style={{ display: 'flex', gap: 22, marginBottom: 16 }}>
            <div>
              <div className="settings-row-desc">Token</div>
              <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>—</div>
            </div>
            <div>
              <div className="settings-row-desc">{t('ui.运行次数')}</div>
              <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>—</div>
            </div>
            <div>
              <div className="settings-row-desc">{t('ui.成功率')}</div>
              <div style={{ fontSize: 24, fontFamily: 'var(--font-display)' }}>—</div>
            </div>
          </div>
          <div className="stats-chart">
            {[0, 0, 0, 0, 0].map((height, index) => (
              <div className="stats-bar-col" key={index}>
                <div className="stats-bar" style={{ height }} />
                <span>—</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
