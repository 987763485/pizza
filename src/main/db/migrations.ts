export interface Migration {
  version: number
  sql: string
  /** 重建被外键引用的表时临时关闭外键检查；迁移完成后统一校验。 */
  disableForeignKeys?: boolean
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS runtime (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        adapter TEXT NOT NULL,
        protocol TEXT NOT NULL,
        transport TEXT NOT NULL,
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        cwd TEXT,
        url TEXT,
        env_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'draft',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        last_connected_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS agent (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        avatar TEXT,
        runtime_id TEXT NOT NULL REFERENCES runtime(id) ON DELETE RESTRICT,
        prompt TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'medium',
        context_limit INTEGER NOT NULL DEFAULT 200000,
        model TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS session (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'agent',
        agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        team_id TEXT,
        workspace_path TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        unread INTEGER NOT NULL DEFAULT 0,
        forked_from_id TEXT,
        runtime_session_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        archived_at TEXT
      );

      CREATE TABLE IF NOT EXISTS message (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        sender_type TEXT NOT NULL,
        sender_agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        content TEXT NOT NULL,
        content_format TEXT NOT NULL DEFAULT 'markdown',
        reply_to_id TEXT,
        status TEXT NOT NULL DEFAULT 'completed',
        round_no INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS attachment (
        id TEXT PRIMARY KEY,
        message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        path TEXT NOT NULL,
        mime TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        trigger_message_id TEXT NOT NULL,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE CASCADE,
        parent_run_id TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        started_at TEXT,
        ended_at TEXT,
        error TEXT,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        cost REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS run_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES run(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(run_id, seq)
      );

      CREATE TABLE IF NOT EXISTS artifact (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        run_id TEXT REFERENCES run(id) ON DELETE SET NULL,
        agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        path TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, path)
      );

      CREATE TABLE IF NOT EXISTS app_setting (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS message_fts USING fts5(
        message_id UNINDEXED,
        session_id UNINDEXED,
        content
      );

      CREATE INDEX IF NOT EXISTS idx_message_session ON message(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_run_session ON run(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_artifact_session ON artifact(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_session_workspace ON session(workspace_id, archived_at, updated_at);
      CREATE INDEX IF NOT EXISTS idx_agent_workspace ON agent(workspace_id, is_archived);
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE runtime ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 30000;
      ALTER TABLE runtime ADD COLUMN auto_reconnect INTEGER NOT NULL DEFAULT 1;
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE IF NOT EXISTS team (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        avatar TEXT,
        leader_agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
        orchestration_prompt TEXT NOT NULL DEFAULT '',
        fanout_strategy TEXT NOT NULL DEFAULT 'parallel'
          CHECK (fanout_strategy IN ('parallel', 'serial')),
        max_concurrency INTEGER NOT NULL DEFAULT 3
          CHECK (max_concurrency BETWEEN 1 AND 10),
        max_rounds INTEGER NOT NULL DEFAULT 5
          CHECK (max_rounds BETWEEN 1 AND 50),
        max_hops INTEGER NOT NULL DEFAULT 12
          CHECK (max_hops BETWEEN 1 AND 100),
        token_budget INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        last_used_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS team_member (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES team(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
        position INTEGER NOT NULL DEFAULT 0,
        role TEXT NOT NULL DEFAULT '',
        prompt_mode TEXT NOT NULL DEFAULT 'inherit'
          CHECK (prompt_mode IN ('inherit', 'append', 'replace')),
        prompt TEXT NOT NULL DEFAULT '',
        capability_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(team_id, agent_id)
      );

      CREATE TABLE IF NOT EXISTS team_turn (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'dispatching',
        trigger_message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        leader_agent_id TEXT NOT NULL REFERENCES agent(id) ON DELETE RESTRICT,
        started_at TEXT NOT NULL,
        ended_at TEXT,
        convergence_reason TEXT,
        hops INTEGER NOT NULL DEFAULT 0,
        rounds INTEGER NOT NULL DEFAULT 0,
        tokens_in INTEGER NOT NULL DEFAULT 0,
        tokens_out INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(session_id, seq)
      );

      CREATE TABLE IF NOT EXISTS message_mention (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL REFERENCES message(id) ON DELETE CASCADE,
        target_type TEXT NOT NULL
          CHECK (target_type IN ('agent', 'user', 'unknown')),
        target_agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        display_name TEXT NOT NULL,
        start_index INTEGER NOT NULL,
        end_index INTEGER NOT NULL,
        raw TEXT NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS team_turn_event (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        turn_id TEXT NOT NULL REFERENCES team_turn(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        type TEXT NOT NULL,
        participant_agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        run_id TEXT REFERENCES run(id) ON DELETE SET NULL,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        UNIQUE(turn_id, seq)
      );

      ALTER TABLE session ADD COLUMN interjection_mode TEXT NOT NULL DEFAULT 'queue';
      ALTER TABLE run ADD COLUMN team_turn_id TEXT REFERENCES team_turn(id) ON DELETE SET NULL;

      CREATE INDEX IF NOT EXISTS idx_team_workspace ON team(workspace_id, is_archived, last_used_at);
      CREATE INDEX IF NOT EXISTS idx_team_member_team ON team_member(team_id, position);
      CREATE INDEX IF NOT EXISTS idx_mention_message ON message_mention(message_id, start_index);
      CREATE INDEX IF NOT EXISTS idx_team_turn_session ON team_turn(session_id, seq);
      CREATE INDEX IF NOT EXISTS idx_team_turn_event_turn ON team_turn_event(turn_id, seq);
      CREATE INDEX IF NOT EXISTS idx_run_team_turn ON run(team_turn_id, created_at);
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE team ADD COLUMN deleted_at TEXT;
      CREATE INDEX IF NOT EXISTS idx_team_deleted ON team(workspace_id, deleted_at);
    `,
  },
  {
    version: 5,
    sql: `
      -- Skill 元数据；文件内容存放在数据目录的 skills/ 下，数据库只保存清单与绑定。
      CREATE TABLE IF NOT EXISTS skill (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '1.0.0',
        source_type TEXT NOT NULL
          CHECK (source_type IN ('builtin', 'local', 'zip', 'git', 'manual')),
        source_ref TEXT,
        tags_json TEXT NOT NULL DEFAULT '[]',
        enabled INTEGER NOT NULL DEFAULT 1,
        builtin INTEGER NOT NULL DEFAULT 0,
        content_dir TEXT NOT NULL,
        file_manifest_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS skill_binding (
        id TEXT PRIMARY KEY,
        skill_id TEXT NOT NULL REFERENCES skill(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL
          CHECK (scope_type IN ('agent', 'team_member', 'workspace')),
        scope_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(skill_id, scope_type, scope_id)
      );

      -- MCP 服务；env/headers 为 safeStorage 加密后的 Base64，不存明文。
      CREATE TABLE IF NOT EXISTS mcp_server (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        transport TEXT NOT NULL CHECK (transport IN ('stdio', 'sse', 'http')),
        command TEXT,
        args_json TEXT NOT NULL DEFAULT '[]',
        url TEXT,
        env_encrypted TEXT,
        headers_encrypted TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'untested',
        tools_json TEXT NOT NULL DEFAULT '[]',
        last_error TEXT,
        last_tested_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(workspace_id, name)
      );

      CREATE TABLE IF NOT EXISTS mcp_binding (
        id TEXT PRIMARY KEY,
        server_id TEXT NOT NULL REFERENCES mcp_server(id) ON DELETE CASCADE,
        scope_type TEXT NOT NULL
          CHECK (scope_type IN ('agent', 'team_member', 'workspace')),
        scope_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        tool_allow_json TEXT NOT NULL DEFAULT '[]',
        tool_deny_json TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL,
        UNIQUE(server_id, scope_type, scope_id)
      );

      CREATE TABLE IF NOT EXISTS approval (
        id TEXT PRIMARY KEY,
        run_id TEXT REFERENCES run(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agent(id) ON DELETE SET NULL,
        agent_name TEXT,
        tool_name TEXT NOT NULL,
        tool_input_json TEXT NOT NULL DEFAULT '{}',
        tool_input_summary TEXT NOT NULL DEFAULT '',
        risk TEXT NOT NULL DEFAULT 'medium',
        policy_source TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL DEFAULT 'pending',
        decision TEXT,
        created_at TEXT NOT NULL,
        decided_at TEXT,
        expires_at TEXT NOT NULL
      );

      -- 「总是允许」的策略：agent_id 为空表示工作区默认，agent 级优先。
      CREATE TABLE IF NOT EXISTS approval_policy (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        agent_id TEXT REFERENCES agent(id) ON DELETE CASCADE,
        tool_name TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('allow', 'ask', 'deny')),
        scope TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE(workspace_id, agent_id, tool_name)
      );

      CREATE TABLE IF NOT EXISTS notification (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspace(id) ON DELETE CASCADE,
        session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
        message_id TEXT REFERENCES message(id) ON DELETE CASCADE,
        kind TEXT NOT NULL DEFAULT 'mention',
        title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_skill_workspace ON skill(workspace_id, name);
      CREATE INDEX IF NOT EXISTS idx_skill_binding_scope ON skill_binding(scope_type, scope_id);
      CREATE INDEX IF NOT EXISTS idx_mcp_workspace ON mcp_server(workspace_id, name);
      CREATE INDEX IF NOT EXISTS idx_mcp_binding_scope ON mcp_binding(scope_type, scope_id);
      CREATE INDEX IF NOT EXISTS idx_approval_session ON approval(session_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_approval_pending ON approval(status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_policy_unique
        ON approval_policy(workspace_id, COALESCE(agent_id, ''), tool_name);
      CREATE INDEX IF NOT EXISTS idx_notification_workspace ON notification(workspace_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_notification_session ON notification(session_id, created_at);
    `,
  },
  {
    version: 6,
    sql: `
      -- MCP 连接与工具发现的超时；迁移 5 已存在的库在这里补列。
      ALTER TABLE mcp_server ADD COLUMN timeout_ms INTEGER NOT NULL DEFAULT 20000;
    `,
  },
  {
    version: 7,
    sql: `
      -- 能力配置读取/修改审计；只保存字段名与摘要，不保存密钥。
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id TEXT,
        actor TEXT NOT NULL DEFAULT 'system',
        action TEXT NOT NULL,
        target_type TEXT NOT NULL,
        target_id TEXT,
        detail_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_audit_workspace
        ON audit_log(workspace_id, created_at);
    `,
  },
  {
    version: 8,
    disableForeignKeys: true,
    sql: `
      -- 智能体改为全局资源，不再绑定工作区。重建表以移除 workspace_id
      -- 与 (workspace_id, name) 唯一约束；外键在迁移期间临时关闭。
      CREATE TABLE agent_new (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        avatar TEXT,
        runtime_id TEXT NOT NULL REFERENCES runtime(id) ON DELETE RESTRICT,
        prompt TEXT NOT NULL,
        thinking_level TEXT NOT NULL DEFAULT 'medium',
        context_limit INTEGER NOT NULL DEFAULT 200000,
        model TEXT,
        is_archived INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO agent_new
        (id, name, description, avatar, runtime_id, prompt, thinking_level,
         context_limit, model, is_archived, created_at, updated_at)
      SELECT
        id, name, description, avatar, runtime_id, prompt, thinking_level,
        context_limit, model, is_archived, created_at, updated_at
      FROM agent;
      DROP TABLE agent;
      ALTER TABLE agent_new RENAME TO agent;
      -- 全局化后同名会破坏 @ 提及；保留最早一条，其余追加 id 片段。
      UPDATE agent
      SET name = name || ' (' || substr(id, 1, 8) || ')'
      WHERE rowid NOT IN (SELECT MIN(rowid) FROM agent GROUP BY name);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_name ON agent(name);
    `,
  },
  {
    version: 9,
    sql: `
      -- 单个智能体的并发上限；与系统全局并发上限分开配置。
      ALTER TABLE agent ADD COLUMN max_concurrency INTEGER NOT NULL DEFAULT 3;
    `,
  },
  {
    version: 10,
    sql: `
      -- 团队交互由指挥者主导，不再用轮次上限替代指挥者的收敛判断。
      ALTER TABLE team DROP COLUMN max_rounds;
    `,
  },
  {
    version: 11,
    sql: `
      -- 指令来源：self = 自带初始 Prompt；leader = 指挥者每次动态下发。
      ALTER TABLE agent ADD COLUMN instruction_mode TEXT NOT NULL DEFAULT 'self'
        CHECK (instruction_mode IN ('self', 'leader'));
    `,
  },
]
