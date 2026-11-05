import { randomUUID } from 'node:crypto'
import type {
  AppNotification,
  ApprovalDecision,
  ApprovalPolicy,
  ApprovalRequest,
  ApprovalRisk,
  ApprovalStatus,
  CapabilityBinding,
  CapabilityScopeType,
  McpServer,
  McpServerStatus,
  McpToolInfo,
  McpTransport,
  Skill,
  SkillSourceType,
} from '@shared/types'
import type { PizzaDatabase } from './database'

interface Row {
  [key: string]: unknown
}

const now = () => new Date().toISOString()

function bool(value: unknown): boolean {
  return Number(value) === 1
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value)
}

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string' || !value) return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function mapSkill(row: Row): Skill {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    version: String(row.version ?? '1.0.0'),
    sourceType: String(row.source_type) as SkillSourceType,
    sourceRef: nullable(row.source_ref),
    tags: json<string[]>(row.tags_json, []),
    enabled: bool(row.enabled),
    builtin: bool(row.builtin),
    fileCount: json<string[]>(row.file_manifest_json, []).length,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapBinding(row: Row, kind: 'skill' | 'mcp'): CapabilityBinding {
  return {
    id: String(row.id),
    kind,
    targetId: String(kind === 'skill' ? row.skill_id : row.server_id),
    scopeType: String(row.scope_type) as CapabilityScopeType,
    scopeId: String(row.scope_id),
    enabled: bool(row.enabled),
    toolAllow: json<string[]>(row.tool_allow_json, []),
    toolDeny: json<string[]>(row.tool_deny_json, []),
    createdAt: String(row.created_at),
  }
}

function mapMcpServer(row: Row): McpServer {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    name: String(row.name),
    description: String(row.description ?? ''),
    transport: String(row.transport) as McpTransport,
    command: nullable(row.command),
    args: json<string[]>(row.args_json, []),
    url: nullable(row.url),
    timeoutMs: Number(row.timeout_ms ?? 20_000),
    hasEnv: Boolean(row.env_encrypted),
    hasHeaders: Boolean(row.headers_encrypted),
    enabled: bool(row.enabled),
    status: String(row.status) as McpServerStatus,
    tools: json<McpToolInfo[]>(row.tools_json, []),
    lastError: nullable(row.last_error),
    lastTestedAt: nullable(row.last_tested_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  }
}

function mapApproval(row: Row): ApprovalRequest {
  return {
    id: String(row.id),
    runId: nullable(row.run_id),
    sessionId: String(row.session_id),
    agentId: nullable(row.agent_id),
    agentName: nullable(row.agent_name),
    toolName: String(row.tool_name),
    toolInputSummary: String(row.tool_input_summary ?? ''),
    risk: String(row.risk) as ApprovalRisk,
    policySource: String(row.policy_source),
    status: String(row.status) as ApprovalStatus,
    decision: nullable(row.decision) as ApprovalDecision | null,
    createdAt: String(row.created_at),
    expiresAt: String(row.expires_at),
  }
}

function mapPolicy(row: Row): ApprovalPolicy {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    agentId: nullable(row.agent_id),
    toolName: String(row.tool_name),
    decision: String(row.decision) as ApprovalPolicy['decision'],
    scope: String(row.scope ?? ''),
    createdAt: String(row.created_at),
  }
}

function mapNotification(row: Row): AppNotification {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    sessionId: String(row.session_id),
    sessionTitle: nullable(row.session_title),
    messageId: nullable(row.message_id),
    kind: 'mention',
    title: String(row.title),
    body: String(row.body ?? ''),
    status: String(row.status) as AppNotification['status'],
    createdAt: String(row.created_at),
    readAt: nullable(row.read_at),
  }
}

export interface SkillRecordInput {
  workspaceId: string
  name: string
  description: string
  version: string
  sourceType: SkillSourceType
  sourceRef: string | null
  tags: string[]
  enabled: boolean
  builtin: boolean
  contentDir: string
  files: string[]
}

export interface McpServerRecordInput {
  workspaceId: string
  name: string
  description: string
  transport: McpTransport
  command: string | null
  args: string[]
  url: string | null
  timeoutMs: number
  envEncrypted: string | null
  headersEncrypted: string | null
  enabled: boolean
}

/**
 * 能力、审批与通知的数据访问层。
 *
 * 与 Store 分离，避免会话仓储继续膨胀；所有表都在迁移 5 中创建。
 */
