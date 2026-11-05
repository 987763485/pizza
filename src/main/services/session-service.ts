import { realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import type {
  SessionDetail,
  SessionSearchHit,
  SessionStatus,
  SessionSummary,
} from '@shared/types'
import type { Store } from '../db/store'

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export class SessionService {
  constructor(private readonly store: Store) {}

  list(workspaceId: string): SessionSummary[] {
    return this.store.listSessions(workspaceId)
  }

  archived(workspaceId: string): SessionSummary[] {
    return this.store.listSessions(workspaceId, true)
  }

  get(id: string): SessionDetail {
    const detail = this.store.getSessionDetail(id)
    if (!detail) throw new Error('SESSION_NOT_FOUND')
    return { ...detail, workspacePath: canonical(detail.workspacePath) }
  }

  create(input: {
    workspaceId: string
    agentId: string
    title?: string
    workspacePath?: string
  }): SessionDetail {
    const workspace = this.store.getWorkspace(input.workspaceId)
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
    const agent = this.store.getAgent(input.agentId)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    if (agent.isArchived) throw new Error('AGENT_ARCHIVED')

    const session = this.store.createSession({
      workspaceId: input.workspaceId,
      agentId: input.agentId,
      title: input.title,
      workspacePath: canonical(input.workspacePath || workspace.rootPath),
    })
    return this.get(session.id)
  }

  createTeam(input: {
    workspaceId: string
    teamId: string
    title?: string
    workspacePath?: string
  }): SessionDetail {
    const workspace = this.store.getWorkspace(input.workspaceId)
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
    const team = this.store.getTeam(input.teamId)
    if (!team) throw new Error('TEAM_NOT_FOUND')
    if (team.deletedAt) throw new Error('TEAM_DELETED')
    if (team.isArchived) throw new Error('TEAM_ARCHIVED')
    if (team.workspaceId !== input.workspaceId) throw new Error('TEAM_WORKSPACE_MISMATCH')
    this.store.touchTeam(team.id)
    const session = this.store.createTeamSession({
      workspaceId: input.workspaceId,
      teamId: input.teamId,
      title: input.title,
      workspacePath: canonical(input.workspacePath || workspace.rootPath),
    })
    return this.get(session.id)
  }

  rename(sessionId: string, title: string): SessionSummary {
    return this.store.renameSession(sessionId, title)
  }

  fork(input: { sessionId: string; messageId?: string }): SessionDetail {
    return this.store.forkSession(input.sessionId, input.messageId)
  }

  archive(sessionId: string): void {
    this.store.archiveSession(sessionId)
  }

  restore(sessionId: string): void {
    this.store.restoreSession(sessionId)
  }

  delete(sessionId: string): void {
    this.store.deleteSession(sessionId)
  }

  search(workspaceId: string, query: string): SessionSearchHit[] {
    return this.store.searchSessions(workspaceId, query)
  }

  markRead(sessionId: string): void {
    this.store.setSessionUnread(sessionId, false)
  }

  setStatus(sessionId: string, status: SessionStatus): void {
    this.store.setSessionStatus(sessionId, status)
  }

  touch(sessionId: string): void {
    this.store.touchSession(sessionId)
  }
}
