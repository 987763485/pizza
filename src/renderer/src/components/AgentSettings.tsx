import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Agent } from '@shared/types'
import { useAppStore } from '../store'
import { Avatar } from './Avatar'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { RuntimeLogo } from './RuntimeLogo'
import { localizeError } from '../locales/errors'

interface AgentSettingsProps {
  onOpenPage: (page: string) => void
  onEditAgent: (agentId?: string) => void
}

function activeLabel(value: string, t: TFunction): string {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  if (Number.isNaN(date.getTime())) return '—'
  if (diff < 60_000) return t('ui.刚刚')
  if (diff < 3_600_000) return t('ui.{{count}} 分钟前', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('ui.{{count}} 小时前', { count: Math.floor(diff / 3_600_000) })
  if (diff < 604_800_000) return t('ui.{{count}} 天前', { count: Math.floor(diff / 86_400_000) })
  return t('ui.{{count}} 周前', { count: Math.floor(diff / 604_800_000) })
}

export function AgentSettings({ onOpenPage, onEditAgent }: AgentSettingsProps) {
  const { t, i18n } = useTranslation()
  const agents = useAppStore((state) => state.agents)
  const runtimes = useAppStore((state) => state.runtimes)
  const sessions = useAppStore((state) => state.sessions)
  const refreshAgents = useAppStore((state) => state.refreshAgents)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline'>('all')
  const [deleteTarget, setDeleteTarget] = useState<Agent | null>(null)
  const [error, setError] = useState<string | null>(null)

  const onlineRuntimes = runtimes.filter((runtime) => runtime.status === 'online')

  function statusOf(agent: Agent): { key: 'working' | 'online' | 'offline' | 'archived'; text: string } {
    if (agent.isArchived) return { key: 'archived', text: t('ui.已归档') }
    const running = sessions.some(
      (session) => session.agentId === agent.id && session.status === 'running',
    )
    if (running) return { key: 'working', text: t('ui.工作中') }
    const runtime = runtimes.find((item) => item.id === agent.runtimeId)
    return runtime?.status === 'online'
      ? { key: 'online', text: t('ui.在线') }
      : { key: 'offline', text: t('ui.离线') }
  }

  const filtered = useMemo(
    () =>
      agents.filter((agent) => {
        const matchesQuery =
          !query.trim() ||
          agent.name.toLowerCase().includes(query.toLowerCase()) ||
          agent.description.toLowerCase().includes(query.toLowerCase())
        if (!matchesQuery) return false
        if (statusFilter === 'all') return true
        const status = statusOf(agent)
        if (statusFilter === 'online') return status.key === 'online' || status.key === 'working'
        return status.key === 'offline' || status.key === 'archived'
      }),
    // statusOf 读取 sessions / runtimes，一并作为依赖。
    [agents, query, statusFilter, sessions, runtimes, t, i18n.language],
  )

  const onlineCount = agents.filter((agent) => {
    const status = statusOf(agent)
    return status.key === 'online' || status.key === 'working'
  }).length
  const offlineCount = agents.length - onlineCount

  async function remove(agent: Agent) {
    try {
      await window.pizza.agent.remove(agent.id)
      setDeleteTarget(null)
      await refreshAgents()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(
        message.includes('AGENT_IN_USE')
          ? t('ui.该智能体仍被活跃会话引用，请先归档或删除相关会话。')
          : message,
      )
    }
  }

  function agentStats(agent: Agent) {
    const related = sessions
      .filter((session) => session.agentId === agent.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    return {
      lastActive: related[0]?.updatedAt ?? agent.updatedAt,
      runs: related.length,
    }
  }

  return (
    <>
      <header className="manage-head">
        <div className="manage-head-left">
          <Icon name="cpu" size={16} /> {t('ui.智能体')}{' '}
          <span className="badge">{agents.length}</span>
        </div>
        <div className="manage-head-actions">
          <button className="icon-btn" onClick={() => setQuery('')} title={t('ui.清除搜索')}>
            <Icon name="search" size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setStatusFilter('all')}
            title={t('ui.清除筛选')}
          >
            <Icon name="filter" size={16} />
          </button>
          <button className="btn btn-sm btn-primary" onClick={() => onEditAgent()}>
            <Icon name="plus" size={13} /> {t('ui.新建')}
          </button>
        </div>
      </header>
      <div className="manage-toolbar">
        <label className="search-input" style={{ flex: 1, maxWidth: 340 }}>
          <Icon name="search" size={14} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('ui.搜索智能体…')}
          />
        </label>
        <button
          className={`filter-chip ${statusFilter === 'all' ? 'active' : ''}`}
          onClick={() => setStatusFilter('all')}
        >
          {t('ui.全部')} {agents.length}
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
          <Icon name="layers" size={11} /> {t('ui.{{count}} 个运行时', { count: runtimes.length })}
        </span>
      </div>

      {onlineRuntimes.length === 0 ? (
        <div className="inline-alert" style={{ marginBottom: 12 }}>
          {t('ui.还没有可用的运行时。先添加并测试一个运行时，智能体才能开始工作。')}
          <button className="mini-btn" onClick={() => onOpenPage('runtimes')}>
            {t('ui.去添加运行时')}
          </button>
        </div>
      ) : null}

      <div className="card" style={{ overflow: 'hidden' }}>
        <div className="list-head">
          <span />
          <span>{t('ui.智能体')}</span>
          <span>{t('ui.状态')}</span>
          <span>{t('ui.运行时')}</span>
          <span>{t('ui.模型')}</span>
          <span>{t('ui.最近活跃')}</span>
          <span>{t('ui.运行次数')}</span>
          <span />
        </div>
        {filtered.length === 0 ? (
          <div className="rp-empty">
            {agents.length === 0 ? t('ui.还没有智能体，创建一个开始。') : t('ui.没有匹配的智能体。')}
          </div>
        ) : (
          filtered.map((agent) => {
            const runtime = runtimes.find((item) => item.id === agent.runtimeId)
            const status = statusOf(agent)
            const stats = agentStats(agent)
            return (
              <div
                className="agent-row"
                key={agent.id}
                role="button"
                tabIndex={0}
                onClick={() => onEditAgent(agent.id)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    onEditAgent(agent.id)
                  }
                }}
              >
                <Avatar
                  name={agent.name}
                  src={agent.avatar}
                  size={36}
                  presence={
                    status.key === 'working'
                      ? 'running'
                      : status.key === 'online'
                        ? 'online'
                        : 'offline'
                  }
                />
                <div style={{ minWidth: 0 }}>
                  <div className="name-line">
                    {agent.name}{' '}
                    <span
                      style={{
                        fontWeight: 400,
                        color: 'var(--muted)',
                        fontSize: 10.5,
                      }}
                    >
                      {t('ui.你')}
                    </span>
                    {agent.isArchived ? <span className="badge">{t('ui.已归档')}</span> : null}
                    {agent.instructionMode === 'leader' ? (
                      <span className="badge">{t('ui.动态指令')}</span>
                    ) : null}
                  </div>
                  <div className="desc-line">{agent.description || t('ui.未填写描述')}</div>
                </div>
                <div className="cell">
                  <span
                    className={`status-dot ${
                      status.key === 'working'
                        ? 'running'
                        : status.key === 'online'
                          ? 'online'
                          : 'offline'
                    }`}
                  />{' '}
                  {status.text}
                </div>
                <div className="cell">
                  {runtime ? (
                    <RuntimeLogo adapter={runtime.adapter} size={13} className="runtime-logo-inline" />
                  ) : (
                    <Icon name="plug" size={13} />
                  )}{' '}
                  {runtime?.name ?? t('ui.未绑定')}
                </div>
                <div className="cell muted">{agent.model || t('ui.由运行时管理')}</div>
                <div className="cell muted">{activeLabel(stats.lastActive, t)}</div>
                <div className="cell muted">{stats.runs}</div>
                <button
                  className="icon-btn row-action"
                  onClick={(event) => {
                    event.stopPropagation()
                    setDeleteTarget(agent)
                  }}
                  title={t('ui.删除智能体')}
                  aria-label={t('ui.删除 {{name}}', { name: agent.name })}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
            )
          })
        )}
      </div>

      {deleteTarget ? (
        <Modal
          title={t('ui.永久删除智能体')}
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDeleteTarget(null)}>
                {t('ui.取消')}
              </button>
              <button className="btn btn-danger" onClick={() => void remove(deleteTarget)}>
                {t('ui.永久删除')}
              </button>
            </>
          }
        >
          <p className="modal-copy">
            {t('ui.删除「{{name}}」后无法恢复。若该智能体仍被活跃会话引用，应用会阻止删除；请先归档或删除相关会话。', {
              name: deleteTarget.name,
            })}
          </p>
          {error ? <div className="form-error">{localizeError(error)}</div> : null}
        </Modal>
      ) : null}
    </>
  )
}