export class CapabilityStore {
  constructor(private readonly db: PizzaDatabase) {}

  // ---------- 审计 ----------

  addAudit(input: {
    workspaceId: string | null
    action: string
    targetType: string
    targetId: string | null
    detail?: Record<string, unknown>
  }): void {
    this.db
      .prepare(
        `INSERT INTO audit_log (
          workspace_id, actor, action, target_type, target_id, detail_json, created_at
        ) VALUES (?, 'system', ?, ?, ?, ?, ?)`,
      )
      .run(
        input.workspaceId,
        input.action,
        input.targetType,
        input.targetId,
        JSON.stringify(input.detail ?? {}),
        now(),
      )
  }

  listAudit(workspaceId: string, limit = 200): Array<{
    action: string
    targetType: string
    targetId: string | null
    detail: Record<string, unknown>
    createdAt: string
  }> {
    return (
      this.db
        .prepare(
          'SELECT * FROM audit_log WHERE workspace_id = ? ORDER BY id DESC LIMIT ?',
        )
        .all(workspaceId, limit) as Row[]
    ).map((row) => ({
      action: String(row.action),
      targetType: String(row.target_type),
      targetId: nullable(row.target_id),
      detail: json<Record<string, unknown>>(row.detail_json, {}),
      createdAt: String(row.created_at),
    }))
  }

  // ---------- Skill ----------

  listSkills(workspaceId: string): Skill[] {
    return (
      this.db
        .prepare('SELECT * FROM skill WHERE workspace_id = ? ORDER BY builtin DESC, name COLLATE NOCASE')
        .all(workspaceId) as Row[]
    ).map(mapSkill)
  }

  getSkill(id: string): Skill | null {
    const row = this.db.prepare('SELECT * FROM skill WHERE id = ?').get(id) as Row | undefined
    return row ? mapSkill(row) : null
  }

  getSkillContent(id: string): { contentDir: string; files: string[] } | null {
    const row = this.db
      .prepare('SELECT content_dir, file_manifest_json FROM skill WHERE id = ?')
      .get(id) as Row | undefined
    if (!row) return null
    return {
      contentDir: String(row.content_dir),
      files: json<string[]>(row.file_manifest_json, []),
    }
  }

  findSkillByName(workspaceId: string, name: string): Skill | null {
    const row = this.db
      .prepare('SELECT * FROM skill WHERE workspace_id = ? AND name = ?')
      .get(workspaceId, name) as Row | undefined
    return row ? mapSkill(row) : null
  }

  createSkill(input: SkillRecordInput): Skill {
    const id = randomUUID()
    const stamp = now()
    this.db
      .prepare(
        `INSERT INTO skill (
          id, workspace_id, name, description, version, source_type, source_ref,
          tags_json, enabled, builtin, content_dir, file_manifest_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.description,
        input.version,
        input.sourceType,
        input.sourceRef,
        JSON.stringify(input.tags),
        input.enabled ? 1 : 0,
        input.builtin ? 1 : 0,
        input.contentDir,
        JSON.stringify(input.files),
        stamp,
        stamp,
      )
    return this.getSkill(id) as Skill
  }

  updateSkill(
    id: string,
    patch: Partial<{
      name: string
      description: string
      tags: string[]
      enabled: boolean
      version: string
      contentDir: string
      files: string[]
      sourceRef: string | null
    }>,
  ): Skill | null {
    const current = this.getSkill(id)
    if (!current) return null
    const content = this.getSkillContent(id)
    this.db
      .prepare(
        `UPDATE skill SET name = ?, description = ?, tags_json = ?, enabled = ?,
          version = ?, content_dir = ?, file_manifest_json = ?, source_ref = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        patch.name ?? current.name,
        patch.description ?? current.description,
        JSON.stringify(patch.tags ?? current.tags),
        (patch.enabled ?? current.enabled) ? 1 : 0,
        patch.version ?? current.version,
        patch.contentDir ?? content?.contentDir ?? '',
        JSON.stringify(patch.files ?? content?.files ?? []),
        patch.sourceRef === undefined ? current.sourceRef : patch.sourceRef,
        now(),
        id,
      )
    return this.getSkill(id)
  }

  deleteSkill(id: string): void {
    this.db.prepare('DELETE FROM skill WHERE id = ?').run(id)
  }

