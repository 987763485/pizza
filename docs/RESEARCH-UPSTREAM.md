# 参考项目可复用能力调研

| 项目 | 内容 |
| --- | --- |
| 调研对象 | `reference/`（只读参考仓库，commit `ca7cdb9`） |
| 日期 | 2026-11-03 |
| 目的 | 判断 Pizza 在「复制参考项目能力」时，哪些直接复用、哪些改造、哪些必须新写 |
| 结论 | 运行时/守护进程、Provider 适配、Skill、MCP、任务队列、用量、实时通道可高度复用；**多智能体 @ 群聊、团队覆盖配置、产物/审计/Git 面板需要新写** |

---

## 1. 调研范围

- 产品文档：`apps/docs/content/docs/*.mdx`（约 60 篇）+ `README.zh.md`、`VISION.zh.md`、`CLI_AND_DAEMON.md`。
- 前端：`apps/web`、`apps/desktop`、`packages/views`、`packages/ui`、`packages/core`。
- 后端：`server/`（Go、chi、sqlc、PostgreSQL、WebSocket、~2,290 个 Go 文件、1,248 个迁移）。
- 参考截图：`docs/assets/readme/*.webp`。

---

## 2. 参考项目是什么（事实基线）

参考项目是一个源码公开的团队工作区：人和 AI 智能体围绕 **Issue（任务）** 协作。智能体是「队友」，可以被指派任务、在评论中 @、通过 Squad（小队）由 leader 分派。聊天（Chat）是人与单个智能体的一对一私有会话，不在看板上。

**与 Pizza 的关键差异：**

| 维度 | 参考项目| Pizza |
| --- | --- | --- |
| 协作载体 | Issue / 评论 / 看板 | 会话 / 消息流 |
| 多智能体协作 | 评论中 @ + Squad leader 分派（Issue 绑定） | 会话内 @ + 指挥者分派（会话绑定） |
| 聊天 | 1:1，单智能体，无 @ | 单智能体 + 多智能体群聊 |
| 团队配置 | Squad：leader + 成员 + 角色描述 + 团队指令 | 增加成员级 Prompt/Skill/MCP 覆盖、快照 |
| 产物 | 附件 / 评论 deliverable，无一等公民产物 | 一等公民产出物面板 |
| 审计 | `activity_log`，无通用审计页/JSONL | 一等公民 JSONL 审计 |
| 运行时 | 27+ CLI/ACP Provider + daemon | 复用 + 面向 6 个目标运行时优化 |
| 上下文限制 | 无 per-agent 上下文阈值 | 每智能体可配置压缩阈值 |

---

## 3. 技术架构

### 3.1 前端

| 包 | 职责 | Pizza 复用判断 |
| --- | --- | --- |
| `apps/web` | Next.js 路由与 Web 端 | 可复用为 Web 版 |
| `apps/desktop` | Electron 外壳、窗口/标签、桌面状态 | 直接复用外壳 |
| `packages/views` | Web/Desktop 共享页面与业务组件 | 大量复用；Issue 页面替换为会话 |
| `packages/ui` | 设计系统原语（Base UI/shadcn 风格） | 直接复用，换品牌令牌 |
| `packages/core` | API 客户端、Query hooks、Zustand、i18n | 复用，扩展 Chat/Team/Artifact |
| `apps/mobile` | Expo 客户端 | P2 再评估 |
| `apps/docs` | Fumadocs 文档站 | 复用为 Pizza 文档站 |

**关键路径（前端）：**

