import type {
  CapabilityBinding,
  EffectiveMcpServer,
  McpBindingInput,
  McpServer,
  McpServerInput,
  McpTestResult,
  McpToolInfo,
} from '@shared/types'
import type { CapabilityStore } from '../db/capability-store'
import type { SecretBox } from './secret-box'

export interface McpConnection {
  tools: McpToolInfo[]
  close: () => Promise<void>
}

/** 把 SDK 依赖隔离在连接器后面，测试可以注入假实现。 */
export interface McpConnector {
  connect(
    server: EffectiveMcpServer,
    timeoutMs: number,
  ): Promise<McpConnection>
}

const DEFAULT_TIMEOUT_MS = 20_000

function normalizeTools(
  tools: Array<{ name?: unknown; description?: unknown; inputSchema?: unknown }>,
): McpToolInfo[] {
  return tools
    .filter((tool) => typeof tool.name === 'string' && tool.name)
    .map((tool) => ({
      name: String(tool.name),
      description: typeof tool.description === 'string' ? tool.description : '',
      inputSchema:
        tool.inputSchema && typeof tool.inputSchema === 'object'
          ? (tool.inputSchema as Record<string, unknown>)
          : { type: 'object' },
    }))
}

export class McpService {
  constructor(
    private readonly store: CapabilityStore,
    private readonly secrets: SecretBox,
    private readonly connector: McpConnector,
  ) {}

  list(workspaceId: string): McpServer[] {
    return this.store.listMcpServers(workspaceId)
  }

  create(input: McpServerInput): McpServer {
    this.validate(input)
    if (this.store.findMcpByName(input.workspaceId, input.name)) {
      throw new Error(`MCP_EXISTS: ${input.name}`)
    }
    const server = this.store.createMcpServer({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description ?? '',
      transport: input.transport,
      command: input.command?.trim() || null,
      args: input.args ?? [],
      url: input.url?.trim() || null,
      timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      envEncrypted: input.env ? this.encryptRecord(input.env) : null,
      headersEncrypted: input.headers ? this.encryptRecord(input.headers) : null,
      enabled: input.enabled ?? true,
    })
    this.audit(input.workspaceId, 'mcp.create', server.id, {
      name: server.name,
      transport: server.transport,
      hasEnv: server.hasEnv,
      hasHeaders: server.hasHeaders,
    })
    return server
  }

  update(id: string, input: McpServerInput): McpServer {
    const current = this.store.getMcpServer(id)
    if (!current) throw new Error('MCP_NOT_FOUND')
    this.validate(input)
    const duplicate = this.store.findMcpByName(input.workspaceId, input.name)
    if (duplicate && duplicate.id !== id) throw new Error(`MCP_EXISTS: ${input.name}`)

    // 修改按整体替换语义：未提供敏感字段表示清空，避免旧密钥被发送到新 URL。
    const envEncrypted = input.env ? this.encryptRecord(input.env) : null
    const headersEncrypted = input.headers ? this.encryptRecord(input.headers) : null

    const updated =
      this.store.updateMcpServer(id, {
        workspaceId: input.workspaceId,
        name: input.name,
        description: input.description ?? '',
        transport: input.transport,
        command: input.command?.trim() || null,
        args: input.args ?? [],
        url: input.url?.trim() || null,
        timeoutMs: input.timeoutMs ?? current.timeoutMs,
        envEncrypted,
        headersEncrypted,
        enabled: input.enabled ?? current.enabled,
        status: 'untested',
        tools: [],
        lastError: null,
        lastTestedAt: null,
      }) ?? current
    this.audit(input.workspaceId, 'mcp.update', id, {
      name: updated.name,
      transport: updated.transport,
      hasEnv: updated.hasEnv,
      hasHeaders: updated.hasHeaders,
    })
    return updated
  }

  setEnabled(id: string, enabled: boolean): McpServer {
    const server = this.store.getMcpServer(id)
    if (!server) throw new Error('MCP_NOT_FOUND')
    this.store.setMcpEnabled(id, enabled)
    this.audit(server.workspaceId, enabled ? 'mcp.enable' : 'mcp.disable', id, {
      name: server.name,
    })
    return this.store.getMcpServer(id) as McpServer
  }

  remove(id: string): void {
    const server = this.store.getMcpServer(id)
    if (!server) throw new Error('MCP_NOT_FOUND')
    const references = this.store.countMcpBindings(id)
    if (references > 0) throw new Error(`MCP_IN_USE: ${references}`)
    this.store.deleteMcpServer(id)
    this.audit(server.workspaceId, 'mcp.delete', id, { name: server.name })
  }