  countSkillBindings(id: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM skill_binding WHERE skill_id = ?')
      .get(id) as Row
    return Number(row.count)
  }

  listSkillReferences(id: string): Array<{
    scopeType: CapabilityScopeType
    scopeId: string
    name: string
  }> {
    return (
      this.db
        .prepare(
          `SELECT b.scope_type, b.scope_id,
             CASE b.scope_type
               WHEN 'agent' THEN a.name
               WHEN 'workspace' THEN w.name
               ELSE t.name || ' · ' || tm_agent.name
             END AS ref_name
           FROM skill_binding b
           LEFT JOIN agent a ON a.id = b.scope_id AND b.scope_type = 'agent'
           LEFT JOIN workspace w ON w.id = b.scope_id AND b.scope_type = 'workspace'
           LEFT JOIN team_member tm ON tm.id = b.scope_id AND b.scope_type = 'team_member'
           LEFT JOIN team t ON t.id = tm.team_id
           LEFT JOIN agent tm_agent ON tm_agent.id = tm.agent_id
           WHERE b.skill_id = ?
           ORDER BY b.scope_type, ref_name`,
        )
        .all(id) as Row[]
    ).map((row) => ({
      scopeType: String(row.scope_type) as CapabilityScopeType,
      scopeId: String(row.scope_id),
      name: String(row.ref_name ?? row.scope_id),
    }))
  }

  listSkillBindings(scopeType: CapabilityScopeType, scopeId: string): CapabilityBinding[] {
    return (
      this.db
        .prepare('SELECT * FROM skill_binding WHERE scope_type = ? AND scope_id = ? ORDER BY created_at')
        .all(scopeType, scopeId) as Row[]
    ).map((row) => mapBinding(row, 'skill'))
  }

  listSkillBindingsForScopes(
    scopes: Array<{ type: CapabilityScopeType; id: string }>,
  ): CapabilityBinding[] {
    if (scopes.length === 0) return []
    const clauses = scopes.map(() => '(scope_type = ? AND scope_id = ?)').join(' OR ')
    const params = scopes.flatMap((scope) => [scope.type, scope.id])
    return (
      this.db
        .prepare(`SELECT * FROM skill_binding WHERE ${clauses} ORDER BY created_at`)
        .all(...params) as Row[]
    ).map((row) => mapBinding(row, 'skill'))
  }

  upsertSkillBinding(input: {
    skillId: string
    scopeType: CapabilityScopeType
    scopeId: string
    enabled?: boolean
  }): CapabilityBinding {
    this.db
      .prepare(
        `INSERT INTO skill_binding (id, skill_id, scope_type, scope_id, enabled, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(skill_id, scope_type, scope_id)
         DO UPDATE SET enabled = excluded.enabled`,
      )
      .run(
        randomUUID(),
        input.skillId,
        input.scopeType,
        input.scopeId,
        input.enabled === false ? 0 : 1,
        now(),
      )
    const row = this.db
      .prepare('SELECT * FROM skill_binding WHERE skill_id = ? AND scope_type = ? AND scope_id = ?')
      .get(input.skillId, input.scopeType, input.scopeId) as Row
    return mapBinding(row, 'skill')
  }

  removeSkillBinding(skillId: string, scopeType: CapabilityScopeType, scopeId: string): void {
    this.db
      .prepare('DELETE FROM skill_binding WHERE skill_id = ? AND scope_type = ? AND scope_id = ?')
      .run(skillId, scopeType, scopeId)
  }

  /** 团队成员通过 capability_overrides 额外挂载的能力。 */
  getTeamMemberCapabilities(
    teamMemberId: string,
  ): { skills: string[]; mcpServers: string[] } {
    const row = this.db
      .prepare('SELECT capability_json FROM team_member WHERE id = ?')
      .get(teamMemberId) as Row | undefined
    const data = json<{ skills?: string[]; mcpServers?: string[] }>(
      row?.capability_json,
      {},
    )
    return {
      skills: Array.isArray(data.skills) ? data.skills.map(String) : [],
      mcpServers: Array.isArray(data.mcpServers) ? data.mcpServers.map(String) : [],
    }
  }

  // ---------- MCP ----------

  listMcpServers(workspaceId: string): McpServer[] {
    return (
      this.db
        .prepare('SELECT * FROM mcp_server WHERE workspace_id = ? ORDER BY name COLLATE NOCASE')
        .all(workspaceId) as Row[]
    ).map(mapMcpServer)
  }

