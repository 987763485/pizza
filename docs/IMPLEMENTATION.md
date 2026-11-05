# Pizza 实现说明

本文记录当前生产代码的架构、数据目录、运行时适配和验证方式。需求与验收以 `docs/PRD.md` 和 `docs/openspec/changes/` 为准；本文只解释实现。

## 1. 当前范围

当前实现对应 `p0-capabilities-settings`（建立在已归档的 `p0-solo-vertical-slice` 与 `p0-team-orchestration` 之上）：

- Electron 桌面壳、工作区、会话、智能体、团队与运行时管理。
- SQLite 本地持久化、全文/模糊搜索、会话分叉、归档、恢复和删除。
- 独立运行时 SDK：Claude CLI、ACP、Codex app-server、Pi/OMP、DSH 与通用 CLI 协议族；单智能体与团队共享同一执行器与调度器。
- 单智能体流式对话、工具调用展示、停止、重试、排队、附件。
- 团队会话：精确提及解析、指挥者/成员路由、并发与串行扇出、插话排队、停止、保护、结构化收敛与对话轨迹。
- 智能体指令来源：自带初始 Prompt，或作为团队成员时由指挥者每次动态下发角色指令。
- Skill 导入、校验、绑定、运行级物化；内置协作 Skill。
- MCP stdio/SSE/HTTP 配置、凭据加密、连接测试、工具发现与运行时注入。
- 统一工具审批：ACP 权限请求与 Claude PreToolUse hook 共用主进程审批服务。
- 设置中心、通知、主题/字号/密度/减少动效、中英文、首次启动探测与数据目录迁移。
- 产出物侧栏、Markdown/代码/图片预览、首选编辑器打开工作区。
- 按已确认原型复原的三栏界面、命令面板、智能体/运行时/团队整页编辑与设置页。
- macOS、Windows 与 Linux 打包目标；Windows/Linux 使用系统默认程序打开工作区。
- 确定性 E2E、打包启动测试与真实 Claude Code 手工验收。

自动更新、签名/公证、团队快照、完整记忆与统计和云同步不在当前范围。

## 2. 目录

```text
src/
  main/                 Electron 主进程
    db/                 SQLite 连接、迁移、会话仓储与能力仓储
    runtime/            运行时配置 → RuntimeSpec 映射、MCP 连接器、注入与审批 hook
    services/           工作区、运行时、智能体、会话、运行、产出物、附件、Skill、MCP、审批、通知、设置
    ipc/                IPC 注册与输入校验
  preload/              窄 contextBridge API
  renderer/             React 界面、Zustand 状态与 i18next 资源
  shared/               主进程与渲染层共享类型、IPC 通道与 Zod schema
packages/
  runtime-sdk/          独立运行时 SDK：协议族适配器、SessionRuntimeActor、RuntimeSupervisor
tests/
  fixtures/             确定性假运行时、假 ACP 服务端与假 MCP stdio 服务
  main/                 数据层、协议解析、能力解析、审批与 MCP/ACP 集成测试
  runtime-sdk/          调度器行为与 Pi/Codex/DSH 协议解析测试
  renderer/             组件测试（审批对话框）
  shared/               共享纯函数与 i18n 资源一致性
  e2e/                  Playwright Electron 冒烟、能力设置与打包启动测试
```

## 3. 数据目录与数据库