  async test(id: string): Promise<McpTestResult> {
    const server = this.store.getMcpServer(id)
    if (!server) throw new Error('MCP_NOT_FOUND')
    if (!server.enabled) {
      return { ok: false, tools: [], error: 'MCP 服务已停用', durationMs: 0 }
    }

    const started = Date.now()
    try {
      const launch = await this.launchConfig(id)
      const connection = await this.connector.connect(launch, launch.timeoutMs)
      try {
        this.store.updateMcpStatus(id, 'connected', connection.tools, null)
        this.audit(server.workspaceId, 'mcp.test', id, {
          ok: true,
          toolCount: connection.tools.length,
        })
        return { ok: true, tools: connection.tools, durationMs: Date.now() - started }
      } finally {
        await connection.close().catch(() => undefined)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.store.updateMcpStatus(id, 'failed', [], message)
      this.audit(server.workspaceId, 'mcp.test', id, { ok: false, error: message.slice(0, 200) })
      return { ok: false, tools: [], error: message, durationMs: Date.now() - started }
    }
  }

  bindings(scopeType: CapabilityBinding['scopeType'], scopeId: string): CapabilityBinding[] {
    return this.store.listMcpBindings(scopeType, scopeId)
  }

  setBinding(input: McpBindingInput): CapabilityBinding {
    if (!this.store.getMcpServer(input.serverId)) throw new Error('MCP_NOT_FOUND')
    return this.store.upsertMcpBinding(input)
  }

  removeBinding(input: McpBindingInput): void {
    this.store.removeMcpBinding(input.serverId, input.scopeType, input.scopeId)
  }

  /** 解析成运行时注入格式；读取时解密凭据，调用方不能把结果写日志。 */
  async launchConfig(id: string): Promise<EffectiveMcpServer> {
    const server = this.store.getMcpServer(id)
    if (!server) throw new Error('MCP_NOT_FOUND')
    const secrets = this.store.getMcpSecrets(id)
    this.audit(server.workspaceId, 'mcp.read', id, { name: server.name })
    return {
      id: server.id,
      name: server.name,
      transport: server.transport,
      command: server.command,
      args: server.args,
      url: server.url,
      timeoutMs: server.timeoutMs,
      env: this.decryptRecord(secrets.envEncrypted),
      headers: this.decryptRecord(secrets.headersEncrypted),
      toolAllow: [],
      toolDeny: [],
      source: 'runtime',
    }
  }

  async launchConfigWithBinding(binding: CapabilityBinding): Promise<EffectiveMcpServer> {
    const config = await this.launchConfig(binding.targetId)
    return {
      ...config,
      toolAllow: binding.toolAllow,
      toolDeny: binding.toolDeny,
      source: binding.scopeType,
    }
  }

  /** 读取时只返回掩码字段，供渲染层展示是否已经配置。 */
  static maskRecord(value: Record<string, string>): Record<string, string> {
    return Object.fromEntries(
      Object.keys(value).map((key) => [key, '••••••••']),
    )
  }

  static summarizeToolInput(input: Record<string, unknown>): string {
    const sensitive = /token|secret|password|key|authorization|cookie/i
    const entries = Object.entries(input).slice(0, 8)
    const parts = entries.map(([key, value]) => {
      if (sensitive.test(key)) return `${key}: ••••`
      const text =
        typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
      return `${key}: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`
    })
    return parts.join(', ').slice(0, 800)
  }

  private validate(input: McpServerInput): void {
    if (input.transport === 'stdio') {
      if (!input.command?.trim()) throw new Error('stdio 传输需要启动命令')
      return
    }
    if (!input.url?.trim()) throw new Error(`${input.transport} 传输需要 URL`)
    let url: URL
    try {
      url = new URL(input.url)
    } catch {
      throw new Error('MCP URL 格式无效')
    }
    if (!['http:', 'https:'].includes(url.protocol)) {
      throw new Error('MCP URL 必须是 http(s)')
    }
  }

  private audit(
    workspaceId: string,
    action: string,
    targetId: string | null,
    detail: Record<string, unknown>,
  ): void {
    // 只写字段名、状态与计数；密钥和完整 URL 不进入审计。
    this.store.addAudit({
      workspaceId,
      action,
      targetType: 'mcp',
      targetId,
      detail,
    })
  }

  private encryptRecord(value: Record<string, string>): string {
    return this.secrets.encrypt(JSON.stringify(value))
  }

  private decryptRecord(value: string | null): Record<string, string> {
    if (!value) return {}
    try {
      const parsed = JSON.parse(this.secrets.decrypt(value)) as unknown
      return parsed && typeof parsed === 'object'
        ? (parsed as Record<string, string>)
        : {}
    } catch (error) {
      // 不能用空对象伪装“无凭据”，否则运行会在认证失败时难以诊断。
      throw new Error(
        `MCP_CREDENTIAL_DECRYPT_FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      )
    }
  }
}

export { normalizeTools }
