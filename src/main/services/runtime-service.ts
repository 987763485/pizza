import { safeStorage } from 'electron'
import type {
  RuntimeCapabilities,
  RuntimeConfig,
  RuntimeInput,
  RuntimePreset,
  RuntimeTestResult,
} from '@shared/types'
import { RUNTIME_PRESETS } from '@shared/types'
import type { Store } from '../db/store'
import { getRuntimeAdapter, testRuntime, toRuntimeSpec } from '../runtime/registry'
import type { SettingsService } from './settings-service'

function encryptEnv(env: Record<string, string>): Record<string, string> {
  if (!env || Object.keys(env).length === 0) return {}
  const json = JSON.stringify(env)
  if (safeStorage.isEncryptionAvailable()) {
    return { __encrypted: safeStorage.encryptString(json).toString('base64') }
  }
  // 在无系统钥匙串的平台上至少避免明文落库，并保留可恢复能力。
  return { __plain: Buffer.from(json, 'utf8').toString('base64') }
}

function decryptEnv(env: Record<string, string>): Record<string, string> {
  try {
    if (env.__encrypted) {
      return JSON.parse(
        safeStorage.decryptString(Buffer.from(env.__encrypted, 'base64')),
      ) as Record<string, string>
    }
    if (env.__plain) {
      return JSON.parse(
        Buffer.from(env.__plain, 'base64').toString('utf8'),
      ) as Record<string, string>
    }
  } catch {
    return {}
  }
  return env
}

function fingerprint(input: RuntimeInput): string {
  return JSON.stringify({
    name: input.name,
    adapter: input.adapter,
    protocol: input.protocol,
    transport: input.transport,
    command: input.command ?? '',
    args: input.args ?? [],
    cwd: input.cwd ?? '',
    url: input.url ?? '',
    env: input.env ?? {},
    timeoutMs: input.timeoutMs ?? 30_000,
    autoReconnect: input.autoReconnect !== false,
  })
}

function configFromInput(input: RuntimeInput): RuntimeConfig {
  return {
    id: 'test-runtime',
    name: input.name,
    adapter: input.adapter,
    protocol: input.protocol,
    transport: input.transport,
    command: input.command,
    args: input.args ?? [],
    cwd: input.cwd,
    url: input.url,
    env: input.env ?? {},
    timeoutMs: input.timeoutMs ?? 30_000,
    autoReconnect: input.autoReconnect !== false,
    status: 'draft',
    capabilities: {},
    createdAt: new Date().toISOString(),
  }
}

