/**
 * Runtime SDK 的公共契约。
 *
 * 这个目录刻意不依赖 Electron、SQLite 或渲染层类型，只使用 Node 标准库，
 * 以便后续用 Rust 等语言重写时可以直接照搬这里的状态机与协议语义。
 */

/** 协议族决定“怎么连”，运行时 ID 只决定默认命令与参数。 */
export type RuntimeFamily =
  | 'claude-cli'
  | 'acp'
  | 'pi-json'
  | 'codex-app-server'
  | 'dsh'
  | 'kimi'
  | 'plain-cli'

export type AdapterLifecycle = 'persistent' | 'per-turn'

/**
 * 一个运行时实例的启动参数。适配器本身无状态，同一个族可以服务多个运行时。
 *
 * `kind` 保留调用方的运行时 ID（如 `pi` / `omp`），只用于选择同族内的差异参数；
 * 调度器不读取它，也不依赖任何具体产品名。
 */
export interface RuntimeSpec {
  kind: string
  family: RuntimeFamily
  command?: string
  args: string[]
  cwd?: string
  env: Record<string, string>
  /** Pi/OMP 等基于会话文件的运行时使用的目录。 */
  sessionDir?: string
}

export interface AdapterProfile {
  family: RuntimeFamily
  /** persistent：进程跨 turn 复用；per-turn：每个 turn 重新拉起进程。 */
  lifecycle: AdapterLifecycle
  supportsResume: boolean
  supportsMidturnDelivery: boolean
  /** 冷启动经验成本，用于 LRU 回收时保留启动更贵的会话。 */
  startupCostMs: number
  startupTimeoutMs: number
  /** 一个进程最多承载多少个逻辑会话；当前适配器都是 1。 */
  maxSessionsPerProcess: number
}

/**
 * 运行时绑定的一个可选模型。
 *
 * `id` 是传给运行时的原始值：Claude 的 resolved model、Codex 的 slug、
 * Pi/OMP 的 `provider/model`、ACP 配置项的 value（可能是 JSON 字符串）。
 */
export interface RuntimeModelInfo {
  id: string
  label: string
  provider?: string
  description?: string
  default?: boolean
  disabled?: boolean
  /** 该模型支持的思考强度值；缺省表示运行时未声明或与模型无关。 */
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
}

export interface RuntimeModelCatalog {
  models: RuntimeModelInfo[]
  /** 运行时级别的思考强度选项，用于模型未单独声明时回退。 */
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
}

export interface TestStep {
  key: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'failed'
  detail?: string
}

export interface TestResult {
  ok: boolean
  steps: TestStep[]
  capabilities?: {
    protocolVersion?: string
    models?: string[]
    streaming?: boolean
    appendInput?: boolean
    mcp?: boolean
    remoteMcp?: boolean
    skills?: boolean
    thinking?: boolean
    latencyMs?: number
  }
  error?: string
}

export type NormalizedRuntimeEventType =
  | 'text_delta'
  | 'tool_started'
  | 'tool_updated'
  | 'tool_finished'
  | 'usage'
  | 'status'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface NormalizedRuntimeEvent {
  type: NormalizedRuntimeEventType
  payload: Record<string, unknown>
}

export interface RuntimeCapabilityInjection {
  /** Claude CLI 运行级插件目录。 */
  pluginDir?: string
  /** Claude CLI 的 `--mcp-config` 临时文件。 */
  mcpConfigPath?: string
  /** Claude CLI 的 `--settings` 临时文件（PreToolUse 审批 hook）。 */
  settingsPath?: string
  /** ACP `session/new` 的 MCP 列表；远程项只在运行时声明 remoteMcp 时出现。 */
  acpMcpServers?: Array<
    | {
        name: string
        command: string
        args: string[]
        env: Record<string, string>
      }
    | {
        name: string
        type: 'sse' | 'http'
        url: string
        headers: Record<string, string>
      }
  >
  /** 写入上下文的 Skill 清单。 */
  skillManifest?: string
}

export interface RuntimePermissionOption {
  optionId: string
  name: string
  kind?: string
}

