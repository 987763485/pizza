import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { RuntimeConfig } from '@shared/types'
import { RUNTIME_PRESETS } from '@shared/types'
import { useAppStore } from '../store'
import { Icon } from './Icon'
import { RuntimeLogo } from './RuntimeLogo'
import { Modal } from './Modal'
import { localizeError } from '../locales/errors'

interface RuntimeSettingsProps {
  onEditRuntime: (runtimeId?: string) => void
}

export function RuntimeSettings({ onEditRuntime }: RuntimeSettingsProps) {
  const { t } = useTranslation()
  const runtimes = useAppStore((state) => state.runtimes)
  const agents = useAppStore((state) => state.agents)
  const refreshRuntimes = useAppStore((state) => state.refreshRuntimes)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [error, setError] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RuntimeConfig | null>(null)
  const [menu, setMenu] = useState<{
    runtime: RuntimeConfig
    x: number
    y: number
  } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // 菜单可能打开在窗口右下角；渲染后按实际尺寸夹回视口，避免被裁切。
  useLayoutEffect(() => {
    const element = menuRef.current
    if (!menu || !element) return
    const rect = element.getBoundingClientRect()
    const padding = 8
    const left = Math.max(
      padding,
      Math.min(menu.x, window.innerWidth - rect.width - padding),
    )
    const top = Math.max(
      padding,
      Math.min(menu.y, window.innerHeight - rect.height - padding),
    )
    element.style.left = `${left}px`
    element.style.top = `${top}px`
  }, [menu])

  const filtered = useMemo(
    () =>
      runtimes.filter((runtime) => {
        const matchesQuery =
          runtime.name.toLowerCase().includes(query.toLowerCase()) ||
          (runtime.command ?? '').toLowerCase().includes(query.toLowerCase())
        if (!matchesQuery) return false
        if (statusFilter === 'all') return true
        if (statusFilter === 'online') return runtime.status === 'online'
        return runtime.status !== 'online'
      }),
    [query, runtimes, statusFilter],
  )

  const onlineCount = runtimes.filter((runtime) => runtime.status === 'online').length
  const offlineCount = runtimes.length - onlineCount

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  async function remove(runtime: RuntimeConfig) {
    try {
      await window.pizza.runtime.remove(runtime.id)
      await refreshRuntimes()
      setDeleteTarget(null)
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(
        message.includes('RUNTIME_IN_USE')
          ? t('ui.该运行时仍被智能体绑定，请先修改或删除相关智能体。')
          : message,
      )
    }
  }

  function openMenu(runtime: RuntimeConfig, event: React.MouseEvent) {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    // 初始按菜单右边缘对齐触发按钮；渲染后再按真实宽度夹回视口。
    const menuWidth = 168
    setMenu({
      runtime,
      x: Math.max(8, rect.right - menuWidth),
      y: rect.bottom + 6,
    })
  }

  return (
    <>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Workspace</div>
          <h1 className="page-title">{t('ui.运行时')}</h1>
          <p className="page-sub">
            {t('ui.Pizza 不自带模型；它驱动本机已安装、已登录的智能体 CLI。')}
          </p>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => onEditRuntime()}>
            <Icon name="plus" size={14} /> {t('ui.添加运行时')}
          </button>
        </div>
      </header>
      <div className="toolbar">
        <label className="search-input">
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('ui.搜索运行时…')}
          />
        </label>
        <button
          className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          {t('ui.全部')} {runtimes.length}
        </button>
        <button
          className={`filter-chip ${statusFilter === 'online' ? 'active' : ''}`}
          onClick={() => setStatusFilter('online')}
        >
          {t('ui.在线')} {onlineCount}
        </button>
        <button
          className={`filter-chip ${statusFilter === 'offline' ? 'active' : ''}`}
          onClick={() => setStatusFilter('offline')}
        >
          {t('ui.离线')} {offlineCount}
        </button>
        <span style={{ flex: 1 }} />
        <span className="badge">
          <Icon name="shield" size={11} /> {t('ui.仅监听本机')}
        </span>
      </div>

      {error ? <div className="inline-alert">{localizeError(error)}</div> : null}

      <div className="card" style={{ overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div className="rp-empty">
            {t('ui.还没有运行时。支持 Claude Code、Hermes、Codex、Pi、Oh My Pi 和 DeepSeek Harness。')}
          </div>
        ) : (
          filtered.map((runtime) => {
            const agentCount = agents.filter(
              (agent) => agent.runtimeId === runtime.id && !agent.isArchived,
            ).length
            const capabilities = [
              runtime.capabilities.streaming ? t('ui.流式') : null,
              runtime.capabilities.mcp ? 'MCP' : null,
              runtime.capabilities.skills ? 'Skill' : null,
              runtime.capabilities.thinking ? t('ui.思考') : null,
              runtime.capabilities.appendInput ? t('ui.插话') : null,
            ].filter(Boolean) as string[]
            const adapterName =
              RUNTIME_PRESETS.find((preset) => preset.adapter === runtime.adapter)?.name ??
              runtime.adapter
            return (
              <div className="runtime-row runtime-grid" key={runtime.id}>
                <span className="runtime-icon">
                  <RuntimeLogo adapter={runtime.adapter} size={22} />
                </span>
                <div>
                  <div className="runtime-name">
                    {runtime.name}{' '}
                    <span
                      className={`status-dot ${
                        runtime.status === 'online'
                          ? 'online'
                          : runtime.status === 'error'
                            ? 'error'
                            : 'offline'
                      }`}
                    />{' '}
                    {runtime.status === 'online' ? (
                      <span className="badge badge-green">{t('ui.在线')}</span>
                    ) : runtime.status === 'draft' ? (
                      <span className="badge">{t('ui.待测试')}</span>
                    ) : runtime.status === 'error' ? (
                      <span className="badge badge-red">{t('ui.错误')}</span>
                    ) : (
                      <span className="badge">{t('ui.离线')}</span>
                    )}
                  </div>
                  <div className="runtime-meta">
                    {adapterName} · {runtime.protocol}
                  </div>
                </div>
                <div className="runtime-caps">
                  {capabilities.length ? (
                    capabilities.map((capability) => (
                      <span className="badge" key={capability}>
                        {capability}
                      </span>
                    ))
                  ) : (
                    <span className="badge">{t('ui.基础')}</span>
                  )}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  {runtime.capabilities.models?.length
                    ? t('ui.{{count}} 个模型', { count: runtime.capabilities.models.length })
                    : t('ui.由运行时管理')}
                  <br />
                  {t('ui.{{count}} 个智能体', { count: agentCount })}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                  {runtime.status === 'online' ? t('ui.已连接') : '—'}
                </div>
                <div className="runtime-actions">
                  <button
                    className="icon-btn"
                    onClick={(event) => openMenu(runtime, event)}
                    aria-label={t('ui.运行时菜单')}
                  >
                    <Icon name="more" size={15} />
                  </button>
                </div>
              </div>
            )
          })
        )}
      </div>

      <div
        className="card"
        style={{
          marginTop: 18,
          padding: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          background: 'var(--surface-2)',
        }}
      >
        <span className="runtime-icon" style={{ background: 'var(--surface)' }}>
          <Icon name="shield" size={18} />
        </span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>
            {t('ui.运行时拥有你当前系统用户的完整权限')}
          </div>
          <div
            style={{
              fontSize: 10.5,
              color: 'var(--muted)',
              marginTop: 2,
              lineHeight: 1.6,
            }}
          >
            {t('ui.Pizza 不做文件系统沙箱；危险工具调用默认逐次审批。建议在独立用户或容器中运行不受信任的任务。')}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setError(null)}>
          {t('ui.了解安全模型')}
        </button>
      </div>

      {menu ? (
        <div
          className="session-menu"
          ref={menuRef}
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="menu-item"
            onClick={() => {
              onEditRuntime(menu.runtime.id)
              setMenu(null)
            }}
          >
            <Icon name="edit" size={13} /> {t('ui.编辑运行时')}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item danger"
            onClick={() => {
              setDeleteTarget(menu.runtime)
              setMenu(null)
            }}
          >
            <Icon name="trash" size={13} /> {t('ui.删除运行时')}
          </button>
        </div>
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('ui.删除运行时')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button className="btn btn-danger" onClick={() => void remove(deleteTarget)}>
                {t('ui.删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.删除「{{name}}」后，已绑定它的智能体需要重新选择运行时。该操作不会卸载本机 CLI。', { name: deleteTarget.name })}
          </p>
        </Modal>
      ) : null}
    </>
  )
}
