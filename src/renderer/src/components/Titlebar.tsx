import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { NotificationBell } from './NotificationBell'

interface TitlebarProps {
  theme: 'light' | 'dark' | 'system'
  settingsMode: boolean
  onToggleCollapsed: () => void
  onOpenSearch: () => void
  onToggleTheme: () => void
}

export function Titlebar({
  theme,
  settingsMode,
  onToggleCollapsed,
  onOpenSearch,
  onToggleTheme,
}: TitlebarProps) {
  const location = useLocation()
  const { t } = useTranslation()
  // 标题栏文案与原型保持一致：首页只显示品牌名，其他页面显示「Pizza · 页面」。
  const title = location.pathname.startsWith('/session/')
    ? t('titlebar.chat')
    : location.pathname.startsWith('/settings/')
      ? t('titlebar.settings')
      : 'Pizza'

  return (
    <header
      className="titlebar"
      style={{ paddingLeft: window.pizzaBootstrap?.platform === 'darwin' ? 82 : 16 }}
    >
      <div className="titlebar-left">
        <div className="titlebar-left-actions">
          {settingsMode ? null : (
            <button
              className="icon-btn"
              onClick={onToggleCollapsed}
              title={t('titlebar.collapse')}
              aria-label={t('titlebar.collapse')}
            >
              <Icon name="panel-left" size={16} />
            </button>
          )}
          <button
            className="icon-btn"
            onClick={onOpenSearch}
            title={`${t('nav.search')} ⌘K`}
            aria-label={t('nav.search')}
          >
            <Icon name="search" size={16} />
          </button>
        </div>
      </div>
      <div className="titlebar-title">{title}</div>
      <div className="titlebar-actions">
        <NotificationBell />
        <button
          className="icon-btn"
          onClick={onToggleTheme}
          title={t('titlebar.theme')}
          aria-label={t('titlebar.theme')}
        >
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
        </button>
      </div>
    </header>
  )
}
