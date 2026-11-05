import { BrowserWindow, dialog, ipcMain } from 'electron'
import {
  agentInputSchema,
  approvalDecisionSchema,
  approvalPolicySchema,
  capabilityPreviewSchema,
  dataDirInputSchema,
  forkSessionSchema,
  idSchema,
  mcpBindingSchema,
  mcpRemoveBindingSchema,
  mcpServerInputSchema,
  openWorkspaceSchema,
  readArtifactSchema,
  renameSchema,
  runtimeInputSchema,
  searchSchema,
  sendMessageSchema,
  sessionCreateSchema,
  skillBindingSchema,
  skillCreateSchema,
  skillImportSchema,
  skillReadFileSchema,
  skillRemoveBindingSchema,
  skillUpdateSchema,
  teamInputSchema,
  teamSessionCreateSchema,
  settingsUpdateSchema,
  IPC,
} from '@shared/ipc'
import type { AppSettings, EditorId } from '@shared/types'
import { appInfo } from '../paths'
import type { AgentService } from '../services/agent-service'
import type { ApprovalService } from '../services/approval-service'
import type { ArtifactService } from '../services/artifact-service'
import type { CapabilityResolver } from '../services/capability-resolver'
import type { DataDirService } from '../services/data-dir-service'
import type { McpService } from '../services/mcp-service'
import type { NotificationService } from '../services/notification-service'
import type { OnboardingService } from '../services/onboarding-service'
import type { RunService } from '../services/run-service'
import type { RuntimeService } from '../services/runtime-service'
import type { SessionService } from '../services/session-service'
import type { SettingsService } from '../services/settings-service'
import type { SkillService } from '../services/skill-service'
import type { TeamService } from '../services/team-service'
import type { TeamOrchestrator } from '../services/team-orchestrator'
import type { WorkspaceService } from '../services/workspace-service'

export interface IpcServices {
  workspaces: WorkspaceService
  runtimes: RuntimeService
  agents: AgentService
  teams: TeamService
  teamOrchestrator: TeamOrchestrator
  sessions: SessionService
  runs: RunService
  artifacts: ArtifactService
  settings: SettingsService
  skills: SkillService
  mcp: McpService
  capabilities: CapabilityResolver
  approvals: ApprovalService
  notifications: NotificationService
  onboarding: OnboardingService
  dataDirs: DataDirService
  onSettingsChanged?: (settings: AppSettings) => void
  onRestart?: () => void
  onResetApp: () => Promise<void>
}