export interface RuntimePermissionRequest {
  toolName: string
  toolInput: Record<string, unknown>
  options: RuntimePermissionOption[]
}

export interface RuntimePromptRequest {
  prompt: string
  systemPrompt: string
  /** 调用方的逻辑会话 ID；per-turn 适配器可能用它生成会话文件。 */
  sessionId: string
  /** 上一次运行返回的、适配器私有的会话标识。 */
  runtimeSessionId: string | null
  cwd: string
  model?: string | null
  thinkingLevel?: string
  attachmentPaths: string[]
  signal: AbortSignal
  onEvent: (event: NormalizedRuntimeEvent) => void
  capabilities?: RuntimeCapabilityInjection
  /** ACP/Codex 收到权限请求时回调调用方；返回 null 表示拒绝。 */
  requestPermission?: (request: RuntimePermissionRequest) => Promise<string | null>
}

export interface RuntimePromptResult {
  text: string
  runtimeSessionId: string | null
  tokensIn: number
  tokensOut: number
  cost: number
}

export interface RuntimeSession {
  prompt(request: RuntimePromptRequest): Promise<RuntimePromptResult>
  cancel(): void
  close(): void
  /** 进程型会话在子进程退出后返回 false，Actor 据此重建。 */
  alive?(): boolean
}

export interface RuntimeAdapter {
  readonly profile: AdapterProfile
  test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult>
  /**
   * 查询该运行时绑定/可用的模型与思考强度。
   *
   * 发现失败应返回空目录而不是抛错，调用方会保留手动填写模型的能力；
   * 只有真正需要用户处理的错误才向上抛。
   */
  listModels(spec: RuntimeSpec, signal?: AbortSignal): Promise<RuntimeModelCatalog>
  /**
   * 创建（或为 per-turn 适配器返回）一个逻辑会话。
   * persistent 适配器应在这里完成进程启动与握手，便于 Supervisor 计算启动成本。
   */
  openSession(spec: RuntimeSpec, signal?: AbortSignal): Promise<RuntimeSession>
}

export type ActorState =
  | 'dormant'
  | 'starting'
  | 'ready'
  | 'running'
  | 'cancelling'
  | 'failed'

export interface ActorSnapshot {
  key: string
  family: RuntimeFamily
  state: ActorState
  queued: number
  activeJobId: string | null
  lastActiveAt: number | null
  lastError: string | null
  warm: boolean
}

export type SchedulerEvent =
  | { type: 'state_changed'; key: string; state: ActorState; error?: string }
  | {
      type: 'queue_changed'
      key: string
      queued: number
      activeJobId: string | null
    }
  | { type: 'turn_started'; key: string; jobId: string; priority: number }
  | {
      type: 'turn_finished'
      key: string
      jobId: string
      ok: boolean
      durationMs: number
    }
  | { type: 'evicted'; key: string; reason: 'idle' | 'lru' | 'shutdown' }
  | { type: 'start_failed'; key: string; error: string }

export interface SupervisorSnapshot {
  actors: ActorSnapshot[]
  warm: number
  maxWarmSessions: number
  activeTurns: number
  maxConcurrentTurns: number
  activeStarts: number
  maxConcurrentStarts: number
  queuedTurns: number
}

export interface SupervisorOptions {
  /** 同时常驻的 persistent 运行时上限。 */
  maxWarmSessions?: number
  /** 同时冷启动的进程数，避免启动风暴。 */
  maxConcurrentStarts?: number
  /** 同时执行的 turn 上限（全局）。 */
  maxConcurrentTurns?: number
  /** 空闲回收阈值，默认 5 分钟。 */
  idleTimeoutMs?: number
  /** 空闲扫描间隔，默认 30 秒。 */
  idleSweepMs?: number
  /** 单个会话最多排队的任务数。 */
  maxQueuePerSession?: number
  /** 取消后等待协议级取消的宽限期，超时杀死进程树。 */
  cancelGraceMs?: number
}

/** 用户主动发送 > 团队指挥者 > 团队成员 > 后台任务。 */
export const PRIORITY = {
  foreground: 0,
  leader: 1,
  member: 2,
  background: 3,
} as const