- 应用外壳：`packages/views/layout/dashboard-layout.tsx`、`app-rail.tsx`、`space-panel.tsx`、`app-shell-context.tsx`。
- 右侧栏基础设施：`packages/views/layout/object-page.tsx`、`animated-right-sidebar.tsx`。
- 设置外壳：`packages/views/settings/components/settings-page.tsx`、`settings-layout.tsx`。
- 智能体管理：`packages/views/agents/*`；表单 `create/agent-configuration-panel.tsx`、`components/agent-detail-inspector.tsx`；草稿模型 `packages/core/agents/draft.ts`。
- 团队：`packages/views/squads/*`；创建弹窗 `modals/create-squad.tsx`。
- 聊天：`packages/views/chat/chat-page.tsx`、`components/chat-message-list.tsx`、`components/chat-input.tsx`、`components/use-chat-controller.ts`。
- Mention 引擎：`packages/views/editor/extensions/mention-suggestion.tsx`、`mention-extension.ts`。
- Issue 评论的多智能体触发（可借鉴）：`packages/views/issues/hooks/use-comment-trigger-preview.ts`、`components/comment-trigger-chips.tsx`、`hooks/use-recipient-actions.ts`、`packages/core/issues/run-steering.ts`。
- 运行时：`packages/views/runtimes/*`、`packages/core/runtimes/*`。
- 设计系统：`packages/ui/styles/tokens.css`、`packages/ui/icons/*`、`packages/ui/components/ui/*`。
- i18n：`packages/views/locales/*`、`packages/core/i18n/*`。
- 桌面端 daemon 控制：`apps/desktop/src/main/daemon-manager.ts`、`apps/desktop/src/preload/index.ts`。

**前端现状（对 Pizza 的影响）：**

- 聊天是 1:1，`chat-input.tsx` 的 `@` 是「上下文引用」模式，不是智能体调用；需切换为参与者模式。
- 多智能体触发的成熟实现只在 Issue 评论，可作为 Chat 分发的参考。
- 聊天页没有产物右栏；右侧栏基础设施 `ObjectPage` 可复用。
- 没有「在 VS Code 中打开」、Git 面板、变更记录、审计页、内存管理、关于页；均需新写。
- 智能体表单没有上下文阈值、max tokens、temperature；需扩展字段。
- Squad 没有成员级覆盖与快照；需扩展类型、迁移与页面。

### 3.2 后端

- Go 1.26 / chi / pgx / PostgreSQL / sqlc / gorilla-websocket；Redis 可选。
- `server/internal/handler`：按领域平铺（agent、chat、squad、skill、workspace_mcp、runtime、daemon…）。
- `server/internal/service/task.go`：8,000+ 行的任务编排核心。
- `server/internal/daemon`：本机守护进程，探测/启动 CLI、领取任务、流式上报。
- `server/pkg/agent`：Provider 抽象与 27 个 CLI/ACP 后端。
- `server/migrations`：~624 对迁移，最新前缀 599。

### 3.3 关键数据表

| 表 | 作用 | Pizza 复用 |
| --- | --- | --- |
| `agent` | 智能体配置（instructions、runtime、model、thinking、env、args、mcp、concurrency、conversation_starters…） | ✅ 直接复用 + 扩展 |
| `agent_runtime` / `runtime_profile` | 运行时实例 / 自定义运行时配置 | ✅ 直接复用 + 增加 ACP 连接表单 |
| `agent_task_queue` | 执行队列（已支持 `issue_id NULL` + `chat_session_id`） | ✅ 复用 |
| `task_message` | 结构化流式事件（text/tool_use/tool_result/error） | ✅ 复用 |
| `task_supplement` | 向运行中的任务注入消息 | ⚠️ 目前 Issue 绑定，需扩展到 Chat |
| `chat_session` / `chat_message` | 1:1 聊天 | ⚠️ 需扩展为房间 + 多发送者 + mention |
| `squad` / `squad_member` | 团队 | ⚠️ 模型可复用，触发/提示词是 Issue 绑定 |
| `skill` / `skill_file` / `agent_skill` | Skill 存储与绑定 | ✅ 直接复用 |
| `workspace_mcp_server` / `agent_mcp_server` | MCP 库与绑定 | ✅ 直接复用 |
| `task_usage*` | token/费用与汇总 | ✅ 直接复用 |
| `activity_log` | 弱审计 | ⚠️ 需新增通用审计 + JSONL |
| `attachment` | 文件 | ✅ 复用为一等产物基础 |

---

## 4. 直接可复用（EXISTS）