export function registerIpc(services: IpcServices): void {
  ipcMain.handle(IPC.appInfo, () => appInfo())
  ipcMain.handle(IPC.appReset, () => services.onResetApp())

  ipcMain.handle(IPC.workspaceList, () => services.workspaces.list())
  ipcMain.handle(IPC.workspaceEnsureDefault, () => services.workspaces.ensureDefault())
  ipcMain.handle(IPC.workspacePick, () => services.workspaces.pick())
  ipcMain.handle(IPC.workspaceSelect, (_event, id: unknown) =>
    services.workspaces.select(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.workspaceDelete, (_event, id: unknown) =>
    services.workspaces.remove(idSchema.parse(id)),
  )

  ipcMain.handle(IPC.runtimeList, () => services.runtimes.list())
  ipcMain.handle(IPC.runtimePresets, () => services.runtimes.presets())
  ipcMain.handle(IPC.runtimeCreate, (_event, input: unknown) =>
    services.runtimes.create(runtimeInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.runtimeUpdate, (_event, id: unknown, input: unknown) =>
    services.runtimes.update(idSchema.parse(id), runtimeInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.runtimeRemove, (_event, id: unknown) =>
    services.runtimes.remove(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.runtimeTest, (_event, input: unknown) =>
    services.runtimes.test(runtimeInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.runtimeModels, (_event, id: unknown) =>
    services.runtimes.refreshModels(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.runtimeReconnect, (_event, id: unknown) =>
    services.runtimes.reconnect(idSchema.parse(id)),
  )

  ipcMain.handle(IPC.agentList, () => services.agents.list())
  ipcMain.handle(IPC.agentCreate, (_event, input: unknown) =>
    services.agents.create(agentInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.agentUpdate, (_event, id: unknown, input: unknown) =>
    services.agents.update(idSchema.parse(id), agentInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.agentDuplicate, (_event, id: unknown) =>
    services.agents.duplicate(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.agentArchive, (_event, id: unknown, archived: unknown) =>
    services.agents.archive(idSchema.parse(id), Boolean(archived)),
  )
  ipcMain.handle(IPC.agentRemove, (_event, id: unknown) =>
    services.agents.remove(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.agentTest, (_event, id: unknown) =>
    services.agents.test(idSchema.parse(id)),
  )

  ipcMain.handle(IPC.teamList, (_event, workspaceId: unknown, includeArchived: unknown) =>
    services.teams.list(idSchema.parse(workspaceId), Boolean(includeArchived)),
  )
  ipcMain.handle(IPC.teamGet, (_event, id: unknown) =>
    services.teams.get(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.teamCreate, (_event, input: unknown) =>
    services.teams.create(teamInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.teamUpdate, (_event, id: unknown, input: unknown) =>
    services.teams.update(idSchema.parse(id), teamInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.teamArchive, (_event, id: unknown, archived: unknown) =>
    services.teams.archive(idSchema.parse(id), Boolean(archived)),
  )
  ipcMain.handle(IPC.teamRemove, (_event, id: unknown) =>
    services.teams.remove(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.teamSend, (_event, input: unknown) =>
    services.teamOrchestrator.send(sendMessageSchema.parse(input)),
  )
  ipcMain.handle(IPC.teamTurns, (_event, sessionId: unknown) =>
    services.teamOrchestrator.turns(idSchema.parse(sessionId)),
  )
  ipcMain.handle(IPC.teamTurnEvents, (_event, turnId: unknown) =>
    services.teamOrchestrator.turnEvents(idSchema.parse(turnId)),
  )
  ipcMain.handle(IPC.teamStopTurn, (_event, turnId: unknown) =>
    services.teamOrchestrator.stopTurn(idSchema.parse(turnId)),
  )

  ipcMain.handle(IPC.sessionList, (_event, workspaceId: unknown) =>
    services.sessions.list(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.sessionArchived, (_event, workspaceId: unknown) =>
    services.sessions.archived(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.sessionGet, (_event, id: unknown) =>
    services.sessions.get(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.sessionCreate, (_event, input: unknown) =>
    services.sessions.create(sessionCreateSchema.parse(input)),
  )
  ipcMain.handle(IPC.sessionCreateTeam, (_event, input: unknown) =>
    services.sessions.createTeam(teamSessionCreateSchema.parse(input)),
  )
  ipcMain.handle(IPC.sessionRename, (_event, input: unknown) => {
    const parsed = renameSchema.parse(input)
    return services.sessions.rename(parsed.sessionId, parsed.title)
  })
  ipcMain.handle(IPC.sessionFork, (_event, input: unknown) =>
    services.sessions.fork(forkSessionSchema.parse(input)),
  )
  ipcMain.handle(IPC.sessionArchive, (_event, id: unknown) =>
    services.sessions.archive(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.sessionRestore, (_event, id: unknown) =>
    services.sessions.restore(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.sessionDelete, (_event, id: unknown) =>
    services.sessions.delete(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.sessionSearch, (_event, input: unknown) => {
    const parsed = searchSchema.parse(input)
    return services.sessions.search(parsed.workspaceId, parsed.query)
  })
  ipcMain.handle(IPC.sessionMarkRead, (_event, id: unknown) =>
    services.sessions.markRead(idSchema.parse(id)),
  )

  ipcMain.handle(IPC.messageSend, (_event, input: unknown) => {
    const parsed = sendMessageSchema.parse(input)
    const session = services.sessions.get(parsed.sessionId)
    return session.mode === 'team'
      ? services.teamOrchestrator.send(parsed)
      : services.runs.send(parsed)
  })
  ipcMain.handle(IPC.messageStop, (_event, runId: unknown) => {
    const parsed = idSchema.parse(runId)
    if (services.teamOrchestrator.stopRun(parsed)) return
    services.runs.stop(parsed)
  })
  ipcMain.handle(IPC.messageRetry, (_event, messageId: unknown) => {
    const parsed = idSchema.parse(messageId)
    const message = services.runs.message(parsed)
    if (!message) throw new Error('MESSAGE_NOT_FOUND')
    const session = services.sessions.get(message.sessionId)
    return session.mode === 'team'
      ? services.teamOrchestrator.retry(parsed)
      : services.runs.retry(parsed)
  })
  ipcMain.handle(IPC.runEvents, (_event, runId: unknown) =>
    services.runs.events(idSchema.parse(runId)),
  )

  ipcMain.handle(IPC.artifactList, (_event, sessionId: unknown) =>
    services.artifacts.list(idSchema.parse(sessionId)),
  )
  ipcMain.handle(IPC.artifactRead, (_event, path: unknown) =>
    services.artifacts.read(readArtifactSchema.parse(path).path),
  )
  ipcMain.handle(IPC.artifactReveal, (_event, path: unknown) =>
    services.artifacts.reveal(readArtifactSchema.parse(path).path),
  )
  ipcMain.handle(IPC.artifactOpenWorkspace, (_event, input: unknown) => {
    const parsed = openWorkspaceSchema.parse(input)
    return services.artifacts.openWorkspace(parsed.workspacePath, parsed.editor as EditorId)
  })

  ipcMain.handle(IPC.editorList, () => services.artifacts.editors())
  ipcMain.handle(IPC.settingsGet, () => services.settings.get())
  ipcMain.handle(IPC.settingsUpdate, (_event, patch: unknown) => {
    const settings = services.settings.update(settingsUpdateSchema.parse(patch))
    services.onSettingsChanged?.(settings)
    return settings
  })
  ipcMain.handle(IPC.settingsDataDir, () => services.dataDirs.status())
  ipcMain.handle(IPC.settingsSetDataDir, (_event, input: unknown) => {
    const status = services.dataDirs.setPending(dataDirInputSchema.parse(input).path)
    services.onSettingsChanged?.(services.settings.get())
    return status
  })
  ipcMain.handle(IPC.settingsRestart, () => services.onRestart?.())

  ipcMain.handle(IPC.skillList, (_event, workspaceId: unknown) =>
    services.skills.list(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.skillGet, (_event, id: unknown) =>
    services.skills.get(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.skillCreate, (_event, input: unknown) => {
    const parsed = skillCreateSchema.parse(input)
    return services.skills.create(parsed)
  })
  ipcMain.handle(IPC.skillImport, (_event, input: unknown) =>
    services.skills.import(skillImportSchema.parse(input)),
  )
  ipcMain.handle(IPC.skillUpdate, (_event, id: unknown, input: unknown) =>
    services.skills.update(idSchema.parse(id), skillUpdateSchema.parse(input)),
  )
  ipcMain.handle(IPC.skillRemove, (_event, id: unknown) =>
    services.skills.remove(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.skillBindings, (_event, scopeType: unknown, scopeId: unknown) =>
    services.skills.bindings(
      scopeType as 'agent' | 'team_member' | 'workspace',
      idSchema.parse(scopeId),
    ),
  )
  ipcMain.handle(IPC.skillSetBinding, (_event, input: unknown) =>
    services.skills.setBinding(skillBindingSchema.parse(input)),
  )
  ipcMain.handle(IPC.skillRemoveBinding, (_event, input: unknown) => {
    const parsed = skillRemoveBindingSchema.parse(input)
    services.skills.removeBinding(parsed)
  })
  ipcMain.handle(IPC.skillPreview, (_event, input: unknown) =>
    services.capabilities.resolve(capabilityPreviewSchema.parse(input)),
  )
  ipcMain.handle(IPC.skillReadFile, (_event, input: unknown) => {
    const parsed = skillReadFileSchema.parse(input)
    return services.skills.readFile(parsed.skillId, parsed.path)
  })
  ipcMain.handle(IPC.dialogPickDirectory, async () => {
    const window = BrowserWindow.getFocusedWindow()
    const options: Electron.OpenDialogOptions = { properties: ['openDirectory'] }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle(IPC.dialogPickFile, async (_event, extensions: unknown) => {
    const window = BrowserWindow.getFocusedWindow()
    const filters =
      Array.isArray(extensions) && extensions.length > 0
        ? [{ name: '文件', extensions: extensions.map(String) }]
        : undefined
    const options: Electron.OpenDialogOptions = { properties: ['openFile'], filters }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.mcpList, (_event, workspaceId: unknown) =>
    services.mcp.list(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.mcpCreate, (_event, input: unknown) =>
    services.mcp.create(mcpServerInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.mcpUpdate, (_event, id: unknown, input: unknown) =>
    services.mcp.update(idSchema.parse(id), mcpServerInputSchema.parse(input)),
  )
  ipcMain.handle(IPC.mcpRemove, (_event, id: unknown) =>
    services.mcp.remove(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.mcpTest, (_event, id: unknown) =>
    services.mcp.test(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.mcpSetEnabled, (_event, id: unknown, enabled: unknown) =>
    services.mcp.setEnabled(idSchema.parse(id), Boolean(enabled)),
  )
  ipcMain.handle(IPC.mcpBindings, (_event, scopeType: unknown, scopeId: unknown) =>
    services.mcp.bindings(
      scopeType as 'agent' | 'team_member' | 'workspace',
      idSchema.parse(scopeId),
    ),
  )
  ipcMain.handle(IPC.mcpSetBinding, (_event, input: unknown) =>
    services.mcp.setBinding(mcpBindingSchema.parse(input)),
  )
  ipcMain.handle(IPC.mcpRemoveBinding, (_event, input: unknown) => {
    const parsed = mcpRemoveBindingSchema.parse(input)
    services.mcp.removeBinding(parsed)
  })

  ipcMain.handle(IPC.approvalList, (_event, sessionId: unknown) =>
    services.approvals.list(sessionId ? idSchema.parse(sessionId) : undefined),
  )
  ipcMain.handle(IPC.approvalPending, () => services.approvals.pending())
  ipcMain.handle(IPC.approvalDecide, (_event, input: unknown) => {
    const parsed = approvalDecisionSchema.parse(input)
    return services.approvals.decide(parsed.approvalId, parsed.decision)
  })
  ipcMain.handle(IPC.approvalPolicies, (_event, workspaceId: unknown) =>
    services.approvals.policies(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.approvalSetPolicy, (_event, input: unknown) =>
    services.approvals.setPolicy(approvalPolicySchema.parse(input)),
  )

  ipcMain.handle(IPC.notificationList, (_event, workspaceId: unknown) =>
    services.notifications.list(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.notificationMarkRead, (_event, id: unknown) =>
    services.notifications.markRead(idSchema.parse(id)),
  )
  ipcMain.handle(IPC.notificationMarkAllRead, (_event, workspaceId: unknown) =>
    services.notifications.markAllRead(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.notificationClear, (_event, workspaceId: unknown) =>
    services.notifications.clear(idSchema.parse(workspaceId)),
  )
  ipcMain.handle(IPC.notificationOpen, (_event, id: unknown) =>
    services.notifications.open(idSchema.parse(id)),
  )

  ipcMain.handle(IPC.onboardingStatus, () => services.onboarding.status())
  ipcMain.handle(IPC.onboardingDetect, () => services.onboarding.detect())
  ipcMain.handle(IPC.onboardingComplete, () => services.onboarding.complete())
}