  getMcpServer(id: string): McpServer | null {
    const row = this.db.prepare('SELECT * FROM mcp_server WHERE id = ?').get(id) as Row | undefined
    return row ? mapMcpServer(row) : null
  }

  getMcpSecrets(id: string): { envEncrypted: string | null; headersEncrypted: string | null } {
    const row = this.db
      .prepare('SELECT env_encrypted, headers_encrypted FROM mcp_server WHERE id = ?')
      .get(id) as Row | undefined
    return {
      envEncrypted: nullable(row?.env_encrypted),
      headersEncrypted: nullable(row?.headers_encrypted),
    }
  }

  findMcpByName(workspaceId: string, name: string): McpServer | null {
    const row = this.db
      .prepare('SELECT * FROM mcp_server WHERE workspace_id = ? AND name = ?')
      .get(workspaceId, name) as Row | undefined
    return row ? mapMcpServer(row) : null
  }

  createMcpServer(input: McpServerRecordInput): McpServer {
    const id = randomUUID()
    const stamp = now()
    this.db
      .prepare(
        `INSERT INTO mcp_server (
          id, workspace_id, name, description, transport, command, args_json, url,
          timeout_ms, env_encrypted, headers_encrypted, enabled, status, tools_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'untested', '[]', ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.timeoutMs,
        input.envEncrypted,
        input.headersEncrypted,
        input.enabled ? 1 : 0,
        stamp,
        stamp,
      )
    return this.getMcpServer(id) as McpServer
  }

  updateMcpServer(
    id: string,
    input: McpServerRecordInput & {
      status?: McpServerStatus
      tools?: McpToolInfo[]
      lastError?: string | null
      lastTestedAt?: string | null
    },
  ): McpServer | null {
    if (!this.getMcpServer(id)) return null
    this.db
      .prepare(
        `UPDATE mcp_server SET name = ?, description = ?, transport = ?, command = ?,
          args_json = ?, url = ?, timeout_ms = ?, env_encrypted = ?, headers_encrypted = ?,
          enabled = ?, status = COALESCE(?, status), tools_json = ?,
          last_error = ?, last_tested_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        input.name,
        input.description,
        input.transport,
        input.command,
        JSON.stringify(input.args),
        input.url,
        input.timeoutMs,
        input.envEncrypted,
        input.headersEncrypted,
        input.enabled ? 1 : 0,
        input.status ?? null,
        JSON.stringify(input.tools ?? []),
        input.lastError === undefined ? null : input.lastError,
        input.lastTestedAt ?? null,
        now(),
        id,
      )
    return this.getMcpServer(id)
  }

  setMcpEnabled(id: string, enabled: boolean): void {
    this.db
      .prepare('UPDATE mcp_server SET enabled = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, now(), id)
  }

  updateMcpStatus(
    id: string,
    status: McpServerStatus,
    tools: McpToolInfo[],
    error: string | null,
  ): void {
    this.db
      .prepare(
        `UPDATE mcp_server SET status = ?, tools_json = ?, last_error = ?,
          last_tested_at = ?, updated_at = ? WHERE id = ?`,
      )
      .run(status, JSON.stringify(tools), error, now(), now(), id)
  }

  deleteMcpServer(id: string): void {
    this.db.prepare('DELETE FROM mcp_server WHERE id = ?').run(id)
  }

  countMcpBindings(id: string): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS count FROM mcp_binding WHERE server_id = ?')
      .get(id) as Row
    return Number(row.count)
  }

  listMcpBindings(scopeType: CapabilityScopeType, scopeId: string): CapabilityBinding[] {
    return (
      this.db
        .prepare('SELECT * FROM mcp_binding WHERE scope_type = ? AND scope_id = ? ORDER BY created_at')
        .all(scopeType, scopeId) as Row[]
    ).map((row) => mapBinding(row, 'mcp'))
  }

  listMcpBindingsForScopes(
    scopes: Array<{ type: CapabilityScopeType; id: string }>,
  ): CapabilityBinding[] {
    if (scopes.length === 0) return []
    const clauses = scopes.map(() => '(scope_type = ? AND scope_id = ?)').join(' OR ')
    const params = scopes.flatMap((scope) => [scope.type, scope.id])
    return (
      this.db
        .prepare(`SELECT * FROM mcp_binding WHERE ${clauses} ORDER BY created_at`)
        .all(...params) as Row[]
    ).map((row) => mapBinding(row, 'mcp'))
  }