- 数据目录：`~/.pizza`，可用环境变量 `PIZZA_DATA_DIR` 覆盖。
- 数据库：`~/.pizza/pizza.db`。
- 附件：`~/.pizza/attachments/`。
- SQLite 使用 WAL、外键和 `node:sqlite`（Electron 45 / Node 24 内置模块）。
- 迁移在 `src/main/db/migrations.ts` 中以版本数组维护；启动时自动补齐，重复启动不会重复执行。
- 主要表：`workspace`、`runtime`、`agent`、`session`、`message`、`message_fts`、`attachment`、`run`、`run_event`、`artifact`、`app_setting`、`team`、`team_member`、`message_mention`、`team_turn`、`team_turn_event`。
- 迁移版本 3 新增团队数据模型，并给 `session` 增加 `interjection_mode`（默认 `queue`）、给 `run` 增加可空 `team_turn_id`；单智能体数据库可无损升级。
- 迁移版本 8 将 `agent` 改为全局资源：重建表以移除 `workspace_id` 与工作区级唯一约束，同名智能体追加 id 片段后建立全局唯一索引；迁移期间临时关闭外键并在提交前执行完整性检查。
- 迁移版本 11 给 `agent` 增加 `instruction_mode`（`self | leader`，默认 `self`）：`self` 使用自带 Prompt，`leader` 作为团队成员时由指挥者每次动态下发角色指令。
- `team` 保存指挥者、编排 Prompt、并发/扇出策略、单回合跳数保护与 token 预算；`team_member` 保存成员排序、角色、Prompt 覆盖模式与 Skill/MCP 覆盖结构。
- `team_turn` 是回合事实来源，状态为 `dispatching → debating → waiting_user → converging → completed`，另有 `failed`、`cancelled`、`interrupted`；`team_turn_event` 记录分派、运行、插话、保护与收敛事件。
- `message_mention` 保存目标类型、目标智能体、显示名、起止位置、原始语法与是否解析成功，供消息渲染和审计复用。
- 运行时环境变量使用 Electron `safeStorage` 加密后写入 `runtime.env_json`；界面只显示是否已保存，不回显明文。

## 4. 运行时调度 SDK

运行时能力拆成独立包 `packages/runtime-sdk/`，不依赖 Electron、SQLite 或渲染层，便于以后用 Rust 重写。三层职责：

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 协议族 Adapter | `packages/runtime-sdk/src/adapters/` | 启动进程、握手、发送 prompt、解析事件、取消与关闭 |
| 会话 Actor | `packages/runtime-sdk/src/session-actor.ts` | 单会话懒启动、单飞、FIFO、空闲计时、失效重建 |
| 全局 Supervisor | `packages/runtime-sdk/src/supervisor.ts` | warm 上限、启动/turn 信号量、优先级、公平性与 LRU 回收 |

主进程只做两件事：把数据库中的 `RuntimeConfig` 映射为 SDK 的 `RuntimeSpec`（`src/main/runtime/spec.ts`），以及调用 `RuntimeSupervisor.run(actorKey, spec, job)`。单智能体以会话 ID 作为 actor key；团队每个成员使用 `${sessionId}:${agentId}`，避免成员共享运行时会话。

协议族：

- `claude-cli`：Claude Code 与 Qoder CN `--output-format stream-json`，per-turn，通过 `--session-id` / `--resume` 维持会话。Qoder CN 复用事件解析，但不支持 Claude 的 `--verbose`，思考强度使用 `--reasoning-effort`；模型列表通过 `--list-models` 读取。
- `acp`：通用 ACP stdio（含 Hermes、OpenCode `acp`、Gemini CLI `--acp`），persistent；覆盖 `initialize`、`session/new`、`session/load`、`session/prompt`、`session/cancel` 与权限请求。
- `codex-app-server`：`codex app-server --listen stdio://`，persistent；使用 `thread/start`、`thread/resume`、`turn/start`、`turn/interrupt` 与 `item/*` 通知。
- `pi-json`：Pi / OMP `-p --mode json`，per-turn；解析 `message_update`、`tool_execution_*`、`turn_end`，以会话文件作为恢复锚点。
- `kimi`：Kimi Code `-p --output-format stream-json`，per-turn；解析 assistant 文本、工具调用与 `session.resume_hint`，通过 `--session` 恢复。
- `dsh`：官方 `--profile acp` 走 ACP 协议族（默认预设）；自定义 JSONL profile 切换为 CLI 后使用 `execute` / `cancel` 命令与 `ready/session/text/tool_*/usage/result` 帧。
- `plain-cli`：任意 CLI 的纯文本兜底（stdin 输入、stdout 输出），用于自定义运行时。

标准化事件保持不变：`text_delta`、`tool_started`、`tool_updated`、`tool_finished`、`usage`、`status`、`completed`、`failed`、`cancelled`。

模型发现由 `RuntimeAdapter.listModels(spec, signal)` 提供，结果写入 `RuntimeCapabilities.modelList` 与 `thinkingLevels`：

