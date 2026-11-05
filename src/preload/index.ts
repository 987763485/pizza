import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PizzaApi, type SettingsPatch } from '@shared/ipc'
import type {
  AgentInput,
  AppNotification,
  AppSettings,
  ApprovalDecisionInput,
  ApprovalRequest,
  Artifact,
  ForkSessionInput,
  McpBindingInput,
  McpServerInput,
  RunEvent,
  RuntimeInput,
  RuntimeStatus,
  SendMessageInput,
  SessionSummary,
  SkillBindingInput,
  SkillImportInput,
  SkillUpdateInput,
  TeamInput,
  TeamTurnEvent,
} from '@shared/types'

// 首屏主题/语言通过启动参数传入，渲染层在 React 挂载前就能应用，避免闪烁。
const arg = (name: string): string | null => {
  const prefix = `--${name}=`
  const found = process.argv.find((value) => value.startsWith(prefix))
  return found ? found.slice(prefix.length) : null
}
contextBridge.exposeInMainWorld('pizzaBootstrap', {
  theme: arg('pizza-theme'),
  language: arg('pizza-language'),
  platform: process.platform,
})

const api: PizzaApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    reset: () => ipcRenderer.invoke(IPC.appReset),
  },
  workspace: {
    list: () => ipcRenderer.invoke(IPC.workspaceList),
    ensureDefault: () => ipcRenderer.invoke(IPC.workspaceEnsureDefault),
    pick: () => ipcRenderer.invoke(IPC.workspacePick),
    select: (id: string) => ipcRenderer.invoke(IPC.workspaceSelect, id),
    remove: (id: string) => ipcRenderer.invoke(IPC.workspaceDelete, id),
  },
  runtime: {
    list: () => ipcRenderer.invoke(IPC.runtimeList),
    presets: () => ipcRenderer.invoke(IPC.runtimePresets),
    create: (input: RuntimeInput) => ipcRenderer.invoke(IPC.runtimeCreate, input),
    update: (id: string, input: RuntimeInput) =>
      ipcRenderer.invoke(IPC.runtimeUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.runtimeRemove, id),
    test: (input: RuntimeInput) => ipcRenderer.invoke(IPC.runtimeTest, input),
    models: (id: string) => ipcRenderer.invoke(IPC.runtimeModels, id),
    reconnect: (id: string) => ipcRenderer.invoke(IPC.runtimeReconnect, id),
  },
  agent: {
    list: () => ipcRenderer.invoke(IPC.agentList),
    create: (input: AgentInput) => ipcRenderer.invoke(IPC.agentCreate, input),
    update: (id: string, input: AgentInput) =>
      ipcRenderer.invoke(IPC.agentUpdate, id, input),
    duplicate: (id: string) => ipcRenderer.invoke(IPC.agentDuplicate, id),
    archive: (id: string, archived: boolean) =>
      ipcRenderer.invoke(IPC.agentArchive, id, archived),
    remove: (id: string) => ipcRenderer.invoke(IPC.agentRemove, id),
    test: (id: string) => ipcRenderer.invoke(IPC.agentTest, id),
  },
  team: {
    list: (workspaceId: string, includeArchived = false) =>
      ipcRenderer.invoke(IPC.teamList, workspaceId, includeArchived),
    get: (id: string) => ipcRenderer.invoke(IPC.teamGet, id),
    create: (input: TeamInput) => ipcRenderer.invoke(IPC.teamCreate, input),
    update: (id: string, input: TeamInput) =>
      ipcRenderer.invoke(IPC.teamUpdate, id, input),
    archive: (id: string, archived: boolean) =>
      ipcRenderer.invoke(IPC.teamArchive, id, archived),
    remove: (id: string) => ipcRenderer.invoke(IPC.teamRemove, id),
    send: (input: SendMessageInput) => ipcRenderer.invoke(IPC.teamSend, input),
    turns: (sessionId: string) => ipcRenderer.invoke(IPC.teamTurns, sessionId),
    turnEvents: (turnId: string) => ipcRenderer.invoke(IPC.teamTurnEvents, turnId),
    stopTurn: (turnId: string) => ipcRenderer.invoke(IPC.teamStopTurn, turnId),
  },
  session: {
    list: (workspaceId: string) => ipcRenderer.invoke(IPC.sessionList, workspaceId),
    archived: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.sessionArchived, workspaceId),
    get: (id: string) => ipcRenderer.invoke(IPC.sessionGet, id),
    create: (input: {
      workspaceId: string
      agentId: string
      title?: string
      workspacePath?: string
    }) => ipcRenderer.invoke(IPC.sessionCreate, input),
    createTeam: (input: {
      workspaceId: string
      teamId: string
      title?: string
      workspacePath?: string
    }) => ipcRenderer.invoke(IPC.sessionCreateTeam, input),
    rename: (sessionId: string, title: string) =>
      ipcRenderer.invoke(IPC.sessionRename, { sessionId, title }),
    fork: (input: ForkSessionInput) => ipcRenderer.invoke(IPC.sessionFork, input),
    archive: (sessionId: string) => ipcRenderer.invoke(IPC.sessionArchive, sessionId),
    restore: (sessionId: string) => ipcRenderer.invoke(IPC.sessionRestore, sessionId),
    delete: (sessionId: string) => ipcRenderer.invoke(IPC.sessionDelete, sessionId),
    search: (workspaceId: string, query: string) =>
      ipcRenderer.invoke(IPC.sessionSearch, { workspaceId, query }),
    markRead: (sessionId: string) =>
      ipcRenderer.invoke(IPC.sessionMarkRead, sessionId),
  },
  message: {
    send: (input: SendMessageInput) => ipcRenderer.invoke(IPC.messageSend, input),
    stop: (runId: string) => ipcRenderer.invoke(IPC.messageStop, runId),
    retry: (messageId: string) => ipcRenderer.invoke(IPC.messageRetry, messageId),
  },
  run: {
    events: (runId: string) => ipcRenderer.invoke(IPC.runEvents, runId),
  },
  artifact: {
    list: (sessionId: string) => ipcRenderer.invoke(IPC.artifactList, sessionId),
    read: (path: string) => ipcRenderer.invoke(IPC.artifactRead, { path }),
    reveal: (path: string) => ipcRenderer.invoke(IPC.artifactReveal, { path }),
    openWorkspace: (workspacePath: string, editor: AppSettings['defaultEditor']) =>
      ipcRenderer.invoke(IPC.artifactOpenWorkspace, { workspacePath, editor }),
  },
  editor: {
    list: () => ipcRenderer.invoke(IPC.editorList),
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    update: (patch: SettingsPatch) =>
      ipcRenderer.invoke(IPC.settingsUpdate, patch),
    dataDir: () => ipcRenderer.invoke(IPC.settingsDataDir),
    setDataDir: (path: string) => ipcRenderer.invoke(IPC.settingsSetDataDir, { path }),
    restart: () => ipcRenderer.invoke(IPC.settingsRestart),
  },
  skill: {
    list: (workspaceId: string) => ipcRenderer.invoke(IPC.skillList, workspaceId),
    get: (id: string) => ipcRenderer.invoke(IPC.skillGet, id),
    create: (input: {
      workspaceId: string
      name: string
      description: string
      body?: string
    }) => ipcRenderer.invoke(IPC.skillCreate, input),
    import: (input: SkillImportInput) => ipcRenderer.invoke(IPC.skillImport, input),
    update: (id: string, input: SkillUpdateInput) =>
      ipcRenderer.invoke(IPC.skillUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.skillRemove, id),
    bindings: (scopeType: string, scopeId: string) =>
      ipcRenderer.invoke(IPC.skillBindings, scopeType, scopeId),
    setBinding: (input: SkillBindingInput) =>
      ipcRenderer.invoke(IPC.skillSetBinding, input),
    removeBinding: (input: {
      skillId: string
      scopeType: string
      scopeId: string
    }) => ipcRenderer.invoke(IPC.skillRemoveBinding, input),
    preview: (input: {
      workspaceId: string
      agentId: string
      teamMemberId?: string
      disabledSkillIds?: string[]
    }) => ipcRenderer.invoke(IPC.skillPreview, input),
    readFile: (skillId: string, path: string) =>
      ipcRenderer.invoke(IPC.skillReadFile, { skillId, path }),
  },
  dialog: {
    pickDirectory: () => ipcRenderer.invoke(IPC.dialogPickDirectory),
    pickFile: (extensions?: string[]) =>
      ipcRenderer.invoke(IPC.dialogPickFile, extensions),
  },
  mcp: {
    list: (workspaceId: string) => ipcRenderer.invoke(IPC.mcpList, workspaceId),
    create: (input: McpServerInput) => ipcRenderer.invoke(IPC.mcpCreate, input),
    update: (id: string, input: McpServerInput) =>
      ipcRenderer.invoke(IPC.mcpUpdate, id, input),
    remove: (id: string) => ipcRenderer.invoke(IPC.mcpRemove, id),
    test: (id: string) => ipcRenderer.invoke(IPC.mcpTest, id),
    setEnabled: (id: string, enabled: boolean) =>
      ipcRenderer.invoke(IPC.mcpSetEnabled, id, enabled),
    bindings: (scopeType: string, scopeId: string) =>
      ipcRenderer.invoke(IPC.mcpBindings, scopeType, scopeId),
    setBinding: (input: McpBindingInput) =>
      ipcRenderer.invoke(IPC.mcpSetBinding, input),
    removeBinding: (input: {
      serverId: string
      scopeType: string
      scopeId: string
    }) => ipcRenderer.invoke(IPC.mcpRemoveBinding, input),
  },
  approval: {
    list: (sessionId?: string) => ipcRenderer.invoke(IPC.approvalList, sessionId),
    pending: () => ipcRenderer.invoke(IPC.approvalPending),
    decide: (input: ApprovalDecisionInput) =>
      ipcRenderer.invoke(IPC.approvalDecide, input),
    policies: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.approvalPolicies, workspaceId),
    setPolicy: (input: {
      workspaceId: string
      agentId?: string | null
      toolName: string
      decision: 'allow' | 'ask' | 'deny'
    }) => ipcRenderer.invoke(IPC.approvalSetPolicy, input),
  },
  notification: {
    list: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.notificationList, workspaceId),
    markRead: (id: string) => ipcRenderer.invoke(IPC.notificationMarkRead, id),
    markAllRead: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.notificationMarkAllRead, workspaceId),
    clear: (workspaceId: string) =>
      ipcRenderer.invoke(IPC.notificationClear, workspaceId),
    open: (id: string) => ipcRenderer.invoke(IPC.notificationOpen, id),
  },
  onboarding: {
    status: () => ipcRenderer.invoke(IPC.onboardingStatus),
    detect: () => ipcRenderer.invoke(IPC.onboardingDetect),
    complete: () => ipcRenderer.invoke(IPC.onboardingComplete),
  },
  events: {
    onRunEvent: (callback: (event: RunEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: RunEvent) =>
        callback(payload)
      ipcRenderer.on(IPC.eventRun, listener)
      return () => ipcRenderer.removeListener(IPC.eventRun, listener)
    },
    onSessionUpdated: (callback: (session: SessionSummary) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SessionSummary) =>
        callback(payload)
      ipcRenderer.on(IPC.eventSession, listener)
      return () => ipcRenderer.removeListener(IPC.eventSession, listener)
    },
    onArtifactChanged: (callback: (artifact: Artifact) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: Artifact) =>
        callback(payload)
      ipcRenderer.on(IPC.eventArtifact, listener)
      return () => ipcRenderer.removeListener(IPC.eventArtifact, listener)
    },
    onRuntimeStatus: (
      callback: (payload: { id: string; status: RuntimeStatus }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { id: string; status: RuntimeStatus },
      ) => callback(payload)
      ipcRenderer.on(IPC.eventRuntime, listener)
      return () => ipcRenderer.removeListener(IPC.eventRuntime, listener)
    },
    onTeamTurn: (callback: (event: TeamTurnEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TeamTurnEvent) =>
        callback(payload)
      ipcRenderer.on(IPC.eventTeamTurn, listener)
      return () => ipcRenderer.removeListener(IPC.eventTeamTurn, listener)
    },
    onApproval: (callback: (event: ApprovalRequest) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ApprovalRequest) =>
        callback(payload)
      ipcRenderer.on(IPC.eventApproval, listener)
      return () => ipcRenderer.removeListener(IPC.eventApproval, listener)
    },
    onNotification: (callback: (event: AppNotification) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AppNotification) =>
        callback(payload)
      ipcRenderer.on(IPC.eventNotification, listener)
      return () => ipcRenderer.removeListener(IPC.eventNotification, listener)
    },
    onNotificationOpen: (
      callback: (payload: { sessionId: string; messageId: string | null }) => void,
    ) => {
      const listener = (
        _event: Electron.IpcRendererEvent,
        payload: { sessionId: string; messageId: string | null },
      ) => callback(payload)
      ipcRenderer.on(IPC.eventNotificationOpen, listener)
      return () => ipcRenderer.removeListener(IPC.eventNotificationOpen, listener)
    },
    onSettingsChanged: (callback: (settings: AppSettings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: AppSettings) =>
        callback(payload)
      ipcRenderer.on(IPC.eventSettings, listener)
      return () => ipcRenderer.removeListener(IPC.eventSettings, listener)
    },
  },
}

contextBridge.exposeInMainWorld('pizza', api)
