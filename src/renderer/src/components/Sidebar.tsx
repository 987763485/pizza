import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { SessionSummary, Workspace } from '@shared/types'
import { useAppStore } from '../store'
import { togglePinnedWorkspace, usePinnedWorkspaces } from '../pinned'
import { useProfile } from '../profile'
import { workspaceLabel } from '../workspace-label'
import { Avatar } from './Avatar'
import { AvatarImage } from './AvatarImage'
import { Brand } from './Brand'
import { Icon } from './Icon'
import { Modal } from './Modal'

interface SidebarProps {
  collapsed: boolean
  onOpenSettings: (page: string) => void
}

export function Sidebar({ collapsed, onOpenSettings }: SidebarProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const workspaces = useAppStore((state) => state.workspaces)
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId)
  const sessionsByWorkspace = useAppStore((state) => state.sessionsByWorkspace)
  const activeSessionId = useAppStore((state) => state.activeSession?.id)
  // 只有路由仍停留在该会话时才显示选中态；回到首页即清除。
  const openSessionId = location.pathname.match(/^\/session\/([^/]+)/)?.[1] ?? null
  const selectWorkspace = useAppStore((state) => state.selectWorkspace)
  const renameSession = useAppStore((state) => state.renameSession)
  const forkSession = useAppStore((state) => state.forkSession)
  const archiveSession = useAppStore((state) => state.archiveSession)
  const deleteSession = useAppStore((state) => state.deleteSession)
  const deleteWorkspace = useAppStore((state) => state.deleteWorkspace)
  const pinned = usePinnedWorkspaces()
  const profile = useProfile()
  const settings = useAppStore((state) => state.settings)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const setNotice = useAppStore((state) => state.setNotice)

  const [sessionMenu, setSessionMenu] = useState<{
    session: SessionSummary
    x: number
    y: number
  } | null>(null)
  const [workspaceMenu, setWorkspaceMenu] = useState<{
    workspace: Workspace
    x: number
    y: number
  } | null>(null)
  const [renameTarget, setRenameTarget] = useState<SessionSummary | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<SessionSummary | null>(null)
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<Workspace | null>(null)
  const [accountMenu, setAccountMenu] = useState<{
    left: number
    bottom: number
    maxHeight: number
  } | null>(null)
  const [helpMenu, setHelpMenu] = useState<{ left: number; bottom: number } | null>(null)
  const [accountSubmenu, setAccountSubmenu] = useState<'theme' | 'language' | null>(null)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [collapsedWorkspaces, setCollapsedWorkspaces] = useState<Set<string>>(
    () => new Set(),
  )

  useEffect(() => {
    if (!sessionMenu && !workspaceMenu && !accountMenu && !helpMenu) return
    const close = () => {
      setSessionMenu(null)
      setWorkspaceMenu(null)
      setAccountMenu(null)
      setAccountSubmenu(null)
      setHelpMenu(null)
    }
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [accountMenu, helpMenu, sessionMenu, workspaceMenu])

  const pinnedWorkspaces = useMemo(
    () => workspaces.filter((workspace) => pinned.includes(workspace.id)),
    [pinned, workspaces],
  )
  const normalWorkspaces = useMemo(
    () => workspaces.filter((workspace) => !pinned.includes(workspace.id)),
    [pinned, workspaces],
  )

  function openWorkspace(workspace: Workspace) {
    void selectWorkspace(workspace.id)
    navigate('/')
  }

  function toggleWorkspace(workspaceId: string) {
    setCollapsedWorkspaces((current) => {
      const next = new Set(current)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      return next
    })
  }

  function openSessionMenu(session: SessionSummary, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setWorkspaceMenu(null)
    setSessionMenu({ session, x: event.clientX, y: event.clientY })
  }

  function openWorkspaceMenu(workspace: Workspace, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    setSessionMenu(null)
    setWorkspaceMenu({ workspace, x: event.clientX, y: event.clientY })
  }

  function openHelpMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setSessionMenu(null)
    setWorkspaceMenu(null)
    setAccountMenu(null)
    setAccountSubmenu(null)
    setHelpMenu({
      left: Math.max(12, Math.min(rect.left - 4, window.innerWidth - 270)),
      bottom: Math.min(window.innerHeight - 12, window.innerHeight - rect.top + 8),
    })
  }

  function openAccountMenu(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setSessionMenu(null)
    setWorkspaceMenu(null)
    setHelpMenu(null)
    setAccountSubmenu(null)
    setAccountMenu({
      left: Math.max(12, Math.min(rect.left - 4, window.innerWidth - 312)),
      bottom: Math.min(window.innerHeight - 12, window.innerHeight - rect.top + 8),
      maxHeight: Math.max(260, rect.top - 16),
    })
  }

  const themeLabel = t(
    `ui.${settings?.theme === 'dark' ? '深色' : settings?.theme === 'system' ? '跟随系统' : '浅色'}`,
  )
  const languageLabel = settings?.language === 'en' ? 'English' : t('ui.简体中文')
  const shortcuts: Array<[string, string]> = [
    [t('ui.新建对话'), '⌘N'],
    [t('ui.搜索会话'), '⌘K'],
    [t('ui.设置'), '⌘,'],
    [t('ui.发送'), 'Enter'],
    [t('ui.换行'), 'Shift + Enter'],
    [t('ui.提及选择器'), '@'],
  ]

  const workspaceBlock = (workspace: Workspace) => {
    const collapsed = collapsedWorkspaces.has(workspace.id)
    const workspaceSessions = sessionsByWorkspace[workspace.id] ?? []
    return (
      <div key={workspace.id}>
        <div
          className="ws-item"
          data-workspace={workspace.id}
          role="button"
          tabIndex={0}
          aria-expanded={!collapsed}
          onClick={() => toggleWorkspace(workspace.id)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              toggleWorkspace(workspace.id)
            }
          }}
        >
          <span className="ws-icon">
            <Icon name="folder" size={14} />
          </span>
          <span className="ws-name">{workspaceLabel(workspace, t)}</span>
          <button
            className="ws-more"
            onClick={(event) => openWorkspaceMenu(workspace, event)}
            aria-label={t('ui.工作区菜单')}
          >
            <Icon name="more" size={13} />
          </button>
          <button
            className="ws-add"
            onClick={(event) => {
              event.stopPropagation()
              openWorkspace(workspace)
            }}
            title={t('ui.在 {{name}} 中新建任务', { name: workspaceLabel(workspace, t) })}
            aria-label={t('ui.在 {{name}} 中新建任务', { name: workspaceLabel(workspace, t) })}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        {!collapsed && workspaceSessions.length ? (
          workspaceSessions.map((session) => {
            const dotClass =
              session.status === 'running'
                ? 'running'
                : session.status === 'waiting_user'
                  ? 'waiting'
                  : session.status === 'error'
                    ? 'error'
                    : 'done'
            // 状态点不能只靠颜色传达：为读屏和 hover 提供文字说明。
            const statusText =
              session.status === 'running'
                ? t('ui.运行中')
                : session.status === 'waiting_user'
                  ? t('ui.等待你回复')
                  : session.status === 'error'
                    ? t('ui.运行失败')
                    : session.unread
                      ? t('ui.未读')
                      : t('ui.已完成')
            return (
              <div
                className={`ws-session ${session.id === openSessionId ? 'active' : ''}`}
                key={session.id}
                data-session={session.id}
                role="button"
                tabIndex={0}
                onClick={() => navigate(`/session/${session.id}`)}
                onContextMenu={(event) => openSessionMenu(session, event)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    navigate(`/session/${session.id}`)
                  }
                }}
              >
                <span className="ws-session-icon">
                  <Icon name={session.mode === 'team' ? 'users' : 'chat'} size={12} />
                </span>
                <span className="ws-preview-title">{session.title}</span>
                <button
                  className="ws-session-more"
                  onClick={(event) => openSessionMenu(session, event)}
                  aria-label={t('ui.会话菜单')}
                >
                  <Icon name="more" size={12} />
                </button>
                <span
                  className={`ws-session-dot ${dotClass}`}
                  title={statusText}
                  aria-label={statusText}
                />
              </div>
            )
          })
        ) : collapsed ? null : (
          <div className="ws-empty">{t('ui.暂无任务')} :)</div>
        )}
      </div>
    )
  }

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand-row">
        <button
          className="brand brand-button"
          onClick={() => navigate('/')}
          aria-label={t('ui.Pizza 首页')}
        >
          <Brand />
        </button>
      </div>

      <button className="new-chat-btn" onClick={() => navigate('/')}>
        <span className="new-chat-icon">
          <Icon name="plus" size={16} />
        </span>
        <span>{t('nav.newChat')}</span>
        <kbd>⌘N</kbd>
      </button>

      <div className="workspace-section">
        {pinnedWorkspaces.length ? (
          <>
            <div className="side-label ws-label">
              <span>{t('ui.置顶')}</span>
            </div>
            {pinnedWorkspaces.map(workspaceBlock)}
          </>
        ) : null}
        <div className="side-label ws-label">
          <span>{t('ui.工作区')}</span>
          <button
            className="icon-btn"
            onClick={() => void useAppStore.getState().pickWorkspace()}
            title={t('ui.添加工作区')}
            aria-label={t('ui.添加工作区')}
          >
            <Icon name="plus" size={12} />
          </button>
        </div>
        {normalWorkspaces.map(workspaceBlock)}
      </div>

      <div className="sidebar-footer">
        <button className="footer-btn" onClick={() => onOpenSettings('profile')}>
          <Icon name="settings" size={15} />
          <span>{t('nav.settings')}</span>
          <span className="kbd-hint">⌘,</span>
        </button>
        <button
          className="footer-btn"
          onClick={openHelpMenu}
          aria-haspopup="menu"
          aria-expanded={!!helpMenu}
        >
          <Icon name="help" size={15} />
          <span>{t('ui.帮助')}</span>
        </button>
        <div className="sidebar-account">
          <button className="sidebar-account-btn" onClick={openAccountMenu} aria-haspopup="menu" aria-expanded={!!accountMenu}>
            <span className="account-avatar">
              {profile.avatar ? (
                <AvatarImage className="profile-avatar-img" src={profile.avatar} name={profile.name} />
              ) : (
                t('ui.你')
              )}
            </span>
            <span className="account-text">
              <span className="account-name">{profile.name}</span>
              <span className="account-sub">{t('ui.本地工作区')}</span>
            </span>
            <Icon name="chevron-right" size={12} />
          </button>
        </div>
      </div>

      {sessionMenu ? (
        <div
          className="session-menu"
          style={{ left: sessionMenu.x, top: sessionMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="menu-item"
            onClick={() => {
              setSessionMenu(null)
              setRenameTarget(sessionMenu.session)
              setRenameValue(sessionMenu.session.title)
            }}
          >
            <Icon name="edit" size={13} /> {t('ui.重命名')}
          </button>
          <button
            className="menu-item"
            onClick={async () => {
              setSessionMenu(null)
              const forked = await forkSession(sessionMenu.session.id)
              if (forked) navigate(`/session/${forked.id}`)
            }}
          >
            <Icon name="fork" size={13} /> {t('ui.分叉会话')}
          </button>
          <button
            className="menu-item"
            onClick={() => {
              setSessionMenu(null)
              void archiveSession(sessionMenu.session.id).then(() => {
                if (activeSessionId === sessionMenu.session.id) navigate('/')
              })
            }}
          >
            <Icon name="archive" size={13} /> {t('ui.归档')}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item danger"
            onClick={() => {
              setSessionMenu(null)
              setDeleteTarget(sessionMenu.session)
            }}
          >
            <Icon name="trash" size={13} /> {t('ui.永久删除')}
          </button>
        </div>
      ) : null}

      {workspaceMenu ? (
        <div
          className="session-menu"
          style={{ left: workspaceMenu.x, top: workspaceMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="menu-item"
            onClick={() => {
              togglePinnedWorkspace(workspaceMenu.workspace.id)
              setWorkspaceMenu(null)
            }}
          >
            <Icon name="pin" size={13} />{' '}
            {pinned.includes(workspaceMenu.workspace.id)
              ? t('ui.取消置顶')
              : t('ui.置顶工作区')}
          </button>
          {!workspaceMenu.workspace.isDefault ? (
            <>
              <div className="menu-sep" />
              <button
                className="menu-item danger"
                onClick={() => {
                  const target = workspaceMenu.workspace
                  setWorkspaceMenu(null)
                  setWorkspaceDeleteTarget(target)
                }}
              >
                <Icon name="trash" size={13} /> {t('ui.删除工作区')}
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {helpMenu ? (
        <>
          <div
            className="popover-layer"
            onClick={() => setHelpMenu(null)}
            aria-hidden="true"
          />
          <div
            className="account-menu help-menu"
            style={{ left: helpMenu.left, bottom: helpMenu.bottom, width: 258 }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="account-item"
              onClick={() => {
                setHelpMenu(null)
                setNotice(t('ui.文档入口随发布渠道提供'))
              }}
            >
              <Icon name="book" size={15} /> {t('ui.文档')}
              <span className="account-right">
                <Icon name="external" size={11} />
              </span>
            </button>
            <button
              className="account-item"
              onClick={() => {
                setHelpMenu(null)
                setNotice(t('ui.更新日志随发布渠道提供'))
              }}
            >
              <Icon name="clock" size={15} /> {t('ui.更新日志')}
              <span className="account-right">
                <Icon name="external" size={11} />
              </span>
            </button>
            <button
              className="account-item"
              onClick={() => {
                setHelpMenu(null)
                setNotice(t('ui.Discord 入口随发布渠道提供'))
              }}
            >
              <Icon name="chat" size={15} /> Discord
              <span className="account-right">
                <Icon name="external" size={11} />
              </span>
            </button>
            <div className="account-sep" />
            <button
              className="account-item"
              onClick={() => {
                setHelpMenu(null)
                setNotice(t('ui.反馈入口随发布渠道提供'))
              }}
            >
              <Icon name="chat" size={15} /> {t('ui.反馈')}
            </button>
          </div>
        </>
      ) : null}

      {accountMenu ? (
        <>
          <div
            className="popover-layer"
            onClick={() => {
              setAccountMenu(null)
              setAccountSubmenu(null)
            }}
            aria-hidden="true"
          />
          <div
            className="account-menu"
            style={{
              left: accountMenu.left,
              bottom: accountMenu.bottom,
              width: 300,
              maxHeight: accountMenu.maxHeight,
              overflowY: 'auto',
            }}
            role="menu"
            onClick={(event) => event.stopPropagation()}
          >
            {accountSubmenu === 'theme' ? (
              <>
                <div className="account-sub-title">{t('ui.主题')}</div>
                {(
                  [
                    ['light', '浅色', 'sun'],
                    ['dark', '深色', 'moon'],
                    ['system', '跟随系统', 'monitor'],
                  ] as const
                ).map(([choice, label, icon]) => (
                  <button
                    key={choice}
                    className="account-item"
                    onClick={() => {
                      void updateSettings({ theme: choice })
                      setAccountMenu(null)
                      setAccountSubmenu(null)
                    }}
                  >
                    <Icon name={icon} size={15} /> {t(`ui.${label}`)}
                    {settings?.theme === choice ? (
                      <span className="account-check">
                        <Icon name="check" size={14} />
                      </span>
                    ) : null}
                  </button>
                ))}
                <div className="account-sep" />
                <button
                  className="account-item"
                  onClick={() => setAccountSubmenu(null)}
                >
                  <Icon name="arrow-left" size={15} /> {t('ui.返回')}
                </button>
              </>
            ) : accountSubmenu === 'language' ? (
              <>
                <div className="account-sub-title">{t('ui.语言')}</div>
                {(
                  [
                    ['zh-CN', '简体中文'],
                    ['en', 'English'],
                  ] as const
                ).map(([choice, label]) => (
                  <button
                    key={choice}
                    className="account-item"
                    onClick={() => {
                      void updateSettings({ language: choice })
                      setAccountMenu(null)
                      setAccountSubmenu(null)
                    }}
                  >
                    <Icon name="globe" size={15} /> {t(`ui.${label}`)}
                    {settings?.language === choice ? (
                      <span className="account-check">
                        <Icon name="check" size={14} />
                      </span>
                    ) : null}
                  </button>
                ))}
                <div className="account-sep" />
                <button
                  className="account-item"
                  onClick={() => setAccountSubmenu(null)}
                >
                  <Icon name="arrow-left" size={15} /> {t('ui.返回')}
                </button>
              </>
            ) : (
              <>
                <div className="account-head">
                  <span className="account-head-avatar">
                    {profile.avatar ? (
                      <AvatarImage
                        className="profile-avatar-img"
                        src={profile.avatar}
                        name={profile.name}
                      />
                    ) : (
                      t('ui.你')
                    )}
                  </span>
                  <div>
                    <div className="account-head-name">{profile.name}</div>
                    <div className="account-head-mail">you@pizza.local</div>
                  </div>
                </div>
                <div className="account-sep" />
                <button
                  className="account-item"
                  onClick={() => {
                    setAccountMenu(null)
                    onOpenSettings('profile')
                  }}
                >
                  <Icon name="user" size={15} /> {t('ui.个人资料')}
                </button>
                <button
                  className="account-item"
                  onClick={() => setAccountSubmenu('theme')}
                >
                  <Icon name="sun" size={15} /> {t('ui.主题')}
                  <span className="account-right">
                    {themeLabel} <Icon name="chevron-right" size={12} />
                  </span>
                </button>
                <button
                  className="account-item"
                  onClick={() => setAccountSubmenu('language')}
                >
                  <Icon name="globe" size={15} /> {t('ui.语言')}
                  <span className="account-right">
                    {languageLabel} <Icon name="chevron-right" size={12} />
                  </span>
                </button>
                <button
                  className="account-item"
                  onClick={() => {
                    setAccountMenu(null)
                    setShortcutsOpen(true)
                  }}
                >
                  <Icon name="command" size={15} /> {t('ui.快捷键')}
                </button>
                <div className="account-sep" />
                <button
                  className="account-item"
                  onClick={() => {
                    setAccountMenu(null)
                    setNotice(t('ui.文档入口随发布渠道提供'))
                  }}
                >
                  <Icon name="book" size={15} /> {t('ui.文档')}
                  <span className="account-right">
                    <Icon name="external" size={11} />
                  </span>
                </button>
                <button
                  className="account-item"
                  onClick={() => {
                    setAccountMenu(null)
                    setNotice(t('ui.更新日志随发布渠道提供'))
                  }}
                >
                  <Icon name="clock" size={15} /> {t('ui.更新日志')}
                  <span className="account-right">
                    <Icon name="external" size={11} />
                  </span>
                </button>
                <button
                  className="account-item"
                  onClick={() => {
                    setAccountMenu(null)
                    setNotice(t('ui.Discord 入口随发布渠道提供'))
                  }}
                >
                  <Icon name="chat" size={15} /> Discord
                  <span className="account-right">
                    <Icon name="external" size={11} />
                  </span>
                </button>
                <div className="account-sep" />
                <button
                  className="account-item danger"
                  onClick={() => {
                    setAccountMenu(null)
                    setNotice(t('ui.本地模式无需登录'))
                  }}
                >
                  <Icon name="log-out" size={15} /> {t('ui.退出登录')}
                </button>
              </>
            )}
          </div>
        </>
      ) : null}

      {shortcutsOpen ? (
        <Modal
          title={t('ui.快捷键')}
          width={520}
          onClose={() => setShortcutsOpen(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setShortcutsOpen(false)}>
              {t('ui.完成')}
            </button>
          }
        >
          <div className="settings-card" style={{ padding: '2px 14px' }}>
            {shortcuts.map(([label, key]) => (
              <div className="settings-row" key={key}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{label}</div>
                </div>
                <div className="settings-row-control">
                  <kbd
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 10,
                      padding: '3px 6px',
                      border: '1px solid var(--line)',
                      borderRadius: 5,
                      background: 'var(--surface-2)',
                    }}
                  >
                    {key}
                  </kbd>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {workspaceDeleteTarget ? (
        <Modal
          title={t('ui.删除工作区')}
          onClose={() => setWorkspaceDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setWorkspaceDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const target = workspaceDeleteTarget
                  const removedCurrent = target.id === currentWorkspaceId
                  const ok = await deleteWorkspace(target.id)
                  if (!ok) return
                  setWorkspaceDeleteTarget(null)
                  if (removedCurrent) navigate('/')
                }}
              >
                {t('ui.删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t(
              'ui.从 Pizza 移除「{{name}}」？该工作区的会话、团队、Skill/MCP 配置与产出物记录会一并删除；磁盘文件不会被删除。',
              { name: workspaceDeleteTarget.name },
            )}
          </p>
        </Modal>
      ) : null}

      {renameTarget ? (
        <Modal
          title={t('ui.重命名会话')}
          onClose={() => setRenameTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setRenameTarget(null)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-primary"
                onClick={async () => {
                  if (!renameValue.trim()) return
                  await renameSession(renameTarget.id, renameValue.trim())
                  setRenameTarget(null)
                }}
              >
                {t('ui.保存')}
              </button>
            </>
          }
        >
          <input
            className="input"
            autoFocus
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && renameValue.trim()) {
                void renameSession(renameTarget.id, renameValue.trim())
                setRenameTarget(null)
              }
            }}
          />
        </Modal>
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('ui.永久删除会话')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const deletedId = deleteTarget.id
                  await deleteSession(deletedId)
                  setDeleteTarget(null)
                  if (activeSessionId === deletedId) navigate('/')
                }}
              >
                {t('ui.永久删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.删除「{{title}}」后无法恢复。该操作只影响这个会话，不会删除工作区中的其他文件。', {
              title: deleteTarget.title,
            })}
          </p>
        </Modal>
      ) : null}
    </aside>
  )
}