  upsertMcpBinding(input: {
    serverId: string
    scopeType: CapabilityScopeType
    scopeId: string
    enabled?: boolean
    toolAllow?: string[]
    toolDeny?: string[]
  }): CapabilityBinding {
    this.db
      .prepare(
        `INSERT INTO mcp_binding (
          id, server_id, scope_type, scope_id, enabled, tool_allow_json, tool_deny_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(server_id, scope_type, scope_id)
        DO UPDATE SET enabled = excluded.enabled,
          tool_allow_json = excluded.tool_allow_json,
          tool_deny_json = excluded.tool_deny_json`,
      )
      .run(
        randomUUID(),
        input.serverId,
        input.scopeType,
        input.scopeId,
        input.enabled === false ? 0 : 1,
        JSON.stringify(input.toolAllow ?? []),
        JSON.stringify(input.toolDeny ?? []),
        now(),
      )
    const row = this.db
      .prepare('SELECT * FROM mcp_binding WHERE server_id = ? AND scope_type = ? AND scope_id = ?')
      .get(input.serverId, input.scopeType, input.scopeId) as Row
    return mapBinding(row, 'mcp')
  }

  removeMcpBinding(serverId: string, scopeType: CapabilityScopeType, scopeId: string): void {
    this.db
      .prepare('DELETE FROM mcp_binding WHERE server_id = ? AND scope_type = ? AND scope_id = ?')
      .run(serverId, scopeType, scopeId)
  }

  getSessionWorkspaceId(sessionId: string): string {
    const row = this.db
      .prepare('SELECT workspace_id FROM session WHERE id = ?')
      .get(sessionId) as Row | undefined
    return row ? String(row.workspace_id) : ''
  }

  // ---------- 审批 ----------

  createApproval(input: {
    runId: string | null
    sessionId: string
    agentId: string | null
    agentName: string | null
    toolName: string
    toolInput: Record<string, unknown>
    toolInputSummary: string
    risk: ApprovalRisk
    policySource: string
    expiresAt: string
  }): ApprovalRequest {
    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO approval (
          id, run_id, session_id, agent_id, agent_name, tool_name, tool_input_json,
          tool_input_summary, risk, policy_source, status, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      )
      .run(
        id,
        input.runId,
        input.sessionId,
        input.agentId,
        input.agentName,
        input.toolName,
        JSON.stringify(input.toolInput),
        input.toolInputSummary,
        input.risk,
        input.policySource,
        now(),
        input.expiresAt,
      )
    return this.getApproval(id) as ApprovalRequest
  }

  getApproval(id: string): ApprovalRequest | null {
    const row = this.db.prepare('SELECT * FROM approval WHERE id = ?').get(id) as Row | undefined
    return row ? mapApproval(row) : null
  }

  getApprovalInput(id: string): Record<string, unknown> {
    const row = this.db
      .prepare('SELECT tool_input_json FROM approval WHERE id = ?')
      .get(id) as Row | undefined
    return json<Record<string, unknown>>(row?.tool_input_json, {})
  }

  updateApproval(
    id: string,
    status: ApprovalStatus,
    decision: ApprovalDecision | null,
  ): ApprovalRequest | null {
    this.db
      .prepare('UPDATE approval SET status = ?, decision = ?, decided_at = ? WHERE id = ?')
      .run(status, decision, now(), id)
    return this.getApproval(id)
  }

  listPendingApprovals(): ApprovalRequest[] {
    return (
      this.db
        .prepare("SELECT * FROM approval WHERE status = 'pending' ORDER BY created_at")
        .all() as Row[]
    ).map(mapApproval)
  }

  listApprovals(sessionId?: string): ApprovalRequest[] {
    const rows = sessionId
      ? (this.db
          .prepare('SELECT * FROM approval WHERE session_id = ? ORDER BY created_at DESC LIMIT 100')
          .all(sessionId) as Row[])
      : (this.db.prepare('SELECT * FROM approval ORDER BY created_at DESC LIMIT 100').all() as Row[])
    return rows.map(mapApproval)
  }

  listPolicies(workspaceId: string): ApprovalPolicy[] {
    return (
      this.db
        .prepare('SELECT * FROM approval_policy WHERE workspace_id = ? ORDER BY created_at')
        .all(workspaceId) as Row[]
    ).map(mapPolicy)
  }

