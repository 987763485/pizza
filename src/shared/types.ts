export type RuntimeAdapterId =
  | 'claude-code'
  | 'acp'
  | 'codex'
  | 'pi'
  | 'omp'
  | 'dsh'
  | 'hermes'
  | 'opencode'
  | 'qoder-cn'
  | 'gemini'
  | 'kimi'
  | 'custom'

export type RuntimeProtocol = 'ACP' | 'CLI'
export type RuntimeTransport = 'stdio' | 'websocket' | 'http'
export type RuntimeStatus = 'draft' | 'testing' | 'online' | 'offline' | 'error'

/**
 * 运行时绑定的可选模型。
 *
 * `id` 是直接传给运行时的原始值（Claude 的 resolved model、Codex 的 slug、
 * Pi/OMP 的 provider/model、ACP 配置项的 value）。与 SDK 的 RuntimeModelInfo
 * 保持结构一致。
 */
export interface RuntimeModelInfo {
  id: string
  label: string
  provider?: string
  description?: string
  default?: boolean
  disabled?: boolean
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
}

export interface RuntimeCapabilities {
  protocolVersion?: string
  /** 兼容旧数据：模型 id 列表；新代码优先读取 modelList。 */
  models?: string[]
  /** 运行时可用的完整模型目录，包含标签、提供方与强度。 */
  modelList?: RuntimeModelInfo[]
  /** 运行时级别的思考强度选项（模型未单独声明时使用）。 */
  thinkingLevels?: string[]
  defaultThinkingLevel?: string
  streaming?: boolean
  appendInput?: boolean
  mcp?: boolean
  /** ACP 运行时是否支持 SSE/HTTP 远程 MCP；不支持时只注入 stdio。 */
  remoteMcp?: boolean
  skills?: boolean
  thinking?: boolean
  latencyMs?: number
}

export interface RuntimeConfig {
  id: string
  name: string
  adapter: RuntimeAdapterId
  protocol: RuntimeProtocol
  transport: RuntimeTransport
  command?: string
  args: string[]
  cwd?: string
  url?: string
  env: Record<string, string>
  timeoutMs: number
  autoReconnect: boolean
  status: RuntimeStatus
  capabilities: RuntimeCapabilities
  hasEnv?: boolean
  lastConnectedAt?: string
  createdAt: string
}

export interface RuntimeInput {
  name: string
  adapter: RuntimeAdapterId
  protocol: RuntimeProtocol
  transport: RuntimeTransport
  command?: string
  args?: string[]
  cwd?: string
  url?: string
  env?: Record<string, string>
  timeoutMs?: number
  autoReconnect?: boolean
}

export interface Workspace {
  id: string
  name: string
  rootPath: string
  isDefault: boolean
  createdAt: string
}

export type ThinkingLevel =
  | 'off'
  | 'minimal'
  | 'low'
  | 'medium'
  | 'high'
  | 'xhigh'
  | 'max'
  | 'ultra'

/**
 * 智能体的指令来源：
 * - self：使用自己保存的初始 Prompt；
 * - leader：作为团队成员时由指挥者在每次 @ 时动态下发角色指令。
 */
export type AgentInstructionMode = 'self' | 'leader'

export interface Agent {
  id: string
  name: string
  description: string
  avatar: string | null
  runtimeId: string
  prompt: string
  instructionMode: AgentInstructionMode
  thinkingLevel: ThinkingLevel
  contextLimit: number
  model: string | null
  /** 该智能体同时运行的任务上限；与系统全局并发上限相互独立。 */
  maxConcurrency: number
  isArchived: boolean
  createdAt: string
  updatedAt: string
}

export interface AgentTestResult {
  ok: boolean
  text: string
  runtimeName: string
  durationMs: number
  error?: string
}

export interface AgentInput {
  name: string
  description?: string
  avatar?: string | null
  runtimeId: string
  prompt: string
  instructionMode?: AgentInstructionMode
  thinkingLevel?: ThinkingLevel
  contextLimit?: number
  model?: string | null
  maxConcurrency?: number
}

export type SessionMode = 'agent' | 'team'
export type SessionStatus = 'idle' | 'running' | 'waiting_user' | 'error'
export type InterjectionMode = 'queue' | 'immediate'

