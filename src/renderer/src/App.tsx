import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { useAppStore } from './store'
import { BrandMark } from './components/Brand'
import { CommandPalette } from './components/CommandPalette'
import { Sidebar } from './components/Sidebar'
import { HomeView } from './components/HomeView'
import { ChatView } from './components/ChatView'
import { SettingsView } from './components/SettingsView'
import { Titlebar } from './components/Titlebar'
import { Icon } from './components/Icon'
import { ApprovalDialog } from './components/ApprovalDialog'
import { Onboarding } from './components/Onboarding'
import i18n from './i18n'
import { localizeError } from './locales/errors'

function SettingsRoute() {
  const params = useParams()
  return <SettingsView page={params.page} />
}

export default function App() {
  const { t } = useTranslation()
  const location = useLocation()
  const navigate = useNavigate()
  const init = useAppStore((state) => state.init)
  const bootstrapped = useAppStore((state) => state.bootstrapped)
  const bootError = useAppStore((state) => state.bootError)
  const appInfo = useAppStore((state) => state.appInfo)
  const settings = useAppStore((state) => state.settings)
  const error = useAppStore((state) => state.error)
  const notice = useAppStore((state) => state.notice)
  const setError = useAppStore((state) => state.setError)
  const updateSettings = useAppStore((state) => state.updateSettings)
  const handleRunEvent = useAppStore((state) => state.handleRunEvent)
  const handleSessionUpdated = useAppStore((state) => state.handleSessionUpdated)
  const handleArtifactChanged = useAppStore((state) => state.handleArtifactChanged)
  const handleRuntimeStatus = useAppStore((state) => state.handleRuntimeStatus)
  const handleTeamTurnEvent = useAppStore((state) => state.handleTeamTurnEvent)
  const handleApproval = useAppStore((state) => state.handleApproval)
  const handleNotification = useAppStore((state) => state.handleNotification)
  const handleSettingsChanged = useAppStore((state) => state.handleSettingsChanged)
  const [collapsed, setCollapsed] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    const api = window.pizza
    const unsubscribers = [
      api.events.onRunEvent(handleRunEvent),
      api.events.onSessionUpdated(handleSessionUpdated),
      api.events.onArtifactChanged(handleArtifactChanged),
      api.events.onRuntimeStatus(handleRuntimeStatus),
      api.events.onTeamTurn(handleTeamTurnEvent),
      api.events.onApproval(handleApproval),
      api.events.onNotification(handleNotification),
      api.events.onSettingsChanged(handleSettingsChanged),
      api.events.onNotificationOpen(({ sessionId, messageId }) => {
        if (!sessionId) return
        navigate(
          messageId
            ? `/session/${sessionId}?message=${encodeURIComponent(messageId)}`
            : `/session/${sessionId}`,
        )
      }),
    ]
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe())
  }, [
    handleApproval,
    handleArtifactChanged,
    handleNotification,
    handleRunEvent,
    handleRuntimeStatus,
    handleSettingsChanged,
    handleSessionUpdated,
    handleTeamTurnEvent,
    navigate,
  ])

  // 外观是界面全局状态：设置或系统偏好变化时立即写入根节点。
  useEffect(() => {
    const darkQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => {
      const root = document.documentElement
      const choice = settings?.theme ?? 'light'
      root.dataset.theme =
        choice === 'system' ? (darkQuery.matches ? 'dark' : 'light') : choice
      root.dataset.fontSize = settings?.fontSize ?? 'standard'
      root.dataset.density = settings?.density ?? 'comfortable'
      const reduce =
        settings?.reducedMotion === 'reduce' ||
        (settings?.reducedMotion !== 'full' && reduceQuery.matches)
      root.dataset.reducedMotion = reduce ? 'true' : 'false'
      if (settings?.language) {
        root.lang = settings.language
        if (i18n.language !== settings.language) {
          void i18n.changeLanguage(settings.language)
        }
      }
    }
    apply()
    darkQuery.addEventListener('change', apply)
    reduceQuery.addEventListener('change', apply)
    return () => {
      darkQuery.removeEventListener('change', apply)
      reduceQuery.removeEventListener('change', apply)
    }
  }, [
    settings?.theme,
    settings?.fontSize,
    settings?.density,
    settings?.reducedMotion,
    settings?.language,
  ])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setSearchOpen(true)
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'n') {
        event.preventDefault()
        navigate('/')
      }
      if ((event.metaKey || event.ctrlKey) && event.key === ',') {
        event.preventDefault()
        navigate('/settings/profile')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [navigate])

  const isSettings = location.pathname.startsWith('/settings')
  const openSettings = (page: string) => navigate(`/settings/${page}`)
  const themeChoice = settings?.theme ?? 'light'

  function toggleTheme() {
    void updateSettings({ theme: themeChoice === 'dark' ? 'light' : 'dark' })
  }

  if (!bootstrapped) {
    return (
      <div className="app">
        <Titlebar
          theme={themeChoice}
          settingsMode={false}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleTheme={toggleTheme}
        />
        <div className="app-loading">
          <span className="app-loading-mark">
            <BrandMark size={26} />
          </span>
          <span>{t('ui.正在打开工作台…')}</span>
        </div>
      </div>
    )
  }

  if (bootError) {
    return (
      <div className="app">
        <Titlebar
          theme={themeChoice}
          settingsMode={false}
          onToggleCollapsed={() => setCollapsed((value) => !value)}
          onOpenSearch={() => setSearchOpen(true)}
          onToggleTheme={toggleTheme}
        />
        <div className="boot-error">
          <span className="home-empty-mark">
            <BrandMark size={24} />
          </span>
          <h1>{t('ui.无法打开本地数据目录')}</h1>
          <p>
            {t('ui.Pizza 需要可读写的本地目录来保存会话与配置。请检查目录权限或磁盘空间后重试。')}
          </p>
          <div className="boot-error-path">{appInfo?.dataDir ?? '~/.pizza'}</div>
          <div className="boot-error-detail">{localizeError(bootError)}</div>
          <div className="boot-error-actions">
            <button className="btn btn-primary" onClick={() => window.location.reload()}>
              {t('ui.重试')}
            </button>
            <button
              className="btn"
              onClick={() => navigator.clipboard.writeText(appInfo?.dataDir ?? '~/.pizza')}
            >
              {t('ui.复制路径')}
            </button>
          </div>
          <div className="field-help">
            {t('ui.也可以通过环境变量')} <code>PIZZA_DATA_DIR</code> {t('ui.指定其他目录。')}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <Titlebar
        theme={themeChoice}
        settingsMode={isSettings}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        onOpenSearch={() => setSearchOpen(true)}
        onToggleTheme={toggleTheme}
      />
      <div className="app-body">
        {isSettings ? (
          <Routes>
            <Route path="/settings/:page?" element={<SettingsRoute />} />
          </Routes>
        ) : (
          <>
            <Sidebar
              collapsed={collapsed}
              onOpenSettings={openSettings}
            />
            <Routes>
              <Route
                path="/"
                element={
                  <HomeView
                    onOpenSettings={openSettings}
                    onOpenSearch={() => setSearchOpen(true)}
                  />
                }
              />
              <Route
                path="/session/:id"
                element={<ChatView onOpenSettings={openSettings} />}
              />
            </Routes>
          </>
        )}
      </div>
      {searchOpen ? <CommandPalette onClose={() => setSearchOpen(false)} /> : null}
      <ApprovalDialog />
      <Onboarding />
      {notice ? (
        <div className="toast-root" role="status">
          <div className="toast">{notice}</div>
        </div>
      ) : null}
      {error ? (
        <div className="error-toast" role="alert">
          <Icon name="alert" size={15} />
          <span>{localizeError(error)}</span>
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('ui.关闭错误')}>
            <Icon name="x" size={13} />
          </button>
        </div>
      ) : null}
    </div>
  )
}
