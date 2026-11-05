import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import type {
  Agent,
  FanoutStrategy,
  PromptOverrideMode,
  TeamDetail,
  TeamInput,
} from '@shared/types'
import { useAppStore } from '../store'
import { cropSquareDataUrl } from '../avatar'
import { Avatar } from './Avatar'
import { Icon, type IconName } from './Icon'
import { TeamAvatar } from './TeamAvatar'
import { localizeError } from '../locales/errors'

type EditorTab = 'basic' | 'leader' | 'members' | 'instructions'

const TABS: Array<[EditorTab, string, IconName]> = [
  ['basic', '基本信息', 'users'],
  ['leader', '指挥者', 'crown'],
  ['members', '成员', 'users'],
  ['instructions', '团队指令', 'file-text'],
]

interface MemberForm {
  agentId: string
  role: string
  promptMode: PromptOverrideMode
  prompt: string
}

interface FormState {
  name: string
  description: string
  avatar: string | null
  leaderAgentId: string
  orchestrationPrompt: string
  fanoutStrategy: FanoutStrategy
  maxConcurrency: number
  maxHops: number
  tokenBudget: number
  members: MemberForm[]
}

function defaultPrompt(name: string, t: TFunction): string {
  return t(
    'ui.你是团队「{{name}}」的指挥者。你是团队唯一的调度中枢：不替成员答题，根据参与者能力目录决定何时调用谁。\n\n规则：\n1. 收到任务后，先用一句话复述目标与成功标准。\n2. 读取参与者能力目录（名称、能力描述、团队职责、运行状态），像选择 Skill 一样，只派发能力匹配且当前空闲的成员。\n3. 每次 @ 成员只下发一个单轮任务，写清目标、输入和完成标准；对指令来源为「指挥者动态下发」的成员，同时写清角色、边界与输出格式。成员完成后会把结果交回你。\n4. 根据成员结果决定是否继续派发：可以交叉引用其观点并要求「同意并补充」或「反驳并给出新论据」；不要让成员互相直连。\n5. 用户随时可能插话；收到插话后，先更新任务约束，再继续分派。\n6. 需要用户拍板时 @我，并提出一个具体问题，不要自行假设。\n7. 没有新的能力匹配目标、或分歧已充分暴露时，停止派发并输出总结；不存在固定轮次上限。\n8. 收敛时输出结论、关键依据、分歧与未决问题、建议下一步。',
    { name: name || t('ui.未命名团队') },
  )
}

function formFromTeam(team: TeamDetail): FormState {
  return {
    name: team.name,
    description: team.description,
    avatar: team.avatar,
    leaderAgentId: team.leaderAgentId,
    orchestrationPrompt: team.orchestrationPrompt,
    fanoutStrategy: team.fanoutStrategy,
    maxConcurrency: team.maxConcurrency,
    maxHops: team.maxHops,
    tokenBudget: team.tokenBudget,
    members: team.members.map((member) => ({
      agentId: member.agentId,
      role: member.role,
      promptMode: member.promptMode,
      prompt: member.prompt,
    })),
  }
}

function effectivePrompt(
  agent: Agent | undefined,
  member: MemberForm,
  t: TFunction,
  isLeader = false,
): string {
  if (!agent) return t('ui.智能体不存在')
  if (!isLeader && agent.instructionMode === 'leader') {
    return t('ui.由指挥者动态下发')
  }
  if (member.promptMode === 'replace') return member.prompt
  if (member.promptMode === 'append') {
    return `${agent.prompt}\n\n${member.prompt}`.trim()
  }
  return agent.prompt
}