- Claude：stream-json `list_models` 控制请求（只读，不调用模型）。
- ACP：临时 `session/new` 的 `configOptions`；兼容旧版 `models.availableModels`。
- Codex：`codex debug models`，失败回退 `--bundled`。
- Pi / OMP：`pi --list-models` / `omp models --json`。
- DSH JSONL：`--list-models`；官方 ACP profile 走 ACP 发现。
- 通用 CLI：空目录，回退手动填写。

连接测试成功后会顺带刷新模型目录；智能体运行时页提供「刷新模型」。模型选择通过 `agent.model` 传给对应适配器，强度按模型声明的集合展示；ACP 使用 `session/set_config_option`（旧版 `session/set_model`），Codex 在模型变化时重建线程。

新增运行时或协议族时：

1. 在 `src/shared/types.ts` 的 `RuntimeAdapterId` 中加入标识，并在 `RUNTIME_PRESETS` 中提供默认配置。
2. 在 `src/main/runtime/spec.ts` 把运行时身份映射到已有协议族；只有需要全新协议时才在 SDK 中新增 adapter。
3. 增加协议解析/调度测试，并在 `packages/runtime-sdk/README.md` 与本文更新说明。

调度默认值：warm 上限 4、并发启动 2、全局 turn 并发 4、空闲 5 分钟、单会话队列 20。超时按“无活动”计算，文本/工具/用量事件都会重置计时；等待审批与工具执行期间不会误杀。

崩溃恢复采用保守策略：启动时把 `starting/running` 标记为失败并保留已输出文本，排队任务不自动重放，避免应用启动时产生用户没有预期的模型调用；这与 AionCore“冷启动回到 Idle、不自动续跑 turn”的做法一致。

## 5. 团队编排

完整的语法、路由矩阵、状态机与保护规则见 `docs/TEAM-PROTOCOL.md`；本节说明实现位置。

### 5.1 共享执行器

`AgentRunExecutor` 负责一次运行的流式事件、消息/运行落库、用量、工具事件、产出物扫描和失败处理；运行时会话的获取、复用、排队与回收交给 `RuntimeSupervisor`。单智能体的会话级 FIFO 由 Actor 提供，`RunService` 只负责消息/运行落库与提交；`TeamOrchestrator` 负责团队队列、回合状态和保护，并为每个成员使用独立 actor key。执行器不决定全局并发或回收策略，但在进入 Supervisor 之前按智能体自己的并发上限排队；该上限与系统全局上限分开配置。

### 5.2 提及语法

`src/shared/mentions.ts` 是主进程与渲染层共用的纯函数：

- 精确提及：`[@名称](mention://agent/<id>)`；用户提及：`[@我](mention://user)`。
- 用户消息同时识别 chip 序列化与文本 `@名称`；智能体消息只识别精确链接，纯文本 `@` 不触发调度。
- 名称解析顺序：本会话参与者 → 团队成员 → 工作区全局唯一名称；重名返回歧义，未知目标保留原文并写系统事件。
- 同一目标去重；自身提及忽略并写 `mention_ignored` 事件。

### 5.3 路由与调度

两种模式从消息入口到运行结束的流转图见 `docs/MESSAGE-ROUTING.md`。

- 用户未提及：默认指挥者；直接提及成员：只调度成员并向指挥者写被动通知；提及用户：回合进入 `waiting_user`。
- 团队交互的主链路是「指挥者提及 → 成员单轮任务 → 回到指挥者」；成员参与次数与顺序由指挥者的提及决定，编排器不按轮次自动唤醒成员。
- 成员完成且无显式提及：返回调用者；调用者是指挥者或用户时回到指挥者。成员消息中的其他成员提及不直接调度，作为建议随结果回到调用者/指挥者。
- 指挥者无提及输出视为本轮收敛结束。
- 同一团队回合内同一智能体最多一个运行；跨会话的同一智能体由执行器的并发闸门限制在它自己的上限内。团队默认最大并发 3，并受全局并发设置约束；并行/串行扇出按团队配置执行，串行时后一个成员上下文包含前一个结果。
- 用户插话统一排队；当前运行时未声明追加输入能力时写入 `runtime_append_unsupported` 事件并在消息流显示排队状态。等待用户后的回复继续当前回合，不新建回合。
- 停止单个运行只取消目标运行；停止回合取消本回合所有运行并保留已产生文本，写 `turn_cancelled` 事件。

