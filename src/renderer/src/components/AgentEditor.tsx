import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type {
  Agent,
  AgentInput,
  AgentInstructionMode,
  AgentTestResult,
  RuntimeModelInfo,
  ThinkingLevel,
} from '@shared/types'
import { useAppStore } from '../store'
import { cropSquareDataUrl, randomAvatar } from '../avatar'
import { Avatar } from './Avatar'
import { ConfigSelect, type ConfigSelectOption } from './ConfigSelect'
import { Icon, type IconName } from './Icon'
import { localizeError } from '../locales/errors'

interface AgentEditorProps {
  onOpenPage: (page: string) => void
}

type EditorTab = 'basic' | 'runtime' | 'instructions' | 'capabilities' | 'behavior'

const TABS: Array<[EditorTab, string, IconName]> = [
  ['basic', '基本资料', 'user'],
  ['runtime', '运行时', 'plug'],
  ['instructions', '指令', 'file-text'],
  ['capabilities', '能力', 'layers'],
  ['behavior', '行为', 'settings'],
]

const THINKING_LABELS: Array<[ThinkingLevel, string]> = [
  ['off', '关闭'],
  ['minimal', '最低'],
  ['low', '低'],
  ['medium', '中'],
  ['high', '高'],
  ['xhigh', '极高'],
  ['max', '最高'],
  ['ultra', '极限'],
]

/** 运行时没有声明强度集合时使用的标准五档。 */
const DEFAULT_THINKING_LEVELS: ThinkingLevel[] = [
  'minimal',
  'low',
  'medium',
  'high',
  'max',
]

interface FormState {
  name: string
  description: string
  avatar: string | null
  runtimeId: string
  prompt: string
  instructionMode: AgentInstructionMode
  thinkingLevel: ThinkingLevel
  contextLimit: number
  model: string | null
  maxConcurrency: number
}

function formFromAgent(agent: Agent): FormState {
  return {
    name: agent.name,
    description: agent.description,
    avatar: agent.avatar,
    runtimeId: agent.runtimeId,
    prompt: agent.prompt,
    instructionMode: agent.instructionMode,
    thinkingLevel: agent.thinkingLevel,
    contextLimit: agent.contextLimit,
    model: agent.model,
    maxConcurrency: agent.maxConcurrency,
  }
}

