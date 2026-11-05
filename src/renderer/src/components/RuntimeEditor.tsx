import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import type {
  RuntimeAdapterId,
  RuntimeInput,
  RuntimeProtocol,
  RuntimeTestResult,
  RuntimeTransport,
} from '@shared/types'
import { RUNTIME_PRESETS } from '@shared/types'
import { useAppStore } from '../store'
import { Icon } from './Icon'
import { RuntimeLogo } from './RuntimeLogo'
import { seedRuntimeForm, type RuntimeFormState as FormState } from '../runtime-form'
import { localizeError } from '../locales/errors'

const ADAPTER_SUBS: Record<RuntimeAdapterId, string> = {
  'claude-code': 'CLI · stream-json',
  acp: 'ACP · stdio',
  codex: 'CLI · app-server',
  pi: 'CLI · 会话文件',
  omp: 'CLI · Pi 协议族',
  dsh: 'ACP · dsh',
  hermes: 'ACP · stdio',
  opencode: 'ACP · stdio',
  'qoder-cn': 'CLI · stream-json',
  gemini: 'ACP · stdio',
  kimi: 'CLI · stream-json',
  custom: '自定义传输',
}

// 与原型一致的适配器展示顺序；数据层仍以 RUNTIME_PRESETS 为准。
const ADAPTER_ORDER: RuntimeAdapterId[] = [
  'claude-code',
  'codex',
  'pi',
  'omp',
  'dsh',
  'hermes',
  'opencode',
  'qoder-cn',
  'gemini',
  'kimi',
  'acp',
  'custom',
]

