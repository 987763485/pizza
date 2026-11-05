import { z } from 'zod'
import type {
  Agent,
  AgentInput,
  AppInfo,
  AppNotification,
  AppSettings,
  ApprovalDecisionInput,
  ApprovalPolicy,
  ApprovalRequest,
  Artifact,
  Attachment,
  AttachmentInput,
  CapabilityBinding,
  CapabilityPreview,
  DataDirStatus,
  EditorOption,
  ForkSessionInput,
  McpBindingInput,
  McpServer,
  McpServerInput,
  McpTestResult,
  Message,
  Run,
  RunEvent,
  RuntimeConfig,
  RuntimeDetection,
  RuntimeInput,
  RuntimePreset,
  RuntimeStatus,
  RuntimeTestResult,
  SendMessageInput,
  SendMessageResult,
  SessionDetail,
  SessionSearchHit,
  SessionSummary,
  Skill,
  SkillBindingInput,
  SkillDetail,
  SkillImportInput,
  SkillUpdateInput,
  TeamDetail,
  TeamInput,
  TeamSendResult,
  TeamSummary,
  TeamTurn,
  TeamTurnEvent,
  Workspace,
} from './types'

export const IPC = {
  appInfo: 'app:info',
  appReset: 'app:reset',
  workspaceList: 'workspace:list',
  workspaceEnsureDefault: 'workspace:ensure-default',
  workspacePick: 'workspace:pick',
  workspaceSelect: 'workspace:select',
  workspaceDelete: 'workspace:delete',
  runtimeList: 'runtime:list',
  runtimePresets: 'runtime:presets',
  runtimeCreate: 'runtime:create',
  runtimeUpdate: 'runtime:update',
  runtimeRemove: 'runtime:remove',
  runtimeTest: 'runtime:test',
  runtimeModels: 'runtime:models',
  runtimeReconnect: 'runtime:reconnect',
  agentList: 'agent:list',
  agentCreate: 'agent:create',
  agentUpdate: 'agent:update',
  agentDuplicate: 'agent:duplicate',
  agentArchive: 'agent:archive',
  agentRemove: 'agent:remove',
  agentTest: 'agent:test',
  teamList: 'team:list',
  teamGet: 'team:get',
  teamCreate: 'team:create',
  teamUpdate: 'team:update',
  teamArchive: 'team:archive',
  teamRemove: 'team:remove',
  teamSend: 'team:send',
  teamTurns: 'team:turns',
  teamTurnEvents: 'team:turn-events',
  teamStopTurn: 'team:stop-turn',
  sessionList: 'session:list',
  sessionArchived: 'session:archived',
  sessionGet: 'session:get',
  sessionCreate: 'session:create',
  sessionCreateTeam: 'session:create-team',
  sessionRename: 'session:rename',
  sessionFork: 'session:fork',
  sessionArchive: 'session:archive',
  sessionRestore: 'session:restore',
  sessionDelete: 'session:delete',
  sessionSearch: 'session:search',
  sessionMarkRead: 'session:mark-read',
  messageSend: 'message:send',
  messageStop: 'message:stop',
  messageRetry: 'message:retry',
  runEvents: 'run:events',
  artifactList: 'artifact:list',
  artifactRead: 'artifact:read',
  artifactReveal: 'artifact:reveal',
  artifactOpenWorkspace: 'artifact:open-workspace',
  editorList: 'editor:list',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  settingsDataDir: 'settings:data-dir',
  settingsSetDataDir: 'settings:set-data-dir',
  settingsRestart: 'settings:restart',
  skillList: 'skill:list',
  skillGet: 'skill:get',
  skillCreate: 'skill:create',
  skillImport: 'skill:import',
  skillUpdate: 'skill:update',
  skillRemove: 'skill:remove',
  skillBindings: 'skill:bindings',
  skillSetBinding: 'skill:set-binding',
  skillRemoveBinding: 'skill:remove-binding',
  skillPreview: 'skill:preview',
  skillReadFile: 'skill:read-file',
  dialogPickDirectory: 'dialog:pick-directory',
  dialogPickFile: 'dialog:pick-file',
  mcpList: 'mcp:list',
  mcpCreate: 'mcp:create',
  mcpUpdate: 'mcp:update',
  mcpRemove: 'mcp:remove',
  mcpTest: 'mcp:test',
  mcpSetEnabled: 'mcp:set-enabled',
  mcpBindings: 'mcp:bindings',
  mcpSetBinding: 'mcp:set-binding',
  mcpRemoveBinding: 'mcp:remove-binding',
  approvalList: 'approval:list',
  approvalPending: 'approval:pending',
  approvalDecide: 'approval:decide',
  approvalPolicies: 'approval:policies',
  approvalSetPolicy: 'approval:set-policy',
  notificationList: 'notification:list',
  notificationMarkRead: 'notification:mark-read',
  notificationMarkAllRead: 'notification:mark-all-read',
  notificationClear: 'notification:clear',
  notificationOpen: 'notification:open',
  onboardingStatus: 'onboarding:status',
  onboardingDetect: 'onboarding:detect',
  onboardingComplete: 'onboarding:complete',
  eventRun: 'event:run',
  eventSession: 'event:session',
  eventArtifact: 'event:artifact',
  eventRuntime: 'event:runtime',
  eventTeamTurn: 'event:team-turn',
  eventApproval: 'event:approval',
  eventNotification: 'event:notification',
  eventNotificationOpen: 'event:notification-open',
  eventSettings: 'event:settings',
} as const