| 能力 | 说明 |
| --- | --- |
| 认证 / 工作区 / 成员权限 | JWT/PAT/daemon/task token、工作区隔离、角色中间件 |
| 实时通道 | `/ws`、Redis relay、scope、重连语义 |
| Daemon 协议 | 注册、心跳、租约、WS RPC + HTTP 兜底、运行时探测 |
| 任务队列与执行 | claim、start、progress、complete、fail、cancel、重试、归属、用量 |
| Provider 抽象 | 27 个后端，统一 `Backend.Execute` / `Session.Messages` / `Result` |
| ACP 传输 | 自研 JSON-RPC stdio 客户端（Hermes、Kimi、Kiro、Qoder、Grok、Devin…） |
| CLI Provider | Claude、Codex、Pi/omp、DSH、Cursor、Copilot 等直接 spawn |
| Skill | 存储、绑定、内置、bundle 缓存、按 Provider 原生目录注入 |
| MCP | 工作区库 + 智能体绑定 + 运行时本地合并 + ACP `mcpServers` |
| 附件 / 对象存储 | 上传、下载、绑定消息 |
| 用量 | `task_usage` + 小时汇总 + Dashboard/Runtime 端点 |
| Mention 解析 | `internal/util/mention.go`（agent/member/squad/issue/all，忽略代码块） |
| 调用权限 | `agent_invocation_target`、`canInvokeAgent`、`AgentReadiness` |
| 设计系统 | 三栏 Shell、消息、头像、设置页、主题、i18n |

---

## 5. 需要改造（PARTIAL）

### 5.1 多智能体会话

参考项目的 `chat_session` 只有 `agent_id`（NOT NULL）与 `creator_id`；`chat_message.role` 只有 `user|assistant`；实时事件仅创建者可见。Pizza 需要：

- `conversation`（或复用 `chat_session`）：绑定 `agent_id` 或 `team_id`，新增 `mode`、`title`、`workspace_path`。
- `conversation_participant`：`participant_type(agent|member|team)`、`participant_id`、`role(commander|member)`。
- `chat_message`：新增 `sender_type(user|agent|system)`、`sender_agent_id`、`round_no`、`status`。
- `message_mention`：`message_id`、`mention_type(agent|user|all)`、`target_agent_id`、`offset`、`resolved_run_id`。
- 实时：新增房间级订阅与按智能体分流的流式事件；扩展现有 `ScopeChat` 授权。

### 5.2 Mention 分发

- 复用 `ParseMentions`、`canInvokeAgent`、`AgentReadiness`。
- 将 Issue 评论的 `resolveMentionedAgentCommentTriggers`（`handler/comment.go`）改造成 Chat 版本：
  - 解析一条消息中的多个 mention；
  - 解析团队/指挥者；
  - 为每个目标创建一个 task，并把 `chat_message_id` 关联到 task；
  - 去重：同一会话 + 同一智能体 + 同一消息只创建一个 task。
- `TaskService.SendDirectChatMessage` 目前假设单智能体、单 task；需扩展为 N 个 task。

### 5.3 指挥者 / 团队

- `squad` / `squad_member` 的模型可直接复用，重命名为 Team。
- `squad_briefing.go` 的 **Squad Operating Protocol + Roster** 文本高度可复用：
  - leader 只协调、不亲自实现；
  - 用精确 mention 语法 `[@Name](mention://agent/<uuid>)` 分派；
  - 每轮记录评估；
  - 分派后停止，等待成员回报。
- 需要新增：
  - Chat 原生的 leader 触发与再触发（不再依赖 Issue 状态）；
  - 成员级 Prompt/Skill/MCP 覆盖（参考项目没有，需要新表）；
  - 团队快照；
  - 用户直接在会话中 @ 成员（参考项目的 Issue 评论支持，Chat 不支持）。

### 5.4 运行中插话

- `task_supplement` 机制成熟，但表与路由都是 Issue 绑定（`issue_id NOT NULL`）。
- Pizza 扩展方式：增加 `chat_session_id` / `chat_message_id` 列与 Chat 路由，复用 daemon 的 supplement claim/ack 与 `Session.Supplement`。
- 若运行时不支持，降级排队。参考项目的 Chat 目前就是排队，Issue 评论支持 "Add to current run" 与 "Steer"。

### 5.5 产物 / 审计 / Git

- **产物**：参考项目没有一等公民 `artifact`；产物是附件 + 客户端派生 deliverable。Pizza 新增 `artifact` 表与监听器。
- **审计**：只有 `activity_log`（弱）与渠道审计；Pizza 新增通用 `audit_event` + JSONL sink + 查看器。
- **Git 面板**：参考项目有 PR 卡片、worktree/branch 语义、GitHub/GitLab/Gitea 集成，但没有独立 Git 面板；Pizza 新增 UI，底层可复用 worktree 逻辑。

