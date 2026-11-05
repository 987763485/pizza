import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Agent, McpServer, McpTransport } from '@shared/types'
import { useAppStore } from '../store'
import { Icon } from './Icon'
import { Modal } from './Modal'
import { localizeError } from '../locales/errors'

const TRANSPORT_LABEL: Record<McpTransport, string> = {
  stdio: 'stdio',
  sse: 'SSE',
  http: 'HTTP',
}

const STATUS_LABEL: Record<McpServer['status'], string> = {
  untested: '未测试',
  connected: '已连接',
  failed: '失败',
  disabled: '已停用',
}

interface ServerForm {
  name: string
  description: string
  transport: McpTransport
  command: string
  args: string
  url: string
  env: string
  headers: string
  timeoutMs: number
  enabled: boolean
}

const EMPTY_FORM: ServerForm = {
  name: '',
  description: '',
  transport: 'stdio',
  command: '',
  args: '',
  url: '',
  env: '',
  headers: '',
  timeoutMs: 20_000,
  enabled: true,
}

function parsePairs(value: string): Record<string, string> | undefined {
  const lines = value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length === 0) return undefined
  const result: Record<string, string> = {}
  for (const line of lines) {
    const index = line.indexOf('=')
    if (index <= 0) continue
    result[line.slice(0, index).trim()] = line.slice(index + 1).trim()
  }
  return result
}

