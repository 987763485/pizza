import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type { Agent, TeamSummary } from '@shared/types'
import { useAppStore } from '../store'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { TeamAvatar } from './TeamAvatar'

interface TeamSettingsProps {
  onEditTeam: (teamId?: string) => void
}

interface BrainstormRole {
  key: string
  name: string
  role: string
  prompt: string
}

function brainstormRoles(t: TFunction): BrainstormRole[] {
  return [
    {
      key: 'host',
      name: t('ui.主持人'),
      role: t('ui.拆解问题、控制节奏并收敛结论'),
      prompt: t('ui.你是团队的主持人。你是团队唯一的调度中枢：先复述目标与成功标准，再读取参与者能力目录，只派发能力匹配且当前空闲的成员；每次分派一个单轮任务（目标、输入、完成标准）。成员完成后结果交回你，由你决定继续派发或收敛；不设固定轮次。最终输出结论、关键依据、分歧与未决问题、建议下一步。'),
    },
    {
      key: 'product',
      name: t('ui.产品经理'),
      role: t('ui.从用户价值和场景出发提出方案'),
      prompt: t('ui.你是产品经理。从目标用户、使用场景、价值与成本出发提出方案，明确假设和需要验证的风险；不要代替其他角色做技术判断。'),
    },
    {
      key: 'architect',
      name: t('ui.架构师'),
      role: t('ui.评估技术方案、成本与可演进性'),
      prompt: t('ui.你是架构师。评估技术可行性、数据流、依赖、迁移成本和长期可演进性，指出具体风险与替代方案。'),
    },
    {
      key: 'contrarian',
      name: t('ui.唱反调者'),
      role: t('ui.主动寻找反例与失败路径'),
      prompt: t('ui.你是唱反调者。主动寻找反例、失败路径和被忽略的约束；不同意时给出具体反驳与新论据，而不是空泛质疑。'),
    },
    {
      key: 'researcher',
      name: t('ui.用户研究员'),
      role: t('ui.提供证据、访谈洞察与边界案例'),
      prompt: t('ui.你是用户研究员。提供用户证据、访谈洞察和边界案例，区分事实、推断与未知；帮助团队避免只凭直觉做决定。'),
    },
  ]
}

function formatLastUsed(team: TeamSummary, t: TFunction): string {
  const value = team.lastUsedAt ?? team.updatedAt
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return t('ui.尚未使用')
  return new Intl.DateTimeFormat(t('ui.zh-CN'), { month: 'numeric', day: 'numeric' }).format(date)
}