const attachmentSchema = z.object({
  name: z.string().min(1).max(255),
  mime: z.string().min(1).max(200),
  data: z.instanceof(Uint8Array),
})

export const runtimeInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  adapter: z.enum([
    'claude-code',
    'acp',
    'codex',
    'pi',
    'omp',
    'dsh',
    'hermes',
    'opencode',
    'qoder-cn',
    'gemini',
    'kimi',
    'custom',
  ]),
  protocol: z.enum(['ACP', 'CLI']),
  transport: z.enum(['stdio', 'websocket', 'http']),
  command: z.string().trim().max(500).optional(),
  args: z.array(z.string().max(1000)).max(50).optional(),
  cwd: z.string().trim().max(2000).optional(),
  url: z.string().trim().max(2000).optional(),
  env: z.record(z.string(), z.string()).optional(),
  timeoutMs: z.number().int().min(1_000).max(600_000).optional(),
  autoReconnect: z.boolean().optional(),
})

export const agentInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).optional(),
  avatar: z.string().max(3_000_000).nullable().optional(),
  runtimeId: z.string().uuid(),
  prompt: z.string().trim().max(50_000),
  instructionMode: z.enum(['self', 'leader']).optional(),
  thinkingLevel: z
    .enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
    .optional(),
  contextLimit: z.number().int().min(100_000).max(2_000_000).optional(),
  model: z.string().max(200).nullable().optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
})

export const teamInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(500).optional(),
  avatar: z.string().max(3_000_000).nullable().optional(),
  leaderAgentId: z.string().uuid(),
  orchestrationPrompt: z.string().max(50_000).optional(),
  fanoutStrategy: z.enum(['parallel', 'serial']).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  maxHops: z.number().int().min(1).max(100).optional(),
  tokenBudget: z.number().int().min(0).max(100_000_000).optional(),
  members: z
    .array(
      z.object({
        agentId: z.string().uuid(),
        role: z.string().max(200).optional(),
        promptMode: z.enum(['inherit', 'append', 'replace']).optional(),
        prompt: z.string().max(50_000).optional(),
        capabilityOverrides: z
          .object({
            skills: z.array(z.string().max(200)).max(50).optional(),
            mcpServers: z.array(z.string().max(200)).max(50).optional(),
          })
          .optional(),
      }),
    )
    .min(1)
    .max(30),
})

export const sessionCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid(),
  title: z.string().trim().max(120).optional(),
  workspacePath: z.string().trim().max(2000).optional(),
})

export const teamSessionCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  teamId: z.string().uuid(),
  title: z.string().trim().max(120).optional(),
  workspacePath: z.string().trim().max(2000).optional(),
})

export const sendMessageSchema = z.object({
  sessionId: z.string().uuid(),
  content: z.string().trim().min(1).max(200_000),
  attachments: z.array(attachmentSchema).max(10).optional(),
})

export const forkSessionSchema = z.object({
  sessionId: z.string().uuid(),
  messageId: z.string().uuid().optional(),
})

