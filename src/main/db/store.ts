import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import type {
  Agent,
  AgentInput,
  Artifact,
  ArtifactKind,
  Attachment,
  InterjectionMode,
  Message,
  MessageMention,
  MessageStatus,
  MentionTargetType,
  Run,
  RunEvent,
  RunEventType,
  RunStatus,
  RuntimeCapabilities,
  RuntimeConfig,
  RuntimeInput,
  RuntimeStatus,
  Session,
  SessionDetail,
  SessionSearchHit,
  SessionStatus,
  SessionSummary,
  Team,
  TeamDetail,
  TeamInput,
  TeamMember,
  TeamSummary,
  TeamTurn,
  TeamTurnEvent,
  TeamTurnEventType,
  TeamTurnStatus,
  TeamParticipant,
  Workspace,
} from '@shared/types'
import type { PizzaDatabase } from './database'
import { inTransaction } from './database'

const now = () => new Date().toISOString()

interface Row {
  [key: string]: unknown
}

function bool(value: unknown): boolean {
  return Number(value) === 1
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapWorkspace(row: Row): Workspace {
  return {
    id: String(row.id),
    name: String(row.name),
    rootPath: String(row.root_path),
    isDefault: bool(row.is_default),
    createdAt: String(row.created_at),
  }
}

function mapRuntime(row: Row): RuntimeConfig {
  return {
    id: String(row.id),
    name: String(row.name),
    adapter: String(row.adapter) as RuntimeConfig['adapter'],
    protocol: String(row.protocol) as RuntimeConfig['protocol'],
    transport: String(row.transport) as RuntimeConfig['transport'],
    command: nullableString(row.command) ?? undefined,
    args: parseJson<string[]>(row.args_json, []),
    cwd: nullableString(row.cwd) ?? undefined,
    url: nullableString(row.url) ?? undefined,
    env: parseJson<Record<string, string>>(row.env_json, {}),
    timeoutMs: Number(row.timeout_ms ?? 30_000),
    autoReconnect: Number(row.auto_reconnect ?? 1) === 1,
    status: String(row.status) as RuntimeStatus,
    capabilities: parseJson<RuntimeCapabilities>(row.capabilities_json, {}),
    lastConnectedAt: nullableString(row.last_connected_at) ?? undefined,
    createdAt: String(row.created_at),
  }
}

function mapAgent(row: Row): Agent {
  return {
    id: String(row.id),
    name: String(row.name),
    description: String(row.description ?? ''),
    avatar: nullableString(row.avatar),
    runtimeId: String(row.runtime_id),
    prompt: String(row.prompt),
    instructionMode: String(row.instruction_mode ?? 'self') as Agent['instructionMode'],
    thinkingLevel: String(row.thinking_level) as Agent['thinkingLevel'],
    contextLimit: Number(row.context_limit),
    model: nullableString(row.model),
    maxConcurrency: Number(row.max_concurrency ?? 3),
    isArchived: bool(row.is_archived),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapSession(row: Row): Session {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    title: String(row.title),
    mode: String(row.mode) as Session['mode'],
    agentId: nullableString(row.agent_id),
    teamId: nullableString(row.team_id),
    workspacePath: String(row.workspace_path),
    status: String(row.status) as SessionStatus,
    unread: bool(row.unread),
    interjectionMode: String(row.interjection_mode ?? 'queue') as InterjectionMode,
    forkedFromId: nullableString(row.forked_from_id),
    runtimeSessionId: nullableString(row.runtime_session_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    archivedAt: nullableString(row.archived_at),
  }
}

function mapSessionSummary(row: Row): SessionSummary {
  return {
    ...mapSession(row),
    agentName: nullableString(row.agent_name),
    agentAvatar: nullableString(row.agent_avatar),
    teamName: nullableString(row.team_name),
    teamAvatar: nullableString(row.team_avatar),
    messageCount: Number(row.message_count ?? 0),
    lastMessage: nullableString(row.last_message),
  }
}

function mapMessage(
  row: Row,
  attachments: Attachment[],
  mentions: MessageMention[],
): Message {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    senderType: String(row.sender_type) as Message['senderType'],
    senderAgentId: nullableString(row.sender_agent_id),
    content: String(row.content),
    contentFormat: String(row.content_format) as Message['contentFormat'],
    replyToId: nullableString(row.reply_to_id),
    status: String(row.status) as MessageStatus,
    roundNo: Number(row.round_no),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    attachments,
    mentions,
  }
}

function mapMention(row: Row): MessageMention {
  return {
    id: String(row.id),
    messageId: String(row.message_id),
    targetType: String(row.target_type) as MentionTargetType,
    targetAgentId: nullableString(row.target_agent_id),
    displayName: String(row.display_name),
    start: Number(row.start_index),
    end: Number(row.end_index),
    raw: String(row.raw),
    resolved: bool(row.resolved),
    createdAt: String(row.created_at),
  }
}

function mapTeam(row: Row): Team {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    avatar: nullableString(row.avatar),
    leaderAgentId: String(row.leader_agent_id),
    orchestrationPrompt: String(row.orchestration_prompt ?? ''),
    fanoutStrategy: String(row.fanout_strategy) as Team['fanoutStrategy'],
    maxConcurrency: Number(row.max_concurrency),
    maxHops: Number(row.max_hops),
    tokenBudget: Number(row.token_budget ?? 0),
    isArchived: bool(row.is_archived),
    deletedAt: nullableString(row.deleted_at),
    lastUsedAt: nullableString(row.last_used_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapTeamSummary(row: Row): TeamSummary {
  return {
    ...mapTeam(row),
    memberCount: Number(row.member_count ?? 0),
    sessionCount: Number(row.session_count ?? 0),
    leaderName: nullableString(row.leader_name),
    leaderAvatar: nullableString(row.leader_avatar),
    memberAvatars: [],
  }
}

function mapTeamMember(row: Row): TeamMember {
  const capability = parseJson<Record<string, unknown>>(row.capability_json, {})
  const skills = Array.isArray(capability.skills) ? capability.skills.map(String) : []
  const mcpServers = Array.isArray(capability.mcpServers)
    ? capability.mcpServers.map(String)
    : []
  return {
    id: String(row.id),
    teamId: String(row.team_id),
    agentId: String(row.agent_id),
    position: Number(row.position),
    role: String(row.role ?? ''),
    promptMode: String(row.prompt_mode) as TeamMember['promptMode'],
    prompt: String(row.prompt ?? ''),
    capabilityOverrides: { skills, mcpServers },
    createdAt: String(row.created_at),
  }
}

function mapTeamTurn(row: Row): TeamTurn {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    seq: Number(row.seq),
    status: String(row.status) as TeamTurnStatus,
    triggerMessageId: String(row.trigger_message_id),
    leaderAgentId: String(row.leader_agent_id),
    startedAt: String(row.started_at),
    endedAt: nullableString(row.ended_at),
    convergenceReason: nullableString(row.convergence_reason),
    hops: Number(row.hops ?? 0),
    rounds: Number(row.rounds ?? 0),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    error: nullableString(row.error),
    createdAt: String(row.created_at),
  }
}

function mapTeamTurnEvent(row: Row): TeamTurnEvent {
  return {
    id: Number(row.id),
    turnId: String(row.turn_id),
    seq: Number(row.seq),
    type: String(row.type) as TeamTurnEventType,
    participantAgentId: nullableString(row.participant_agent_id),
    runId: nullableString(row.run_id),
    payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    createdAt: String(row.created_at),
  }
}

function mapAttachment(row: Row): Attachment {
  return {
    id: String(row.id),
    messageId: nullableString(row.message_id),
    name: String(row.name),
    path: String(row.path),
    mime: String(row.mime),
    size: Number(row.size),
    createdAt: String(row.created_at),
  }
}

function mapRun(row: Row): Run {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    triggerMessageId: String(row.trigger_message_id),
    agentId: String(row.agent_id),
    parentRunId: nullableString(row.parent_run_id),
    teamTurnId: nullableString(row.team_turn_id),
    status: String(row.status) as RunStatus,
    startedAt: nullableString(row.started_at),
    endedAt: nullableString(row.ended_at),
    error: nullableString(row.error),
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    cost: Number(row.cost ?? 0),
    createdAt: String(row.created_at),
  }
}

function mapArtifact(row: Row): Artifact {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    runId: nullableString(row.run_id),
    agentId: nullableString(row.agent_id),
    path: String(row.path),
    kind: String(row.kind) as ArtifactKind,
    title: String(row.title),
    createdAt: String(row.created_at),
  }
}

function sanitizeFts(query: string): string {
  return query
    .replace(/["']/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => `"${token.replace(/[^\p{L}\p{N}_-]/gu, '')}"`)
    .filter((token) => token !== '""')
    .join(' AND ')
}

export class Store {
  constructor(private readonly db: PizzaDatabase) { }

  // ---------- settings ----------

  getSetting<T>(key: string, fallback: T): T {
    const row = this.db
      .prepare('SELECT value_json FROM app_setting WHERE key = ?')
      .get(key) as Row | undefined
    if (!row) return fallback
    return parseJson<T>(row.value_json, fallback)
  }

  setSetting(key: string, value: unknown): void {
    this.db
      .prepare(
        `INSERT INTO app_setting (key, value_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now())
  }

  getAllSettings(): Record<string, unknown> {
    const rows = this.db
      .prepare('SELECT key, value_json FROM app_setting')
      .all() as Row[]
    return Object.fromEntries(
      rows.map((row) => [String(row.key), parseJson(row.value_json, null)]),
    )
  }

  // ---------- workspaces ----------

  listWorkspaces(): Workspace[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM workspace
           ORDER BY is_default DESC, created_at ASC`,
        )
        .all() as Row[]
    ).map(mapWorkspace)
  }

  getWorkspace(id: string): Workspace | null {
    const row = this.db
      .prepare('SELECT * FROM workspace WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapWorkspace(row) : null
  }

  findWorkspaceByPath(rootPath: string): Workspace | null {
    const row = this.db
      .prepare('SELECT * FROM workspace WHERE root_path = ?')
      .get(rootPath) as Row | undefined
    return row ? mapWorkspace(row) : null
  }

  createWorkspace(rootPath: string, isDefault = false): Workspace {
    const existing = this.findWorkspaceByPath(rootPath)
    if (existing) return existing
    const id = randomUUID()
    const createdAt = now()
    if (isDefault) {
      this.db.prepare('UPDATE workspace SET is_default = 0').run()
    }
    this.db
      .prepare(
        `INSERT INTO workspace (id, name, root_path, is_default, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, basename(rootPath) || 'Pizza', rootPath, isDefault ? 1 : 0, createdAt)
    return {
      id,
      name: basename(rootPath) || 'Pizza',
      rootPath,
      isDefault,
      createdAt,
    }
  }

  deleteWorkspace(id: string): Workspace | null {
    const existing = this.getWorkspace(id)
    if (!existing) throw new Error('WORKSPACE_NOT_FOUND')
    if (existing.isDefault) throw new Error('WORKSPACE_DEFAULT')
    this.db.prepare('DELETE FROM workspace WHERE id = ?').run(id)
    const remaining = this.listWorkspaces()
    if (remaining.length === 0) return null
    return remaining.find((workspace) => workspace.isDefault) ?? remaining[0]
  }

  ensureDefaultWorkspace(rootPath: string): Workspace {
    const existingDefault = this.db
      .prepare('SELECT * FROM workspace WHERE is_default = 1 LIMIT 1')
      .get() as Row | undefined
    if (existingDefault) return mapWorkspace(existingDefault)

    const existing = this.findWorkspaceByPath(rootPath)
    if (existing) {
      this.db.prepare('UPDATE workspace SET is_default = 1 WHERE id = ?').run(existing.id)
      return { ...existing, isDefault: true }
    }
    return this.createWorkspace(rootPath, true)
  }

  // ---------- runtimes ----------

  listRuntimes(): RuntimeConfig[] {
    return (
      this.db
        .prepare('SELECT * FROM runtime ORDER BY created_at ASC')
        .all() as Row[]
    ).map(mapRuntime)
  }

  getRuntime(id: string): RuntimeConfig | null {
    const row = this.db
      .prepare('SELECT * FROM runtime WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapRuntime(row) : null
  }

  createRuntime(input: RuntimeInput): RuntimeConfig {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO runtime
         (id, name, adapter, protocol, transport, command, args_json, cwd, url, env_json, timeout_ms, auto_reconnect, status, capabilities_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', '{}', ?)`,
      )
      .run(
        id,
        input.name,
        input.adapter,
        input.protocol,
        input.transport,
        input.command ?? null,
        JSON.stringify(input.args ?? []),
        input.cwd ?? null,
        input.url ?? null,
        JSON.stringify(input.env ?? {}),
        input.timeoutMs ?? 30_000,
        input.autoReconnect === false ? 0 : 1,
        createdAt,
      )
    return this.getRuntime(id) as RuntimeConfig
  }

  updateRuntime(id: string, input: RuntimeInput): RuntimeConfig {
    this.db
      .prepare(
        `UPDATE runtime SET name = ?, adapter = ?, protocol = ?, transport = ?,
         command = ?, args_json = ?, cwd = ?, url = ?, env_json = ?,
         timeout_ms = ?, auto_reconnect = ?,
         status = 'draft', capabilities_json = '{}', last_connected_at = NULL
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.adapter,
        input.protocol,
        input.transport,
        input.command ?? null,
        JSON.stringify(input.args ?? []),
        input.cwd ?? null,
        input.url ?? null,
        JSON.stringify(input.env ?? {}),
        input.timeoutMs ?? 30_000,
        input.autoReconnect === false ? 0 : 1,
        id,
      )
    const runtime = this.getRuntime(id)
    if (!runtime) throw new Error('RUNTIME_NOT_FOUND')
    return runtime
  }

  deleteRuntime(id: string): void {
    const used = this.db
      .prepare('SELECT COUNT(*) AS count FROM agent WHERE runtime_id = ?')
      .get(id) as Row
    if (Number(used.count) > 0) throw new Error('RUNTIME_IN_USE')
    this.db.prepare('DELETE FROM runtime WHERE id = ?').run(id)
  }

  setRuntimeStatus(
    id: string,
    status: RuntimeStatus,
    capabilities?: RuntimeCapabilities,
  ): void {
    this.db
      .prepare(
        `UPDATE runtime SET status = ?, capabilities_json = COALESCE(?, capabilities_json),
         last_connected_at = CASE WHEN ? = 'online' THEN ? ELSE last_connected_at END
         WHERE id = ?`,
      )
      .run(
        status,
        capabilities === undefined ? null : JSON.stringify(capabilities),
        status,
        now(),
        id,
      )
  }

  // ---------- agents ----------

  listAgents(): Agent[] {
    return (
      this.db
        .prepare('SELECT * FROM agent ORDER BY is_archived ASC, updated_at DESC')
        .all() as Row[]
    ).map(mapAgent)
  }

  getAgent(id: string): Agent | null {
    const row = this.db
      .prepare('SELECT * FROM agent WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapAgent(row) : null
  }

  createAgent(input: AgentInput): Agent {
    if (this.db.prepare('SELECT 1 FROM agent WHERE name = ?').get(input.name)) {
      throw new Error('AGENT_NAME_EXISTS')
    }
    const id = randomUUID()
    const createdAt = now()
    try {
      this.db
        .prepare(
          `INSERT INTO agent
           (id, name, description, avatar, runtime_id, prompt, instruction_mode,
            thinking_level, context_limit, model, max_concurrency,
            is_archived, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        )
        .run(
          id,
          input.name,
          input.description ?? '',
          input.avatar ?? null,
          input.runtimeId,
          input.prompt,
          input.instructionMode ?? 'self',
          input.thinkingLevel ?? 'medium',
          input.contextLimit ?? 200_000,
          input.model ?? null,
          input.maxConcurrency ?? 3,
          createdAt,
          createdAt,
        )
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new Error('AGENT_NAME_EXISTS')
      }
      throw error
    }
    return this.getAgent(id) as Agent
  }

  updateAgent(id: string, input: AgentInput): Agent {
    const conflict = this.db
      .prepare('SELECT 1 FROM agent WHERE name = ? AND id != ?')
      .get(input.name, id)
    if (conflict) throw new Error('AGENT_NAME_EXISTS')
    try {
      this.db
        .prepare(
          `UPDATE agent SET name = ?, description = ?, avatar = ?, runtime_id = ?,
           prompt = ?, instruction_mode = ?, thinking_level = ?, context_limit = ?,
           model = ?, max_concurrency = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(
          input.name,
          input.description ?? '',
          input.avatar ?? null,
          input.runtimeId,
          input.prompt,
          input.instructionMode ?? 'self',
          input.thinkingLevel ?? 'medium',
          input.contextLimit ?? 200_000,
          input.model ?? null,
          input.maxConcurrency ?? 3,
          now(),
          id,
        )
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new Error('AGENT_NAME_EXISTS')
      }
      throw error
    }
    const agent = this.getAgent(id)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    return agent
  }

  duplicateAgent(id: string): Agent {
    const source = this.getAgent(id)
    if (!source) throw new Error('AGENT_NOT_FOUND')
    let name = `${source.name} 副本`
    let index = 2
    while (
      this.db
        .prepare('SELECT 1 FROM agent WHERE name = ?')
        .get(name)
    ) {
      name = `${source.name} 副本 ${index++}`
    }
    return this.createAgent({
      name,
      description: source.description,
      avatar: source.avatar,
      runtimeId: source.runtimeId,
      prompt: source.prompt,
      instructionMode: source.instructionMode,
      thinkingLevel: source.thinkingLevel,
      contextLimit: source.contextLimit,
      model: source.model,
      maxConcurrency: source.maxConcurrency,
    })
  }

  archiveAgent(id: string, archived: boolean): Agent {
    this.db
      .prepare('UPDATE agent SET is_archived = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, now(), id)
    const agent = this.getAgent(id)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    return agent
  }

  deleteAgent(id: string): void {
    this.db.prepare('DELETE FROM agent WHERE id = ?').run(id)
  }

  countActiveSessionsForAgent(id: string): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS count FROM session WHERE agent_id = ? AND archived_at IS NULL',
      )
      .get(id) as Row
    return Number(row.count)
  }

  // ---------- teams ----------

  listTeams(workspaceId: string, includeArchived = false): TeamSummary[] {
    const teams = (
      this.db
        .prepare(
          `SELECT t.*, a.name AS leader_name, a.avatar AS leader_avatar,
            (SELECT COUNT(*) FROM team_member m WHERE m.team_id = t.id) AS member_count,
            (SELECT COUNT(*) FROM session s WHERE s.team_id = t.id) AS session_count
           FROM team t
           LEFT JOIN agent a ON a.id = t.leader_agent_id
           WHERE t.workspace_id = ? AND t.deleted_at IS NULL
             ${includeArchived ? '' : 'AND t.is_archived = 0'}
           ORDER BY t.is_archived ASC, t.last_used_at DESC NULLS LAST, t.updated_at DESC`,
        )
        .all(workspaceId) as Row[]
    ).map(mapTeamSummary)

    // 列表默认头像需要成员拼贴；团队数量很小，逐团队取成员比缓存多一份
    // 反范式字段更简单，也能保证成员变化后立即刷新。
    for (const team of teams) {
      team.memberAvatars = this.listTeamMembers(team.id).flatMap((member) => {
        const agent = this.getAgent(member.agentId)
        return agent
          ? [{ id: agent.id, name: agent.name, avatar: agent.avatar }]
          : []
      })
    }
    return teams
  }

  getTeam(id: string): Team | null {
    const row = this.db
      .prepare('SELECT * FROM team WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapTeam(row) : null
  }

  getTeamDetail(id: string): TeamDetail | null {
    const team = this.getTeam(id)
    if (!team) return null
    return { ...team, members: this.listTeamMembers(id) }
  }

  listTeamMembers(teamId: string): TeamMember[] {
    return (
      this.db
        .prepare('SELECT * FROM team_member WHERE team_id = ? ORDER BY position ASC, created_at ASC')
        .all(teamId) as Row[]
    ).map(mapTeamMember)
  }

  createTeam(input: TeamInput): TeamDetail {
    const id = randomUUID()
    const createdAt = now()
    try {
      inTransaction(this.db, () => {
        this.db
          .prepare(
            `INSERT INTO team
             (id, workspace_id, name, description, avatar, leader_agent_id,
              orchestration_prompt, fanout_strategy, max_concurrency,
              max_hops, token_budget, is_archived, last_used_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?, ?)`,
          )
          .run(
            id,
            input.workspaceId,
            input.name,
            input.description ?? '',
            input.avatar ?? null,
            input.leaderAgentId,
            input.orchestrationPrompt ?? '',
            input.fanoutStrategy ?? 'parallel',
            input.maxConcurrency ?? 3,
            input.maxHops ?? 64,
            input.tokenBudget ?? 0,
            createdAt,
            createdAt,
          )
        this.replaceTeamMembers(id, input.leaderAgentId, input.members, createdAt)
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new Error('TEAM_NAME_EXISTS')
      }
      throw error
    }
    return this.getTeamDetail(id) as TeamDetail
  }

  updateTeam(id: string, input: TeamInput): TeamDetail {
    const existing = this.getTeam(id)
    if (!existing) throw new Error('TEAM_NOT_FOUND')
    try {
      inTransaction(this.db, () => {
        this.db
          .prepare(
            `UPDATE team SET name = ?, description = ?, avatar = ?, leader_agent_id = ?,
             orchestration_prompt = ?, fanout_strategy = ?, max_concurrency = ?,
             max_hops = ?, token_budget = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            input.name,
            input.description ?? '',
            input.avatar ?? null,
            input.leaderAgentId,
            input.orchestrationPrompt ?? '',
            input.fanoutStrategy ?? 'parallel',
            input.maxConcurrency ?? 3,
            input.maxHops ?? 64,
            input.tokenBudget ?? 0,
            now(),
            id,
          )
        this.db.prepare('DELETE FROM team_member WHERE team_id = ?').run(id)
        this.replaceTeamMembers(id, input.leaderAgentId, input.members, existing.createdAt)
      })
    } catch (error) {
      if (String(error).includes('UNIQUE constraint failed')) {
        throw new Error('TEAM_NAME_EXISTS')
      }
      throw error
    }
    return this.getTeamDetail(id) as TeamDetail
  }

  private replaceTeamMembers(
    teamId: string,
    leaderAgentId: string,
    members: TeamInput['members'],
    createdAt: string,
  ): void {
    if (!members.some((member) => member.agentId === leaderAgentId)) {
      throw new Error('TEAM_LEADER_NOT_MEMBER')
    }
    members.forEach((member, index) => {
      const capability = {
        skills: member.capabilityOverrides?.skills ?? [],
        mcpServers: member.capabilityOverrides?.mcpServers ?? [],
      }
      this.db
        .prepare(
          `INSERT INTO team_member
           (id, team_id, agent_id, position, role, prompt_mode, prompt, capability_json, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          teamId,
          member.agentId,
          index,
          member.role ?? '',
          member.promptMode ?? 'inherit',
          member.prompt ?? '',
          JSON.stringify(capability),
          createdAt,
        )
    })
  }

  setTeamArchived(id: string, archived: boolean): Team {
    this.db
      .prepare('UPDATE team SET is_archived = ?, updated_at = ? WHERE id = ?')
      .run(archived ? 1 : 0, now(), id)
    const team = this.getTeam(id)
    if (!team) throw new Error('TEAM_NOT_FOUND')
    return team
  }

  deleteTeam(id: string): void {
    // 软删除：团队从列表与新建会话中消失，但保留行以让历史会话继续显示
    // 团队名称和头像；成员关系不删除，便于审计。
    const at = now()
    this.db
      .prepare('UPDATE team SET deleted_at = ?, is_archived = 1, updated_at = ? WHERE id = ?')
      .run(at, at, id)
  }

  touchTeam(id: string): void {
    const at = now()
    this.db
      .prepare('UPDATE team SET last_used_at = ?, updated_at = ? WHERE id = ?')
      .run(at, at, id)
  }

  countSessionsForTeam(id: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM session WHERE team_id = ?')
      .get(id) as Row
    return Number(row.count)
  }

  // ---------- mentions ----------

  addMention(input: {
    messageId: string
    targetType: MentionTargetType
    targetAgentId?: string | null
    displayName: string
    start: number
    end: number
    raw: string
    resolved: boolean
  }): MessageMention {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO message_mention
         (id, message_id, target_type, target_agent_id, display_name,
          start_index, end_index, raw, resolved, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.messageId,
        input.targetType,
        input.targetAgentId ?? null,
        input.displayName,
        input.start,
        input.end,
        input.raw,
        input.resolved ? 1 : 0,
        createdAt,
      )
    return {
      id,
      messageId: input.messageId,
      targetType: input.targetType,
      targetAgentId: input.targetAgentId ?? null,
      displayName: input.displayName,
      start: input.start,
      end: input.end,
      raw: input.raw,
      resolved: input.resolved,
      createdAt,
    }
  }

  listMentions(messageId: string): MessageMention[] {
    return (
      this.db
        .prepare('SELECT * FROM message_mention WHERE message_id = ? ORDER BY start_index ASC')
        .all(messageId) as Row[]
    ).map(mapMention)
  }

  // ---------- team turns ----------

  createTeamTurn(input: {
    sessionId: string
    triggerMessageId: string
    leaderAgentId: string
    status?: TeamTurnStatus
  }): TeamTurn {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM team_turn WHERE session_id = ?')
      .get(input.sessionId) as Row
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO team_turn
         (id, session_id, seq, status, trigger_message_id, leader_agent_id,
          started_at, ended_at, convergence_reason, hops, rounds, tokens_in,
          tokens_out, error, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 0, 0, 0, 0, NULL, ?)`,
      )
      .run(
        id,
        input.sessionId,
        Number(row.next),
        input.status ?? 'dispatching',
        input.triggerMessageId,
        input.leaderAgentId,
        createdAt,
        createdAt,
      )
    return this.getTeamTurn(id) as TeamTurn
  }

  getTeamTurn(id: string): TeamTurn | null {
    const row = this.db
      .prepare('SELECT * FROM team_turn WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapTeamTurn(row) : null
  }

  listTeamTurns(sessionId: string): TeamTurn[] {
    return (
      this.db
        .prepare('SELECT * FROM team_turn WHERE session_id = ? ORDER BY seq ASC')
        .all(sessionId) as Row[]
    ).map(mapTeamTurn)
  }

  updateTeamTurn(
    id: string,
    patch: Partial<
      Pick<
        TeamTurn,
        | 'status'
        | 'endedAt'
        | 'convergenceReason'
        | 'hops'
        | 'rounds'
        | 'tokensIn'
        | 'tokensOut'
        | 'error'
      >
    >,
  ): TeamTurn {
    const current = this.getTeamTurn(id)
    if (!current) throw new Error('TEAM_TURN_NOT_FOUND')
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE team_turn SET status = ?, ended_at = ?, convergence_reason = ?,
         hops = ?, rounds = ?, tokens_in = ?, tokens_out = ?, error = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.endedAt,
        next.convergenceReason,
        next.hops,
        next.rounds,
        next.tokensIn,
        next.tokensOut,
        next.error,
        id,
      )
    return this.getTeamTurn(id) as TeamTurn
  }

  addTeamTurnEvent(input: {
    turnId: string
    type: TeamTurnEventType
    participantAgentId?: string | null
    runId?: string | null
    payload?: Record<string, unknown>
  }): TeamTurnEvent {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM team_turn_event WHERE turn_id = ?')
      .get(input.turnId) as Row
    const createdAt = now()
    const result = this.db
      .prepare(
        `INSERT INTO team_turn_event
         (turn_id, seq, type, participant_agent_id, run_id, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.turnId,
        Number(row.next),
        input.type,
        input.participantAgentId ?? null,
        input.runId ?? null,
        JSON.stringify(input.payload ?? {}),
        createdAt,
      )
    return {
      id: Number(result.lastInsertRowid),
      turnId: input.turnId,
      seq: Number(row.next),
      type: input.type,
      participantAgentId: input.participantAgentId ?? null,
      runId: input.runId ?? null,
      payload: input.payload ?? {},
      createdAt,
    }
  }

  listTeamTurnEvents(turnId: string): TeamTurnEvent[] {
    return (
      this.db
        .prepare('SELECT * FROM team_turn_event WHERE turn_id = ? ORDER BY seq ASC')
        .all(turnId) as Row[]
    ).map(mapTeamTurnEvent)
  }

  // ---------- sessions ----------

  createSession(input: {
    workspaceId: string
    agentId: string
    title?: string
    workspacePath: string
  }): Session {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO session
         (id, workspace_id, title, mode, agent_id, team_id, workspace_path,
          status, unread, forked_from_id, runtime_session_id, created_at, updated_at, archived_at)
         VALUES (?, ?, ?, 'agent', ?, NULL, ?, 'idle', 0, NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.workspaceId,
        input.title?.slice(0, 120) || '新会话',
        input.agentId,
        input.workspacePath,
        createdAt,
        createdAt,
      )
    return this.getSession(id) as Session
  }

  createTeamSession(input: {
    workspaceId: string
    teamId: string
    title?: string
    workspacePath: string
  }): Session {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO session
         (id, workspace_id, title, mode, agent_id, team_id, workspace_path,
          status, unread, interjection_mode, forked_from_id, runtime_session_id,
          created_at, updated_at, archived_at)
         VALUES (?, ?, ?, 'team', NULL, ?, ?, 'idle', 0, 'queue', NULL, NULL, ?, ?, NULL)`,
      )
      .run(
        id,
        input.workspaceId,
        input.title?.slice(0, 120) || '新团队会话',
        input.teamId,
        input.workspacePath,
        createdAt,
        createdAt,
      )
    return this.getSession(id) as Session
  }

  getSession(id: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM session WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapSession(row) : null
  }

  getSessionSummary(id: string): SessionSummary | null {
    const row = this.db
      .prepare(
        `SELECT s.*, a.name AS agent_name, a.avatar AS agent_avatar,
          t.name AS team_name, t.avatar AS team_avatar,
          (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
          (SELECT m.content FROM message m WHERE m.session_id = s.id
           ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM session s
         LEFT JOIN agent a ON a.id = s.agent_id
         LEFT JOIN team t ON t.id = s.team_id
         WHERE s.id = ?`,
      )
      .get(id) as Row | undefined
    return row ? mapSessionSummary(row) : null
  }

  listSessions(workspaceId: string, archived = false): SessionSummary[] {
    const rows = this.db
      .prepare(
        `SELECT s.*, a.name AS agent_name, a.avatar AS agent_avatar,
          t.name AS team_name, t.avatar AS team_avatar,
          (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
          (SELECT m.content FROM message m WHERE m.session_id = s.id
           ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM session s
         LEFT JOIN agent a ON a.id = s.agent_id
         LEFT JOIN team t ON t.id = s.team_id
         WHERE s.workspace_id = ? AND s.archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
         ORDER BY s.created_at DESC, s.rowid DESC`,
      )
      .all(workspaceId) as Row[]
    return rows.map(mapSessionSummary)
  }

  getSessionDetail(id: string): SessionDetail | null {
    const session = this.getSession(id)
    if (!session) return null
    const agent = session.agentId ? this.getAgent(session.agentId) : null
    const team = session.teamId ? this.getTeamDetail(session.teamId) : null
    const participants: TeamParticipant[] = []
    if (team) {
      for (const member of team.members) {
        const memberAgent = this.getAgent(member.agentId)
        if (!memberAgent) continue
        participants.push({
          agent: memberAgent,
          role: member.agentId === team.leaderAgentId ? 'leader' : 'member',
          roleDescription: member.role,
          position: member.position,
        })
      }
    }
    return {
      ...session,
      agent,
      team,
      participants,
      messages: this.listMessages(id),
      artifacts: this.listArtifacts(id),
    }
  }

  renameSession(id: string, title: string): SessionSummary {
    this.db
      .prepare('UPDATE session SET title = ?, updated_at = ? WHERE id = ?')
      .run(title.slice(0, 120), now(), id)
    const session = this.getSessionSummary(id)
    if (!session) throw new Error('SESSION_NOT_FOUND')
    return session
  }

  forkSession(id: string, messageId?: string): SessionDetail {
    const source = this.getSession(id)
    if (!source) throw new Error('SESSION_NOT_FOUND')

    return inTransaction(this.db, () => {
      const newId = randomUUID()
      const createdAt = now()
      this.db
        .prepare(
          `INSERT INTO session
           (id, workspace_id, title, mode, agent_id, team_id, workspace_path,
            status, unread, forked_from_id, runtime_session_id, created_at, updated_at, archived_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'idle', 0, ?, NULL, ?, ?, NULL)`,
        )
        .run(
          newId,
          source.workspaceId,
          `${source.title}（分叉）`,
          source.mode,
          source.agentId,
          source.teamId,
          source.workspacePath,
          source.id,
          createdAt,
          createdAt,
        )

      const messages = this.listMessages(id)
      const cutoff = messageId
        ? messages.findIndex((message) => message.id === messageId)
        : messages.length - 1
      const kept = cutoff >= 0 ? messages.slice(0, cutoff + 1) : messages

      for (const message of kept) {
        const newMessageId = randomUUID()
        this.db
          .prepare(
            `INSERT INTO message
             (id, session_id, sender_type, sender_agent_id, content, content_format,
              reply_to_id, status, round_no, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`,
          )
          .run(
            newMessageId,
            newId,
            message.senderType,
            message.senderAgentId,
            message.content,
            message.contentFormat,
            message.status,
            message.roundNo,
            message.createdAt,
            message.updatedAt,
          )
        this.insertFts(newMessageId, newId, message.content)
        for (const attachment of message.attachments) {
          this.db
            .prepare(
              `INSERT INTO attachment (id, message_id, name, path, mime, size, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              randomUUID(),
              newMessageId,
              attachment.name,
              attachment.path,
              attachment.mime,
              attachment.size,
              attachment.createdAt,
            )
        }
      }

      for (const artifact of this.listArtifacts(id)) {
        this.upsertArtifact(newId, artifact.runId, artifact.agentId, artifact.path, artifact.kind)
      }

      return this.getSessionDetail(newId) as SessionDetail
    })
  }

  archiveSession(id: string): void {
    this.db
      .prepare('UPDATE session SET archived_at = ?, updated_at = ? WHERE id = ?')
      .run(now(), now(), id)
  }

  restoreSession(id: string): void {
    this.db
      .prepare('UPDATE session SET archived_at = NULL, updated_at = ? WHERE id = ?')
      .run(now(), id)
  }

  deleteSession(id: string): void {
    const messageIds = this.listMessages(id).map((message) => message.id)
    for (const messageId of messageIds) this.deleteFts(messageId)
    this.db.prepare('DELETE FROM session WHERE id = ?').run(id)
  }

  setSessionStatus(id: string, status: SessionStatus): void {
    this.db
      .prepare('UPDATE session SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id)
  }

  setSessionUnread(id: string, unread: boolean): void {
    this.db
      .prepare('UPDATE session SET unread = ?, updated_at = ? WHERE id = ?')
      .run(unread ? 1 : 0, now(), id)
  }

  setSessionRuntimeId(id: string, runtimeSessionId: string | null): void {
    this.db
      .prepare('UPDATE session SET runtime_session_id = ? WHERE id = ?')
      .run(runtimeSessionId, id)
  }

  touchSession(id: string): void {
    this.db.prepare('UPDATE session SET updated_at = ? WHERE id = ?').run(now(), id)
  }

  searchSessions(workspaceId: string, query: string): SessionSearchHit[] {
    const hits = new Map<string, SessionSearchHit>()
    const rows = this.db
      .prepare(
        `SELECT s.*, a.name AS agent_name, a.avatar AS agent_avatar,
          t.name AS team_name, t.avatar AS team_avatar,
          (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
          (SELECT m.content FROM message m WHERE m.session_id = s.id
           ORDER BY m.created_at DESC LIMIT 1) AS last_message
         FROM session s
         LEFT JOIN agent a ON a.id = s.agent_id
         LEFT JOIN team t ON t.id = s.team_id
         WHERE s.workspace_id = ? AND s.archived_at IS NULL
           AND (s.title LIKE ? OR a.name LIKE ? OR t.name LIKE ?)
         ORDER BY s.updated_at DESC LIMIT 20`,
      )
      .all(workspaceId, `%${query}%`, `%${query}%`, `%${query}%`) as Row[]
    for (const row of rows) {
      const session = mapSessionSummary(row)
      hits.set(session.id, { session, messageId: null, snippet: null })
    }

    // FTS5 对连续中文的分词不稳定；LIKE 作为中文和短词的兜底。
    const likeRows = this.db
      .prepare(
        `SELECT s.*, a.name AS agent_name, a.avatar AS agent_avatar,
          t.name AS team_name, t.avatar AS team_avatar,
          (SELECT COUNT(*) FROM message m2 WHERE m2.session_id = s.id) AS message_count,
          (SELECT m2.content FROM message m2 WHERE m2.session_id = s.id
           ORDER BY m2.created_at DESC LIMIT 1) AS last_message,
          m.id AS hit_message_id,
          m.content AS hit_snippet
         FROM message m
         JOIN session s ON s.id = m.session_id
         LEFT JOIN agent a ON a.id = s.agent_id
         LEFT JOIN team t ON t.id = s.team_id
         WHERE s.workspace_id = ? AND s.archived_at IS NULL AND m.content LIKE ?
         ORDER BY s.updated_at DESC LIMIT 20`,
      )
      .all(workspaceId, `%${query}%`) as Row[]
    for (const row of likeRows) {
      const session = mapSessionSummary(row)
      const existing = hits.get(session.id)
      const messageId = nullableString(row.hit_message_id)
      const snippet = nullableString(row.hit_snippet)
      if (!existing) {
        hits.set(session.id, { session, messageId, snippet })
      } else if (!existing.messageId && messageId) {
        existing.messageId = messageId
        existing.snippet = snippet
      }
    }

    const ftsQuery = sanitizeFts(query)
    if (ftsQuery) {
      try {
        const ftsRows = this.db
          .prepare(
            `SELECT s.*, a.name AS agent_name, a.avatar AS agent_avatar,
              t.name AS team_name, t.avatar AS team_avatar,
              (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) AS message_count,
              (SELECT m.content FROM message m WHERE m.session_id = s.id
               ORDER BY m.created_at DESC LIMIT 1) AS last_message,
              f.message_id AS hit_message_id,
              snippet(message_fts, 2, '', '', '…', 16) AS hit_snippet
             FROM message_fts f
             JOIN message m ON m.id = f.message_id
             JOIN session s ON s.id = f.session_id
             LEFT JOIN agent a ON a.id = s.agent_id
             LEFT JOIN team t ON t.id = s.team_id
             WHERE s.workspace_id = ? AND s.archived_at IS NULL
               AND message_fts MATCH ?
             ORDER BY s.updated_at DESC LIMIT 20`,
          )
          .all(workspaceId, ftsQuery) as Row[]
        for (const row of ftsRows) {
          const session = mapSessionSummary(row)
          const existing = hits.get(session.id)
          const messageId = nullableString(row.hit_message_id)
          const snippet = nullableString(row.hit_snippet)
          if (!existing) {
            hits.set(session.id, { session, messageId, snippet })
          } else if (!existing.messageId && messageId) {
            existing.messageId = messageId
            existing.snippet = snippet
          }
        }
      } catch {
        // FTS 查询失败时保留标题搜索结果，不阻断界面。
      }
    }

    return Array.from(hits.values())
  }

  // ---------- messages ----------

  listMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM message WHERE session_id = ? ORDER BY created_at ASC, rowid ASC',
      )
      .all(sessionId) as Row[]
    return rows.map((row) => {
      const attachments = this.db
        .prepare('SELECT * FROM attachment WHERE message_id = ? ORDER BY created_at ASC')
        .all(String(row.id)) as Row[]
      return mapMessage(row, attachments.map(mapAttachment), this.listMentions(String(row.id)))
    })
  }

  getMessage(id: string): Message | null {
    const row = this.db
      .prepare('SELECT * FROM message WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) return null
    const attachments = this.db
      .prepare('SELECT * FROM attachment WHERE message_id = ? ORDER BY created_at ASC')
      .all(id) as Row[]
    return mapMessage(row, attachments.map(mapAttachment), this.listMentions(id))
  }

  createMessage(input: {
    sessionId: string
    senderType: Message['senderType']
    senderAgentId?: string | null
    content: string
    contentFormat?: Message['contentFormat']
    replyToId?: string | null
    status?: MessageStatus
    roundNo?: number
  }): Message {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO message
         (id, session_id, sender_type, sender_agent_id, content, content_format,
          reply_to_id, status, round_no, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.senderType,
        input.senderAgentId ?? null,
        input.content,
        input.contentFormat ?? 'markdown',
        input.replyToId ?? null,
        input.status ?? 'completed',
        input.roundNo ?? 1,
        createdAt,
        createdAt,
      )
    this.insertFts(id, input.sessionId, input.content)
    return this.getMessage(id) as Message
  }

  updateMessageContent(id: string, content: string): void {
    this.db
      .prepare('UPDATE message SET content = ?, updated_at = ? WHERE id = ?')
      .run(content, now(), id)
    const message = this.getMessage(id)
    if (message) {
      this.deleteFts(id)
      this.insertFts(id, message.sessionId, content)
    }
  }

  updateMessageStatus(id: string, status: MessageStatus): void {
    this.db
      .prepare('UPDATE message SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, now(), id)
  }

  findRunningAssistant(sessionId: string): Message | null {
    const row = this.db
      .prepare(
        `SELECT * FROM message
         WHERE session_id = ? AND sender_type = 'agent'
           AND status IN ('queued', 'running', 'streaming')
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get(sessionId) as Row | undefined
    if (!row) return null
    return this.getMessage(String(row.id))
  }

  addAttachment(
    messageId: string,
    input: Omit<Attachment, 'id' | 'messageId' | 'createdAt'>,
  ): Attachment {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO attachment (id, message_id, name, path, mime, size, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, messageId, input.name, input.path, input.mime, input.size, createdAt)
    return {
      id,
      messageId,
      name: input.name,
      path: input.path,
      mime: input.mime,
      size: input.size,
      createdAt,
    }
  }

  private insertFts(messageId: string, sessionId: string, content: string): void {
    this.db
      .prepare('INSERT INTO message_fts (message_id, session_id, content) VALUES (?, ?, ?)')
      .run(messageId, sessionId, content)
  }

  private deleteFts(messageId: string): void {
    this.db.prepare('DELETE FROM message_fts WHERE message_id = ?').run(messageId)
  }

  // ---------- runs ----------

  createRun(input: {
    sessionId: string
    triggerMessageId: string
    agentId: string
    parentRunId?: string | null
    teamTurnId?: string | null
    status?: RunStatus
  }): Run {
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO run
         (id, session_id, trigger_message_id, agent_id, parent_run_id, team_turn_id,
          status, started_at, ended_at, error, tokens_in, tokens_out, cost, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0, 0, 0, ?)`,
      )
      .run(
        id,
        input.sessionId,
        input.triggerMessageId,
        input.agentId,
        input.parentRunId ?? null,
        input.teamTurnId ?? null,
        input.status ?? 'queued',
        createdAt,
      )
    return this.getRun(id) as Run
  }

  getRun(id: string): Run | null {
    const row = this.db
      .prepare('SELECT * FROM run WHERE id = ?')
      .get(id) as Row | undefined
    return row ? mapRun(row) : null
  }

  updateRun(
    id: string,
    patch: Partial<Pick<Run, 'status' | 'startedAt' | 'endedAt' | 'error' | 'tokensIn' | 'tokensOut' | 'cost'>>,
  ): Run {
    const current = this.getRun(id)
    if (!current) throw new Error('RUN_NOT_FOUND')
    const next = { ...current, ...patch }
    this.db
      .prepare(
        `UPDATE run SET status = ?, started_at = ?, ended_at = ?, error = ?,
         tokens_in = ?, tokens_out = ?, cost = ? WHERE id = ?`,
      )
      .run(
        next.status,
        next.startedAt,
        next.endedAt,
        next.error,
        next.tokensIn,
        next.tokensOut,
        next.cost,
        id,
      )
    return this.getRun(id) as Run
  }

  addRunEvent(runId: string, seq: number, type: RunEventType, payload: Record<string, unknown>): RunEvent {
    this.db
      .prepare(
        `INSERT INTO run_event (run_id, seq, type, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(runId, seq, type, JSON.stringify(payload), now())
    return { runId, seq, type, payload }
  }

  listRunEvents(runId: string): RunEvent[] {
    return (
      this.db
        .prepare(
          `SELECT run_id, seq, type, payload_json
           FROM run_event WHERE run_id = ? ORDER BY seq ASC`,
        )
        .all(runId) as Row[]
    ).map((row) => ({
      runId: String(row.run_id),
      seq: Number(row.seq),
      type: String(row.type) as RunEventType,
      payload: parseJson<Record<string, unknown>>(row.payload_json, {}),
    }))
  }

  nextRunEventSeq(runId: string): number {
    const row = this.db
      .prepare('SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM run_event WHERE run_id = ?')
      .get(runId) as Row
    return Number(row.next)
  }

  markInterruptedRuns(): number {
    const result = this.db
      .prepare(
        `UPDATE run SET status = 'failed', error = '运行被中断',
         ended_at = COALESCE(ended_at, ?)
         WHERE status IN ('queued', 'starting', 'running')`,
      )
      .run(now())
    this.db
      .prepare(
        `UPDATE message SET status = 'failed', updated_at = ?
         WHERE status IN ('queued', 'running', 'streaming')`,
      )
      .run(now())
    this.db
      .prepare(
        `UPDATE session SET status = 'error', updated_at = ?
         WHERE status = 'running'`,
      )
      .run(now())

    // 团队回合不自动重放：保留已完成文本，把未完成回合标记为 interrupted，
    // 并写入可审计的结束事件，供对话轨迹展示。
    const turns = this.db
      .prepare(
        `SELECT id FROM team_turn
         WHERE status IN ('dispatching', 'debating', 'waiting_user', 'converging')`,
      )
      .all() as Row[]
    for (const turn of turns) {
      const id = String(turn.id)
      this.db
        .prepare(
          `UPDATE team_turn SET status = 'interrupted', ended_at = COALESCE(ended_at, ?),
           error = COALESCE(error, '应用重启，回合中断') WHERE id = ?`,
        )
        .run(now(), id)
      this.addTeamTurnEvent({
        turnId: id,
        type: 'turn_interrupted',
        payload: { reason: '应用重启，回合中断' },
      })
    }
    return Number(result.changes)
  }

  // ---------- artifacts ----------

  listArtifacts(sessionId: string): Artifact[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM artifact WHERE session_id = ? ORDER BY created_at DESC, path ASC',
        )
        .all(sessionId) as Row[]
    ).map(mapArtifact)
  }

  upsertArtifact(
    sessionId: string,
    runId: string | null,
    agentId: string | null,
    path: string,
    kind: ArtifactKind,
  ): Artifact {
    const existing = this.db
      .prepare('SELECT * FROM artifact WHERE session_id = ? AND path = ?')
      .get(sessionId, path) as Row | undefined
    if (existing) {
      this.db
        .prepare(
          `UPDATE artifact SET run_id = COALESCE(?, run_id), agent_id = COALESCE(?, agent_id),
           kind = ?, title = ? WHERE id = ?`,
        )
        .run(runId, agentId, kind, basename(path), String(existing.id))
      return mapArtifact(
        this.db
          .prepare('SELECT * FROM artifact WHERE id = ?')
          .get(String(existing.id)) as Row,
      )
    }
    const id = randomUUID()
    const createdAt = now()
    this.db
      .prepare(
        `INSERT INTO artifact (id, session_id, run_id, agent_id, path, kind, title, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, sessionId, runId, agentId, path, kind, basename(path), createdAt)
    return {
      id,
      sessionId,
      runId,
      agentId,
      path,
      kind,
      title: basename(path),
      createdAt,
    }
  }

  deleteArtifact(sessionId: string, path: string): void {
    this.db
      .prepare('DELETE FROM artifact WHERE session_id = ? AND path = ?')
      .run(sessionId, path)
  }
}