### 5.4 上下文与保护

`TeamContextBuilder` 组装系统协作协议、精确提及语法、参与者能力目录（名称、能力描述、团队职责、指令来源、运行状态）、调用者说明、有效成员 Prompt、最近消息、串行前序结果与产出物路径；团队编排规则只注入指挥者。运行状态由编排器根据活动运行与队列实时提供，指挥者据此避免重复派发或决定等待；它像读取 Skill 注册表一样，按能力描述决定派发对象。

指令来源为 `leader` 的成员不使用自己的 Prompt 与团队覆盖：编排器把触发消息作为本轮角色指令，系统 Prompt 改为动态角色说明，用户 Prompt 显式列出「本轮角色指令」；指挥者会在能力目录中看到该成员的指令来源，并被要求写清角色、边界、输出格式与完成标准。指挥者自身始终使用自己的 Prompt；单智能体运行、连接测试等无指挥者下发的场景使用可选的单智能体兜底 Prompt，未填写时使用共享的通用兜底 Prompt。成员协议只允许完成单轮任务并回传结果，不允许跨成员直连。指挥者再次发言时额外注入自上次发言以来的成员摘要。上下文使用确定性结构化压缩：保留原始任务、最近消息和产出物路径，截断中间旧正文，不额外调用模型。

保护阈值：单回合跳数使用团队配置（默认 64，仅作防失控保护）、单运行超时 30 分钟、同一发送者到同一目标的相似调用在 2 分钟内抑制、A→B→A 连续三次触发收敛提示、token 预算 80% 提醒 / 100% 停止。团队不设辩论轮次上限，是否继续辩论由指挥者决定。触发保护后回合进入 `converging`，向指挥者投递结构化总结指令。

收敛文本写入工作区 `.pizza/artifacts/team-turn-<seq>.md` 并索引到产出物面板；写入失败时保留会话内文本并写系统消息说明路径与原因。

### 5.5 崩溃恢复

启动时 `markInterruptedRuns()` 把未完成运行标记为 `failed`、未完成回合标记为 `interrupted`，并写入 `turn_interrupted` 事件；已完成文本与产出物保留，不自动重放。用户可查看结果后重新发起回合。

## 5A. 能力、审批与设置

详细规则见 `docs/CAPABILITIES.md`，这里只说明代码位置：

- `db/capability-store.ts`：Skill、MCP、绑定、审批、策略与通知的仓储。
- `services/skill-service.ts` + `skill-utils.ts` + `skill-materializer.ts`：导入校验、存储、物化与 Claude 插件目录。
- `services/mcp-service.ts` + `runtime/mcp-connector.ts`：配置加密、连接测试与官方 SDK 连接器。
- `services/capability-resolver.ts`：工作区 → 智能体 → 团队成员的能力解析与诊断。
- `services/approval-service.ts` + `runtime/injection.ts`：统一审批、超时/FIFO、Claude hook 与运行级注入。
- `services/notification-service.ts`：提及通知、去重、免打扰与系统通知降级。
- `services/settings-service.ts` + `services/data-dir-service.ts`：设置默认值、持久化与数据目录迁移。
- `services/onboarding-service.ts`：运行时探测；渲染层按 `RUNTIME_PRESETS` 与检测到的命令路径生成 `RuntimeInput`，复用 `runtime.test` / `runtime.create` 批量导入所选运行时。
- `electron-builder.yml` 与 `scripts/check-package-metadata.mjs` 负责打包。

## 6. 运行与验证

```bash
npm install
npm run dev
npm run typecheck
npm test
npm run build
npm run test:e2e
```

- `npm install` 通过 `.npmrc` 使用 Electron 二进制镜像；如网络允许官方源，可删除该行。
- E2E 使用 `tests/fixtures/fake-claude.cjs` 作为确定性运行时，不依赖真实模型。
- 真实运行时验收：在图形界面添加 Claude Code 运行时，测试连接，创建智能体，发送带文件写入的任务，确认产出物面板出现文件。
- 当前使用 `node:sqlite` 的实验性 API；Node 运行测试时会出现 ExperimentalWarning，这是预期提示，不是失败。