function parseArgs(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

function parseEnv(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of text.split('\n')) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    env[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return env
}

function inputFromForm(form: FormState): RuntimeInput {
  return {
    name: form.name.trim(),
    adapter: form.adapter,
    protocol: form.protocol,
    transport: form.transport,
    command: form.command.trim() || undefined,
    args: parseArgs(form.argsText),
    cwd: form.cwd.trim() || undefined,
    url: form.url.trim() || undefined,
    env: parseEnv(form.envText),
    timeoutMs: form.timeoutMs,
    autoReconnect: form.autoReconnect,
  }
}

export function RuntimeEditor() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const id = searchParams.get('id')
  const requestedAdapter = searchParams.get('adapter') as RuntimeAdapterId | null
  const requestedCommand = searchParams.get('command')
  const runtimes = useAppStore((state) => state.runtimes)
  const refreshRuntimes = useAppStore((state) => state.refreshRuntimes)
  const editing = id ? runtimes.find((runtime) => runtime.id === id) ?? null : null

  const [form, setForm] = useState<FormState>(() => {
    if (editing) {
      return {
        name: editing.name,
        adapter: editing.adapter,
        protocol: editing.protocol,
        transport: editing.transport,
        command: editing.command ?? '',
        argsText: editing.args.join('\n'),
        cwd: editing.cwd ?? '',
        url: editing.url ?? '',
        envText: '',
        timeoutMs: editing.timeoutMs,
        autoReconnect: editing.autoReconnect,
      }
    }
    return seedRuntimeForm(requestedAdapter, requestedCommand)
  })
  const [testResult, setTestResult] = useState<RuntimeTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setTestResult(null)
  }, [form])

  function patch(value: Partial<FormState>) {
    setForm((current) => ({ ...current, ...value }))
    setError(null)
  }

  function selectAdapter(adapter: RuntimeAdapterId) {
    const preset = RUNTIME_PRESETS.find((item) => item.adapter === adapter)
    if (!preset) return
    patch({
      adapter,
      protocol: preset.protocol,
      transport: preset.transport,
      command: preset.command ?? '',
      argsText: preset.args.join('\n'),
      name: editing?.name ?? preset.name,
    })
  }

  async function test() {
    setTesting(true)
    setTestResult(null)
    setError(null)
    try {
      setTestResult(await window.pizza.runtime.test(inputFromForm(form)))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!form.name.trim()) {
      setError(t('ui.请填写运行时名称'))
      return
    }
    if (!testResult?.ok) {
      setError(t('ui.请先完成并通过连接测试'))
      return
    }
    setSaving(true)
    setError(null)
    try {
      if (editing) await window.pizza.runtime.update(editing.id, inputFromForm(form))
      else await window.pizza.runtime.create(inputFromForm(form))
      await refreshRuntimes()
      navigate('/settings/runtimes')
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught)
      setError(
        message.includes('RUNTIME_NOT_TESTED')
          ? t('ui.连接测试已失效，请重新测试后再保存')
          : message,
      )
    } finally {
      setSaving(false)
    }
  }

  const orderedPresets = [...RUNTIME_PRESETS].sort(
    (a, b) => ADAPTER_ORDER.indexOf(a.adapter) - ADAPTER_ORDER.indexOf(b.adapter),
  )
  const urlPlaceholder =
    form.transport === 'websocket'
      ? 'ws://127.0.0.1:4317/acp'
      : form.transport === 'http'
        ? 'http://127.0.0.1:4317/acp'
        : t('ui.stdio 使用命令启动，无需地址')
  const steps =
    testResult?.steps ??
    [
      { key: 'start', label: t('ui.启动进程 / 建立连接'), status: 'pending' as const },
      { key: 'initialize', label: t('ui.握手与版本协商'), status: 'pending' as const },
      { key: 'session', label: t('ui.创建临时会话'), status: 'pending' as const },
      { key: 'message', label: t('ui.发送测试消息'), status: 'pending' as const },
      { key: 'cleanup', label: t('ui.清理临时会话'), status: 'pending' as const },
    ]

  return (
    <>
      <header className="page-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            className="icon-btn"
            onClick={() => navigate('/settings/runtimes')}
            title={t('ui.返回')}
            aria-label={t('ui.返回运行时列表')}
          >
            <Icon name="arrow-left" size={17} />
          </button>
          <div>
            <div className="page-eyebrow">Runtimes / {editing ? t('ui.编辑') : t('ui.添加')}</div>
            <h1 className="page-title">{editing ? t('ui.编辑运行时') : t('ui.接入运行时')}</h1>
            <p className="page-sub">
              {editing
                ? t('ui.修改接入配置；测试通过后保存。')
                : t('ui.测试通过后才能注册；注册后即可被智能体绑定。')}
            </p>
          </div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost" onClick={() => navigate('/settings/runtimes')}>
            {t('ui.取消')}
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={saving || !testResult?.ok}
          >
            <Icon name="check" size={14} />{' '}
            {saving ? t('ui.保存中…') : editing ? t('ui.保存修改') : t('ui.注册运行时')}
          </button>
        </div>
      </header>

      <div className="card adapter-picker" style={{ padding: 18 }}>
        <div className="field">
          <div className="field-label">
            {t('ui.适配器')}
            <span className="hint">{t('ui.选择内置适配器预设，下方可继续调整连接参数')}</span>
          </div>
          <div className="adapter-grid">
            {orderedPresets.map((preset) => (
              <button
                className="member-card"
                key={preset.adapter}
                style={{
                  margin: 0,
                  textAlign: 'left',
                  cursor: 'pointer',
                  borderColor: form.adapter === preset.adapter ? 'var(--ink)' : 'var(--line)',
                  background:
                    form.adapter === preset.adapter ? 'var(--surface-2)' : 'var(--surface)',
                }}
                onClick={() => selectAdapter(preset.adapter)}
              >
                <span className="runtime-icon">
                  <RuntimeLogo adapter={preset.adapter} size={20} />
                </span>
                <span className="member-info">
                  <span className="member-name">{preset.name}</span>
                  <span className="member-desc">{t(`ui.${ADAPTER_SUBS[preset.adapter]}`)}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="acp-layout">
        <div className="card" style={{ padding: 18 }}>
          <div className="field">
            <div className="field-label">{t('ui.名称')}</div>
            <input
              className="input"
              value={form.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>
          <div className="field-row">
            <div className="field">
              <div className="field-label">{t('ui.传输方式')}</div>
              <div className="segmented" style={{ width: '100%' }}>
                {(
                  [
                    ['stdio', 'stdio'],
                    ['websocket', 'WebSocket'],
                    ['http', 'HTTP'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    style={{ flex: 1 }}
                    className={form.transport === value ? 'active' : ''}
                    onClick={() => patch({ transport: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <div className="field-label">{t('ui.超时（秒）')}</div>
              <input
                className="input"
                type="number"
                min={1}
                max={600}
                value={Math.round(form.timeoutMs / 1000)}
                onChange={(event) =>
                  patch({
                    timeoutMs: Math.min(
                      600_000,
                      Math.max(1_000, (Number(event.target.value) || 30) * 1000),
                    ),
                  })
                }
              />
            </div>
          </div>
          <div className="field">
            <div className="field-label">
              {t('ui.ACP 连接地址')}{' '}
              <span className="hint">
                {form.transport === 'stdio' ? t('ui.stdio 无需地址') : 'WebSocket / HTTP'}
              </span>
            </div>
            <input
              className="input mono"
              style={{ fontSize: 11.5 }}
              value={form.url}
              onChange={(event) => patch({ url: event.target.value })}
              placeholder={urlPlaceholder}
              disabled={form.transport === 'stdio'}
            />
          </div>
          <div className="field">
            <div className="field-label">{t('ui.命令')}</div>
            <input
              className="input mono"
              style={{ fontSize: 11.5 }}
              value={form.command}
              onChange={(event) => patch({ command: event.target.value })}
              placeholder={t('ui.例如：npx -y @scope/acp-adapter')}
            />
          </div>
          <div className="field">
            <div className="field-label">
              {t('ui.初始测试命令')} <span className="hint">{t('ui.每行一个参数')}</span>
            </div>
            <textarea
              className="textarea mono runtime-args"
              value={form.argsText}
              onChange={(event) => patch({ argsText: event.target.value })}
              placeholder="--model&#10;default"
            />
          </div>
          <div className="field">
            <div className="field-label">
              {t('ui.环境变量')} <span className="hint">{t('ui.值保存到系统钥匙串')}</span>
            </div>
            <textarea
              className="textarea mono runtime-args"
              value={form.envText}
              onChange={(event) => patch({ envText: event.target.value })}
              placeholder={t('ui.未配置。可添加 API Key、代理或运行时专用变量。')}
            />
            {editing?.hasEnv ? (
              <div className="field-help">
                {t('ui.已保存的环境变量不会回显。留空保存会保留原值；重新填写会整体替换。')}
              </div>
            ) : null}
          </div>
          <div className="switch-row">
            <div className="switch-text">
              <div className="switch-title">{t('ui.自动重连')}</div>
              <div className="switch-desc">{t('ui.断线后按退避策略重连，不自动重放失败任务。')}</div>
            </div>
            <button
              className={`switch ${form.autoReconnect ? 'on' : ''}`}
              onClick={() => patch({ autoReconnect: !form.autoReconnect })}
              aria-label={t('ui.自动重连')}
            />
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 14 }}
            onClick={() => void test()}
            disabled={testing}
          >
            <Icon name={testing ? 'loader' : 'flask'} size={14} />{' '}
            {testing ? t('ui.测试中…') : t('ui.测试连接')}
          </button>
          <div className="field-help" style={{ marginTop: 8 }}>
            {t('ui.协议：{{protocol}} · 工作目录：{{cwd}}', { protocol: form.protocol, cwd: form.cwd || t('ui.会话工作区') })}
          </div>
          {error ? <div className="form-error">{localizeError(error)}</div> : null}
        </div>

        <div className="test-console">
          <div className="test-console-head">
            <span
              className={`status-dot ${
                testResult?.ok ? 'online' : testing ? 'running' : 'offline'
              }`}
            />
            {t('ui.连接控制台')}
            <span style={{ marginLeft: 'auto', fontWeight: 400, opacity: 0.55 }}>
              {form.adapter}
            </span>
          </div>
          <div className="test-steps">
            {steps.map((step, index) => {
              const state =
                testResult?.ok || (testResult && step.status === 'ok')
                  ? 'success'
                  : step.status === 'running'
                    ? 'running'
                    : step.status === 'failed'
                      ? 'failed'
                      : ''
              return (
                <div className={`test-step ${state}`} key={step.key}>
                  <span className="step-dot">
                    {state === 'success'
                      ? '✓'
                      : state === 'failed'
                        ? '!'
                        : state === 'running'
                          ? '·'
                          : index + 1}
                  </span>
                  <span>{step.label}</span>
                  <span
                    className="step-time"
                    title={step.detail}
                  >
                    {state === 'success'
                      ? `${(0.1 + index * 0.3).toFixed(1)}s`
                      : state === 'running'
                        ? t('ui.进行中')
                        : state === 'failed'
                          ? (step.detail ?? t('ui.失败')).slice(0, 80)
                          : t('ui.等待')}
                  </span>
                </div>
              )
            })}
          </div>
          {testResult?.ok ? (
            <div className="test-result">
              <strong>{t('ui.连接成功')}</strong> · {t('ui.协议握手完成')}
              {testResult.capabilities?.latencyMs !== undefined
                ? ` · ${t('ui.往返 {{ms}}ms', { ms: testResult.capabilities.latencyMs })}`
                : ''}
              <div className="capability-grid">
                <div className="capability">
                  <b>{t('ui.协议版本')}</b>
                  {testResult.capabilities?.protocolVersion || 'ACP'}
                </div>
                <div className="capability">
                  <b>{t('ui.流式输出')}</b>
                  {testResult.capabilities?.streaming ? t('ui.支持') : t('ui.未声明')}
                </div>
                <div className="capability">
                  <b>MCP</b>
                  {testResult.capabilities?.mcp ? t('ui.支持') : t('ui.未声明')}
                </div>
                <div className="capability">
                  <b>Skill</b>
                  {testResult.capabilities?.skills ? t('ui.支持') : t('ui.未声明')}
                </div>
              </div>
            </div>
          ) : testResult ? (
            <div className="test-result test-error">
              <strong>{t('ui.连接失败')}</strong>
              <div>{testResult.error || t('ui.请检查命令和运行时登录状态。')}</div>
            </div>
          ) : (
            <div className="test-result" style={{ opacity: 0.7 }}>
              {t('ui.点击「测试连接」后，会依次执行握手、创建临时会话与测试消息。成功后才能注册。')}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