export function McpSettings() {
  const { t } = useTranslation()
  const workspaceId = useAppStore((state) => state.currentWorkspaceId)
  const agents = useAppStore((state) => state.agents)
  const [servers, setServers] = useState<McpServer[]>([])
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<McpServer | 'new' | null>(null)
  const [detail, setDetail] = useState<McpServer | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<McpServer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [testing, setTesting] = useState<string | null>(null)

  async function refresh() {
    if (!workspaceId) return
    try {
      setServers(await window.pizza.mcp.list(workspaceId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    void refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return servers
    return servers.filter((server) =>
      `${server.name} ${server.description}`.toLowerCase().includes(keyword),
    )
  }, [query, servers])

  async function test(server: McpServer) {
    setTesting(server.id)
    try {
      const result = await window.pizza.mcp.test(server.id)
      if (!result.ok) {
        setError(t('ui.连接失败：{{error}}', { error: result.error ?? t('ui.未知错误') }))
      }
      await refresh()
      setDetail((current) =>
        current?.id === server.id
          ? (servers.find((item) => item.id === server.id) ?? current)
          : current,
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setTesting(null)
    }
  }

  async function toggle(server: McpServer) {
    try {
      await window.pizza.mcp.setEnabled(server.id, !server.enabled)
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function remove(server: McpServer) {
    try {
      await window.pizza.mcp.remove(server.id)
      setDeleteTarget(null)
      setDetail(null)
      await refresh()
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message.replace('MCP_IN_USE', t('ui.该服务仍被引用，请先解除绑定：'))
          : String(cause),
      )
    }
  }

  return (
    <>
      <h1 className="settings-title">{t('mcp.title')}</h1>
      <p className="settings-sub">{t('mcp.sub')}</p>
      <div className="toolbar">
        <input
          className="input"
          style={{ width: 260 }}
          placeholder={t('mcp.search')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span style={{ flex: 1 }} />
        <button className="btn btn-primary" onClick={() => setEditing('new')}>
          <Icon name="plus" size={14} /> {t('mcp.add')}
        </button>
      </div>

      <div className="settings-section">
        <div className="settings-card">
          {filtered.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-text">
                <div className="settings-row-title">{t('mcp.empty')}</div>
                <div className="settings-row-desc">{t('mcp.emptyHint')}</div>
              </div>
            </div>
          ) : (
            filtered.map((server) => (
              <div className="settings-row" key={server.id}>
                <div className="settings-row-text">
                  <div className="settings-row-title">
                    {server.name}
                    <span className="badge" style={{ marginLeft: 8 }}>
                      {TRANSPORT_LABEL[server.transport]}
                    </span>
                    <span
                      className={`status-dot ${server.status === 'connected' ? 'online' : server.status === 'failed' ? 'error' : ''}`}
                      style={{ marginLeft: 8 }}
                    />
                    <span className="settings-row-desc" style={{ marginLeft: 4 }}>
                      {t(`ui.${STATUS_LABEL[server.status]}`)}
                    </span>
                  </div>
                  <div className="settings-row-desc">
                    {server.description || server.command || server.url || t('ui.未配置连接信息')}
                    {server.tools.length > 0 ? ` · ${t('ui.{{count}} 个工具', { count: server.tools.length })}` : ''}
                  </div>
                </div>
                <div className="settings-row-control">
                  <button
                    className={`switch ${server.enabled ? 'on' : ''}`}
                    onClick={() => void toggle(server)}
                    aria-label={server.enabled ? t('ui.停用 MCP') : t('ui.启用 MCP')}
                  />
                  <button
                    className="btn btn-sm"
                    disabled={testing === server.id}
                    onClick={() => void test(server)}
                  >
                    {testing === server.id ? t('ui.测试中…') : t('ui.测试')}
                  </button>
                  <button className="btn btn-sm" onClick={() => setDetail(server)}>
                    {t('ui.详情')}
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditing(server)}>
                    {t('ui.编辑')}
                  </button>
                  <button
                    className="btn btn-sm btn-danger"
                    onClick={() => setDeleteTarget(server)}
                  >
                    {t('ui.删除')}
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {error ? (
        <div className="inline-error" role="alert">
          {localizeError(error)}
          <button className="icon-btn" onClick={() => setError(null)} aria-label={t('ui.关闭')}>
            <Icon name="x" size={12} />
          </button>
        </div>
      ) : null}

      {editing ? (
        <McpEditorModal
          server={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSubmit={async (form) => {
            if (!workspaceId) return
            const payload = {
              workspaceId,
              name: form.name.trim(),
              description: form.description.trim(),
              transport: form.transport,
              command: form.transport === 'stdio' ? form.command.trim() : undefined,
              args:
                form.transport === 'stdio'
                  ? form.args
                      .split('\n')
                      .map((line) => line.trim())
                      .filter(Boolean)
                  : [],
              url: form.transport === 'stdio' ? undefined : form.url.trim(),
              env: form.transport === 'stdio' ? parsePairs(form.env) : undefined,
              headers: form.transport === 'stdio' ? undefined : parsePairs(form.headers),
              timeoutMs: form.timeoutMs,
              enabled: form.enabled,
            }
            try {
              if (editing === 'new') {
                await window.pizza.mcp.create(payload)
              } else {
                await window.pizza.mcp.update(editing.id, payload)
              }
              setEditing(null)
              await refresh()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : String(cause))
            }
          }}
        />
      ) : null}

      {detail ? (
        <McpDetailModal
          server={detail}
          agents={agents}
          onClose={() => setDetail(null)}
          onTest={() => void test(detail)}
          testing={testing === detail.id}
        />
      ) : null}

      {deleteTarget ? (
        <Modal
          title={t('ui.删除 MCP 服务器')}
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
            {t('ui.删除「{{name}}」会移除本地配置与密钥；仍被智能体引用时会被阻止。', { name: deleteTarget.name })}
          </p>
        </Modal>
      ) : null}
    </>
  )
}

function McpEditorModal({
  server,
  onClose,
  onSubmit,
}: {
  server: McpServer | null
  onClose: () => void
  onSubmit: (form: ServerForm) => Promise<void>
}) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ServerForm>(() =>
    server
      ? {
          name: server.name,
          description: server.description,
          transport: server.transport,
          command: server.command ?? '',
          args: server.args.join('\n'),
          url: server.url ?? '',
          env: '',
          headers: '',
          timeoutMs: server.timeoutMs,
          enabled: server.enabled,
        }
      : EMPTY_FORM,
  )
  const [busy, setBusy] = useState(false)

  const disabled =
    busy ||
    !form.name.trim() ||
    (form.transport === 'stdio' ? !form.command.trim() : !form.url.trim())

  return (
    <Modal
      title={server ? t('ui.编辑 MCP 服务器') : t('ui.添加 MCP 服务器')}
      onClose={onClose}
      width={620}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            {t('ui.取消')}
          </button>
          <button
            className="btn btn-primary"
            disabled={disabled}
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit(form)
              } finally {
                setBusy(false)
              }
            }}
          >
            {server ? t('ui.保存修改') : t('ui.添加服务器')}
          </button>
        </>
      }
    >
      <div className="form-row">
        <div className="field-label">{t('ui.名称')}</div>
        <input
          className="input"
          value={form.name}
          placeholder={t('ui.例如：本机文件检索')}
          onChange={(event) =>
            setForm((current) => ({ ...current, name: event.target.value }))
          }
        />
      </div>
      <div className="form-row">
        <div className="field-label">{t('ui.描述')}</div>
        <input
          className="input"
          value={form.description}
          placeholder={t('ui.一句话说明这个服务提供什么')}
          onChange={(event) =>
            setForm((current) => ({ ...current, description: event.target.value }))
          }
        />
      </div>
      <div className="form-row">
        <div className="field-label">{t('ui.传输')}</div>
        <div className="segmented">
          {(['stdio', 'sse', 'http'] as const).map((value) => (
            <button
              key={value}
              className={form.transport === value ? 'active' : ''}
              onClick={() => setForm((current) => ({ ...current, transport: value }))}
            >
              {TRANSPORT_LABEL[value]}
            </button>
          ))}
        </div>
      </div>
      {form.transport === 'stdio' ? (
        <>
          <div className="form-row">
            <div className="field-label">{t('ui.启动命令')}</div>
            <input
              className="input"
              value={form.command}
              placeholder={t('ui.例如：npx -y @modelcontextprotocol/server-filesystem')}
              onChange={(event) =>
                setForm((current) => ({ ...current, command: event.target.value }))
              }
            />
          </div>
          <div className="form-row">
            <div className="field-label">{t('ui.参数')}</div>
            <textarea
              className="textarea"
              style={{ minHeight: 64 }}
              value={form.args}
              placeholder={t('ui.每行一个参数')}
              onChange={(event) =>
                setForm((current) => ({ ...current, args: event.target.value }))
              }
            />
          </div>
          <div className="form-row">
            <div className="field-label">{t('ui.环境变量')}</div>
            <textarea
              className="textarea"
              style={{ minHeight: 64 }}
              value={form.env}
              placeholder={
                server?.hasEnv
                  ? t('ui.已保存密钥；留空将清空，需要保留请重新输入')
                  : t('ui.每行 KEY=VALUE')
              }
              onChange={(event) =>
                setForm((current) => ({ ...current, env: event.target.value }))
              }
            />
          </div>
        </>
      ) : (
        <>
          <div className="form-row">
            <div className="field-label">{t('ui.服务 URL')}</div>
            <input
              className="input"
              value={form.url}
              placeholder="https://example.com/mcp"
              onChange={(event) =>
                setForm((current) => ({ ...current, url: event.target.value }))
              }
            />
          </div>
          <div className="form-row">
            <div className="field-label">{t('ui.请求 Header')}</div>
            <textarea
              className="textarea"
              style={{ minHeight: 64 }}
              value={form.headers}
              placeholder={
                server?.hasHeaders
                  ? t('ui.已保存密钥；留空将清空，需要保留请重新输入')
                  : t('ui.每行 KEY=VALUE')
              }
              onChange={(event) =>
                setForm((current) => ({ ...current, headers: event.target.value }))
              }
            />
          </div>
        </>
      )}
      <div className="form-row">
        <div className="field-label">{t('ui.超时（毫秒）')}</div>
        <input
          className="input"
          type="number"
          min={1000}
          max={300000}
          step={1000}
          value={form.timeoutMs}
          onChange={(event) =>
            setForm((current) => ({
              ...current,
              timeoutMs: Number(event.target.value) || 1000,
            }))
          }
        />
      </div>
      <div className="form-row">
        <div className="field-label">{t('ui.启用')}</div>
        <button
          className={`switch ${form.enabled ? 'on' : ''}`}
          onClick={() => setForm((current) => ({ ...current, enabled: !current.enabled }))}
          aria-label={t('ui.启用 MCP')}
        />
      </div>
      <p className="field-help">
        {t('ui.凭据只写不读：保存后界面只显示是否已配置，不会回显明文。')}
      </p>
    </Modal>
  )
}

function McpDetailModal({
  server,
  agents,
  onClose,
  onTest,
  testing,
}: {
  server: McpServer
  agents: Agent[]
  onClose: () => void
  onTest: () => void
  testing: boolean
}) {
  const { t } = useTranslation()
  const [preview, setPreview] = useState<string | null>(null)
  const [policies, setPolicies] = useState<Record<string, 'allow' | 'ask' | 'deny'>>({})

  useEffect(() => {
    void window.pizza.approval
      .policies(server.workspaceId)
      .then((list) =>
        setPolicies(
          Object.fromEntries(
            list
              .filter((policy) => !policy.agentId)
              .map((policy) => [policy.toolName, policy.decision]),
          ),
        ),
      )
  }, [server.workspaceId])

  async function setPolicy(toolName: string, decision: 'allow' | 'ask' | 'deny') {
    await window.pizza.approval.setPolicy({
      workspaceId: server.workspaceId,
      toolName,
      decision,
    })
    setPolicies((current) => ({ ...current, [toolName]: decision }))
  }

  async function showPreview() {
    const agent = agents[0]
    if (!agent) return
    const result = await window.pizza.skill.preview({
      workspaceId: server.workspaceId,
      agentId: agent.id,
    })
    setPreview(
      result.mcpServers
        .map(
          (item) =>
            `${item.name} · ${item.transport} · ${
              item.toolAllow.length ? item.toolAllow.join(', ') : t('ui.全部工具')
            }`,
        )
        .join('\n') || t('ui.没有生效的 MCP 服务'),
    )
  }

  return (
    <Modal
      title={`MCP · ${server.name}`}
      onClose={onClose}
      width={720}
      footer={
        <button className="btn" onClick={onClose}>
          {t('ui.关闭')}
        </button>
      }
    >
      <div className="settings-section">
        <div className="settings-section-title">{t('ui.连接与工具')}</div>
        <div className="settings-card" style={{ padding: 12 }}>
          <div className="settings-row">
            <div className="settings-row-text">
              <div className="settings-row-title">
                {STATUS_LABEL[server.status]}
                {server.lastError ? ` · ${server.lastError}` : ''}
              </div>
              <div className="settings-row-desc">
                {server.transport} · {t('ui.{{count}} 个工具', { count: server.tools.length })}
              </div>
            </div>
            <button className="btn btn-sm" disabled={testing} onClick={onTest}>
              {testing ? t('ui.测试中…') : t('ui.重新测试')}
            </button>
          </div>
          {server.tools.length === 0 ? (
            <div className="settings-row">
              <div className="settings-row-desc">
                {t('ui.尚未发现工具；连接失败不会显示为空工具列表。')}
              </div>
            </div>
          ) : (
            server.tools.map((tool) => {
              const toolName = `mcp__${server.name}__${tool.name}`
              const decision = policies[toolName] ?? 'ask'
              return (
                <div className="settings-row" key={tool.name}>
                  <div className="settings-row-text">
                    <div className="settings-row-title mono">{tool.name}</div>
                    <div className="settings-row-desc">{tool.description || t('ui.无描述')}</div>
                  </div>
                  <div className="settings-row-control">
                    <div className="segmented">
                      {(
                        [
                          ['ask', '询问'],
                          ['allow', '允许'],
                          ['deny', '禁止'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          key={value}
                          className={decision === value ? 'active' : ''}
                          onClick={() => void setPolicy(toolName, value)}
                        >
                          {t(`ui.${label}`)}
                        </button>
                      ))}
                    </div>
                    <details>
                      <summary className="settings-row-desc">{t('ui.参数 schema')}</summary>
                      <pre className="code-preview compact">
                        {JSON.stringify(tool.inputSchema, null, 2)}
                      </pre>
                    </details>
                  </div>
                </div>
              )
            })
          )}
          <div style={{ padding: 12 }}>
            <button className="btn btn-sm" onClick={() => void showPreview()}>
              {t('ui.预览第一个智能体的生效工具')}
            </button>
            {preview ? <pre className="code-preview compact">{preview}</pre> : null}
          </div>
        </div>
      </div>
      <McpBindings server={server} agents={agents} />
    </Modal>
  )
}

function McpBindings({ server, agents }: { server: McpServer; agents: Agent[] }) {
  const { t } = useTranslation()
  const teams = useAppStore((state) => state.teams)
  const [bound, setBound] = useState<Set<string>>(new Set())
  const [allow, setAllow] = useState<Record<string, string>>({})
  const [memberRows, setMemberRows] = useState<
    Array<{ memberId: string; label: string; bound: boolean }>
  >([])

  useEffect(() => {
    void Promise.all(
      agents.map(async (agent) => {
        const bindings = await window.pizza.mcp.bindings('agent', agent.id)
        const match = bindings.find((item) => item.targetId === server.id)
        return { agentId: agent.id, match }
      }),
    ).then((rows) => {
      setBound(new Set(rows.filter((row) => row.match?.enabled).map((row) => row.agentId)))
      setAllow(
        Object.fromEntries(
          rows
            .filter((row) => row.match)
            .map((row) => [row.agentId, (row.match?.toolAllow ?? []).join(', ')]),
        ),
      )
    })
  }, [agents, server.id])

  useEffect(() => {
    void Promise.all(
      teams.map(async (team) => {
        const detail = await window.pizza.team.get(team.id)
        return Promise.all(
          detail.members.map(async (member) => {
            const agent = agents.find((item) => item.id === member.agentId)
            const bindings = await window.pizza.mcp.bindings('team_member', member.id)
            return {
              memberId: member.id,
              label: `${detail.name} · ${agent?.name ?? member.agentId}`,
              bound: bindings.some((item) => item.targetId === server.id),
            }
          }),
        )
      }),
    ).then((groups) => setMemberRows(groups.flat()))
  }, [agents, teams, server.id])

  async function toggleMember(memberId: string, nextBound: boolean) {
    try {
      // 取消时写入 disabled 绑定，覆盖从工作区/智能体继承的挂载。
      await window.pizza.mcp.setBinding({
        serverId: server.id,
        scopeType: 'team_member',
        scopeId: memberId,
        enabled: nextBound,
      })
      setMemberRows((rows) =>
        rows.map((row) =>
          row.memberId === memberId ? { ...row, bound: nextBound } : row,
        ),
      )
    } catch {
      // 列表页会展示具体错误。
    }
  }

  async function save(agent: Agent, nextBound: boolean) {
    try {
      if (!nextBound) {
        await window.pizza.mcp.removeBinding({
          serverId: server.id,
          scopeType: 'agent',
          scopeId: agent.id,
        })
        setBound((current) => {
          const next = new Set(current)
          next.delete(agent.id)
          return next
        })
        return
      }
      const tools = (allow[agent.id] ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
      await window.pizza.mcp.setBinding({
        serverId: server.id,
        scopeType: 'agent',
        scopeId: agent.id,
        enabled: true,
        toolAllow: tools,
      })
      setBound((current) => new Set(current).add(agent.id))
    } catch {
      // 列表页会展示具体错误。
    }
  }

  return (
    <div className="settings-section">
      <div className="settings-section-title">{t('ui.绑定智能体与工具范围')}</div>
      <div className="settings-card">
        {agents.length === 0 ? (
          <div className="settings-row">
            <div className="settings-row-desc">{t('ui.还没有可绑定的智能体。')}</div>
          </div>
        ) : (
          agents.map((agent) => {
            const active = bound.has(agent.id)
            return (
              <div className="settings-row" key={agent.id}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{agent.name}</div>
                  <div className="settings-row-desc">
                    {t('ui.允许的工具名，逗号分隔；留空表示全部允许。')}
                  </div>
                </div>
                <div className="settings-row-control">
                  {active ? (
                    <input
                      className="input"
                      style={{ width: 220 }}
                      placeholder={t('ui.例如：search, read')}
                      value={allow[agent.id] ?? ''}
                      onChange={(event) =>
                        setAllow((current) => ({
                          ...current,
                          [agent.id]: event.target.value,
                        }))
                      }
                      onBlur={() => void save(agent, true)}
                    />
                  ) : null}
                  <button
                    className={`switch ${active ? 'on' : ''}`}
                    onClick={() => void save(agent, !active)}
                    aria-label={`${active ? t('ui.解绑') : t('ui.绑定')} ${agent.name}`}
                  />
                </div>
              </div>
            )
          })
        )}
        {memberRows.length > 0 ? (
          <>
            <div className="settings-section-title" style={{ paddingTop: 8 }}>
              {t('ui.团队成员')}
            </div>
            {memberRows.map((row) => (
              <div className="settings-row" key={row.memberId}>
                <div className="settings-row-text">
                  <div className="settings-row-title">{row.label}</div>
                  <div className="settings-row-desc">
                    {t('ui.团队成员级挂载优先于智能体绑定。')}
                  </div>
                </div>
                <div className="settings-row-control">
                  <button
                    className={`switch ${row.bound ? 'on' : ''}`}
                    onClick={() => void toggleMember(row.memberId, !row.bound)}
                    aria-label={`${row.bound ? t('ui.解绑') : t('ui.绑定')} ${row.label}`}
                  />
                </div>
              </div>
            ))}
          </>
        ) : null}
      </div>
    </div>
  )
}