export function AgentEditor({ onOpenPage }: AgentEditorProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const id = searchParams.get('id')
  const agents = useAppStore((state) => state.agents)
  const runtimes = useAppStore((state) => state.runtimes)
  const settings = useAppStore((state) => state.settings)
  const refreshAgents = useAppStore((state) => state.refreshAgents)
  const refreshRuntimes = useAppStore((state) => state.refreshRuntimes)
  const agent = id ? agents.find((item) => item.id === id) ?? null : null
  const editing = !!id

  const [tab, setTab] = useState<EditorTab>('basic')
  const [form, setForm] = useState<FormState>(() =>
    agent
      ? formFromAgent(agent)
      : {
          name: '',
          description: '',
          avatar: null,
          runtimeId: '',
          prompt: t('ui.你是一个通用助手。先理解用户目标，再给出可执行、可验证的结果。需要时主动说明假设与风险。'),
          instructionMode: 'self',
          thinkingLevel: 'medium',
          contextLimit: 200_000,
          model: null,
          maxConcurrency: 3,
        },
  )
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [refreshingModels, setRefreshingModels] = useState(false)
  const [testResult, setTestResult] = useState<AgentTestResult | null>(null)
  const [previewTab, setPreviewTab] = useState<'prompt' | 'test'>('prompt')
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (agent) setForm(formFromAgent(agent))
  }, [agent])

  useEffect(() => {
    if (!form.runtimeId) {
      const preferred =
        runtimes.find((runtime) => runtime.status === 'online')?.id ?? runtimes[0]?.id ?? ''
      if (preferred) setForm((current) => ({ ...current, runtimeId: preferred }))
    }
  }, [form.runtimeId, runtimes])

  const selectedRuntime = runtimes.find((runtime) => runtime.id === form.runtimeId)
  const modelCatalog: RuntimeModelInfo[] = selectedRuntime?.capabilities.modelList?.length
    ? selectedRuntime.capabilities.modelList
    : (selectedRuntime?.capabilities.models ?? []).map((id) => ({ id, label: id }))
  const selectableModels = modelCatalog.filter((model) => !model.disabled)
  const modelGroups = (() => {
    const groups = new Map<string, RuntimeModelInfo[]>()
    for (const model of selectableModels) {
      const key = model.provider ?? ''
      const list = groups.get(key) ?? []
      list.push(model)
      groups.set(key, list)
    }
    return Array.from(groups.entries()).sort(([left], [right]) => {
      if (!left) return -1
      if (!right) return 1
      return left.localeCompare(right)
    })
  })()
  const selectedModelInfo = selectableModels.find((model) => model.id === form.model)
  // 只有运行时/模型明确声明了可选强度时，才用它替换标准五档；
  // 否则保留标准档并额外展示已保存的自定义档位。
  const declaredThinkingLevels = selectedModelInfo?.thinkingLevels?.length
    ? selectedModelInfo.thinkingLevels
    : selectedRuntime?.capabilities.thinkingLevels?.length
      ? selectedRuntime.capabilities.thinkingLevels
      : null
  const thinkingValues = declaredThinkingLevels ?? DEFAULT_THINKING_LEVELS
  const thinkingOptions: Array<[ThinkingLevel, string]> = thinkingValues.map((value) => {
    const known = THINKING_LABELS.find(([level]) => level === value)
    return [value as ThinkingLevel, known?.[1] ?? value]
  })
  if (
    !declaredThinkingLevels &&
    !thinkingOptions.some(([value]) => value === form.thinkingLevel)
  ) {
    const known = THINKING_LABELS.find(([level]) => level === form.thinkingLevel)
    thinkingOptions.push([form.thinkingLevel, known?.[1] ?? form.thinkingLevel])
  }
  const thinkingSupported =
    thinkingOptions.length > 0 && selectedRuntime?.capabilities.thinking !== false

  // 切换模型/运行时后，如果已保存的强度不被新目录支持，回落到模型默认或首档。
  const declaredThinkingKey = declaredThinkingLevels?.join('|') ?? ''
  useEffect(() => {
    if (!declaredThinkingLevels?.length) return
    if (declaredThinkingLevels.includes(form.thinkingLevel)) return
    const preferred = selectedModelInfo?.defaultThinkingLevel
    const next =
      preferred && declaredThinkingLevels.includes(preferred)
        ? preferred
        : declaredThinkingLevels[0]
    setForm((current) => ({ ...current, thinkingLevel: next as ThinkingLevel }))
    // declaredThinkingKey captures the current allowed set without array identity churn.
  }, [form.thinkingLevel, declaredThinkingKey])
  const selectedRuntimeName =
    selectedRuntime?.name ?? (form.runtimeId ? t('ui.未命名运行时') : t('ui.未绑定运行时'))

  const runtimeOptions: ConfigSelectOption[] = runtimes.map((runtime) => ({
    value: runtime.id,
    label: runtime.name,
    logoAdapter: runtime.adapter,
  }))
  if (form.runtimeId && !runtimes.some((runtime) => runtime.id === form.runtimeId)) {
    runtimeOptions.unshift({
      value: form.runtimeId,
      label: selectedRuntimeName,
      icon: 'plug',
    })
  }

  const modelSelectOptions: ConfigSelectOption[] = [
    { value: '', label: t('ui.由运行时管理'), icon: 'cpu' },
    ...modelGroups.flatMap(([provider, models]) =>
      models.map((model) => ({
        value: model.id,
        label: model.label,
        icon: 'cpu' as const,
        group: provider || undefined,
      })),
    ),
  ]
  if (form.model && !selectableModels.some((model) => model.id === form.model)) {
    modelSelectOptions.push({ value: form.model, label: form.model, icon: 'cpu' })
  }

  const thinkingSelectOptions: ConfigSelectOption[] = thinkingOptions.map(
    ([value, label]) => ({
      value,
      label: t(`ui.${label}`),
      icon: 'wand',
    }),
  )

  const previewText = useMemo(() => {
    if (form.instructionMode === 'leader') {
      return form.prompt.trim()
        ? `${t('ui.团队运行：由指挥者动态下发角色指令。')}\n\n${t('ui.单智能体兜底 Prompt：')}\n${form.prompt}`
        : t('ui.团队运行：由指挥者动态下发角色指令；单智能体使用通用兜底 Prompt。')
    }
    return form.prompt.trim()
      ? form.prompt
      : t('ui.你是 {{name}}，{{description}}', {
          name: form.name || t('ui.智能体'),
          description: form.description || t('ui.先理解任务，再给出可验证的结果。'),
        })
  }, [form.description, form.instructionMode, form.name, form.prompt, t])

  function selectRuntime(runtimeId: string) {
    const runtime = runtimes.find((item) => item.id === runtimeId)
    // 切换运行时后旧模型可能不属于新运行时；只有新目录明确包含时才保留。
    const catalog = runtime?.capabilities.modelList ?? []
    const model =
      form.model && catalog.some((item) => item.id === form.model) ? form.model : null
    const levels = runtime?.capabilities.thinkingLevels ?? []
    const thinkingLevel =
      levels.length === 0 || levels.includes(form.thinkingLevel)
        ? form.thinkingLevel
        : ((runtime?.capabilities.defaultThinkingLevel as ThinkingLevel | undefined) ??
          'medium')
    patch({ runtimeId, model, thinkingLevel })
  }

  async function refreshModelCatalog() {
    if (!selectedRuntime) return
    setRefreshingModels(true)
    setError(null)
    try {
      await window.pizza.runtime.models(selectedRuntime.id)
      await refreshRuntimes()
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(localizeError(message))
    } finally {
      setRefreshingModels(false)
    }
  }

  async function save() {
    if (!form.name.trim() || !form.runtimeId) {
      setError(t('ui.名称和运行时都是必填项'))
      return
    }
    if (form.instructionMode === 'self' && !form.prompt.trim()) {
      setError(t('ui.模式一需要填写初始 Prompt'))
      return
    }
    setSaving(true)
    setError(null)
    const input: AgentInput = {
      name: form.name,
      description: form.description,
      avatar: form.avatar,
      runtimeId: form.runtimeId,
      prompt: form.prompt,
      instructionMode: form.instructionMode,
      thinkingLevel: form.thinkingLevel,
      contextLimit: form.contextLimit,
      model: form.model,
      maxConcurrency: form.maxConcurrency,
    }
    try {
      if (agent) await window.pizza.agent.update(agent.id, input)
      else await window.pizza.agent.create(input)
      await refreshAgents()
      navigate('/settings/agents')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(
        message.includes('AGENT_NAME_EXISTS')
          ? t('ui.已有同名智能体')
          : message.includes('RUNTIME_NOT_READY')
            ? t('ui.绑定的运行时当前不可用')
            : message.includes('AGENT_PROMPT_REQUIRED')
              ? t('ui.模式一需要填写初始 Prompt')
              : message,
      )
    } finally {
      setSaving(false)
    }
  }

  async function testAgent() {
    if (!agent) return
    setTesting(true)
    setTestResult(null)
    setPreviewTab('test')
    try {
      setTestResult(await window.pizza.agent.test(agent.id))
    } catch (caught) {
      setTestResult({
        ok: false,
        text: '',
        runtimeName: '',
        durationMs: 0,
        error: caught instanceof Error ? caught.message : String(caught),
      })
    } finally {
      setTesting(false)
    }
  }

  async function duplicate() {
    if (!agent) return
    await window.pizza.agent.duplicate(agent.id)
    await refreshAgents()
    navigate('/settings/agents')
  }

  async function archive() {
    if (!agent) return
    await window.pizza.agent.archive(agent.id, true)
    await refreshAgents()
    navigate('/settings/agents')
  }

  function patch(patchValue: Partial<FormState>) {
    setForm((current) => ({ ...current, ...patchValue }))
    setError(null)
  }

  return (
    <>
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="icon-btn"
            onClick={() => navigate('/settings/agents')}
            title={t('ui.返回')}
            aria-label={t('ui.返回智能体列表')}
          >
            <Icon name="arrow-left" size={17} />
          </button>
          <div>
            <div className="page-eyebrow">Agents / {agent?.name ?? t('ui.新建')}</div>
            <h1 className="page-title">{editing ? t('ui.编辑智能体') : t('ui.新建智能体')}</h1>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => navigate('/settings/agents')}>
            {t('ui.取消')}
          </button>
          <button className="btn btn-primary" onClick={() => void save()} disabled={saving}>
            <Icon name="check" size={14} /> {saving ? t('ui.保存中…') : t('ui.保存')}
          </button>
        </div>
      </header>

      <div
        className="editor-layout"
        style={{ padding: 0, maxWidth: 'none', gridTemplateColumns: '180px minmax(0, 1fr) 310px' }}
      >
        <nav className="editor-nav">
          {TABS.map(([idValue, label, icon]) => (
            <button
              className={`editor-nav-item ${tab === idValue ? 'active' : ''}`}
              key={idValue}
              onClick={() => setTab(idValue)}
            >
              <Icon name={icon} size={15} /> {t(`ui.${label}`)}
              {idValue === 'instructions' ? <span className="badge">P0</span> : null}
            </button>
          ))}
          {agent ? (
            <>
              <div style={{ height: 1, background: 'var(--line)', margin: '8px 0' }} />
              <button className="editor-nav-item" onClick={() => void duplicate()}>
                <Icon name="copy" size={15} /> {t('ui.复制')}
              </button>
              <button
                className="editor-nav-item"
                style={{ color: 'var(--red)' }}
                onClick={() => void archive()}
              >
                <Icon name="archive" size={15} /> {t('ui.归档')}
              </button>
            </>
          ) : null}
        </nav>

        <div>
          {tab === 'basic' ? (
            <>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="user" size={15} /> {t('ui.身份')}
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.头像')}</div>
                  <div className="avatar-picker">
                    <button
                      className="avatar-preview"
                      title={t('ui.点击上传头像')}
                      onClick={() => fileRef.current?.click()}
                    >
                      <Avatar
                        name={form.name || t('ui.新智能体')}
                        src={form.avatar ?? randomAvatar(form.name || t('ui.新智能体'), 'preview')}
                        size={60}
                      />
                    </button>
                    <div>
                      <div className="avatar-actions">
                        <button
                          className="btn btn-sm"
                          onClick={() => patch({ avatar: randomAvatar(form.name || 'Pizza') })}
                        >
                          <Icon name="refresh" size={12} /> {t('ui.随机生成')}
                        </button>
                      </div>
                      <div className="field-help" style={{ marginTop: 7 }}>
                        {t('ui.点击预览上传方形图片（≤2MB）。')}
                      </div>
                    </div>
                  </div>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0]
                      if (!file) return
                      if (file.size > 2 * 1024 * 1024) {
                        setError(t('ui.头像图片不能超过 2 MB'))
                        return
                      }
                      try {
                        patch({ avatar: await cropSquareDataUrl(file) })
                      } catch {
                        setError(t('ui.头像图片读取失败'))
                      }
                      event.target.value = ''
                    }}
                  />
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.名称')}</div>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(event) => patch({ name: event.target.value })}
                    placeholder={t('ui.例如：架构师')}
                  />
                  <div className="field-help">{t('ui.会话内唯一；重名会自动追加序号。')}</div>
                </div>
                <div className="field">
                  <div className="field-label">
                    {t('ui.描述')} <span className="hint">{t('ui.用于指挥者选择成员')}</span>
                  </div>
                  <textarea
                    className="textarea"
                    style={{ minHeight: 76 }}
                    maxLength={500}
                    value={form.description}
                    onChange={(event) => patch({ description: event.target.value })}
                    placeholder={t('ui.一句话说明它适合接什么活')}
                  />
                </div>
                <div className="field">
                  <div className="field-label">
                    {t('ui.对话开场白')} <span className="hint">{t('ui.最多 3 条 · P1')}</span>
                  </div>
                  <div className="chip-list">
                    <span className="chip">
                      <Icon name="chat" size={12} /> {t('ui.先给我结论')}
                    </span>
                    <span className="chip">
                      <Icon name="chat" size={12} /> {t('ui.列出风险')}
                    </span>
                    <button className="chip" style={{ borderStyle: 'dashed', color: 'var(--muted)' }}>
                      <Icon name="plus" size={12} /> {t('ui.添加')}
                    </button>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {tab === 'runtime' ? (
            <section className="form-section">
              <div className="form-section-title">
                <Icon name="settings" size={15} /> {t('ui.执行配置')}
              </div>
              <div className="exec-config-card">
                <div className="exec-config-row">
                  <div className="exec-config-label">{t('ui.运行时')}</div>
                  <div className="exec-config-body">
                    <ConfigSelect
                      value={form.runtimeId}
                      options={runtimeOptions}
                      onChange={selectRuntime}
                      ariaLabel={t('ui.运行时')}
                      leadingLogoAdapter={selectedRuntime?.adapter}
                      leadingIcon={selectedRuntime ? undefined : 'plug'}
                      placeholder={t('ui.未绑定运行时')}
                      status={
                        selectedRuntime
                          ? selectedRuntime.status === 'online'
                            ? 'online'
                            : 'offline'
                          : null
                      }
                    />
                    <div className="exec-config-help">
                      {!runtimes.length
                        ? t('ui.还没有运行时，请先在设置 → 运行时中接入。')
                        : `${selectedRuntime?.protocol ?? 'CLI'} · ${
                            selectedRuntime?.command || t('ui.未配置启动命令')
                          }`}
                    </div>
                  </div>
                </div>

                <div className="exec-config-row">
                  <div className="exec-config-label">{t('ui.模型')}</div>
                  <div className="exec-config-body">
                    <ConfigSelect
                      value={form.model ?? ''}
                      options={modelSelectOptions}
                      searchable
                      searchPlaceholder={t('ui.搜索或输入模型 ID')}
                      allowCustomValue
                      customValueLabel={(id) => `${t('ui.使用模型 ID')} ${id}`}
                      refreshing={refreshingModels}
                      onRefresh={selectedRuntime ? () => void refreshModelCatalog() : undefined}
                      refreshLabel={t('ui.刷新模型')}
                      onChange={(value) => {
                        const model = selectableModels.find((item) => item.id === value)
                        const levels = model?.thinkingLevels?.length
                          ? model.thinkingLevels
                          : (selectedRuntime?.capabilities.thinkingLevels ?? [])
                        const preferred = model?.defaultThinkingLevel
                        const thinkingLevel =
                          levels.length === 0
                            ? form.thinkingLevel
                            : preferred && levels.includes(preferred)
                              ? (preferred as ThinkingLevel)
                              : levels.includes(form.thinkingLevel)
                                ? form.thinkingLevel
                                : (levels[0] as ThinkingLevel)
                        patch({ model: value || null, thinkingLevel })
                      }}
                      ariaLabel={t('ui.模型')}
                      leadingIcon="cpu"
                      placeholder={t('ui.由运行时管理')}
                    />
                  </div>
                </div>

                <div className="exec-config-row">
                  <div className="exec-config-label">{t('ui.思考')}</div>
                  <div className="exec-config-body">
                    <ConfigSelect
                      value={thinkingSupported ? form.thinkingLevel : ''}
                      options={thinkingSelectOptions}
                      onChange={(value) =>
                        patch({ thinkingLevel: value as ThinkingLevel })
                      }
                      ariaLabel={t('ui.思考强度')}
                      leadingIcon="wand"
                      placeholder={t('ui.不支持')}
                      disabled={!thinkingSupported}
                    />
                    {!thinkingSupported ? (
                      <div className="exec-config-help">
                        {t('ui.当前运行时未声明思考强度。')}
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="exec-config-row">
                  <div className="exec-config-label">{t('ui.并发')}</div>
                  <div className="exec-config-body">
                    <div className="exec-config-number-row">
                      <input
                        className="input exec-config-number"
                        type="number"
                        min={1}
                        max={10}
                        value={form.maxConcurrency}
                        aria-label={t('ui.并发')}
                        onChange={(event) => {
                          const next = Number(event.target.value)
                          patch({
                            maxConcurrency: Number.isFinite(next)
                              ? Math.min(10, Math.max(1, Math.trunc(next)))
                              : 3,
                          })
                        }}
                      />
                      <span className="exec-config-unit">{t('ui.个并行任务')}</span>
                    </div>
                    <div className="exec-config-help">
                      {t('ui.仅限制该智能体同时运行的任务数（1-10），与系统全局上限分别配置。')}
                    </div>
                  </div>
                </div>
              </div>

              <div className="field" style={{ marginTop: 18 }}>
                <div className="field-label">
                  {t('ui.自定义环境变量与参数')} <span className="hint">P1</span>
                </div>
                <div className="card" style={{ padding: 12, color: 'var(--muted)', fontSize: 11.5 }}>
                  {t('ui.未配置。敏感值保存在系统钥匙串，不写入日志。')}
                </div>
              </div>
            </section>
          ) : null}

          {tab === 'instructions' ? (
            <>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="file-text" size={15} /> {t('ui.指令来源')}
                </div>
                <div className="field">
                  {(['self', 'leader'] as const).map((mode) => {
                    const active = form.instructionMode === mode
                    return (
                      <label
                        className="card"
                        key={mode}
                        style={{
                          padding: 12,
                          display: 'flex',
                          gap: 10,
                          alignItems: 'flex-start',
                          marginTop: mode === 'leader' ? 7 : 0,
                          borderColor: active ? 'var(--line-strong)' : 'var(--line)',
                          cursor: 'pointer',
                        }}
                      >
                        <input
                          type="radio"
                          name="instruction-mode"
                          checked={active}
                          onChange={() => patch({ instructionMode: mode })}
                          style={{ marginTop: 3 }}
                        />
                        <div>
                          <div style={{ fontSize: 12, fontWeight: 600 }}>
                            {mode === 'self'
                              ? t('ui.模式一：自带初始 Prompt')
                              : t('ui.模式二：指挥者动态下发')}
                          </div>
                          <div className="field-help">
                            {mode === 'self'
                              ? t('ui.成员使用自己保存的角色、边界与输出格式。P0 默认。')
                              : t('ui.不预设角色 Prompt，每次由指挥者 @ 时下发完整角色指令与约束。')}
                          </div>
                        </div>
                      </label>
                    )
                  })}
                </div>
              </section>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="wand" size={15} />{' '}
                  {form.instructionMode === 'leader'
                    ? t('ui.单智能体兜底 Prompt（可选）')
                    : t('ui.初始 Prompt')}
                </div>
                <div className="field">
                  <textarea
                    className="textarea mono"
                    value={form.prompt}
                    onChange={(event) => patch({ prompt: event.target.value })}
                  />
                  <div className="field-help">
                    {form.instructionMode === 'leader'
                      ? t('ui.团队运行时由指挥者动态下发角色指令，不使用此内容；留空时单智能体使用通用兜底 Prompt。')
                      : t('ui.支持变量：{{team.name}}、{{team.roster}}、{{workspace.path}}、{{round}}。')}
                  </div>
                  <div className="chip-list" style={{ marginTop: 8 }}>
                    {['{{team.roster}}', '{{workspace.path}}', '{{round}}'].map((variable) => (
                      <button
                        className="chip"
                        key={variable}
                        onClick={() => patch({ prompt: `${form.prompt}\n${variable}` })}
                      >
                        {variable}
                      </button>
                    ))}
                  </div>
                </div>
                {form.instructionMode === 'self' ? (
                  <div className="field">
                    <div className="field-label">{t('ui.模板库')}</div>
                    <div className="chip-list">
                      {(['通用助手', '前端工程师', '评审者', '唱反调者'] as const).map((template) => (
                        <button
                          className="chip"
                          key={template}
                          onClick={() =>
                            patch({
                              prompt: t('ui.你是{{role}}。先理解目标，再给出可执行、可验证的结果。', {
                                role: t(`ui.${template}`),
                              }),
                            })
                          }
                        >
                          {t(`ui.${template}`)}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </section>
            </>
          ) : null}

          {tab === 'capabilities' ? (
            <>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="wand" size={15} /> Skill
                </div>
                <div className="form-section-sub">
                  {t('ui.Skill 是解决某一类工作的方法包；可挂载到多个智能体。')}
                </div>
                <div className="card" style={{ padding: '4px 12px' }}>
                  <div className="switch-row">
                    <div className="switch-text">
                      <div className="switch-title">{t('ui.尚未接入 Skill')}</div>
                      <div className="switch-desc">
                        {t('ui.Skill 管理将在能力设置变更中提供。')}
                      </div>
                    </div>
                    <span className="badge">{t('ui.规划中')}</span>
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <button className="btn btn-sm" onClick={() => onOpenPage('skills')}>
                    <Icon name="wand" size={13} /> {t('ui.管理工作区 Skill')}
                  </button>
                </div>
              </section>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="plug" size={15} /> {t('ui.MCP 工具')}
                </div>
                <div className="form-section-sub">
                  {t('ui.三层合并：智能体自有 > 工作区库绑定 > 运行时本地配置。')}
                </div>
                <div className="card" style={{ padding: '4px 12px' }}>
                  <div className="switch-row">
                    <div className="switch-text">
                      <div className="switch-title">{t('ui.尚未接入 MCP')}</div>
                      <div className="switch-desc">
                        {t('ui.MCP 服务器管理将在能力设置变更中提供。')}
                      </div>
                    </div>
                    <span className="badge">{t('ui.规划中')}</span>
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {tab === 'behavior' ? (
            <>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="settings" size={15} /> {t('ui.上下文')}
                </div>
                <div className="field">
                  <div className="field-label">
                    {t('ui.上下文压缩阈值')} <span className="hint">{t('ui.达到后摘要旧消息')}</span>
                  </div>
                  <div className="range-row">
                    <input
                      type="range"
                      min={100_000}
                      max={1_000_000}
                      step={100_000}
                      value={form.contextLimit}
                      onChange={(event) =>
                        patch({ contextLimit: Number(event.target.value) })
                      }
                    />
                    <span className="range-value">{form.contextLimit / 1000}k</span>
                  </div>
                  <div className="field-help">
                    {t('ui.永不压缩：当前任务、未决问题、产出物路径、用户要求保留的内容。')}
                  </div>
                </div>
                <div className="field-row">
                  <div className="field">
                    <div className="field-label">{t('ui.保留最近消息')}</div>
                    <input className="input" type="number" value={20} readOnly />
                  </div>
                  <div className="field">
                    <div className="field-label">{t('ui.单次运行超时')}</div>
                    <input className="input" value={t('ui.30 分钟')} readOnly />
                  </div>
                </div>
              </section>
              <section className="form-section">
                <div className="form-section-title">
                  <Icon name="shield" size={15} /> {t('ui.权限与审批')}
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.工作区访问')}</div>
                  <select className="select">
                    <option>{t('ui.仅当前工作目录')}</option>
                    <option>{t('ui.工作区根目录')}</option>
                  </select>
                </div>
                <div className="field">
                  <div className="field-label">{t('ui.危险工具调用')}</div>
                  <div className="segmented">
                    <button className="active">{t('ui.每次询问')}</button>
                    <button>{t('ui.总是允许')}</button>
                    <button>{t('ui.禁止')}</button>
                  </div>
                  <div className="field-help">
                    {t('ui.默认每次询问。拒绝会作为工具结果返回给智能体，并记入审计。')}
                  </div>
                </div>
              </section>
            </>
          ) : null}

          {error ? <div className="form-error">{localizeError(error)}</div> : null}
        </div>

        <aside className="preview-panel">
          <div className="preview-head">
            <Icon name="eye" size={14} /> {t('ui.最终生效配置')}
          </div>
          <div className="preview-tabs">
            <button
              className={`preview-tab ${previewTab === 'prompt' ? 'active' : ''}`}
              onClick={() => setPreviewTab('prompt')}
            >
              Prompt
            </button>
            <button
              className={`preview-tab ${previewTab === 'test' ? 'active' : ''}`}
              onClick={() => setPreviewTab('test')}
            >
              {t('ui.测试对话')}
            </button>
          </div>
          {previewTab === 'prompt' ? (
            <>
              <div className="prompt-preview">{previewText}</div>
              <div className="preview-meta">
                <span className="badge">{selectedRuntimeName}</span>
                <span className="badge">
                  {t('ui.思考')}{' '}
                  {t(`ui.${THINKING_LABELS.find(([value]) => value === form.thinkingLevel)?.[1] ?? form.thinkingLevel}`)}
                </span>
                <span className="badge">{form.contextLimit / 1000}k</span>
                <span className="badge">0 Skill</span>
                <span className="badge">0 MCP</span>
              </div>
            </>
          ) : (
            <div style={{ fontSize: 11.5, lineHeight: 1.7, color: 'var(--ink-2)' }}>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  background: 'var(--surface-2)',
                  marginBottom: 8,
                }}
              >
                {t('ui.帮我检查这段代码的边界条件。')}
              </div>
              <div
                style={{
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--line)',
                }}
              >
                {testResult ? (
                  <>
                    {testResult.ok ? testResult.text : testResult.error}
                    <br />
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                      {testResult.ok ? t('ui.测试通过') : t('ui.测试失败')}
                      {testResult.runtimeName ? ` · ${testResult.runtimeName}` : ''}
                      {testResult.durationMs ? ` · ${testResult.durationMs} ms` : ''}
                    </span>
                  </>
                ) : (
                  <>
                    {t('ui.我会先定位输入校验与失败路径，再给出最小修复建议。')}
                    <br />
                    <span style={{ color: 'var(--muted)', fontSize: 10 }}>
                      {t('ui.测试运行仅用于验证配置，不写入正式会话。')}
                    </span>
                  </>
                )}
              </div>
              <button
                className="btn btn-sm"
                style={{ marginTop: 10 }}
                disabled={!agent || testing}
                onClick={() => void testAgent()}
              >
                <Icon name="play" size={12} /> {testing ? t('ui.测试中…') : t('ui.发送测试')}
              </button>
            </div>
          )}
        </aside>
      </div>
    </>
  )
}