export function TeamSettings({ onEditTeam }: TeamSettingsProps) {
  const { t } = useTranslation()
  const teams = useAppStore((state) => state.teams)
  const agents = useAppStore((state) => state.agents)
  const runtimes = useAppStore((state) => state.runtimes)
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId)
  const refreshAgents = useAppStore((state) => state.refreshAgents)
  const createTeam = useAppStore((state) => state.createTeam)
  const deleteTeam = useAppStore((state) => state.deleteTeam)
  const setError = useAppStore((state) => state.setError)

  const [query, setQuery] = useState('')
  const [pendingDelete, setPendingDelete] = useState<TeamSummary | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateRuntime, setTemplateRuntime] = useState(runtimes[0]?.id ?? '')
  const [templateBusy, setTemplateBusy] = useState(false)

  const normalizedQuery = query.trim().toLowerCase()
  const visible = teams.filter(
    (team) =>
      !normalizedQuery ||
      team.name.toLowerCase().includes(normalizedQuery) ||
      team.description.toLowerCase().includes(normalizedQuery),
  )
  const archivedCount = teams.filter((team) => team.isArchived).length

  async function createBrainstormTemplate() {
    if (!currentWorkspaceId || !templateRuntime) return
    const runtime = runtimes.find((item) => item.id === templateRuntime)
    if (!runtime) return
    setTemplateBusy(true)
    try {
      const roles = brainstormRoles(t)
      const byName = new Map(agents.filter((agent) => !agent.isArchived).map((agent) => [agent.name, agent]))
      const resolved: Agent[] = []
      for (const role of roles) {
        let agent = byName.get(role.name)
        if (!agent) {
          agent = await window.pizza.agent.create({
            name: role.name,
            description: role.role,
            runtimeId: runtime.id,
            prompt: role.prompt,
          })
        }
        resolved.push(agent)
      }
      await refreshAgents()
      const team = await createTeam({
        workspaceId: currentWorkspaceId,
        name: t('ui.头脑风暴小组'),
        description: t('ui.围绕一个议题分角色辩论，并由主持人收敛结论。'),
        leaderAgentId: resolved[0].id,
        orchestrationPrompt: t(
          'ui.你是团队的主持人。按参与者能力目录派发单轮任务，要求成员交叉质询但不要互相直连；需要用户拍板时 @我。没有匹配目标或分歧已充分暴露时停止派发，收敛时输出结论、关键依据、分歧与未决问题、建议下一步。',
        ),
        fanoutStrategy: 'parallel',
        members: resolved.map((agent, index) => ({
          agentId: agent.id,
          role: roles[index].role,
        })),
      })
      setTemplateOpen(false)
      if (team) onEditTeam(team.id)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setTemplateBusy(false)
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return
    try {
      await deleteTeam(pendingDelete.id)
      setPendingDelete(null)
    } catch {
      // store 已记录错误；保留弹窗让用户改为归档。
    }
  }

  return (
    <>
      <header className="page-header">
        <div>
          <div className="page-eyebrow">Teams</div>
          <h1 className="page-title">{t('ui.智能体团队')}</h1>
          <p className="page-sub">{t('ui.一个指挥者，一组成员，围绕会话协同完成一件事。')}</p>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setTemplateOpen(true)}>
            <Icon name="layers" size={14} /> {t('ui.从模板创建')}
          </button>
          <button className="btn btn-primary" onClick={() => onEditTeam()}>
            <Icon name="plus" size={14} /> {t('ui.新建团队')}
          </button>
        </div>
      </header>

      <div className="toolbar">
        <label className="search-input">
          <Icon name="search" size={14} />
          <input
            placeholder={t('ui.搜索团队…')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button className="filter-chip active">{t('ui.全部')} {teams.length}</button>
        <button className="filter-chip">{t('ui.最近使用')}</button>
        {archivedCount > 0 ? <span className="badge">{t('ui.{{count}} 已归档', { count: archivedCount })}</span> : null}
      </div>

      {visible.length === 0 ? (
        <div className="empty-state">
          <Icon name="users" size={24} />
          <div className="empty-title">{t('ui.还没有智能体团队')}</div>
          <p>{t('ui.先创建一支团队，或从头脑风暴模板开始。')}</p>
        </div>
      ) : (
        <div className="team-grid">
          {visible.map((team) => (
            <div
              key={team.id}
              className="team-card"
              role="button"
              tabIndex={0}
              onClick={() => onEditTeam(team.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onEditTeam(team.id)
              }}
            >
              <div className="team-card-head">
                <TeamAvatar
                  name={team.name}
                  src={team.avatar}
                  members={team.memberAvatars}
                  size={44}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="team-card-name">
                    {team.name}
                    {team.isArchived ? <span className="badge">{t('ui.已归档')}</span> : null}
                  </div>
                  <div className="team-card-desc">{team.description || t('ui.暂无描述')}</div>
                </div>
                <button
                  className="icon-btn row-action"
                  title={t('ui.删除团队')}
                  aria-label={t('ui.删除 {{name}}', { name: team.name })}
                  onClick={(event) => {
                    event.stopPropagation()
                    setPendingDelete(team)
                  }}
                >
                  <Icon name="trash" size={14} />
                </button>
              </div>
              <div className="team-card-foot">
                <span className="badge badge-accent">{t('ui.指挥者')} {team.leaderName ?? t('ui.未设置')}</span>
                <span>{t('ui.{{count}} 名成员', { count: team.memberCount })}</span>
                <span style={{ marginLeft: 'auto' }}>{formatLastUsed(team, t)}</span>
              </div>
            </div>
          ))}
          <button
            className="team-card team-card-new"
            onClick={() => onEditTeam()}
          >
            <Icon name="plus" size={18} /> {t('ui.新建团队')}
          </button>
        </div>
      )}

      <div style={{ marginTop: 26 }}>
        <div className="recent-head" style={{ paddingLeft: 0 }}>
          <span>{t('ui.模板')}</span>
        </div>
        <div className="team-grid">
          <div className="team-card" style={{ cursor: 'default' }}>
            <div className="team-card-name">
              {t('ui.头脑风暴')} <span className="badge">{t('ui.内置')}</span>
            </div>
            <div className="team-card-desc">
              {t('ui.主持人、产品经理、架构师、唱反调者、用户研究员，围绕议题分角色辩论。')}
            </div>
            <div className="team-card-foot">
              <span>{t('ui.5 名成员')}</span>
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={() => setTemplateOpen(true)}
              >
                {t('ui.使用')}
              </button>
            </div>
          </div>
        </div>
      </div>

      {templateOpen ? (
        <Modal
          title={t('ui.从头脑风暴模板创建')}
          onClose={() => setTemplateOpen(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setTemplateOpen(false)}>
                {t('ui.取消')}
              </button>
              <button
                className="btn btn-primary"
                disabled={templateBusy || !templateRuntime}
                onClick={() => void createBrainstormTemplate()}
              >
                {templateBusy ? t('ui.创建中…') : t('ui.创建团队')}
              </button>
            </>
          }
        >
          <div className="field">
            <div className="field-label">{t('ui.运行时')}</div>
            <select
              className="input"
              value={templateRuntime}
              onChange={(event) => setTemplateRuntime(event.target.value)}
            >
              {runtimes.map((runtime) => (
                <option key={runtime.id} value={runtime.id}>
                  {runtime.name}（{runtime.status === 'online' ? t('ui.在线') : t('ui.离线')}）
                </option>
              ))}
            </select>
            <div className="field-help">
              {t('ui.模板会自动补齐缺失的五名角色智能体；已存在的同名智能体会直接复用。')}
            </div>
          </div>
          <div className="team-summary" style={{ marginTop: 14 }}>
            <div className="team-summary-title">{t('ui.成员')}</div>
            {brainstormRoles(t).map((role) => (
              <div className="summary-row" key={role.key}>
                <span style={{ flex: 1 }}>{role.name}</span>
                <span style={{ fontSize: 10, color: 'var(--muted)' }}>{role.role}</span>
              </div>
            ))}
          </div>
        </Modal>
      ) : null}

      {pendingDelete ? (
        <Modal
          title={t('ui.删除团队')}
          onClose={() => setPendingDelete(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setPendingDelete(null)}>
                {t('ui.取消')}
              </button>
              <button className="btn btn-danger" onClick={() => void confirmDelete()}>
                {t('ui.确认删除')}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.7 }}>
            {pendingDelete.sessionCount > 0
              ? t('ui.「{{name}}」仍有 {{count}} 个历史会话。删除后团队会从列表和新建会话中移除，历史会话仍保留团队名称与头像；团队成员本身不会被删除。', { name: pendingDelete.name, count: pendingDelete.sessionCount })
              : t('ui.删除「{{name}}」后无法恢复。团队成员不会被删除。', { name: pendingDelete.name })}
          </p>
        </Modal>
      ) : null}
    </>
  )
}