## 7. 安全边界

- `contextIsolation: true`，`nodeIntegration: false`，渲染层只能通过 preload 暴露的 API。
- CSP 限制脚本、样式、图片和连接来源；外部链接通过白名单打开。
- 运行时以 argv 数组启动，不经过 shell。
- IPC 输入使用 Zod 校验；文件读取限制在数据目录或已注册工作区内。
- 运行时密钥使用 `safeStorage`；日志不输出完整密钥。
- 产出物路径在读写前做规范化与根目录校验，拒绝越界路径。

## 8. 界面与原型

- `src/renderer/src/styles.css` 以 `prototype/styles.css` 的设计令牌和组件样式为基础，生产组件直接使用原型类名，确保颜色、间距、字号和布局一致。
- 标题栏、侧栏、首页、会话页、产出物面板、设置导航与智能体/运行时列表均已按原型结构还原；图标集中在 `components/Icon.tsx`，避免混用不同笔画风格。
- 首页与侧栏的「置顶工作区」是纯界面偏好，保存在本机 `localStorage`；其余状态仍以 SQLite 为准。默认工作区在界面统一显示为「默认工作区」，底层仍保留目录名与真实路径。
- 智能体、运行时与团队编辑是设置内容区的整页视图；团队编辑器包含基本信息、指挥者、成员、团队指令、校验预览与最终生效 Prompt。
- 团队列表支持搜索、最近使用排序、模板创建、归档与删除影响提示；删除有历史会话的团队会被拒绝，引导改为归档。
- 首页参与者下拉包含「智能体」与「智能体团队」分组；选择团队直接创建团队会话。
- 团队会话复用三栏外壳：头像堆叠、指挥者/成员数、回合分隔、多参与者消息头、指挥者/成员标签、等待用户卡片、单个/全部停止、插话排队状态与「轨迹」页签。
- 团队输入框使用 contentEditable 提及编辑器：`@` 打开指挥者/成员/我分组，插入不可编辑 chip，发送时序列化为精确提及语法；消息气泡把 mention 链接渲染为 chip。
- Skills、MCP、统计、快照等 P1 页面保留原型导航位置，并以明确的「规划中」空状态呈现，不伪造可操作数据。

### 界面入口与快捷键

- `⌘K`：打开命令面板，可搜索会话标题、消息正文、智能体名称，并跳转到命中的消息。
- `⌘N`：回到首页开始新对话。
- `⌘,`：打开设置。
- 标题栏左侧：折叠/展开侧栏、搜索；右侧：切换浅色/深色主题。
- 侧栏工作区行的「…」：置顶、打开工作区首页或删除工作区（默认工作区不可删除；删除只清理应用数据，不删除磁盘文件）；会话行的「…」或右键：重命名、分叉、归档、永久删除。
- 会话头部：编辑器角标打开当前工作区，右侧箭头切换首选编辑器；搜索、停止、右侧栏开关。
- 设置导航：个人资料、语言与外观、记忆管理、已归档会话、智能体、智能体团队、Skills、MCP、运行时、统计、系统设置、初始化系统、关于 Pizza。
- 初始化写入 `reset-requested` 标记后重启；下次启动在打开数据库前清理数据库、附件、Skill、运行临时目录与 Web 存储，工作区目录保持不变。

## 9. 已知限制

- Skill/MCP 实际执行、团队快照、团队嵌套、`@全体`、自然语言并行声明、审批流、安装包和云同步尚未进入当前范围。
- 首批认证 Claude Code CLI 与通用 ACP；其他预设为实验性。
- 运行中插话依赖运行时能力；当前适配器均未声明追加输入，因此统一降级为排队并写事件说明。
- 团队收敛质量取决于指挥者模型；协议要求结构化字段，产品不额外调用模型二次校验。
- 附件界面已支持文本/图片预览；更多文件类型的预览在后续变更完善。
- 大型工作区的产出物监听仍需性能评估。
- 主题已支持浅色/深色切换；字号、密度、减少动效与界面语言仍为 P1。
