import { create } from 'zustand'
import i18n from './i18n'
import type { SettingsPatch } from '@shared/ipc'
import type {
  Agent,
  AppInfo,
  AppNotification,
  AppSettings,
  ApprovalRequest,
  Artifact,
  AttachmentInput,
  DataDirStatus,
  EditorOption,
  Message,
  RunEvent,
  RuntimeConfig,
  RuntimeStatus,
  SendMessageResult,
  SessionDetail,
  SessionSummary,
  TeamDetail,
  TeamInput,
  TeamSendResult,
  TeamSummary,
  TeamTurn,
  TeamTurnEvent,
  Workspace,
} from '@shared/types'

export interface ToolCallView {
  id: string
  name: string
  status: 'running' | 'completed' | 'failed'
  detail?: string
  startedAt: number
  endedAt?: number
}

interface AppState {
  bootstrapped: boolean
  bootError: string | null
  appInfo: AppInfo | null
  workspaces: Workspace[]
  currentWorkspaceId: string | null
  sessions: SessionSummary[]
  sessionsByWorkspace: Record<string, SessionSummary[]>
  agents: Agent[]
  teams: TeamSummary[]
  runtimes: RuntimeConfig[]
  settings: AppSettings | null
  editors: EditorOption[]
  activeSession: SessionDetail | null
  archivedSessions: SessionSummary[]
  runToMessage: Record<string, string>
  toolEvents: Record<string, ToolCallView[]>
  busy: boolean
  error: string | null
  notice: string | null
  searchQuery: string
  searchResults: SessionSummary[]
  searchHitMessageIds: Record<string, string>
  searchSnippets: Record<string, string>
  teamTurns: TeamTurn[]
  teamTurnEvents: Record<string, TeamTurnEvent[]>
  approvals: ApprovalRequest[]
  notifications: AppNotification[]
  dataDirStatus: DataDirStatus | null