export interface Session {
  id: string
  workspaceId: string
  title: string
  mode: SessionMode
  agentId: string | null
  teamId: string | null
  workspacePath: string
  status: SessionStatus
  unread: boolean
  interjectionMode: InterjectionMode
  forkedFromId: string | null
  runtimeSessionId: string | null
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}

export interface SessionSummary extends Session {
  agentName: string | null
  agentAvatar: string | null
  teamName: string | null
  teamAvatar: string | null
  messageCount: number
  lastMessage: string | null
}

export type MessageSenderType = 'user' | 'agent' | 'system'
export type MessageStatus =
  | 'queued'
  | 'running'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface Attachment {
  id: string
  messageId: string | null
  name: string
  path: string
  mime: string
  size: number
  createdAt: string
}

export interface AttachmentInput {
  name: string
  mime: string
  data: Uint8Array
}

export interface Message {
  id: string
  sessionId: string
  senderType: MessageSenderType
  senderAgentId: string | null
  content: string
  contentFormat: 'markdown' | 'plain'
  replyToId: string | null
  status: MessageStatus
  roundNo: number
  createdAt: string
  updatedAt: string
  attachments: Attachment[]
  mentions: MessageMention[]
}

export type FanoutStrategy = 'parallel' | 'serial'
export type PromptOverrideMode = 'inherit' | 'append' | 'replace'

export interface TeamCapabilityOverrides {
  skills: string[]
  mcpServers: string[]
}

export interface TeamMember {
  id: string
  teamId: string
  agentId: string
  position: number
  role: string
  promptMode: PromptOverrideMode
  prompt: string
  capabilityOverrides: TeamCapabilityOverrides
  createdAt: string
}

export interface TeamMemberInput {
  agentId: string
  role?: string
  promptMode?: PromptOverrideMode
  prompt?: string
  capabilityOverrides?: Partial<TeamCapabilityOverrides>
}