### 5.6 上下文压缩

参考项目没有 per-agent 上下文阈值；上下文由 Workspace / Project / Issue 提供。Pizza 需新增 `context_limit`、`keep_recent_messages` 与摘要器，并写入 Run 的 effective config。

---

## 6. 必须新写（ABSENT）

1. 多参与者会话/房间模型与房间级实时授权。
2. 会话内 mention → 多 Run 扇出；`@全体`；mention 触发预览。
3. 团队/指挥者的 Chat 原生协议与再触发规则。
4. 成员级配置覆盖与团队快照。
5. 一等公民产物（artifact）与右侧面板。
6. 通用审计事件、JSONL 导出与查看器。
7. Git 面板 / 变更记录 UI。
8. 每智能体上下文压缩与摘要。
9. 目标运行时的一键 ACP 接入向导（参考项目更偏 daemon 自动探测 + 运行时配置）。

---

## 7. ACP 与运行时事实

参考项目的 "ACP" 是**自研 JSON-RPC stdio 客户端**，不是通用 ACP Server Host。使用 ACP 的 Provider：

- Hermes、Kimi、Kiro、Reasonix、Qoder/Qoder CN、Trae、Grok、QwenPaw、MiniMax Code、Dim、Devin、ZeroClaw、OpenCode v2。
- ACP 能力：`session/new`、`session/load`/`resume`、`session/prompt`、`session/update`、权限请求、MCP `mcpServers`、usage。

**非 ACP 的 Provider**（直接 spawn CLI / 自有 JSON-RPC）：

- Claude（`claude --output-format stream-json`）、Codex（`codex app-server`）、Copilot、Cursor、OpenClaw、Pi/omp、CodeArts、DevEco、DSH、Antigravity、Qwen、Muse 等。

因此 Pizza 的目标运行时需要分两类：

| 目标 | 接入方式 | 说明 |
| --- | --- | --- |
| Claude Code | CLI 适配（`stream-json`）或第三方 ACP 包装 | 参考项目原生是 CLI；ACP 需额外适配器 |
| Codex | CLI 适配（`app-server`）或第三方 ACP 包装 | 同上 |
| Pi | CLI 适配 | 参考项目已有 `pi` backend |
| Oh My Pi | CLI 适配（`omp` → pi 协议族） | 参考项目 `builtin_runtimes.go` 映射 |
| DeepSeek Harness | CLI 适配 | 参考项目已有 `dsh` backend |
| Hermes | **原生 ACP** | 参考项目已有 `hermesClient` |

> 结论：Pizza 的「ACP 协议调用」应表述为「**统一运行时适配层，ACP 优先，CLI 兼容**」。若强行要求全部走 ACP，需要为 Claude/Codex/Pi/OMP/DSH 编写或引入 ACP 桥接器，属于额外工程与稳定性风险。

---

## 8. 复用架构建议

### 方案 A（推荐）：完整 Fork + 本地化打包

```text
Electron (apps/desktop)
  ├── React renderer (packages/views + packages/ui)
  ├── 本地 Go server（复用 server/，Postgres 本地实例）
  └── 本地 daemon（复用 server/internal/daemon + pkg/agent）
```

- **优点**：直接继承 27 个 Provider、daemon、任务队列、Skill/MCP、用量、实时、权限；工期最短。
- **改造面**：Chat/Team 领域、Mention 扇出、产物/审计/Git UI、品牌与导航。
- **部署**：桌面端内置/伴随启动 Go server 与 PostgreSQL（或使用现有 self-host Docker）；数据留在本机。
- **风险**：安装包体积、Postgres 生命周期管理、许可证。

### 方案 B：只复用前端 + 本地新核

- Electron + React + TypeScript 本地核心 + SQLite + ACP 客户端。
- **优点**：轻、纯本地、启动快。
- **缺点**：需要重写 daemon、Provider 适配、任务队列、Skill/MCP 注入；等于放弃参考项目最有价值的后端。
- **结论**：不推荐，除非许可证不允许复制后端。

### 方案 C：只复用交互与设计，独立实现

- 仅借鉴信息架构与 UI 模式，代码全部新写。
- 适合规避许可证品牌条款，但工期最长。

**建议**：先确认许可证与授权，再选择 A；若不能复制代码，则退到 C（而非 B，因为 B 仍是复制前端代码，同样受许可证约束）。