export const settingsUpdateSchema = z.object({
  currentWorkspaceId: z.string().uuid().nullable().optional(),
  defaultWorkspacePath: z.string().trim().max(2000).optional(),
  defaultRuntimeId: z.string().uuid().nullable().optional(),
  defaultEditor: z
    .enum([
      'system',
      'finder',
      'cursor',
      'vscode',
      'zed',
      'sublimetext',
      'xcode',
      'idea',
      'goland',
      'rustrover',
      'sourcetree',
      'warp',
      'terminal',
    ])
    .optional(),
  theme: z.enum(['light', 'dark', 'system']).optional(),
  language: z.enum(['zh-CN', 'en']).optional(),
  maxConcurrency: z.number().int().min(1).max(10).optional(),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).optional(),
  autoUpdate: z.boolean().optional(),
  anonymousStats: z.boolean().optional(),
  fontSize: z.enum(['compact', 'standard', 'comfortable']).optional(),
  density: z.enum(['compact', 'comfortable']).optional(),
  reducedMotion: z.enum(['system', 'reduce', 'full']).optional(),
  profileName: z.string().trim().max(80).optional(),
  profileAbout: z.string().max(2000).optional(),
  profileAvatar: z.string().max(3_000_000).nullable().optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      system: z.boolean().optional(),
      sound: z.boolean().optional(),
      doNotDisturb: z.boolean().optional(),
    })
    .optional(),
  onboardingCompleted: z.boolean().optional(),
})

export type SettingsPatch = z.infer<typeof settingsUpdateSchema>

export const dataDirInputSchema = z.object({
  path: z.string().trim().min(1).max(4000),
})

export const skillCreateSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9][a-z0-9-_]*$/, '名称必须为小写字母、数字、连字符或下划线'),
  description: z.string().trim().min(1).max(1000),
  body: z.string().max(100_000).optional(),
})

export const skillImportSchema = z.object({
  workspaceId: z.string().uuid(),
  sourceType: z.enum(['local', 'zip', 'git']),
  sourcePath: z.string().trim().max(4000).optional(),
  gitUrl: z.string().trim().max(2000).optional(),
  name: z.string().trim().max(80).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  conflict: z.enum(['stop', 'overwrite', 'rename', 'skip']).optional(),
  enabled: z.boolean().optional(),
})

export const skillReadFileSchema = z.object({
  skillId: z.string().uuid(),
  path: z.string().trim().min(1).max(1000),
})

export const skillUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(1000).optional(),
  tags: z.array(z.string().trim().max(40)).max(20).optional(),
  enabled: z.boolean().optional(),
})

const scopeSchema = z.enum(['agent', 'team_member', 'workspace'])

export const skillBindingSchema = z.object({
  skillId: z.string().uuid(),
  scopeType: scopeSchema,
  scopeId: z.string().uuid(),
  enabled: z.boolean().optional(),
})

export const skillRemoveBindingSchema = z.object({
  skillId: z.string().uuid(),
  scopeType: scopeSchema,
  scopeId: z.string().uuid(),
})

export const capabilityPreviewSchema = z.object({
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid(),
  teamMemberId: z.string().uuid().optional(),
  disabledSkillIds: z.array(z.string().uuid()).max(50).optional(),
})

export const mcpServerInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  transport: z.enum(['stdio', 'sse', 'http']),
  command: z.string().trim().max(1000).optional(),
  args: z.array(z.string().max(1000)).max(50).optional(),
  url: z.string().trim().max(2000).optional(),
  env: z.record(z.string().max(200), z.string().max(20_000)).optional(),
  headers: z.record(z.string().max(200), z.string().max(20_000)).optional(),
  timeoutMs: z.number().int().min(1_000).max(300_000).optional(),
  enabled: z.boolean().optional(),
})

export const mcpBindingSchema = z.object({
  serverId: z.string().uuid(),
  scopeType: scopeSchema,
  scopeId: z.string().uuid(),
  enabled: z.boolean().optional(),
  toolAllow: z.array(z.string().max(200)).max(200).optional(),
  toolDeny: z.array(z.string().max(200)).max(200).optional(),
})

export const mcpRemoveBindingSchema = z.object({
  serverId: z.string().uuid(),
  scopeType: scopeSchema,
  scopeId: z.string().uuid(),
})

export const approvalDecisionSchema = z.object({
  approvalId: z.string().uuid(),
  decision: z.enum(['allow_once', 'always_allow', 'deny']),
})

