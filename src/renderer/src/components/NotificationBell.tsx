import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import i18n from '../i18n'
import { formatDateTime } from '../format'
import { localizeError } from '../locales/errors'
import { useAppStore } from '../store'
import { Icon } from './Icon'

/** 应用内通知：精确提及用户时出现，点击定位到会话消息。 */
export function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const notifications = useAppStore((state) => state.notifications)
  const markRead = useAppStore((state) => state.markNotificationRead)
  const markAllRead = useAppStore((state) => state.markAllNotificationsRead)
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const unread = notifications.filter((item) => item.status === 'pending').length

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  return (
    <div className="notification-wrap" ref={wrapperRef}>
      <button
        className="icon-btn notification-btn"
        onClick={() => setOpen((value) => !value)}
        title={t('notifications.title')}
        aria-label={`${t('notifications.title')}${unread ? ` (${unread})` : ''}`}
      >
        <Icon name="bell" size={16} />
        {unread > 0 ? <span className="notification-count">{unread}</span> : null}
      </button>
      {open ? (
        <div className="notification-popover">
          <div className="notification-head">
            <strong>{t('notifications.title')}</strong>
            {unread > 0 ? (
              <button className="btn btn-sm" onClick={() => void markAllRead()}>
                {t('notifications.markAll')}
              </button>
            ) : null}
          </div>
          <div className="notification-list">
            {notifications.length === 0 ? (
              <div className="notification-empty">{t('notifications.empty')}</div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  className={`notification-item ${item.status === 'pending' ? 'unread' : ''}`}
                  onClick={async () => {
                    try {
                      await window.pizza.notification.open(item.id)
                      await markRead(item.id)
                      if (item.sessionId) {
                        navigate(`/session/${item.sessionId}`)
                      }
                    } catch {
                      useAppStore
                        .getState()
                        .setError(t('ui.通知对应的会话已被删除或不可用'))
                    } finally {
                      setOpen(false)
                    }
                  }}
                >
                  <div className="notification-title">{localizeError(item.title)}</div>
                  <div className="notification-body">{localizeError(item.body)}</div>
                  <div className="notification-meta">
                    {item.sessionTitle ?? t('notifications.session')} ·{' '}
                    {formatDateTime(item.createdAt, i18n.language)}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