export class RuntimeService {
  private readonly tested = new Map<string, RuntimeCapabilities>()
  private readonly reconnectTimers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService,
  ) {}

  list(): RuntimeConfig[] {
    return this.store.listRuntimes().map((runtime) => ({
      ...runtime,
      hasEnv: Object.keys(runtime.env).length > 0,
      env: {},
    }))
  }

  getForRun(id: string): RuntimeConfig {
    const runtime = this.store.getRuntime(id)
    if (!runtime) throw new Error('RUNTIME_NOT_FOUND')
    return { ...runtime, env: decryptEnv(runtime.env) }
  }

  presets(): RuntimePreset[] {
    return RUNTIME_PRESETS
  }

  async test(input: RuntimeInput): Promise<RuntimeTestResult> {
    const config = configFromInput(input)
    const controller = new AbortController()
    // 连接测试不能短于协议族的启动预算（Codex app-server 可能超过 1 分钟）。
    const timeout = Math.max(
      config.timeoutMs,
      getRuntimeAdapter(config).profile.startupTimeoutMs,
    )
    const timer = setTimeout(() => controller.abort(), timeout)
    try {
      const result = await testRuntime(config, controller.signal)
      if (result.ok) {
        const capabilities = await this.discoverModels(config, controller.signal)
        if (capabilities) result.capabilities = capabilities
      }
      if (result.ok && result.capabilities) {
        this.tested.set(fingerprint(input), result.capabilities)
      }
      return result
    } finally {
      clearTimeout(timer)
    }
  }

  /**
   * 查询运行时当前绑定的全部模型，并把结果写回运行时能力。
   * 发现失败时保留旧目录，避免网络/登录波动把用户已选模型清空。
   */
  async refreshModels(id: string): Promise<RuntimeCapabilities> {
    const runtime = this.getForRun(id)
    const adapter = getRuntimeAdapter(runtime)
    const controller = new AbortController()
    const timer = setTimeout(
      () => controller.abort(),
      Math.max(runtime.timeoutMs, adapter.profile.startupTimeoutMs),
    )
    try {
      const catalog = await adapter.listModels(
        toRuntimeSpec(runtime),
        controller.signal,
      )
      const capabilities: RuntimeCapabilities = {
        ...runtime.capabilities,
        ...(catalog.models.length > 0
          ? {
              models: catalog.models.map((model) => model.id),
              modelList: catalog.models,
              thinking:
                runtime.capabilities.thinking === true ||
                Boolean(catalog.thinkingLevels?.length) ||
                catalog.models.some((model) => Boolean(model.thinkingLevels?.length)),
            }
          : {}),
        ...(catalog.thinkingLevels?.length
          ? { thinkingLevels: catalog.thinkingLevels }
          : {}),
        ...(catalog.defaultThinkingLevel
          ? { defaultThinkingLevel: catalog.defaultThinkingLevel }
          : {}),
      }
      this.store.setRuntimeStatus(id, runtime.status, capabilities)
      return capabilities
    } finally {
      clearTimeout(timer)
    }
  }

  private async discoverModels(
    config: RuntimeConfig,
    signal: AbortSignal,
  ): Promise<RuntimeCapabilities | null> {
    try {
      const adapter = getRuntimeAdapter(config)
      const catalog = await adapter.listModels(toRuntimeSpec(config), signal)
      if (catalog.models.length === 0) return null
      return {
        ...config.capabilities,
        models: catalog.models.map((model) => model.id),
        modelList: catalog.models,
        thinkingLevels: catalog.thinkingLevels,
        defaultThinkingLevel: catalog.defaultThinkingLevel,
        thinking:
          config.capabilities.thinking === true ||
          Boolean(catalog.thinkingLevels?.length) ||
          catalog.models.some((model) => Boolean(model.thinkingLevels?.length)),
      }
    } catch {
      // 模型发现是增强能力；失败时仍允许注册运行时并手动填写模型。
      return null
    }
  }

  create(input: RuntimeInput): RuntimeConfig {
    const capabilities = this.tested.get(fingerprint(input))
    if (!capabilities) throw new Error('RUNTIME_NOT_TESTED')

    const runtime = this.store.createRuntime({
      ...input,
      env: encryptEnv(input.env ?? {}),
    })
    this.store.setRuntimeStatus(runtime.id, 'online', capabilities)
    if (!this.settings.get().defaultRuntimeId) {
      this.settings.setDefaultRuntime(runtime.id)
    }
    this.tested.delete(fingerprint(input))
    return this.store.getRuntime(runtime.id) as RuntimeConfig
  }

  update(id: string, input: RuntimeInput): RuntimeConfig {
    const existing = this.store.getRuntime(id)
    if (!existing) throw new Error('RUNTIME_NOT_FOUND')
    const capabilities = this.tested.get(fingerprint(input))
    if (!capabilities) throw new Error('RUNTIME_NOT_TESTED')

    const preserveEnv =
      !input.env || Object.keys(input.env).length === 0
        ? existing.env
        : encryptEnv(input.env)
    const runtime = this.store.updateRuntime(id, {
      ...input,
      env: preserveEnv,
    })
    this.store.setRuntimeStatus(runtime.id, 'online', capabilities)
    this.tested.delete(fingerprint(input))
    return this.store.getRuntime(id) as RuntimeConfig
  }

  remove(id: string): void {
    this.store.deleteRuntime(id)
    if (this.settings.get().defaultRuntimeId === id) {
      this.settings.setDefaultRuntime(null)
    }
  }

  setStatus(
    id: string,
    status: RuntimeConfig['status'],
    capabilities?: RuntimeCapabilities,
  ): void {
    this.store.setRuntimeStatus(id, status, capabilities)
  }

  async reconnect(id: string): Promise<RuntimeTestResult> {
    const runtime = this.getForRun(id)
    const input: RuntimeInput = {
      name: runtime.name,
      adapter: runtime.adapter,
      protocol: runtime.protocol,
      transport: runtime.transport,
      command: runtime.command,
      args: runtime.args,
      cwd: runtime.cwd,
      url: runtime.url,
      env: runtime.env,
      timeoutMs: runtime.timeoutMs,
      autoReconnect: runtime.autoReconnect,
    }
    const result = await this.test(input)
    this.tested.delete(fingerprint(input))
    if (result.ok) {
      this.store.setRuntimeStatus(id, 'online', result.capabilities)
    } else {
      this.store.setRuntimeStatus(id, 'offline')
    }
    return result
  }

  // 运行失败后按退避策略尝试恢复；最多 3 次，成功后停止。
  // 仅当用户没有关闭自动重连时调度，避免对不稳定的 CLI 无休止拉起。
  scheduleReconnect(id: string): void {
    const runtime = this.store.getRuntime(id)
    if (!runtime?.autoReconnect || this.reconnectTimers.has(id)) return

    let attempt = 0
    const tick = async () => {
      attempt += 1
      const result = await this.reconnect(id)
      if (result.ok) {
        this.reconnectTimers.delete(id)
        return
      }
      if (attempt >= 3) {
        this.reconnectTimers.delete(id)
        return
      }
      const timer = setTimeout(() => void tick(), 3_000 * attempt)
      this.reconnectTimers.set(id, timer)
    }

    const timer = setTimeout(() => void tick(), 3_000)
    this.reconnectTimers.set(id, timer)
  }

  dispose(): void {
    for (const timer of this.reconnectTimers.values()) clearTimeout(timer)
    this.reconnectTimers.clear()
  }
}