export const approvalPolicySchema = z.object({
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid().nullable().optional(),
  toolName: z.string().trim().min(1).max(300),
  decision: z.enum(['allow', 'ask', 'deny']),
})

export const idSchema = z.string().uuid()
export const renameSchema = z.object({
  sessionId: z.string().uuid(),
  title: z.string().trim().min(1).max(120),
})
export const searchSchema = z.object({
  workspaceId: z.string().uuid(),
  query: z.string().trim().min(1).max(200),
})
export const openWorkspaceSchema = z.object({
  workspacePath: z.string().trim().min(1).max(2000),
  editor: z.enum([
      'finder',
      'cursor',
      'vscode',
      'zed',
      'sublimetext',
      'xcode',
      'idea',
      'goland',
      'rustrover',
      'sourcetree',
      'warp',
      'terminal',
    ]),
})
export const readArtifactSchema = z.object({
  path: z.string().trim().min(1).max(4000),
})

export type Unsubscribe = () => void

export interface PizzaApi {
  app: {
    info(): Promise<AppInfo>
    reset(): Promise<void>
  }
  workspace: {
    list(): Promise<Workspace[]>
    ensureDefault(): Promise<Workspace>
    pick(): Promise<Workspace | null>
    select(id: string): Promise<Workspace>
    remove(id: string): Promise<Workspace>
  }
  runtime: {
    list(): Promise<RuntimeConfig[]>
    presets(): Promise<RuntimePreset[]>
    create(input: RuntimeInput): Promise<RuntimeConfig>
    update(id: string, input: RuntimeInput): Promise<RuntimeConfig>
    remove(id: string): Promise<void>
    test(input: RuntimeInput): Promise<RuntimeTestResult>
    /** 重新查询运行时绑定的模型，并更新其能力缓存。 */
    models(id: string): Promise<import('./types').RuntimeCapabilities>
    reconnect(id: string): Promise<RuntimeTestResult>
  }
  agent: {
    list(): Promise<Agent[]>
    create(input: AgentInput): Promise<Agent>
    update(id: string, input: AgentInput): Promise<Agent>
    duplicate(id: string): Promise<Agent>
    archive(id: string, archived: boolean): Promise<Agent>
    remove(id: string): Promise<void>
    test(id: string): Promise<import('./types').AgentTestResult>
  }
  team: {
    list(workspaceId: string, includeArchived?: boolean): Promise<TeamSummary[]>
    get(id: string): Promise<TeamDetail>
    create(input: TeamInput): Promise<TeamDetail>
    update(id: string, input: TeamInput): Promise<TeamDetail>
    archive(id: string, archived: boolean): Promise<TeamDetail>
    remove(id: string): Promise<void>
    send(input: SendMessageInput): Promise<TeamSendResult>
    turns(sessionId: string): Promise<TeamTurn[]>
    turnEvents(turnId: string): Promise<TeamTurnEvent[]>
    stopTurn(turnId: string): Promise<void>
  }
  session: {
    list(workspaceId: string): Promise<SessionSummary[]>
    archived(workspaceId: string): Promise<SessionSummary[]>
    get(id: string): Promise<SessionDetail>
    create(input: {
      workspaceId: string
      agentId: string
      title?: string
      workspacePath?: string
    }): Promise<SessionDetail>
    createTeam(input: {
      workspaceId: string
      teamId: string
      title?: string
      workspacePath?: string
    }): Promise<SessionDetail>
    rename(sessionId: string, title: string): Promise<SessionSummary>
    fork(input: ForkSessionInput): Promise<SessionDetail>
    archive(sessionId: string): Promise<void>
    restore(sessionId: string): Promise<void>
    delete(sessionId: string): Promise<void>
    search(workspaceId: string, query: string): Promise<SessionSearchHit[]>
    markRead(sessionId: string): Promise<void>
  }
  message: {
    send(input: SendMessageInput): Promise<SendMessageResult | TeamSendResult>
    stop(runId: string): Promise<void>
    retry(messageId: string): Promise<SendMessageResult | TeamSendResult>
  }
  run: {
    events(runId: string): Promise<RunEvent[]>
  }
  artifact: {
    list(sessionId: string): Promise<Artifact[]>
    read(path: string): Promise<{ path: string; content: string; kind: 'text' | 'image' }>
    reveal(path: string): Promise<void>
    openWorkspace(workspacePath: string, editor: AppSettings['defaultEditor']): Promise<void>
  }
  editor: {
    list(): Promise<EditorOption[]>
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: SettingsPatch): Promise<AppSettings>
    dataDir(): Promise<DataDirStatus>
    setDataDir(path: string): Promise<DataDirStatus>
    restart(): Promise<void>
  }
  skill: {
    list(workspaceId: string): Promise<Skill[]>
    get(id: string): Promise<SkillDetail>
    create(input: {
      workspaceId: string
      name: string
      description: string
      body?: string
    }): Promise<Skill>
    import(input: SkillImportInput): Promise<Skill>
    update(id: string, input: SkillUpdateInput): Promise<Skill>
    remove(id: string): Promise<void>
    bindings(scopeType: string, scopeId: string): Promise<CapabilityBinding[]>
    setBinding(input: SkillBindingInput): Promise<CapabilityBinding>
    removeBinding(input: {
      skillId: string
      scopeType: string
      scopeId: string
    }): Promise<void>
    preview(input: {
      workspaceId: string
      agentId: string
      teamMemberId?: string
      disabledSkillIds?: string[]
    }): Promise<CapabilityPreview>
    readFile(skillId: string, path: string): Promise<{ path: string; content: string }>
  }
  dialog: {
    pickDirectory(): Promise<string | null>
    pickFile(extensions?: string[]): Promise<string | null>
  }
  mcp: {
    list(workspaceId: string): Promise<McpServer[]>
    create(input: McpServerInput): Promise<McpServer>
    update(id: string, input: McpServerInput): Promise<McpServer>
    remove(id: string): Promise<void>
    test(id: string): Promise<McpTestResult>
    setEnabled(id: string, enabled: boolean): Promise<McpServer>
    bindings(scopeType: string, scopeId: string): Promise<CapabilityBinding[]>
    setBinding(input: McpBindingInput): Promise<CapabilityBinding>
    removeBinding(input: {
      serverId: string
      scopeType: string
      scopeId: string
    }): Promise<void>
  }
  approval: {
    list(sessionId?: string): Promise<ApprovalRequest[]>
    pending(): Promise<ApprovalRequest[]>
    decide(input: ApprovalDecisionInput): Promise<ApprovalRequest>
    policies(workspaceId: string): Promise<ApprovalPolicy[]>
    setPolicy(input: {
      workspaceId: string
      agentId?: string | null
      toolName: string
      decision: 'allow' | 'ask' | 'deny'
    }): Promise<ApprovalPolicy>
  }
  notification: {
    list(workspaceId: string): Promise<AppNotification[]>
    markRead(id: string): Promise<void>
    markAllRead(workspaceId: string): Promise<void>
    clear(workspaceId: string): Promise<void>
    open(id: string): Promise<void>
  }
  onboarding: {
    status(): Promise<{ completed: boolean; detections: RuntimeDetection[] }>
    detect(): Promise<RuntimeDetection[]>
    complete(): Promise<void>
  }
  events: {
    onRunEvent(cb: (event: RunEvent) => void): Unsubscribe
    onSessionUpdated(cb: (session: SessionSummary) => void): Unsubscribe
    onArtifactChanged(cb: (artifact: Artifact) => void): Unsubscribe
    onRuntimeStatus(
      cb: (payload: { id: string; status: RuntimeStatus }) => void,
    ): Unsubscribe
    onTeamTurn(cb: (event: TeamTurnEvent) => void): Unsubscribe
    onApproval(cb: (event: ApprovalRequest) => void): Unsubscribe
    onNotification(cb: (event: AppNotification) => void): Unsubscribe
    onNotificationOpen(
      cb: (payload: { sessionId: string; messageId: string | null }) => void,
    ): Unsubscribe
    onSettingsChanged(cb: (settings: AppSettings) => void): Unsubscribe
  }
}

export type IpcPayloads = {
  [IPC.messageSend]: SendMessageInput
  [IPC.runtimeCreate]: RuntimeInput
  [IPC.agentCreate]: AgentInput
  [IPC.sessionCreate]: {
    workspaceId: string
    agentId: string
    title?: string
    workspacePath?: string
  }
  [IPC.settingsUpdate]: Partial<AppSettings>
}

export type { Attachment, AttachmentInput, Message, Run }