export interface Team {
  id: string
  workspaceId: string
  name: string
  description: string
  avatar: string | null
  leaderAgentId: string
  orchestrationPrompt: string
  fanoutStrategy: FanoutStrategy
  maxConcurrency: number
  /** 单回合派发上限，仅用于防止 @ 循环失控，不是参与策略。 */
  maxHops: number
  tokenBudget: number
  isArchived: boolean
  deletedAt: string | null
  lastUsedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TeamDetail extends Team {
  members: TeamMember[]
}

export interface TeamInput {
  workspaceId: string
  name: string
  description?: string
  avatar?: string | null
  leaderAgentId: string
  orchestrationPrompt?: string
  fanoutStrategy?: FanoutStrategy
  maxConcurrency?: number
  maxHops?: number
  tokenBudget?: number
  members: TeamMemberInput[]
}

export interface TeamSummary extends Team {
  memberCount: number
  sessionCount: number
  leaderName: string | null
  leaderAvatar: string | null
  memberAvatars: Array<{ id: string; name: string; avatar: string | null }>
}

export interface TeamParticipant {
  agent: Agent
  role: 'leader' | 'member'
  roleDescription: string
  position: number
}

export type MentionTargetType = 'agent' | 'user' | 'unknown'

export interface MessageMention {
  id: string
  messageId: string
  targetType: MentionTargetType
  targetAgentId: string | null
  displayName: string
  start: number
  end: number
  raw: string
  resolved: boolean
  createdAt: string
}

export type TeamTurnStatus =
  | 'dispatching'
  | 'debating'
  | 'waiting_user'
  | 'converging'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface TeamTurn {
  id: string
  sessionId: string
  seq: number
  status: TeamTurnStatus
  triggerMessageId: string
  leaderAgentId: string
  startedAt: string
  endedAt: string | null
  convergenceReason: string | null
  hops: number
  rounds: number
  tokensIn: number
  tokensOut: number
  error: string | null
  createdAt: string
}

export type TeamTurnEventType =
  | 'turn_started'
  | 'dispatch'
  | 'run_started'
  | 'run_completed'
  | 'run_failed'
  | 'run_cancelled'
  | 'user_interjection'
  | 'waiting_user'
  | 'protection_triggered'
  | 'converging'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_cancelled'
  | 'turn_interrupted'
  | 'mention_ignored'
  | 'notice'

export interface TeamTurnEvent {
  id: number
  turnId: string
  seq: number
  type: TeamTurnEventType
  participantAgentId: string | null
  runId: string | null
  payload: Record<string, unknown>
  createdAt: string
}

export interface SessionDetail extends Session {
  agent: Agent | null
  team: TeamDetail | null
  participants: TeamParticipant[]
  messages: Message[]
  artifacts: Artifact[]
}

export type RunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timeout'

export interface Run {
  id: string
  sessionId: string
  triggerMessageId: string
  agentId: string
  parentRunId: string | null
  teamTurnId: string | null
  status: RunStatus
  startedAt: string | null
  endedAt: string | null
  error: string | null
  tokensIn: number
  tokensOut: number
  cost: number
  createdAt: string
}

export type RunEventType =
  | 'text_delta'
  | 'tool_started'
  | 'tool_updated'
  | 'tool_finished'
  | 'usage'
  | 'status'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RunEvent {
  runId: string
  seq: number
  type: RunEventType
  payload: Record<string, unknown>
}

export type ArtifactKind = 'added' | 'modified' | 'info'

export interface Artifact {
  id: string
  sessionId: string
  runId: string | null
  agentId: string | null
  path: string
  kind: ArtifactKind
  title: string
  createdAt: string
}

export type EditorId =
  | 'system'
  | 'finder'
  | 'cursor'
  | 'vscode'
  | 'zed'
  | 'sublimetext'
  | 'xcode'
  | 'idea'
  | 'goland'
  | 'rustrover'
  | 'sourcetree'
  | 'warp'
  | 'terminal'

export interface EditorOption {
  id: EditorId
  name: string
  /** 应用图标（PNG data URL）；无法提取时为 null，由界面回退到线性图标。 */
  icon: string | null
}

export type FontSize = 'compact' | 'standard' | 'comfortable'
export type Density = 'compact' | 'comfortable'
export type LogLevel = 'error' | 'warn' | 'info' | 'debug'
export type MotionPreference = 'system' | 'reduce' | 'full'

export interface NotificationPreferences {
  enabled: boolean
  system: boolean
  sound: boolean
  doNotDisturb: boolean
}

export interface AppSettings {
  currentWorkspaceId: string | null
  defaultWorkspacePath: string
  defaultRuntimeId: string | null
  defaultEditor: EditorId
  theme: 'light' | 'dark' | 'system'
  language: 'zh-CN' | 'en'
  maxConcurrency: number
  logLevel: LogLevel
  autoUpdate: boolean
  anonymousStats: boolean
  fontSize: FontSize
  density: Density
  reducedMotion: MotionPreference
  profileName: string
  profileAbout: string
  profileAvatar: string | null
  notifications: NotificationPreferences
  onboardingCompleted: boolean
  /** 生效中的数据目录；由主进程在启动时解析。 */
  dataDir: string
  /** 已确认但尚未在下次启动切换的数据目录。 */
  pendingDataDir: string | null
  dataDirError: string | null
}

// ---------- 能力：Skill ----------

export type SkillSourceType = 'builtin' | 'local' | 'zip' | 'git' | 'manual'
export type SkillConflictStrategy = 'stop' | 'overwrite' | 'rename' | 'skip'
export type CapabilityScopeType = 'agent' | 'team_member' | 'workspace'

export interface Skill {
  id: string
  workspaceId: string
  name: string
  description: string
  version: string
  sourceType: SkillSourceType
  sourceRef: string | null
  tags: string[]
  enabled: boolean
  builtin: boolean
  fileCount: number
  createdAt: string
  updatedAt: string
}

export interface SkillReference {
  scopeType: CapabilityScopeType
  scopeId: string
  name: string
}

export interface SkillDetail extends Skill {
  files: string[]
  references: SkillReference[]
}

export interface SkillImportInput {
  workspaceId: string
  sourceType: Exclude<SkillSourceType, 'builtin' | 'manual'>
  /** 本地目录或 ZIP 的绝对路径。 */
  sourcePath?: string
  /** Git 仓库地址。 */
  gitUrl?: string
  name?: string
  tags?: string[]
  conflict?: SkillConflictStrategy
  /** 导入后是否立即启用；默认保持原有行为（启用）。 */
  enabled?: boolean
}

export interface SkillUpdateInput {
  name?: string
  description?: string
  tags?: string[]
  enabled?: boolean
}

export interface SkillBindingInput {
  skillId: string
  scopeType: CapabilityScopeType
  scopeId: string
  enabled?: boolean
}

// ---------- 能力：MCP ----------

export type McpTransport = 'stdio' | 'sse' | 'http'
export type McpServerStatus = 'untested' | 'connected' | 'failed' | 'disabled'

export interface McpToolInfo {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface McpServer {
  id: string
  workspaceId: string
  name: string
  description: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
  timeoutMs: number
  hasEnv: boolean
  hasHeaders: boolean
  enabled: boolean
  status: McpServerStatus
  tools: McpToolInfo[]
  lastError: string | null
  lastTestedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface McpServerInput {
  workspaceId: string
  name: string
  description?: string
  transport: McpTransport
  command?: string
  args?: string[]
  url?: string
  env?: Record<string, string>
  headers?: Record<string, string>
  timeoutMs?: number
  enabled?: boolean
}

export interface McpTestResult {
  ok: boolean
  tools: McpToolInfo[]
  error?: string
  durationMs: number
}

export interface McpBindingInput {
  serverId: string
  scopeType: CapabilityScopeType
  scopeId: string
  enabled?: boolean
  toolAllow?: string[]
  toolDeny?: string[]
}

export interface CapabilityBinding {
  id: string
  kind: 'skill' | 'mcp'
  targetId: string
  scopeType: CapabilityScopeType
  scopeId: string
  enabled: boolean
  toolAllow: string[]
  toolDeny: string[]
  createdAt: string
}

// ---------- 能力：解析结果 ----------

export interface EffectiveSkill {
  id: string
  name: string
  description: string
  version: string
  path: string
  builtin: boolean
  sourceType: SkillSourceType
}

export interface EffectiveMcpServer {
  id: string
  name: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
  timeoutMs: number
  env: Record<string, string>
  headers: Record<string, string>
  toolAllow: string[]
  toolDeny: string[]
  /** 最终生效来源：智能体 > 工作区 > 团队成员 > 运行时本地配置。 */
  source: 'agent' | 'workspace' | 'team_member' | 'runtime'
}

export interface CapabilityDiagnostic {
  capability: 'skill' | 'mcp'
  target: string
  message: string
}

export interface CapabilityPreview {
  skills: EffectiveSkill[]
  mcpServers: EffectiveMcpServer[]
  diagnostics: CapabilityDiagnostic[]
}

// ---------- 审批 ----------

export type ApprovalRisk = 'low' | 'medium' | 'high'
export type ApprovalDecision = 'allow_once' | 'always_allow' | 'deny'
export type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'timeout' | 'cancelled'
export type ApprovalPolicyDecision = 'allow' | 'ask' | 'deny'

export interface ApprovalRequest {
  id: string
  runId: string | null
  sessionId: string
  agentId: string | null
  agentName: string | null
  toolName: string
  toolInputSummary: string
  risk: ApprovalRisk
  policySource: string
  status: ApprovalStatus
  decision: ApprovalDecision | null
  createdAt: string
  expiresAt: string
}

export interface ApprovalPolicy {
  id: string
  workspaceId: string
  agentId: string | null
  toolName: string
  decision: ApprovalPolicyDecision
  scope: string
  createdAt: string
}

export interface ApprovalDecisionInput {
  approvalId: string
  decision: ApprovalDecision
}

// ---------- 通知 ----------

export type NotificationStatus = 'pending' | 'read'

export interface AppNotification {
  id: string
  workspaceId: string
  sessionId: string
  sessionTitle: string | null
  messageId: string | null
  kind: 'mention'
  title: string
  body: string
  status: NotificationStatus
  createdAt: string
  readAt: string | null
}

// ---------- 首次启动 ----------

export interface RuntimeDetection {
  adapter: RuntimeAdapterId
  name: string
  command: string
  installed: boolean
  version: string | null
  needsLogin: boolean
  path: string | null
}

export interface DataDirStatus {
  current: string
  pending: string | null
  error: string | null
  restartRequired: boolean
}

export interface AppInfo {
  version: string
  /** 构建号；开发环境为 dev。 */
  build: string
  platform: string
  dataDir: string
}

export interface RuntimeTestStep {
  key: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'failed'
  detail?: string
}

export interface RuntimeTestResult {
  ok: boolean
  steps: RuntimeTestStep[]
  capabilities?: RuntimeCapabilities
  error?: string
}

export interface RuntimePreset {
  adapter: RuntimeAdapterId
  name: string
  protocol: RuntimeProtocol
  transport: RuntimeTransport
  command?: string
  args: string[]
  description: string
}

export const RUNTIME_PRESETS: RuntimePreset[] = [
  {
    adapter: 'claude-code',
    name: 'Claude Code',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'claude',
    args: [],
    description: '使用本机 Claude Code CLI，支持流式输出与工具调用',
  },
  {
    adapter: 'hermes',
    name: 'Hermes',
    protocol: 'ACP',
    transport: 'stdio',
    command: 'hermes',
    args: ['acp'],
    description: '通过 ACP stdio 连接 Hermes',
  },
  {
    adapter: 'codex',
    name: 'Codex',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'codex',
    args: ['app-server', '--listen', 'stdio://'],
    description: '通过 codex app-server 接入，复用线程并支持 turn/interrupt',
  },
  {
    adapter: 'pi',
    name: 'Pi',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'pi',
    args: [],
    description: 'Pi JSON 事件协议，按会话文件恢复上下文',
  },
  {
    adapter: 'omp',
    name: 'Oh My Pi',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'omp',
    args: [],
    description: '复用 Pi 协议族，支持 OMP 原生会话文件',
  },
  {
    adapter: 'dsh',
    name: 'DeepSeek Harness',
    protocol: 'ACP',
    transport: 'stdio',
    command: 'dsh',
    args: ['--profile', 'acp'],
    description: '通过 DSH 的 ACP profile 接入；自定义 JSONL profile 请切换为 CLI',
  },
  {
    adapter: 'opencode',
    name: 'OpenCode',
    protocol: 'ACP',
    transport: 'stdio',
    command: 'opencode',
    args: ['acp'],
    description: '通过 OpenCode ACP 模式接入，支持流式事件与工具调用',
  },
  {
    adapter: 'qoder-cn',
    name: 'Qoder CN',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'qoder-cn',
    args: [],
    description: 'Qoder CLI CN，兼容 Claude Code stream-json 协议',
  },
  {
    adapter: 'gemini',
    name: 'Gemini CLI',
    protocol: 'ACP',
    transport: 'stdio',
    command: 'gemini',
    args: ['--acp'],
    description: '通过 Gemini CLI 的 ACP 模式接入',
  },
  {
    adapter: 'kimi',
    name: 'Kimi Code',
    protocol: 'CLI',
    transport: 'stdio',
    command: 'kimi',
    args: [],
    description: 'Kimi Code CLI stream-json 事件协议',
  },
  {
    adapter: 'acp',
    name: '通用 ACP',
    protocol: 'ACP',
    transport: 'stdio',
    description: '自定义 ACP stdio 命令',
    args: [],
  },
  {
    adapter: 'custom',
    name: 'Custom CLI',
    protocol: 'CLI',
    transport: 'stdio',
    description: 'stdin 发送提示词、stdout 输出文本的任意命令行工具',
    args: [],
  },
]

export type SessionSearchHit = {
  session: SessionSummary
  messageId: string | null
  snippet: string | null
}

export interface SendMessageInput {
  sessionId: string
  content: string
  attachments?: AttachmentInput[]
}

export interface SendMessageResult {
  userMessage: Message
  assistantMessage: Message
  runId: string
}

export interface TeamSendResult {
  userMessage: Message
  turn: TeamTurn
  queued: boolean
}

export interface ForkSessionInput {
  sessionId: string
  messageId?: string
}