export function TeamEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const id = searchParams.get('id')
  const agents = useAppStore((state) => state.agents)
  const runtimes = useAppStore((state) => state.runtimes)
  const currentWorkspaceId = useAppStore((state) => state.currentWorkspaceId)
  const createTeam = useAppStore((state) => state.createTeam)
  const updateTeam = useAppStore((state) => state.updateTeam)
  const setError = useAppStore((state) => state.setError)

  const [tab, setTab] = useState<EditorTab>('basic')
  const [form, setForm] = useState<FormState | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(!!id)
  const [addOpen, setAddOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const addRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!addOpen) return
    const onPointerDown = (event: MouseEvent) => {
      if (!addRef.current?.contains(event.target as Node)) setAddOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setAddOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [addOpen])

  const availableAgents = agents.filter((agent) => !agent.isArchived)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) {
        // 新建团队默认不带成员；添加第一名成员时自动设为指挥者。
        setForm({
          name: '',
          description: '',
          avatar: null,
          leaderAgentId: '',
          orchestrationPrompt: defaultPrompt('', t),
          fanoutStrategy: 'parallel',
          maxConcurrency: 3,
          maxHops: 64,
          tokenBudget: 0,
          members: [],
        })
        setLoading(false)
        return
      }
      try {
        const team = await window.pizza.team.get(id)
        if (!cancelled) setForm(formFromTeam(team))
      } catch (caught) {
        if (!cancelled) {
          setLocalError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
    // 只在首次打开时加载团队；后续编辑由本地表单持有。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (loading) {
    return <div className="empty-state">{t('ui.正在加载团队…')}</div>
  }
  if (!form) {
    return <div className="empty-state">{localError ?? t('ui.团队不存在')}</div>
  }

  const agentById = new Map(agents.map((agent) => [agent.id, agent]))
  const runtimeById = new Map(runtimes.map((runtime) => [runtime.id, runtime]))
  const leader = agentById.get(form.leaderAgentId)
  const memberAgents = form.members
    .map((member) => agentById.get(member.agentId))
    .filter((agent): agent is Agent => !!agent)
  const addableAgents = availableAgents.filter(
    (agent) => !form.members.some((member) => member.agentId === agent.id),
  )
  const issues: string[] = []
  if (!form.name.trim()) issues.push(t('ui.团队名称不能为空'))
  if (!form.members.some((member) => member.agentId === form.leaderAgentId)) {
    issues.push(t('ui.指挥者不在成员列表中'))
  }
  if (form.members.length === 0) issues.push(t('ui.至少需要一名成员'))

  function patch(next: Partial<FormState>) {
    setForm((current) => (current ? { ...current, ...next } : current))
  }

  function patchMember(agentId: string, next: Partial<MemberForm>) {
    setForm((current) =>
      current
        ? {
            ...current,
            members: current.members.map((member) =>
              member.agentId === agentId ? { ...member, ...next } : member,
            ),
          }
        : current,
    )
  }

  function addMember(agentId: string) {
    if (!agentId) return
    setForm((current) =>
      current && !current.members.some((member) => member.agentId === agentId)
        ? {
            ...current,
            members: [
              ...current.members,
              { agentId, role: '', promptMode: 'inherit', prompt: '' },
            ],
            // 第一名成员自动成为指挥者，避免新建团队停留在“无指挥者”状态。
            leaderAgentId: current.leaderAgentId || agentId,
          }
        : current,
    )
  }

  function moveMember(agentId: string, direction: -1 | 1) {
    setForm((current) => {
      if (!current) return current
      const index = current.members.findIndex((member) => member.agentId === agentId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= current.members.length) return current
      const members = [...current.members]
      ;[members[index], members[target]] = [members[target], members[index]]
      return { ...current, members }
    })
  }

  function removeMember(agentId: string) {
    setForm((current) => {
      if (!current || agentId === current.leaderAgentId) return current
      return {
        ...current,
        members: current.members.filter((member) => member.agentId !== agentId),
      }
    })
  }

  async function uploadAvatar(file: File) {
    if (file.size > 2 * 1024 * 1024) {
      setLocalError(t('ui.头像不能超过 2 MB'))
      return
    }
    try {
      const data = await cropSquareDataUrl(file, 160)
      patch({ avatar: data })
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : String(caught))
    }
  }

  async function save() {
    if (!currentWorkspaceId || !form) return
    if (issues.length > 0) {
      setLocalError(issues[0])
      return
    }
    setSaving(true)
    setLocalError(null)
    const input: TeamInput = {
      workspaceId: currentWorkspaceId,
      name: form.name,
      description: form.description,
      avatar: form.avatar,
      leaderAgentId: form.leaderAgentId,
      orchestrationPrompt: form.orchestrationPrompt,
      fanoutStrategy: form.fanoutStrategy,
      maxConcurrency: form.maxConcurrency,
      maxHops: form.maxHops,
      tokenBudget: form.tokenBudget,
      members: form.members.map((member) => ({
        agentId: member.agentId,
        role: member.role,
        promptMode: member.promptMode,
        prompt: member.prompt,
      })),
    }
    try {
      const result = id ? await updateTeam(id, input) : await createTeam(input)
      if (result) navigate('/settings/teams')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setLocalError(
        message.includes('TEAM_NAME_EXISTS')
          ? t('ui.同一工作区已有同名团队')
          : message.includes('TEAM_LEADER_NOT_MEMBER')
            ? t('ui.指挥者必须是团队成员')
            : message,
      )
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="page">
      <div className="page-inner" style={{ maxWidth: 1240 }}>
        <header className="page-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="icon-btn"
              aria-label={t('ui.返回团队列表')}
              onClick={() => navigate('/settings/teams')}
            >
              <Icon name="arrow-left" size={17} />
            </button>
            <div>
              <div className="page-eyebrow">Teams / {form.name || t('ui.新建团队')}</div>
              <h1 className="page-title">{id ? t('ui.编辑团队') : t('ui.新建团队')}</h1>
            </div>
          </div>
          <div className="page-actions">
            <button className="btn btn-ghost" onClick={() => navigate('/settings/teams')}>
              {t('ui.取消')}
            </button>
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
              <Icon name="check" size={14} /> {saving ? t('ui.保存中…') : t('ui.保存')}
            </button>
          </div>
        </header>

        {localError ? <div className="form-error">{localizeError(localError)}</div> : null}

        <div className="editor-layout">
          <nav className="editor-nav">
            {TABS.map(([value, label, icon]) => (
              <button
                key={value}
                className={`editor-nav-item ${tab === value ? 'active' : ''}`}
                onClick={() => setTab(value)}
              >
                <Icon name={icon} size={15} /> {t(`ui.${label}`)}
              </button>
            ))}
          </nav>

          <div>
            {tab === 'basic' ? (
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="users" size={15} /> {t('ui.团队身份')}
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.团队头像')}</div>
                  <div className="avatar-picker">
                    <button
                      className="avatar-preview"
                      title={t('ui.点击上传头像')}
                      onClick={() => fileRef.current?.click()}
                    >
                      <TeamAvatar
                        name={form.name || t('ui.新团队')}
                        src={form.avatar}
                        members={memberAgents}
                        size={60}
                      />
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => {
                        const file = event.target.files?.[0]
                        if (file) void uploadAvatar(file)
                        event.target.value = ''
                      }}
                    />
                    <div>
                      {form.avatar ? (
                        <div className="avatar-actions">
                          <button
                            className="btn btn-sm btn-ghost"
                            onClick={() => patch({ avatar: null })}
                          >
                            {t('ui.恢复默认头像')}
                          </button>
                        </div>
                      ) : null}
                      <div className="field-help" style={{ marginTop: form.avatar ? 7 : 0 }}>
                        {t('ui.未添加成员时使用 Pizza 图标；添加成员后由成员头像拼贴生成。点击头像上传图片，不超过 2 MB。')}
                      </div>
                    </div>
                  </div>
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.名称')}</div>
                  <input
                    className="input"
                    value={form.name}
                    placeholder={t('ui.例如：产品评审团')}
                    onChange={(event) => patch({ name: event.target.value })}
                  />
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.描述')}</div>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 76 }}
                    maxLength={500}
                    value={form.description}
                    placeholder={t('ui.这支团队负责什么？')}
                    onChange={(event) => patch({ description: event.target.value })}
                  />
                </div>
                <div className="exec-config-card team-config-card" style={{ marginTop: 4 }}>
                  <div className="exec-config-row">
                    <div className="exec-config-label">{t('ui.默认扇出策略')}</div>
                    <div className="exec-config-body">
                      <div className="segmented">
                        {(
                          [
                            ['parallel', '并发'],
                            ['serial', '串行'],
                          ] as Array<[FanoutStrategy, string]>
                        ).map(([value, label]) => (
                          <button
                            key={value}
                            className={form.fanoutStrategy === value ? 'active' : ''}
                            onClick={() => patch({ fanoutStrategy: value })}
                          >
                            {t(`ui.${label}`)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="exec-config-row">
                    <div className="exec-config-label">{t('ui.最大并发')}</div>
                    <div className="exec-config-body">
                      <input
                        className="input team-limit-input"
                        type="number"
                        min={1}
                        max={10}
                        value={form.maxConcurrency}
                        onChange={(event) => patch({ maxConcurrency: Number(event.target.value) })}
                      />
                    </div>
                  </div>
                  <div className="exec-config-row">
                    <div className="exec-config-label">{t('ui.最大跳数')}</div>
                    <div className="exec-config-body">
                      <input
                        className="input team-limit-input"
                        type="number"
                        min={1}
                        max={100}
                        value={form.maxHops}
                        onChange={(event) => patch({ maxHops: Number(event.target.value) })}
                      />
                      <div className="exec-config-help">
                        {t('ui.单回合派发上限，仅用于防止 @ 循环失控。')}
                      </div>
                    </div>
                  </div>
                  <div className="exec-config-row">
                    <div className="exec-config-label">{t('ui.Token 预算')}</div>
                    <div className="exec-config-body">
                      <input
                        className="input team-limit-input"
                        type="number"
                        min={0}
                        step={1000}
                        value={form.tokenBudget}
                        onChange={(event) => patch({ tokenBudget: Number(event.target.value) })}
                      />
                      <div className="exec-config-help">{t('ui.0 表示不限')}</div>
                    </div>
                  </div>
                </div>
              </section>
            ) : null}

            {tab === 'leader' ? (
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="crown" size={15} /> {t('ui.指挥者')}
                </div>
                <div className="form-section-sub">
                  {t('ui.指挥者默认接收用户消息，负责拆解、分派、交叉质询与收敛。它必须是团队成员。')}
                </div>
                {leader ? (
                  <div className="member-card" style={{ borderColor: 'var(--line-strong)' }}>
                    <Avatar name={leader.name} src={leader.avatar} size={38} />
                    <div className="member-info">
                      <div className="member-name">
                        {leader.name} <span className="badge badge-accent">{t('ui.当前指挥者')}</span>
                      </div>
                      <div className="member-desc">{leader.description || t('ui.暂无描述')}</div>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">{t('ui.还没有可用的指挥者')}</div>
                )}
                {leader?.instructionMode === 'leader' ? (
                  <div className="field-help" style={{ marginTop: 8, color: 'var(--red)' }}>
                    {t('ui.指挥者始终使用自己的 Prompt；指令来源模式二仅对成员生效。请填写团队编排 Prompt。')}
                  </div>
                ) : null}
                <div className="field" style={{ marginTop: 16 }}>
                  <div className="field-label">{t('ui.更换指挥者')}</div>
                  <div className="chip-list">
                    {form.members
                      .filter((member) => member.agentId !== form.leaderAgentId)
                      .map((member) => {
                        const agent = agentById.get(member.agentId)
                        if (!agent) return null
                        return (
                          <button
                            className="chip"
                            key={member.agentId}
                            onClick={() => patch({ leaderAgentId: member.agentId })}
                          >
                            <Avatar name={agent.name} src={agent.avatar} size={16} />
                            {agent.name}
                          </button>
                        )
                      })}
                  </div>
                  <div className="field-help">{t('ui.更换后下一次回合生效；正在运行的回合不受影响。')}</div>
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.指挥者协议（只读）')}</div>
                  <div className="prompt-preview">
                    {t('ui.1. 唯一调度中枢：按参与者能力目录决定调用谁，不代替成员实现。')}
                    {'\n'}2. {t('ui.每次分派一个单轮任务：目标、输入、完成标准；动态指令成员还需角色、边界与输出格式。使用精确提及语法：[@名称](mention://agent/<id>)。')}
                    {'\n'}3. {t('ui.成员完成后结果交回你；不要要求成员互相直连。')}
                    {'\n'}4. {t('ui.没有匹配目标或分歧已充分暴露时停止派发；不设固定轮次。')}
                    {'\n'}5. {t('ui.需要用户拍板时 @我；收敛后输出结论、依据、分歧、未决问题与下一步。')}
                  </div>
                </div>
              </section>
            ) : null}

            {tab === 'members' ? (
              <section className="form-section">
                <div className="form-section-title" style={{ justifyContent: 'space-between' }}>
                  <span>
                    <Icon name="users" size={15} /> {t('ui.成员')}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--muted)', fontWeight: 400 }}>
                    {t('ui.{{count}} 人', { count: form.members.length })}
                  </span>
                </div>
                <div className="form-section-sub">
                  {t('ui.成员级配置可以覆盖 Prompt；覆盖不会修改智能体本身。')}
                </div>
                {form.members.map((member, memberIndex) => {
                  const agent = agentById.get(member.agentId)
                  const isLeader = member.agentId === form.leaderAgentId
                  return (
                    <div className="card member-card-editor" key={member.agentId}>
                      <div className="member-head">
                        <Avatar name={agent?.name ?? t('ui.未知')} src={agent?.avatar} size={36} />
                        <div className="member-info">
                          <div className="member-name">
                            {agent?.name ?? t('ui.智能体不存在')}
                            {isLeader ? (
                              <>
                                <span className="leader-crown">
                                  <Icon name="crown" size={13} />
                                </span>
                                <span className="badge badge-accent" style={{ height: 16, fontSize: 9 }}>
                                  {t('ui.指挥者')}
                                </span>
                              </>
                            ) : null}
                            {!isLeader && agent?.instructionMode === 'leader' ? (
                              <span className="badge" style={{ height: 16, fontSize: 9 }}>
                                {t('ui.动态指令')}
                              </span>
                            ) : null}
                          </div>
                          <div className="member-desc">
                            {agent?.description || t('ui.暂无描述')}
                            {member.promptMode !== 'inherit' &&
                            agent?.instructionMode !== 'leader'
                              ? t('ui. · 有团队覆盖')
                              : ''}
                          </div>
                        </div>
                        <div className="member-actions">
                          <button
                            className="icon-btn"
                            title={t('ui.上移')}
                            disabled={memberIndex === 0}
                            onClick={() => moveMember(member.agentId, -1)}
                          >
                            <Icon name="arrow-up" size={13} />
                          </button>
                          <button
                            className="icon-btn"
                            title={t('ui.下移')}
                            disabled={memberIndex === form.members.length - 1}
                            onClick={() => moveMember(member.agentId, 1)}
                          >
                            <Icon name="chevron-down" size={13} />
                          </button>
                          {!isLeader ? (
                            <>
                              <button
                                className="icon-btn"
                                title={t('ui.设为指挥者')}
                                onClick={() => patch({ leaderAgentId: member.agentId })}
                              >
                                <Icon name="crown" size={14} />
                              </button>
                              <button
                                className="icon-btn"
                                title={t('ui.移除成员')}
                                onClick={() => removeMember(member.agentId)}
                              >
                                <Icon name="x" size={14} />
                              </button>
                            </>
                          ) : null}
                        </div>
                      </div>
                      <div className="member-role-row">
                        <div className="field member-role-field">
                          <div className="field-label">{t('ui.角色')}</div>
                          <input
                            className="input"
                            value={member.role}
                            placeholder={t('ui.例如：评估技术可行性')}
                            onChange={(event) =>
                              patchMember(member.agentId, { role: event.target.value })
                            }
                          />
                        </div>
                        {!isLeader && agent?.instructionMode === 'leader' ? null : (
                          <label className="check-row member-prompt-check">
                            <input
                              type="checkbox"
                              checked={member.promptMode !== 'inherit'}
                              onChange={(event) =>
                                patchMember(member.agentId, {
                                  promptMode: event.target.checked ? 'replace' : 'inherit',
                                })
                              }
                            />
                            {t('ui.自定义 Prompt')}
                          </label>
                        )}
                      </div>
                    {!isLeader &&
                    agent?.instructionMode === 'leader' ? (
                      <div className="field-help" style={{ marginTop: 8 }}>
                        {t('ui.该成员由指挥者动态下发角色指令，团队 Prompt 覆盖不生效。')}
                      </div>
                    ) : null}
                    {member.promptMode !== 'inherit' &&
                    (isLeader || agent?.instructionMode !== 'leader') ? (
                      <div className="field" style={{ marginTop: 12 }}>
                        <div className="field-label">{t('ui.覆盖内容')}</div>
                        <textarea
                          className="textarea"
                          style={{ minHeight: 82 }}
                          value={member.prompt}
                          onChange={(event) =>
                            patchMember(member.agentId, { prompt: event.target.value })
                          }
                        />
                      </div>
                    ) : null}
                    <div className="field-help" style={{ marginTop: 10 }}>
                      {!isLeader && agent?.instructionMode === 'leader'
                        ? t('ui.角色指令：')
                        : t('ui.初始 Prompt：')}
                      {effectivePrompt(
                        agentById.get(member.agentId),
                        member,
                        t,
                        isLeader,
                      ).slice(0, 120)}
                    </div>
                  </div>
                  )
                })}

                <div className="add-member" ref={addRef} style={{ marginTop: 12 }}>
                  <button
                    className="btn btn-sm add-member-btn"
                    aria-haspopup="menu"
                    aria-expanded={addOpen}
                    onClick={() => setAddOpen((current) => !current)}
                  >
                    <Icon name="plus" size={14} /> {t('ui.添加成员')}
                  </button>
                  {addOpen ? (
                    <div className="add-member-menu" role="menu">
                      {addableAgents.length === 0 ? (
                        <div className="add-member-empty">
                          {t('ui.没有可添加的智能体')}
                        </div>
                      ) : (
                        addableAgents.map((agent) => (
                          <button
                            className="add-member-item"
                            role="menuitem"
                            key={agent.id}
                            onClick={() => {
                              addMember(agent.id)
                              setAddOpen(false)
                            }}
                          >
                            <Avatar name={agent.name} src={agent.avatar} size={20} />
                            <span className="add-member-name">{agent.name}</span>
                            <span className="add-member-meta">
                              {agent.model ?? t('ui.由运行时管理')} ·{' '}
                              {runtimeById.get(agent.runtimeId)?.name ?? t('ui.未知')}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {tab === 'instructions' ? (
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="file-text" size={15} /> {t('ui.团队编排 Prompt')}
                </div>
                <div className="form-section-sub">
                  {t('ui.只提供给指挥者，用于规定它如何按能力派发成员、何时收敛。')}
                </div>
                <textarea
                  className="textarea mono"
                  style={{ minHeight: 300 }}
                  value={form.orchestrationPrompt}
                  onChange={(event) => patch({ orchestrationPrompt: event.target.value })}
                />
                <div className="field" style={{ marginTop: 14 }}>
                  <div className="field-label">{t('ui.最终生效预览（指挥者）')}</div>
                  <div className="prompt-preview">
                    {`${leader?.prompt ?? ''}\n\n${form.orchestrationPrompt}`.trim()}
                  </div>
                </div>
              </section>
            ) : null}
          </div>

          <aside className="preview-panel">
            <div className="preview-head">
              <Icon name="shield" size={14} /> {t('ui.校验与预览')}
            </div>
            <div className="team-summary">
              <div className="team-summary-title">{t('ui.团队名单（指挥者可见）')}</div>
              {form.members.map((member) => {
                const agent = agentById.get(member.agentId)
                return (
                  <div className="summary-row" key={member.agentId}>
                    <Avatar name={agent?.name ?? t('ui.未知')} src={agent?.avatar} size={20} />
                    <span style={{ flex: 1 }}>{agent?.name ?? t('ui.未知智能体')}</span>
                    <span style={{ fontSize: 9.5, color: 'var(--muted)' }}>
                      {member.agentId === form.leaderAgentId ? t('ui.指挥者') : t('ui.成员')}
                    </span>
                  </div>
                )
              })}
            </div>
            <div className="rp-note" style={{ marginTop: 10 }}>
              <strong style={{ color: 'var(--ink)' }}>{t('ui.提及语法')}</strong>
              <br />
              [@{leader?.name ?? t('ui.成员')}](mention://agent/&lt;id&gt;)
              <br />
              {t('ui.精确语法才会触发分派；纯文本 @ 不触发。')}
            </div>
            <div style={{ marginTop: 12 }}>
              {issues.length ? (
                issues.map((issue) => (
                  <span className="badge badge-red" style={{ margin: '0 4px 5px 0' }} key={issue}>
                    {issue}
                  </span>
                ))
              ) : (
                <span className="badge badge-green">
                  <Icon name="check" size={10} /> {t('ui.配置有效')}
                </span>
              )}
              <span className="badge">{t('ui.{{count}} 成员', { count: form.members.length })}</span>
              <span className="badge">{form.fanoutStrategy === 'parallel' ? t('ui.并发') : t('ui.串行')}</span>
            </div>
            <div className="rp-note">{t('ui.保存后下一次会话生效；正在运行的回合继续使用旧配置。')}</div>
          </aside>
        </div>
      </div>
    </div>
  )
}