  init: () => Promise<void>
  refreshSessions: () => Promise<void>
  refreshAgents: () => Promise<void>
  refreshTeams: () => Promise<void>
  refreshRuntimes: () => Promise<void>
  createTeam: (input: TeamInput) => Promise<TeamDetail | null>
  updateTeam: (id: string, input: TeamInput) => Promise<TeamDetail | null>
  archiveTeam: (id: string, archived: boolean) => Promise<void>
  deleteTeam: (id: string) => Promise<void>
  createTeamSession: (teamId: string) => Promise<SessionDetail | null>
  selectWorkspace: (id: string) => Promise<void>
  deleteWorkspace: (id: string) => Promise<boolean>
  pickWorkspace: () => Promise<void>
  openSession: (id: string) => Promise<void>
  createSession: (agentId: string) => Promise<SessionDetail | null>
  sendMessage: (content: string, attachments: AttachmentInput[]) => Promise<void>
  stopRun: () => Promise<void>
  stopMessageRun: (runId: string) => Promise<void>
  retryMessage: (messageId: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  forkSession: (id: string) => Promise<SessionDetail | null>
  archiveSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  loadArchived: () => Promise<void>
  restoreSession: (id: string) => Promise<void>
  refreshArtifacts: () => Promise<void>
  search: (query: string) => Promise<void>
  updateSettings: (patch: SettingsPatch) => Promise<void>
  setError: (message: string | null) => void
  setNotice: (message: string | null) => void
  refreshTeamTurns: (sessionId?: string) => Promise<void>
  loadTurnEvents: (turnId: string) => Promise<void>
  stopTurn: (turnId: string) => Promise<void>
  handleTeamTurnEvent: (event: TeamTurnEvent) => void
  handleRunEvent: (event: RunEvent) => void
  handleSessionUpdated: (session: SessionSummary) => void
  handleArtifactChanged: (artifact: Artifact) => void
  handleRuntimeStatus: (payload: { id: string; status: RuntimeStatus }) => void
  handleApproval: (request: ApprovalRequest) => void
  decideApproval: (
    approvalId: string,
    decision: 'allow_once' | 'always_allow' | 'deny',
  ) => Promise<void>
  refreshNotifications: () => Promise<void>
  handleNotification: (notification: AppNotification) => void
  markNotificationRead: (id: string) => Promise<void>
  markAllNotificationsRead: () => Promise<void>
  handleSettingsChanged: (settings: AppSettings) => void
  refreshDataDir: () => Promise<void>
}

function messageWithDelta(message: Message, text: string): Message {
  return {
    ...message,
    content: `${message.content}${text}`,
    status: 'streaming',
    updatedAt: new Date().toISOString(),
  }
}

let noticeTimer: ReturnType<typeof setTimeout> | null = null

export const useAppStore = create<AppState>((set, get) => ({
  bootstrapped: false,
  bootError: null,
  appInfo: null,
  workspaces: [],
  currentWorkspaceId: null,
  sessions: [],
  sessionsByWorkspace: {},
  agents: [],
  teams: [],
  runtimes: [],
  settings: null,
  editors: [],
  activeSession: null,
  archivedSessions: [],
  runToMessage: {},
  toolEvents: {},
  busy: false,
  error: null,
  notice: null,
  searchQuery: '',
  searchResults: [],
  searchHitMessageIds: {},
  searchSnippets: {},
  teamTurns: [],
  teamTurnEvents: {},
  approvals: [],
  notifications: [],
  dataDirStatus: null,

  init: async () => {
    try {
      const api = window.pizza
      const [appInfo, settings, workspaces, editors] = await Promise.all([
        api.app.info(),
        api.settings.get(),
        api.workspace.list(),
        api.editor.list(),
      ])
      let workspacesNow = workspaces
      if (workspacesNow.length === 0) {
        await api.workspace.ensureDefault()
        workspacesNow = await api.workspace.list()
      }
      const current =
        workspacesNow.find((workspace) => workspace.id === settings.currentWorkspaceId) ??
        workspacesNow.find((workspace) => workspace.isDefault) ??
        workspacesNow[0]
      if (current) await api.workspace.select(current.id)
      const [runtimes, agents, teams, settingsNow, ...sessionLists] = await Promise.all([
        api.runtime.list(),
        api.agent.list(),
        current ? api.team.list(current.id) : Promise.resolve([]),
        api.settings.get(),
        ...workspacesNow.map((workspace) => api.session.list(workspace.id)),
      ])
      const sessionsByWorkspace: Record<string, SessionSummary[]> = {}
      workspacesNow.forEach((workspace, index) => {
        sessionsByWorkspace[workspace.id] = sessionLists[index] ?? []
      })
      const [approvals, dataDirStatus, notifications] = await Promise.all([
        api.approval.pending(),
        api.settings.dataDir(),
        current ? api.notification.list(current.id) : Promise.resolve([]),
      ])
      set({
        bootstrapped: true,
        appInfo,
        settings: settingsNow,
        workspaces: workspacesNow,
        currentWorkspaceId: current?.id ?? null,
        editors,
        runtimes,
        agents,
        teams,
        sessions: current ? (sessionsByWorkspace[current.id] ?? []) : [],
        sessionsByWorkspace,
        approvals,
        notifications,
        dataDirStatus,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 数据目录打不开时仍尝试读取路径信息，错误页需要告诉用户实际位置。
      let appInfoNow: AppInfo | null = null
      try {
        appInfoNow = await window.pizza.app.info()
      } catch {
        appInfoNow = null
      }
      set({ bootstrapped: true, bootError: message, appInfo: appInfoNow, error: message })
    }
  },

  refreshSessions: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    const sessions = await window.pizza.session.list(id)
    set((state) => ({
      sessions,
      sessionsByWorkspace: { ...state.sessionsByWorkspace, [id]: sessions },
    }))
  },

  refreshAgents: async () => {
    const agents = await window.pizza.agent.list()
    set({ agents })
  },

  refreshTeams: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    const teams = await window.pizza.team.list(id)
    set({ teams })
  },

  refreshRuntimes: async () => {
    const runtimes = await window.pizza.runtime.list()
    set({ runtimes })
  },

  createTeam: async (input) => {
    try {
      const team = await window.pizza.team.create(input)
      await get().refreshTeams()
      return team
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  updateTeam: async (id, input) => {
    try {
      const team = await window.pizza.team.update(id, input)
      await get().refreshTeams()
      return team
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  archiveTeam: async (id, archived) => {
    try {
      await window.pizza.team.archive(id, archived)
      await get().refreshTeams()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  deleteTeam: async (id) => {
    try {
      await window.pizza.team.remove(id)
      await get().refreshTeams()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      throw error
    }
  },

  createTeamSession: async (teamId) => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return null
    try {
      const session = await window.pizza.session.createTeam({ workspaceId, teamId })
      set({ activeSession: session, teamTurns: [], teamTurnEvents: {} })
      await get().refreshSessions()
      return session
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  deleteWorkspace: async (id) => {
    const workspace = get().workspaces.find((item) => item.id === id)
    if (workspace?.isDefault) {
      set({ error: i18n.t('ui.默认工作区不可删除') })
      return false
    }
    if (get().workspaces.length <= 1) {
      set({ error: i18n.t('ui.至少保留一个工作区') })
      return false
    }
    try {
      const wasCurrent = get().currentWorkspaceId === id
      const next = await window.pizza.workspace.remove(id)
      const workspaces = await window.pizza.workspace.list()
      set((state) => ({
        workspaces,
        sessionsByWorkspace: Object.fromEntries(
          Object.entries(state.sessionsByWorkspace).filter(([workspaceId]) => workspaceId !== id),
        ),
      }))
      if (wasCurrent) await get().selectWorkspace(next.id)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      set({
        error: message.includes('WORKSPACE_DEFAULT')
          ? i18n.t('ui.默认工作区不可删除')
          : message,
      })
      return false
    }
  },

  selectWorkspace: async (id) => {
    try {
      const workspace = await window.pizza.workspace.select(id)
      const [sessions, agents, teams, settings] = await Promise.all([
        window.pizza.session.list(id),
        window.pizza.agent.list(),
        window.pizza.team.list(id),
        window.pizza.settings.get(),
      ])
      set((state) => ({
        currentWorkspaceId: workspace.id,
        sessions,
        sessionsByWorkspace: { ...state.sessionsByWorkspace, [workspace.id]: sessions },
        agents,
        teams,
        settings,
        activeSession: null,
        searchResults: [],
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  pickWorkspace: async () => {
    try {
      const workspace = await window.pizza.workspace.pick()
      if (!workspace) return
      const workspaces = await window.pizza.workspace.list()
      set({ workspaces })
      await get().selectWorkspace(workspace.id)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  openSession: async (id) => {
    try {
      const session = await window.pizza.session.get(id)
      set({ activeSession: session, teamTurns: [], teamTurnEvents: {} })
      if (session.mode === 'team') {
        const turns = await window.pizza.team.turns(session.id)
        set({ teamTurns: turns })
        const latest = turns.at(-1)
        if (latest) await get().loadTurnEvents(latest.id)
      }
      await window.pizza.session.markRead(id)
      await get().refreshSessions()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  createSession: async (agentId) => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return null
    try {
      const session = await window.pizza.session.create({ workspaceId, agentId })
      set({ activeSession: session, teamTurns: [], teamTurnEvents: {} })
      await get().refreshSessions()
      return session
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  sendMessage: async (content, attachments) => {
    const session = get().activeSession
    if (!session) return
    try {
      set({ busy: true, error: null })
      const result = await window.pizza.message.send({
        sessionId: session.id,
        content,
        attachments,
      })
      if (session.mode === 'team') {
        const teamResult = result as TeamSendResult
        set((state) => ({
          busy: false,
          activeSession: state.activeSession
            ? {
                ...state.activeSession,
                messages: [...state.activeSession.messages, teamResult.userMessage],
                status: teamResult.queued ? state.activeSession.status : 'running',
              }
            : state.activeSession,
        }))
        await get().refreshTeamTurns(session.id)
      } else {
        const soloResult = result as SendMessageResult
        set((state) => ({
          busy: false,
          activeSession: state.activeSession
            ? {
                ...state.activeSession,
                messages: [
                  ...state.activeSession.messages,
                  soloResult.userMessage,
                  soloResult.assistantMessage,
                ],
                status: 'running',
              }
            : state.activeSession,
          runToMessage: {
            ...state.runToMessage,
            [soloResult.runId]: soloResult.assistantMessage.id,
          },
        }))
      }
      await get().refreshSessions()
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      })
      throw error
    }
  },

  stopRun: async () => {
    const state = get()
    const running = state.activeSession?.messages
      .slice()
      .reverse()
      .find((message) => message.status === 'running' || message.status === 'streaming')
    if (!running) return
    const runId = Object.entries(state.runToMessage).find(
      ([, messageId]) => messageId === running.id,
    )?.[0]
    if (!runId) return
    try {
      await window.pizza.message.stop(runId)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  stopMessageRun: async (runId) => {
    try {
      await window.pizza.message.stop(runId)
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  retryMessage: async (messageId) => {
    const session = get().activeSession
    if (!session) return
    try {
      set({ busy: true, error: null })
      const result = await window.pizza.message.retry(messageId)
      if (session.mode === 'team') {
        const fresh = await window.pizza.session.get(session.id)
        set({ busy: false, activeSession: fresh })
        await get().refreshTeamTurns(session.id)
        await get().refreshSessions()
        return
      }
      const soloResult = result as SendMessageResult
      set((state) => ({
        busy: false,
        activeSession: state.activeSession
          ? {
              ...state.activeSession,
              messages: [...state.activeSession.messages, soloResult.assistantMessage],
              status: 'running',
            }
          : state.activeSession,
        runToMessage: {
          ...state.runToMessage,
          [soloResult.runId]: soloResult.assistantMessage.id,
        },
      }))
      await get().refreshSessions()
    } catch (error) {
      set({
        busy: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  renameSession: async (id, title) => {
    try {
      const updated = await window.pizza.session.rename(id, title)
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === id ? updated : session,
        ),
        sessionsByWorkspace: Object.fromEntries(
          Object.entries(state.sessionsByWorkspace).map(([workspaceId, list]) => [
            workspaceId,
            list.map((session) => (session.id === id ? updated : session)),
          ]),
        ),
        activeSession:
          state.activeSession?.id === id
            ? { ...state.activeSession, title: updated.title }
            : state.activeSession,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  forkSession: async (id) => {
    try {
      const forked = await window.pizza.session.fork({ sessionId: id })
      set({ activeSession: forked })
      await get().refreshSessions()
      return forked
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  archiveSession: async (id) => {
    try {
      await window.pizza.session.archive(id)
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== id),
        sessionsByWorkspace: Object.fromEntries(
          Object.entries(state.sessionsByWorkspace).map(([workspaceId, list]) => [
            workspaceId,
            list.filter((session) => session.id !== id),
          ]),
        ),
        activeSession: state.activeSession?.id === id ? null : state.activeSession,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  deleteSession: async (id) => {
    try {
      await window.pizza.session.delete(id)
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== id),
        sessionsByWorkspace: Object.fromEntries(
          Object.entries(state.sessionsByWorkspace).map(([workspaceId, list]) => [
            workspaceId,
            list.filter((session) => session.id !== id),
          ]),
        ),
        activeSession: state.activeSession?.id === id ? null : state.activeSession,
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  loadArchived: async () => {
    const id = get().currentWorkspaceId
    if (!id) return
    try {
      const archivedSessions = await window.pizza.session.archived(id)
      set({ archivedSessions })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  restoreSession: async (id) => {
    try {
      await window.pizza.session.restore(id)
      set((state) => ({
        archivedSessions: state.archivedSessions.filter((session) => session.id !== id),
      }))
      await get().refreshSessions()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  refreshArtifacts: async () => {
    const session = get().activeSession
    if (!session) return
    try {
      const artifacts = await window.pizza.artifact.list(session.id)
      set((state) =>
        state.activeSession
          ? { activeSession: { ...state.activeSession, artifacts } }
          : state,
      )
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  search: async (query) => {
    const id = get().currentWorkspaceId
    if (!id) return
    set({ searchQuery: query })
    if (!query.trim()) {
      set({ searchResults: [], searchHitMessageIds: {}, searchSnippets: {} })
      return
    }
    try {
      const hits = await window.pizza.session.search(id, query.trim())
      set({
        searchResults: hits.map((hit) => hit.session),
        searchHitMessageIds: Object.fromEntries(
          hits
            .filter((hit) => hit.messageId)
            .map((hit) => [hit.session.id, hit.messageId as string]),
        ),
        searchSnippets: Object.fromEntries(
          hits
            .filter((hit) => hit.snippet)
            .map((hit) => [hit.session.id, hit.snippet as string]),
        ),
      })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  updateSettings: async (patch) => {
    try {
      const settings = await window.pizza.settings.update(patch)
      set({ settings })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  setError: (message) => set({ error: message }),

  setNotice: (message) => {
    if (noticeTimer) clearTimeout(noticeTimer)
    set({ notice: message })
    if (message) {
      noticeTimer = setTimeout(() => set({ notice: null }), 2600)
    }
  },

  refreshTeamTurns: async (sessionId) => {
    const id = sessionId ?? get().activeSession?.id
    if (!id) return
    const turns = await window.pizza.team.turns(id)
    set({ teamTurns: turns })
    const latest = turns.at(-1)
    if (latest) await get().loadTurnEvents(latest.id)
  },

  loadTurnEvents: async (turnId) => {
    try {
      const events = await window.pizza.team.turnEvents(turnId)
      set((state) => ({
        teamTurnEvents: { ...state.teamTurnEvents, [turnId]: events },
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  stopTurn: async (turnId) => {
    try {
      await window.pizza.team.stopTurn(turnId)
      await get().refreshTeamTurns()
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  handleTeamTurnEvent: (event) => {
    const nextStatus: TeamTurn['status'] | null =
      event.type === 'waiting_user'
        ? 'waiting_user'
        : event.type === 'converging'
          ? 'converging'
          : event.type === 'turn_completed'
            ? 'completed'
            : event.type === 'turn_failed'
              ? 'failed'
              : event.type === 'turn_cancelled'
                ? 'cancelled'
                : event.type === 'turn_interrupted'
                  ? 'interrupted'
                  : event.type === 'run_started' ||
                      event.type === 'dispatch' ||
                      (event.type === 'user_interjection' && event.payload.queued === false)
                    ? 'debating'
                    : null
    set((state) => {
      const existing = state.teamTurnEvents[event.turnId] ?? []
      if (existing.some((item) => item.id === event.id)) return state
      return {
        teamTurnEvents: {
          ...state.teamTurnEvents,
          [event.turnId]: [...existing, event],
        },
        teamTurns: nextStatus
          ? state.teamTurns.map((turn) =>
              turn.id === event.turnId ? { ...turn, status: nextStatus } : turn,
            )
          : state.teamTurns,
      }
    })

    if (event.type === 'run_started') {
      const session = get().activeSession
      const assistantMessageId = String(event.payload.assistantMessageId ?? '')
      const agentId = String(event.payload.agentId ?? event.participantAgentId ?? '')
      if (session && assistantMessageId && agentId) {
        set((state) => {
          if (!state.activeSession) return state
          const exists = state.activeSession.messages.some(
            (message) => message.id === assistantMessageId,
          )
          const message: Message = {
            id: assistantMessageId,
            sessionId: state.activeSession.id,
            senderType: 'agent',
            senderAgentId: agentId,
            content: '',
            contentFormat: 'markdown',
            replyToId: null,
            status: 'running',
            roundNo: 1,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            attachments: [],
            mentions: [],
          }
          return {
            activeSession: exists
              ? state.activeSession
              : {
                  ...state.activeSession,
                  messages: [...state.activeSession.messages, message],
                  status: 'running',
                },
            runToMessage:
              event.runId && assistantMessageId
                ? { ...state.runToMessage, [event.runId]: assistantMessageId }
                : state.runToMessage,
          }
        })
      }
    }

    if (
      event.type === 'run_completed' ||
      event.type === 'run_failed' ||
      event.type === 'run_cancelled' ||
      event.type === 'user_interjection' ||
      event.type === 'waiting_user'
    ) {
      const session = get().activeSession
      if (session) {
        void window.pizza.session.get(session.id).then((fresh) => {
          set({ activeSession: fresh })
          void get().refreshSessions()
        })
      }
    }

    if (
      event.type === 'turn_completed' ||
      event.type === 'turn_failed' ||
      event.type === 'turn_cancelled' ||
      event.type === 'turn_interrupted'
    ) {
      void get().refreshTeamTurns()
      const session = get().activeSession
      if (session) {
        void window.pizza.session.get(session.id).then((fresh) => {
          set({ activeSession: fresh })
          void get().refreshSessions()
        })
      }
    }
  },

  handleRunEvent: (event) => {
    const state = get()
    const messageId = state.runToMessage[event.runId]
    if (!messageId) return
    const session = state.activeSession
    if (!session) return

    if (event.type === 'status') {
      const status = event.payload.status === 'running' ? 'running' : null
      if (status) {
        set({
          activeSession: {
            ...session,
            messages: session.messages.map((message) =>
              message.id === messageId ? { ...message, status } : message,
            ),
          },
        })
      }
      return
    }

    if (event.type === 'text_delta') {
      const text = String(event.payload.text ?? '')
      set({
        activeSession: {
          ...session,
          messages: session.messages.map((message) =>
            message.id === messageId ? messageWithDelta(message, text) : message,
          ),
        },
      })
      return
    }

    if (
      event.type === 'tool_started' ||
      event.type === 'tool_updated' ||
      event.type === 'tool_finished'
    ) {
      const index = event.payload.index
      const id = String(
        event.payload.id ??
          (index !== undefined && index !== null ? `index-${index}` : `tool-${Date.now()}`),
      )
      const name = String(event.payload.name ?? i18n.t('ui.工具调用'))
      const status: ToolCallView['status'] =
        event.type === 'tool_finished'
          ? event.payload.status === 'failed'
            ? 'failed'
            : 'completed'
          : 'running'
      const detail: string | undefined =
        typeof event.payload.output === 'string'
          ? event.payload.output
          : typeof event.payload.partialInput === 'string'
            ? event.payload.partialInput
            : undefined
      set((state) => {
        const current = state.toolEvents[messageId] ?? []
        const existing =
          current.find((tool) => tool.id === id) ??
          (event.type === 'tool_finished'
            ? current.find((tool) => tool.name === name && tool.status === 'running')
            : undefined)
        const next = existing
          ? current.map((tool) =>
              tool.id === existing.id
                ? {
                    ...tool,
                    status,
                    detail: detail ?? tool.detail,
                    name: tool.name === i18n.t('ui.工具调用') ? name : tool.name,
                    endedAt:
                      event.type === 'tool_finished'
                        ? Date.now()
                        : tool.endedAt,
                  }
                : tool,
            )
          : [
              ...current,
              {
                id,
                name,
                status,
                detail,
                startedAt: Date.now(),
                endedAt: event.type === 'tool_finished' ? Date.now() : undefined,
              },
            ]
        return { toolEvents: { ...state.toolEvents, [messageId]: next } }
      })
      return
    }

    if (
      event.type === 'completed' ||
      event.type === 'failed' ||
      event.type === 'cancelled'
    ) {
      const status =
        event.type === 'completed'
          ? 'completed'
          : event.type === 'cancelled'
            ? 'cancelled'
            : 'failed'
      set({
        activeSession: {
          ...session,
          messages: session.messages.map((message) =>
            message.id === messageId ? { ...message, status } : message,
          ),
        },
      })
      void window.pizza.session.get(session.id).then((fresh) => {
        set({ activeSession: fresh })
      })
      void get().refreshSessions()
    }
  },

  handleSessionUpdated: (updated) => {
    set((state) => {
      const nextCurrent = state.sessions.some((session) => session.id === updated.id)
        ? state.sessions.map((session) =>
            session.id === updated.id ? updated : session,
          )
        : [updated, ...state.sessions]
      return {
        sessions: nextCurrent,
        sessionsByWorkspace: {
          ...state.sessionsByWorkspace,
          [updated.workspaceId]: state.sessionsByWorkspace[updated.workspaceId]
            ? state.sessionsByWorkspace[updated.workspaceId].some(
                (session) => session.id === updated.id,
              )
              ? state.sessionsByWorkspace[updated.workspaceId].map((session) =>
                  session.id === updated.id ? updated : session,
                )
              : [updated, ...state.sessionsByWorkspace[updated.workspaceId]]
            : [updated],
        },
        activeSession:
          state.activeSession?.id === updated.id
            ? { ...state.activeSession, status: updated.status }
            : state.activeSession,
      }
    })
  },

  handleArtifactChanged: (artifact) => {
    set((state) => {
      if (!state.activeSession || state.activeSession.id !== artifact.sessionId) {
        return state
      }
      const exists = state.activeSession.artifacts.some(
        (item) => item.id === artifact.id,
      )
      return {
        activeSession: {
          ...state.activeSession,
          artifacts: exists
            ? state.activeSession.artifacts.map((item) =>
                item.id === artifact.id ? artifact : item,
              )
            : [artifact, ...state.activeSession.artifacts],
        },
      }
    })
  },

  handleRuntimeStatus: (payload) => {
    set((state) => ({
      runtimes: state.runtimes.map((runtime) =>
        runtime.id === payload.id ? { ...runtime, status: payload.status } : runtime,
      ),
    }))
  },

  handleApproval: (request) => {
    set((state) => {
      if (request.status !== 'pending') {
        return { approvals: state.approvals.filter((item) => item.id !== request.id) }
      }
      const exists = state.approvals.some((item) => item.id === request.id)
      return {
        approvals: exists
          ? state.approvals.map((item) => (item.id === request.id ? request : item))
          : [...state.approvals, request].sort((a, b) =>
              a.createdAt.localeCompare(b.createdAt),
            ),
      }
    })
  },

  decideApproval: async (approvalId, decision) => {
    try {
      await window.pizza.approval.decide({ approvalId, decision })
      set((state) => ({
        approvals: state.approvals.filter((item) => item.id !== approvalId),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  refreshNotifications: async () => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return
    try {
      const notifications = await window.pizza.notification.list(workspaceId)
      set({ notifications })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  handleNotification: (notification) => {
    set((state) => {
      const exists = state.notifications.some((item) => item.id === notification.id)
      return {
        notifications: exists
          ? state.notifications.map((item) =>
              item.id === notification.id ? notification : item,
            )
          : [notification, ...state.notifications],
      }
    })
  },

  markNotificationRead: async (id) => {
    try {
      await window.pizza.notification.markRead(id)
      set((state) => ({
        notifications: state.notifications.map((item) =>
          item.id === id ? { ...item, status: 'read' } : item,
        ),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  markAllNotificationsRead: async () => {
    const workspaceId = get().currentWorkspaceId
    if (!workspaceId) return
    try {
      await window.pizza.notification.markAllRead(workspaceId)
      set((state) => ({
        notifications: state.notifications.map((item) => ({ ...item, status: 'read' })),
      }))
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },

  handleSettingsChanged: (settings) => set({ settings }),

  refreshDataDir: async () => {
    try {
      const dataDirStatus = await window.pizza.settings.dataDir()
      set({ dataDirStatus })
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
    }
  },
}))