---

## 9. 许可证

参考项目使用自定义许可证（Apache-2.0 + 附加条件，见 `参考仓库根目录/LICENSE`）：

- 允许内部使用、修改、公开 fork 源码；
- **限制移除参考项目的 LOGO、产品名与版权归属**（除非获得品牌豁免）；
- 对向第三方提供托管服务 / 将参考项目作为商业产品组件有额外限制；
- 商业授权与品牌豁免需通过参考项目的官方渠道申请。

**对 Pizza 的影响**：直接复制 UI/代码后改名为 Pizza、移除参考项目品牌，可能违反条款。代码阶段前必须：

1. 取得品牌豁免/商业授权；或
2. 保留参考项目归属信息并遵守条款；或
3. 仅借鉴交互、独立实现（方案 C）。

---

## 10. 关键文件索引（实现阶段直接定位）

| 领域 | 路径 |
| --- | --- |
| Chat handler | `server/internal/handler/chat.go` |
| Chat 任务编排 | `server/internal/service/task.go`（chat enqueue ~1947–2520） |
| Mention 解析 | `server/internal/util/mention.go` |
| Issue mention 触发 | `server/internal/handler/comment.go`（~3064–3310） |
| Squad briefing | `server/internal/handler/squad_briefing.go` |
| Daemon claim 响应 | `server/internal/handler/daemon.go`（~2817+，squad 注入 ~3187） |
| Daemon 执行 | `server/internal/daemon/daemon.go`（runTask 7708，executeAndDrain 9523） |
| Prompt 构建 | `server/internal/daemon/prompt.go` |
| 运行中插话 | `server/internal/daemon/task_supplement.go` |
| Provider 抽象 | `server/pkg/agent/agent.go`、`launch.go`、`hermes.go`、`<provider>.go` |
| 实时隐私 | `server/cmd/server/listeners.go`、`server/internal/realtime/hub.go` |
| Chat 迁移 | `server/migrations/033_chat.up.sql` |
| Squad 迁移 | `server/migrations/084_squad.up.sql` |
| Skill 迁移 | `server/migrations/008_structured_skills.up.sql` |
| MCP 迁移 | `server/migrations/315_workspace_mcp_server.up.sql` |
| 用量迁移 | `server/migrations/101_task_usage_hourly_schema.up.sql` |
| 前端 Chat | `packages/views/chat/chat-page.tsx`、`components/chat-message-list.tsx`、`components/chat-input.tsx`、`components/use-chat-controller.ts` |
| 前端 Mention | `packages/views/editor/extensions/mention-suggestion.tsx`、`mention-extension.ts` |
| 前端 Agents | `packages/views/agents/components/agents-page.tsx`、`create/agent-configuration-panel.tsx`、`components/agent-detail-inspector.tsx` |
| 前端 Squads | `packages/views/squads/components/squads-page.tsx`、`squad-detail-page.tsx`、`modals/create-squad.tsx` |
| 前端外壳 | `packages/views/layout/dashboard-layout.tsx`、`app-rail.tsx`、`space-panel.tsx` |
| 前端右侧栏 | `packages/views/layout/object-page.tsx`、`animated-right-sidebar.tsx` |
| 设计系统 | `packages/ui/styles/tokens.css`、`packages/ui/icons/`、`packages/ui/components/ui/` |
| 桌面 daemon | `apps/desktop/src/main/daemon-manager.ts`、`apps/desktop/src/preload/index.ts` |

---

## 11. 调研结论

1. **不要从零写运行时层**。参考项目的 daemon + Provider 抽象 + 任务队列是 Pizza 最大的复用资产。
2. **多智能体 @ 群聊是真正的新东西**。参考项目的 @ 只存在于 Issue 评论，Chat 是 1:1；Pizza 需要新增房间/参与者/mention/扇出/房间级实时。
3. **团队配置需要增强**。参考项目的 Squad 只有角色描述与团队指令，没有成员级 Prompt/Skill/MCP 覆盖与快照。
4. **产物、审计、Git 面板是新增面**。不要假装参考项目已有。
5. **ACP 不是全部运行时的原生协议**。产品文案与架构需区分 ACP 与 CLI 兼容层。
6. **许可证是代码阶段的前置决策**，不是实现细节。