  findPolicy(workspaceId: string, agentId: string | null, toolName: string): ApprovalPolicy | null {
    const row = this.db
      .prepare(
        `SELECT * FROM approval_policy
         WHERE workspace_id = ? AND tool_name = ?
           AND (agent_id IS NULL OR agent_id = ?)
         ORDER BY agent_id IS NULL ASC, created_at DESC LIMIT 1`,
      )
      .get(workspaceId, toolName, agentId) as Row | undefined
    return row ? mapPolicy(row) : null
  }

  upsertPolicy(input: {
    workspaceId: string
    agentId: string | null
    toolName: string
    decision: ApprovalPolicy['decision']
    scope: string
  }): ApprovalPolicy {
    const existing = this.db
      .prepare(
        'SELECT * FROM approval_policy WHERE workspace_id = ? AND agent_id IS ? AND tool_name = ?',
      )
      .get(input.workspaceId, input.agentId, input.toolName) as Row | undefined
    if (existing) {
      this.db
        .prepare('UPDATE approval_policy SET decision = ?, scope = ? WHERE id = ?')
        .run(input.decision, input.scope, String(existing.id))
    } else {
      this.db
        .prepare(
          `INSERT INTO approval_policy (id, workspace_id, agent_id, tool_name, decision, scope, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          randomUUID(),
          input.workspaceId,
          input.agentId,
          input.toolName,
          input.decision,
          input.scope,
          now(),
        )
    }
    const row = this.db
      .prepare(
        'SELECT * FROM approval_policy WHERE workspace_id = ? AND agent_id IS ? AND tool_name = ?',
      )
      .get(input.workspaceId, input.agentId, input.toolName) as Row
    return mapPolicy(row)
  }

  // ---------- 通知 ----------

  findNotification(sessionId: string, messageId: string | null): AppNotification | null {
    const row = this.db
      .prepare(
        `SELECT n.*, s.title AS session_title FROM notification n
         LEFT JOIN session s ON s.id = n.session_id
         WHERE n.session_id = ? AND n.message_id IS ? AND n.kind = 'mention'
         ORDER BY n.created_at DESC LIMIT 1`,
      )
      .get(sessionId, messageId) as Row | undefined
    return row ? mapNotification(row) : null
  }

  createNotification(input: {
    workspaceId: string
    sessionId: string
    messageId: string | null
    title: string
    body: string
  }): AppNotification {
    const existing = this.findNotification(input.sessionId, input.messageId)
    if (existing) return existing

    const id = randomUUID()
    this.db
      .prepare(
        `INSERT INTO notification (
          id, workspace_id, session_id, message_id, kind, title, body, status, created_at
        ) VALUES (?, ?, ?, ?, 'mention', ?, ?, 'pending', ?)`,
      )
      .run(id, input.workspaceId, input.sessionId, input.messageId, input.title, input.body, now())
    return this.getNotification(id) as AppNotification
  }

  getNotification(id: string): AppNotification | null {
    const row = this.db
      .prepare(
        `SELECT n.*, s.title AS session_title FROM notification n
         LEFT JOIN session s ON s.id = n.session_id WHERE n.id = ?`,
      )
      .get(id) as Row | undefined
    return row ? mapNotification(row) : null
  }

  listNotifications(workspaceId: string): AppNotification[] {
    return (
      this.db
        .prepare(
          `SELECT n.*, s.title AS session_title FROM notification n
           LEFT JOIN session s ON s.id = n.session_id
           WHERE n.workspace_id = ? ORDER BY n.created_at DESC LIMIT 100`,
        )
        .all(workspaceId) as Row[]
    ).map(mapNotification)
  }

  markNotificationRead(id: string): void {
    this.db
      .prepare("UPDATE notification SET status = 'read', read_at = ? WHERE id = ?")
      .run(now(), id)
  }

  markAllNotificationsRead(workspaceId: string): void {
    this.db
      .prepare(
        "UPDATE notification SET status = 'read', read_at = ? WHERE workspace_id = ? AND status = 'pending'",
      )
      .run(now(), workspaceId)
  }

  clearNotifications(workspaceId: string): void {
    this.db.prepare('DELETE FROM notification WHERE workspace_id = ?').run(workspaceId)
  }
}
