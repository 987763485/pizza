# Comet Design Handoff

- Change: p0-solo-vertical-slice
- Phase: design
- Mode: compact
- Context hash: 9cdf4e381084bae762431c3f872e14c1f05543acb3fa6e8f9ab991b37b41d98c

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/p0-solo-vertical-slice/proposal.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/proposal.md
- Lines: 1-38
- SHA256: 1e63aa89fcf6e1c29e29cf8bb7a98863a21cb726bcb0d2ce5825c96f71c85052

```md
# Proposal

## Why

Pizza 目前只有需求文档、UI 规范和高保真原型，没有可运行的生产实现。首个纵向切片必须先证明最关键的闭环成立：用户能在本机接入一个真实运行时，创建一个智能体，完成一次带附件和产出物的流式对话，并在重启后找回全部内容。只有这条链路跑通，团队协作、能力管理和产品化设置才有可靠基础。

## What Changes

- 新增可运行的桌面应用基础壳，提供工作区、会话、智能体、运行时的最小导航与本地数据目录。
- 新增运行时注册与连接测试：支持本机已安装运行时的探测、适配器选择、分步连通性测试、能力记录和在线状态。
- 新增智能体管理：创建、编辑、复制、归档、删除智能体，配置名称、描述、头像、运行时、初始 Prompt、思考强度、上下文阈值和基础权限。
- 新增单智能体会话：会话创建、工作区绑定、消息持久化、流式输出、停止、重试、附件上传与消息内预览。
- 新增会话历史：按工作区归组、搜索、重命名、分叉、归档、恢复与永久删除。
- 新增产出物侧栏：监听工作区文件变化，展示目录树、Markdown/代码/图片预览，并支持用首选编辑器打开工作区。
- 本 change 不包含团队模式、`@` 跨智能体调度、Skill/MCP 管理、完整设置中心、主题/国际化、安装包和云同步。

## Capabilities

### New Capabilities

- `local-workspace`: 桌面应用基础壳、本地数据目录、工作区注册与工作区级数据边界。
- `runtime-connections`: 运行时注册、适配器探测、分步连接测试、能力探测与健康状态。
- `agent-profiles`: 智能体的创建、编辑、复制、归档、删除及运行时相关配置。
- `solo-conversations`: 单智能体会话、消息持久化、流式输出、停止、重试和附件输入。
- `session-library`: 按工作区归组的会话历史、搜索、重命名、分叉、归档、恢复和永久删除。
- `workspace-artifacts`: 工作区产出物的发现、文件树展示、预览和外部编辑器打开。

### Modified Capabilities

无。项目当前没有既有能力规格。

## Impact

- 新增桌面端渲染层、主进程、本地数据层和运行时适配层；技术基线在 Design 阶段确定。
- 新增本地数据库或等价持久化方案，覆盖工作区、运行时、智能体、会话、消息、附件引用、运行记录和产出物索引。
- 新增与 ACP/CLI 运行时的进程或连接生命周期管理，涉及本机命令执行、权限与日志脱敏。
- 现有 `prototype/` 仅作为视觉和交互参考，不直接作为生产代码；参考实现的代码复用需先满足许可证与品牌约束，本 change 默认独立实现。
- 验收以真实运行时完成一次编码任务为准，不以静态演示数据通过。

```

## docs/openspec/changes/p0-solo-vertical-slice/design.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/design.md
- Lines: 1-137
- SHA256: 41596836521aced706ceae29e3cde497e453e141c4e8d5e3afa7acfc854d90d2

[TRUNCATED]

```md
# Design

## Context

变更动机与范围见 `proposal.md`。当前仓库只有产品文档、静态高保真原型和 Comet/OpenSpec 配置，没有生产应用。原型只是视觉与交互契约，没有构建系统、持久化和运行时接入。

首个切片必须能在 macOS 本机运行，所有数据留在本地，并驱动用户已经安装并登录的智能体运行时。它不能依赖云端账号。根据 `docs/PRD.md` 和 `docs/DECISIONS.md` 中记录的许可证与品牌限制，本变更不复制参考项目的代码和品牌资产，采用独立实现。

## Goals / Non-Goals

**Goals:**

- 建立可持续扩展的桌面应用基础，使后续团队协作、Skill/MCP 和设置变更不需要替换数据层或运行时层。
- 跑通一条真实闭环：注册运行时、绑定智能体、流式对话、持久化消息，并展示工作区中实际写入的文件。
- 把运行时差异收敛在稳定的适配器边界内，使新增 CLI 或 ACP 后端不修改会话与 UI 核心。
- 让所有持久化状态可观察，并能在应用重启后恢复。

**Non-Goals:**

- 多智能体调度、`@` 路由、团队配置与结果收敛。
- Skill/MCP 安装、工具审批界面、记忆管理和完整设置中心。
- 生产安装包、自动更新、Windows/Linux 支持、英文界面和深色主题。
- 在本切片中认证所有预设运行时。界面展示预设，但 Claude Code CLI 和通用 ACP 是已认证路径；其他预设标记为实验性，验证后再更新。

## Decisions

### 1. 桌面技术栈：Electron + React + TypeScript + electron-vite

采用 Electron，渲染层使用 React，所有进程使用 TypeScript，构建与开发使用 `electron-vite`。主进程负责操作系统访问，preload 暴露窄接口，渲染层只负责展示和交互状态。

理由：Electron 在 macOS 上能可靠访问子进程、本地文件、系统文件夹选择器和外部编辑器；React 适合实现原型所表达的三栏组件结构；`electron-vite` 用一套工具链管理 main、preload 和 renderer，并支持开发期热更新。

备选方案：

- Tauri：安装包更小，但本切片需要的运行时进程管理和跨平台 sidecar 支持会引入额外风险。
- 本地 Go 服务端 + 浏览器 UI：会把进程管理和 IPC 重复实现一遍，并在纵向切片验证前增加打包复杂度，因此不采用。

### 2. 本地持久化：SQLite + WAL + FTS5

主进程通过 `better-sqlite3` 使用 SQLite，迁移脚本随仓库提交。启用 WAL、外键和 FTS5。数据库位于 `~/.pizza/pizza.db`，附件位于 `~/.pizza/attachments/`。

理由：SQLite 嵌入式、事务化，足以支撑本地单用户场景；WAL 让运行期写入不阻塞读取；FTS5 提供消息搜索，不需要额外搜索服务。

备选方案：

- PostgreSQL：独立实现基线不需要多用户服务端，它会增加服务生命周期和安装包重量，因此不采用。
- JSON 文件：无法可靠支持消息搜索、崩溃恢复和并发写入，因此不采用。

核心表：`workspace`、`runtime`、`agent`、`session`、`message`、`message_fts`、`attachment`、`run`、`run_event`、`artifact`、`app_setting`。`runtime.env_json` 只保存密钥引用，不保存明文；值使用 Electron `safeStorage` 加密，仅在启动运行时解密。

### 3. 运行时边界：统一适配器接口 + ACP/CLI 实现

主进程定义 `RuntimeAdapter` 契约：

- `test(config, signal)` 返回有序的测试步骤和能力数据。
- `openSession(config, context)` 返回带 `prompt()`、`cancel()` 和 `close()` 的会话句柄。

首批实现两个适配器：

- `AcpStdioAdapter`：基于 stdio 的最小 JSON-RPC 2.0 客户端，完成 `initialize`、`session/new`、`session/prompt` 和 `session/cancel`，把 `session/update` 通知映射为标准化运行事件，并把权限请求交给后续审批钩子。
- `ClaudeCodeCliAdapter`：以 argv 数组启动 `claude`，解析结构化 JSON 输出中的文本、工具和结果事件，并使用运行时返回的会话标识继续对话。命令不经过 shell。

两个适配器统一输出以下事件：`text_delta`、`tool_started`、`tool_updated`、`tool_finished`、`usage`、`completed`、`failed`、`cancelled`。会话与 UI 只消费标准化事件。

理由：协议边界是本切片风险最高的集成点。稳定适配器契约能让后续运行时接入不修改会话逻辑。同时实现 ACP 和 Claude Code，可以覆盖协议原生与 CLI 原生两类真实路径。

备选方案：

- 所有运行时都套一层通用 CLI：适配器更少，但会丢失能力探测，失败原因也会被同质化。
- 直接依赖现成 ACP SDK：后续可以采用；首版自行实现最小客户端，依赖更少，升级风险更低。

### 4. 进程与事件流

主进程监督运行时子进程，并且是 SQLite 的唯一写入者。一次运行按以下顺序执行：

1. 持久化用户消息，写入状态为 `queued` 的 `run` 记录。
2. 启动或复用适配器会话，把运行状态改为 `running`。
3. 对每个标准化事件，先追加 `run_event`、更新消息与运行状态，再通过受控 IPC 通知渲染层并展示。
4. 完成时写入用量和最终消息状态；失败或取消时保留已产生内容与错误摘要。
5. 启动时把所有仍为 `running` 的运行标记为 `interrupted`，并开放重试。

```

Full source: docs/openspec/changes/p0-solo-vertical-slice/design.md

## docs/openspec/changes/p0-solo-vertical-slice/tasks.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/tasks.md
- Lines: 1-87
- SHA256: 968f830bf2dcfd067354f36dd8660c9031e864e01e129350864044abcf98f3fd

[TRUNCATED]

```md
# Tasks

## 1. 工程基础

- [ ] 1.1 创建 Electron + React + TypeScript + electron-vite 工程骨架，配置 `dev`、`build`、`typecheck`、`test` 脚本，验证 `npm install` 与 `npm run build` 成功 <!-- comet-task:a5a6cc37-24d9-4c14-97fd-e88bbd629c3e -->
- [ ] 1.2 建立主进程、preload、renderer 分层目录和最小窗口，验证应用能启动且 `contextIsolation` 已开启 <!-- comet-task:5e25e4d4-87f4-4cd5-90fe-c2cb9dece2c7 -->
- [ ] 1.3 配置 CSP、禁止 `nodeIntegration`、限制外部导航，并用一个 preload IPC 冒烟测试验证 renderer 无法直接访问 Node <!-- comet-task:8d43182e-268f-44b7-93ca-79a5d0da2db0 -->
- [ ] 1.4 建立共享类型、Zod IPC 输入校验和错误码，验证不合法 IPC 输入被拒绝的单元测试通过 <!-- comet-task:d6345de3-0085-4535-9e1a-ec6aced2954d -->
- [ ] 1.5 移植 UI 设计令牌与三栏布局骨架，验证窗口宽度变化时侧栏和主区不重叠 <!-- comet-task:66085657-c8a3-485a-a677-33fad336f72d -->
- [ ] 1.6 增加 Vitest 配置与一个示例单元测试，验证 `npm test` 可在干净环境运行 <!-- comet-task:8b0b6a69-124b-4ea4-a992-b722f1e08428 -->

## 2. 本地数据层

- [ ] 2.1 实现 SQLite 连接、WAL、外键和迁移执行器，验证空数据库启动后迁移到最新版本且重复启动不重复迁移 <!-- comet-task:6a950166-fcbe-4b6b-b9da-64cf96263e57 -->
- [ ] 2.2 建立 `workspace`、`app_setting` 表及仓储，验证默认工作区读写和路径持久化测试通过 <!-- comet-task:77aa5b91-80bb-4b46-865e-4b2b46f50781 -->
- [ ] 2.3 建立 `runtime`、`agent` 表及仓储，验证创建、更新、归档和唯一名称校验测试通过 <!-- comet-task:df3f26e7-b0ee-4a3a-b2dd-45bc5e3bf17d -->
- [ ] 2.4 建立 `session`、`message`、`attachment`、`run`、`run_event`、`artifact` 表及仓储，验证外键级联和事务回滚测试通过 <!-- comet-task:f97e2c30-3666-484b-8553-0c96a0d37b49 -->
- [ ] 2.5 建立 `message_fts` 与同步触发器，验证按标题、消息内容和智能体名称搜索的集成测试通过 <!-- comet-task:7857a76f-5c24-4ae1-9a4e-608845be6fe9 -->
- [ ] 2.6 实现附件落盘到 `~/.pizza/attachments/` 并记录元数据，验证 20 MB 限制、重启后可读取和路径越界拒绝测试通过 <!-- comet-task:6e5fbb6d-8e99-49da-a653-b8fb6c5fae0a -->
- [ ] 2.7 记录数据库与数据目录文档，验证文档中的路径和迁移命令与实际实现一致 <!-- comet-task:bdcba48b-4612-4e98-8569-e4deb3cf17d0 -->

## 3. 工作区与应用壳

- [ ] 3.1 实现默认工作区 `~/Pizza` 的检测与按需创建，验证无工作区会话归入默认工作区的测试通过 <!-- comet-task:266586a1-da09-4a35-b2a2-e93533afc6f5 -->
- [ ] 3.2 接入系统文件夹选择器并实现工作区注册、切换和错误提示，验证已有目录、新目录和无权限目录三个场景的测试通过 <!-- comet-task:15c80112-023a-4037-8c0f-5103a52bc7fc -->
- [ ] 3.3 实现左侧栏工作区并列展示、当前工作区高亮和会话占位，验证多工作区渲染测试通过 <!-- comet-task:a4c591b6-cede-455e-bb99-e53050d4d68e -->
- [ ] 3.4 实现应用启动恢复当前工作区并加载其会话，验证重启后工作区状态保持的测试通过 <!-- comet-task:a122e575-9dc9-4bbd-ab4a-c3c935cd83b8 -->

## 4. 运行时连接

- [ ] 4.1 定义 `RuntimeAdapter`、标准化运行事件和能力数据结构，验证事件映射单元测试通过 <!-- comet-task:8064fe99-d028-4bae-982e-32fd9a5597fd -->
- [ ] 4.2 实现 ACP stdio 的 JSON-RPC 客户端，覆盖 `initialize`、`session/new`、`session/prompt`、`session/cancel`，验证假 ACP 服务端集成测试通过 <!-- comet-task:241b8f13-51cc-4720-a54a-a54e271a766e -->
- [ ] 4.3 实现 Claude Code CLI 适配器，解析流式 JSON 输出、工具事件和结果事件，验证夹具流解析测试通过 <!-- comet-task:4d03ce9e-c99e-4304-ab47-76e11e878258 -->
- [ ] 4.4 实现连接测试的五阶段状态机和超时处理，验证成功、启动失败、握手失败和测试消息失败场景的测试通过 <!-- comet-task:0ce2649a-4ad6-4867-9d90-c238d0b2b2ec -->
- [ ] 4.5 实现运行时注册、能力探测、在线状态与重连调度，验证未测试运行时不能被智能体绑定的测试通过 <!-- comet-task:1666afb6-91cb-42cb-bd6c-c251fb62bef9 -->
- [ ] 4.6 实现运行时列表、添加/编辑表单、测试步骤和敏感字段掩码，验证表单校验与掩码展示的组件测试通过 <!-- comet-task:f0283cde-24f7-40d1-ae7c-cdd15bf093c6 -->
- [ ] 4.7 增加六种运行时预设和「ACP/CLI 兼容」标识，验证预设填充和协议标识的组件测试通过 <!-- comet-task:b9b7d86d-c9e2-4897-9d58-c980789037d7 -->
- [ ] 4.8 记录运行时适配器接口和新增适配器步骤，验证文档示例与现有适配器签名一致 <!-- comet-task:62dba7dd-620c-44ee-b6d3-c1edc1f00af3 -->

## 5. 智能体管理

- [ ] 5.1 实现智能体创建、编辑、复制、归档和删除服务，验证必填校验、唯一名称和引用检查测试通过 <!-- comet-task:b4882618-8e01-4605-ac1f-c648de3cb534 -->
- [ ] 5.2 实现智能体列表、搜索、在线状态和最近使用时间，验证 20 个智能体下列表渲染与搜索测试通过 <!-- comet-task:d9e379a0-7c99-46b5-bd72-ade23191fe0c -->
- [ ] 5.3 实现智能体编辑表单、运行时能力门控、思考强度和 100k 步长上下文阈值，验证不兼容配置被阻止的测试通过 <!-- comet-task:03e5ca74-5c44-4b4f-ae82-1fcf83e1faf6 -->
- [ ] 5.4 实现默认头像生成、随机头像和上传头像，验证 2 MB 限制、方形裁剪和重启后头像稳定的测试通过 <!-- comet-task:809222b1-e943-4d98-85ad-4885de35c6d9 -->
- [ ] 5.5 实现不写入正式会话的智能体测试消息，验证测试运行不新增会话的集成测试通过 <!-- comet-task:e02d8db4-9586-45d2-ab49-4d2fae871b79 -->
- [ ] 5.6 更新智能体配置的界面说明和错误文案，验证文案与 `docs/UI-SPEC.md` 对应页面一致 <!-- comet-task:400e9009-6d03-4455-9bb1-2257d982b716 -->

## 6. 单智能体会话

- [ ] 6.1 实现从首页选择智能体并创建会话，验证首条消息生成标题和会话立即出现在侧栏的测试通过 <!-- comet-task:a5dbca5f-8390-4ab4-bd68-7da39e99392b -->
- [ ] 6.2 实现会话绑定智能体的消息路由和单次运行编排，验证未提及时只路由绑定智能体的测试通过 <!-- comet-task:a22d1060-330d-4fb5-840f-4e80aed0d1e7 -->
- [ ] 6.3 实现运行事件落库、IPC 推送与流式渲染，验证文本增量、工具事件和完成事件的集成测试通过 <!-- comet-task:04527ed4-d73f-42f3-8607-cf961ebe5a32 -->
- [ ] 6.4 实现停止运行、失败保留和重试，验证停止两秒内生效、重试创建新运行且不删除原消息的测试通过 <!-- comet-task:cdc57e02-66bf-4b1e-958d-c70cb12b1cad -->
- [ ] 6.5 实现运行中输入与排队提示，验证不支持追加的运行时显示「已排队」且结束后处理的测试通过 <!-- comet-task:949a8e96-b7eb-4a7e-8496-4900c3dc9bbb -->
- [ ] 6.6 实现附件按钮、拖拽和粘贴上传，验证图片、文本、代码文件的消息内预览与持久化测试通过 <!-- comet-task:128443ba-6f09-4bf4-b34f-8cdb7b151e17 -->
- [ ] 6.7 实现 Markdown、GFM 表格、代码高亮与工具调用折叠，验证复杂 Markdown 和失败工具调用的组件测试通过 <!-- comet-task:b29187c9-4815-471e-9293-3ec83759df31 -->
- [ ] 6.8 实现发送失败草稿保留、错误摘要和日志入口，验证失败后原始输入不丢失的测试通过 <!-- comet-task:c8d3f036-e719-41b5-9e09-f9617bc72a4c -->
- [ ] 6.9 实现启动时把未完成运行标记为中断并恢复已接收内容，验证模拟崩溃后的恢复测试通过 <!-- comet-task:fd769f77-948f-498b-a3a4-b9a18d0d19d0 -->

## 7. 会话历史

- [ ] 7.1 实现按工作区归组的会话列表、未读/运行中/失败状态，验证状态标记不只依赖颜色的组件测试通过 <!-- comet-task:15055029-1c85-42b5-8cb0-4315601486e5 -->
- [ ] 7.2 实现会话搜索与命中跳转，验证标题、消息内容和智能体名称三种命中的集成测试通过 <!-- comet-task:f6edb7b5-e200-4e69-accc-bcc463219c44 -->
- [ ] 7.3 实现会话重命名、分叉、归档、恢复和永久删除，验证分叉不改变原会话、归档可恢复、删除二次确认的测试通过 <!-- comet-task:760f9822-96d3-4163-bf38-421e3972e2eb -->
- [ ] 7.4 实现已归档会话设置页和批量清理入口，验证恢复与永久删除操作测试通过 <!-- comet-task:9d04034b-7d18-4da2-9ce2-1024ba49f545 -->
- [ ] 7.5 更新会话操作文案与快捷键说明，验证文档中的菜单项与实际 UI 一致 <!-- comet-task:7b30b984-490e-4dfe-bc1b-3cc80e0f8030 -->

## 8. 产出物与编辑器

- [ ] 8.1 实现运行期工作区监听、忽略规则和产出物索引，验证新增、修改、忽略目录和 `.pizza/artifacts` 场景的测试通过 <!-- comet-task:ab68944b-7d30-4161-85f5-b874103e0bc6 -->
- [ ] 8.2 实现产出物文件树、展开状态持久化和状态筛选，验证切换会话后展开状态保持的测试通过 <!-- comet-task:851cf5cc-84e6-4fef-b7e7-58434088af94 -->
- [ ] 8.3 实现 Markdown、代码、图片预览和不支持类型的降级展示，验证预览不修改源文件的测试通过 <!-- comet-task:2d7731d8-40dc-4ffd-8221-7a683085e66b -->
- [ ] 8.4 实现编辑器偏好、七种编辑器适配和路径不存在提示，验证选择持久化和不可用编辑器指引的测试通过 <!-- comet-task:2b0151a6-5927-4b7b-b2c1-9786487af308 -->
- [ ] 8.5 移除产出物面板中重复的打开工作区入口，验证头部编辑器操作是唯一入口的组件测试通过 <!-- comet-task:e5438e1c-01b1-4b69-88b0-0af41a02366f -->

## 9. 集成验收

- [ ] 9.1 建立 Playwright Electron 冒烟测试，覆盖创建智能体、创建会话、流式回复、重启恢复和产出物出现，验证 `npm run test:e2e` 通过 <!-- comet-task:6f56b60b-fad7-45fc-ade3-b85cb9ca82fd -->
- [ ] 9.2 使用 Claude Code CLI 或可用 ACP 运行时完成一次真实编码任务，验证产出文件出现在右侧面板并记录运行证据 <!-- comet-task:2c9cbd85-b91b-45a7-ade6-f888413461e0 -->

```

Full source: docs/openspec/changes/p0-solo-vertical-slice/tasks.md

## docs/openspec/changes/p0-solo-vertical-slice/.openspec.yaml

- Source: docs/openspec/changes/p0-solo-vertical-slice/.openspec.yaml
- Lines: 1-2
- SHA256: b6d27c089c6ee9596ce0433bd8f7f771b477758efe1ce7f7a7505af47316ecd0

```md
schema: spec-driven
created: 2026-11-03

```

## docs/openspec/changes/p0-solo-vertical-slice/specs/agent-profiles/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/agent-profiles/spec.md
- Lines: 1-121
- SHA256: fcbbec6e56e8734492992fec9dbcd0513827178a38f6486c718f164341814f97

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义用户如何创建、配置和维护可被会话使用的智能体，确保每个智能体都有明确的身份、运行时绑定和可验证的执行配置。

## ADDED Requirements

### Requirement: 智能体列表

本要求为强制要求（MUST）。

设置中的智能体列表必须展示头像、名称、描述、绑定运行时、在线状态和最近使用时间，并支持按名称搜索。列表在 20 个智能体下必须保持可滚动且不丢失操作入口。

#### Scenario: 搜索智能体

- **WHEN** 用户在智能体搜索框输入名称片段
- **THEN** 列表只显示名称或描述匹配的智能体
- **AND** 清空搜索后恢复完整列表

### Requirement: 创建与必填校验

本要求为强制要求（MUST）。

用户必须能够创建智能体，至少填写唯一名称、非空初始 Prompt 和可用运行时。校验失败时必须在对应字段旁说明原因，不得保存部分无效记录。

#### Scenario: 名称重复

- **WHEN** 用户输入已存在的智能体名称并保存
- **THEN** 名称字段显示重复错误
- **AND** 智能体不被保存

#### Scenario: 运行时不可用

- **WHEN** 用户选择的运行时已离线或未注册
- **THEN** 表单阻止保存并说明运行时不可用
- **AND** 用户可以改选其他在线运行时

### Requirement: 智能体身份与头像

本要求为强制要求（MUST）。

每个智能体必须有稳定的身份标识和默认生成的头像。用户必须能够上传头像或使用随机生成；上传文件必须是图片、裁剪为方形且不超过 2 MB，超出限制时给出明确错误。

#### Scenario: 默认头像稳定

- **WHEN** 用户创建智能体后多次重启应用
- **THEN** 该智能体的默认头像保持一致
- **AND** 头像是根据智能体标识确定生成的

#### Scenario: 上传超大头像

- **WHEN** 用户选择大于 2 MB 的图片作为头像
- **THEN** 应用拒绝上传并显示文件大小限制
- **AND** 原头像保持不变

### Requirement: 智能体配置

本要求为强制要求（MUST）。

智能体必须支持配置描述、运行时绑定、初始 Prompt、思考强度和上下文压缩阈值。上下文压缩阈值必须按 100k token 步长调整，默认值为 100k 或 200k。

#### Scenario: 调整上下文阈值

- **WHEN** 用户在智能体编辑页拖动上下文压缩阈值
- **THEN** 数值按 100k 步长变化
- **AND** 保存后新建会话使用该阈值

#### Scenario: 运行时能力受限

- **WHEN** 绑定的运行时不支持所选思考强度
- **THEN** 表单禁用该选项并解释原因
- **AND** 不允许保存与运行时不兼容的值

### Requirement: 编辑与复制

本要求为强制要求（MUST）。

用户必须能够编辑已有智能体，并将其配置复制为新智能体。复制后的智能体必须有新的标识和唯一名称，不得与原智能体共享可变配置。


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/agent-profiles/spec.md

## docs/openspec/changes/p0-solo-vertical-slice/specs/local-workspace/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/local-workspace/spec.md
- Lines: 1-91
- SHA256: 77017be76bc83fa4cf8666b27e543db9c32218206d153a1c7233236670f6677f

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 Pizza 桌面应用的基础运行边界：本地数据目录、工作区注册与切换、单机持久化，以及工作区之间的数据隔离，保证所有会话与配置都能在离线环境中安全恢复。

## ADDED Requirements

### Requirement: 应用启动与本地数据目录

本要求为强制要求（MUST）。

Pizza 启动时必须使用本地数据目录保存配置、会话和索引，不得要求用户登录或连接云端服务。首次启动应创建默认数据目录 `~/.pizza`，并在目录不可写或数据损坏时给出可操作的错误说明。

#### Scenario: 首次启动创建数据目录

- **WHEN** 用户首次启动 Pizza 且 `~/.pizza` 不存在
- **THEN** 应用创建该目录及必要的子目录，并进入首页
- **AND** 不发起任何云端注册或远程同步请求

#### Scenario: 数据目录不可写

- **WHEN** 默认数据目录没有写权限
- **THEN** 应用显示包含实际路径和修复建议的错误页
- **AND** 不覆盖既有数据，也不静默切换到临时目录

### Requirement: 默认工作区

本要求为强制要求（MUST）。

Pizza 必须提供一个默认工作区 `~/Pizza`。默认工作区不存在时，应用应在用户确认或首次新建会话时创建它；没有显式工作区的会话必须归入默认工作区。

#### Scenario: 没有工作区的会话归入默认工作区

- **WHEN** 用户创建的会话没有指定工作区
- **THEN** 该会话出现在默认工作区 `~/Pizza` 下
- **AND** 会话记录中保存默认工作区的真实路径

### Requirement: 工作区注册与切换

本要求为强制要求（MUST）。

用户必须能够通过系统文件夹选择器选择已有目录作为工作区，或选择新目录创建工作区。切换工作区后，新建会话和后续运行必须使用该工作区的路径。

#### Scenario: 选择已有目录

- **WHEN** 用户选择一个已注册的目录
- **THEN** 应用切换到该工作区并将其标记为当前工作区
- **AND** 会话列表只显示属于该工作区的会话

#### Scenario: 选择新目录

- **WHEN** 用户选择一个尚未注册且可写的目录
- **THEN** 应用创建新的工作区记录并切换到该工作区
- **AND** 新工作区立即出现在左侧栏

#### Scenario: 目录无访问权限

- **WHEN** 用户选择的目录不存在或没有读写权限
- **THEN** 应用显示包含路径和原因的错误提示
- **AND** 保留当前工作区不变

### Requirement: 多工作区并列展示

本要求为强制要求（MUST）。

左侧栏必须能够并列展示多个工作区，每个工作区下直接列出其会话。当前工作区必须有可见高亮，工作区数量超过可视区域时可以滚动。

#### Scenario: 多个工作区同时存在

- **WHEN** 用户注册了三个工作区
- **THEN** 左侧栏同时展示三个工作区及其各自会话
- **AND** 当前工作区具有与其他工作区不同且非仅靠颜色表达的选中状态

### Requirement: 本地优先与重启恢复

本要求为强制要求（MUST）。

所有工作区、智能体、运行时、会话、消息和设置必须默认保存在本机。应用正常退出或被终止后重新启动时，已提交的数据必须仍然可见，未完成的运行必须被标记为可恢复或已中断，不得伪装成成功。


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/local-workspace/spec.md

## docs/openspec/changes/p0-solo-vertical-slice/specs/runtime-connections/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/runtime-connections/spec.md
- Lines: 1-115
- SHA256: 1dad7cc975187a700b6a41c663fd65679b6be6b4edf2c15acaebb000428987a8

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 Pizza 如何注册、测试、探测和维护本机运行时连接，使用户能够接入 ACP 或 CLI 运行时，并在连接失效时看到真实状态和可操作的恢复路径。

## ADDED Requirements

### Requirement: 运行时注册字段

本要求为强制要求（MUST）。

用户必须能够创建运行时记录，至少包含名称、适配器、传输方式、启动命令或连接地址、可选参数、超时和自动重连设置。缺少必填字段时不得保存。

#### Scenario: 创建 stdio 运行时

- **WHEN** 用户选择内置适配器并填写可执行命令、参数和超时
- **THEN** 应用保存一条待测试的运行时记录
- **AND** 该记录在测试通过前不得被智能体绑定

#### Scenario: 缺少必填字段

- **WHEN** 用户未填写名称或启动命令就尝试保存
- **THEN** 应用定位到缺失字段并说明原因
- **AND** 不创建运行时记录

### Requirement: 适配器预设与协议标识

本要求为强制要求（MUST）。

运行时选择器必须提供 Claude Code、Codex、Pi、Oh My Pi、DeepSeek Harness、Hermes 和通用 ACP 的默认模板。每个运行时必须以用户可见的方式标注实际接入协议为「ACP」或「CLI 兼容」，不得把 CLI 适配描述为原生 ACP。

#### Scenario: 选择内置适配器

- **WHEN** 用户选择 Hermes 适配器
- **THEN** 表单预填该适配器的默认命令或地址
- **AND** 界面显示其协议标识为「ACP」

#### Scenario: 选择 CLI 适配器

- **WHEN** 用户选择 Claude Code 适配器
- **THEN** 界面显示其协议标识为「CLI 兼容」
- **AND** 用户仍可修改命令和参数

### Requirement: 分步连接测试

本要求为强制要求（MUST）。

连接测试必须按顺序展示启动进程或连接、握手、创建临时会话、发送测试消息和清理临时资源的结果。成功时必须展示协议版本、检测到的能力和往返延迟；失败时必须展示失败步骤、退出码和截断后的错误输出。

#### Scenario: 连接测试成功

- **WHEN** 用户对一条有效的运行时配置点击「测试连接」
- **THEN** 界面逐步显示五个测试阶段的结果
- **AND** 成功后展示协议版本、能力和往返延迟

#### Scenario: 连接测试失败

- **WHEN** 运行时可执行文件不存在或握手失败
- **THEN** 界面标记具体失败阶段
- **AND** 显示可诊断的错误信息，不显示笼统的「连接失败」

### Requirement: 测试通过后注册

本要求为强制要求（MUST）。

运行时只有在连接测试成功后才能注册为可用状态。未通过测试的记录可以保留为草稿，但不得出现在智能体的可选运行时中。

#### Scenario: 测试失败不注册

- **WHEN** 运行时连接测试在握手阶段失败
- **THEN** 记录保持草稿或失败状态
- **AND** 创建智能体时无法选择该运行时

### Requirement: 能力探测与配置门控

本要求为强制要求（MUST）。

注册成功后，系统必须保存运行时能力，包括可用模型、是否支持运行中追加输入、MCP、Skill 和思考强度。智能体界面必须禁用运行时不支持的能力并解释原因，不得静默忽略配置。


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/runtime-connections/spec.md

## docs/openspec/changes/p0-solo-vertical-slice/specs/session-library/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/session-library/spec.md
- Lines: 1-109
- SHA256: 719c56e0d155d6b21471eb076645ee6484cf4fd5e8a11178ca318c0ec8c1e20d

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义用户如何浏览、检索和维护历史会话，使大量会话仍然可发现、可恢复，并且归档或删除操作不会误伤其他工作区。

## ADDED Requirements

### Requirement: 按工作区归组的会话历史

本要求为强制要求（MUST）。

左侧栏必须按工作区展示会话，每个工作区直接列出其会话，不提供独立的全量会话列表或日期分组。没有工作区的会话必须归入默认工作区。

#### Scenario: 工作区下的会话

- **WHEN** 用户展开一个工作区
- **THEN** 只显示属于该工作区的会话
- **AND** 会话项显示标题、模式和运行状态

### Requirement: 会话搜索

本要求为强制要求（MUST）。

用户必须能够按会话标题、消息内容和智能体名称搜索会话。搜索结果必须高亮命中片段并能跳转到对应会话。

#### Scenario: 按消息内容搜索

- **WHEN** 用户输入一个出现在历史消息中的词
- **THEN** 搜索结果列出包含该词的会话
- **AND** 选择结果后打开对应会话并定位到命中消息

#### Scenario: 没有匹配结果

- **WHEN** 用户输入没有匹配的关键词
- **THEN** 界面显示空结果状态
- **AND** 用户可以清除搜索回到完整列表

### Requirement: 重命名会话

本要求为强制要求（MUST）。

用户必须能够重命名会话，修改在提交后立即反映到左侧栏和会话头部。空标题必须被拒绝。

#### Scenario: 重命名成功

- **WHEN** 用户输入非空新标题并确认
- **THEN** 会话标题立即更新
- **AND** 重启应用后仍保持新标题

### Requirement: 分叉会话

本要求为强制要求（MUST）。

用户必须能够从当前会话分叉出新会话。分叉必须复制分叉点之前的消息和配置，保留原会话不变，并自动切换到新会话。

#### Scenario: 分叉会话

- **WHEN** 用户对一条会话选择「分叉会话」
- **THEN** 系统创建包含分叉点之前消息的新会话
- **AND** 原会话保持不变且新会话获得新的标识

### Requirement: 归档与恢复

本要求为强制要求（MUST）。

用户必须能够归档会话，归档后会话从工作区列表移入已归档列表。用户必须能够在设置中的已归档会话里恢复或永久删除归档会话。

#### Scenario: 归档会话

- **WHEN** 用户归档一个会话
- **THEN** 该会话从当前工作区列表消失
- **AND** 已归档列表中出现该会话

#### Scenario: 恢复归档会话

- **WHEN** 用户从已归档列表恢复一个会话
- **THEN** 该会话重新出现在原工作区
- **AND** 消息内容保持完整


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/session-library/spec.md

## docs/openspec/changes/p0-solo-vertical-slice/specs/solo-conversations/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/solo-conversations/spec.md
- Lines: 1-145
- SHA256: a7331144cb295c64fefc9c93eb0cac8c211c55598ca7ddca5c1e49962d16107e

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义单智能体会话的核心行为：用户消息如何被路由给绑定智能体、流式输出如何呈现、运行如何停止和重试，以及附件和失败状态如何可靠保存。

## ADDED Requirements

### Requirement: 创建单智能体会话

本要求为强制要求（MUST）。

用户从首页或参与者选择器选择一个智能体后，系统必须创建一个绑定该智能体和工作区的单智能体会话。会话标题取首条用户消息的前 24 个字符并允许后续重命名。

#### Scenario: 从首页发送首条消息

- **WHEN** 用户选择一个智能体、输入消息并发送
- **THEN** 系统创建新会话并将会话标题设为消息前 24 个字符
- **AND** 输入框路由提示显示该智能体的名称

#### Scenario: 没有可用智能体

- **WHEN** 用户尚未创建任何智能体
- **THEN** 首页参与者选择器显示创建智能体的入口
- **AND** 发送操作被阻止并说明需要先创建智能体

### Requirement: 单智能体消息路由

本要求为强制要求（MUST）。

单智能体会话中，用户未显式提及其他目标的消息必须发送给会话绑定的智能体。单智能体模式下不得产生跨智能体调度。

#### Scenario: 默认路由

- **WHEN** 用户在单智能体会话中发送一条未包含提及的消息
- **THEN** 该消息只触发绑定智能体的一次运行
- **AND** 会话中不出现其他智能体

### Requirement: 流式输出

本要求为强制要求（MUST）。

智能体运行时，界面必须逐段呈现文本增量，并显示头像、名称、运行状态和耗时。首字延迟受运行时限制，但界面必须在运行开始后立即显示可辨认的进行中状态。

#### Scenario: 流式文本

- **WHEN** 运行时返回文本增量
- **THEN** 消息内容逐步增长且不闪烁或丢失已显示内容
- **AND** 消息头部显示运行中的状态

#### Scenario: 流式过程中切换页面

- **WHEN** 用户在运行中切换到设置或另一个会话
- **THEN** 原运行继续执行
- **AND** 返回会话时可以看到完整或最新的已接收内容

### Requirement: Markdown 与工具调用展示

本要求为强制要求（MUST）。

智能体消息必须支持标题、列表、表格、代码块、链接和任务列表渲染。工具调用必须以可折叠行展示名称、参数摘要、状态和耗时；失败的工具调用必须显示错误且可展开查看。

#### Scenario: 渲染代码块

- **WHEN** 智能体输出包含代码块的消息
- **THEN** 代码块保留缩进和语法高亮
- **AND** 用户可复制代码内容

#### Scenario: 工具调用失败

- **WHEN** 运行时报告某个工具调用失败
- **THEN** 该调用行标记为失败并自动展开错误摘要
- **AND** 消息其他内容保持可见

### Requirement: 停止运行

本要求为强制要求（MUST）。

用户必须能够停止当前单智能体运行。停止后界面应在两秒内显示已停止状态，保留已接收内容，并插入一条弱化的系统事件说明用户停止了运行。


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/solo-conversations/spec.md

## docs/openspec/changes/p0-solo-vertical-slice/specs/workspace-artifacts/spec.md

- Source: docs/openspec/changes/p0-solo-vertical-slice/specs/workspace-artifacts/spec.md
- Lines: 1-103
- SHA256: 345954e52fb286363232ff4814121535ac8feb412733ce8f645c98a31ff4d657

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义会话产出物如何从工作区被发现、浏览、预览和打开，让用户能直接确认智能体实际写入的文件，而不是只看到聊天中的文本。

## ADDED Requirements

### Requirement: 产出物发现

本要求为强制要求（MUST）。

系统必须把智能体运行期间在工作区新增或修改的文件，以及写入 `.pizza/artifacts/` 的明确产出物，识别为本会话的产出物。新产出物必须在运行过程中或运行结束后出现在右侧面板，不得要求用户手动刷新整个应用。

#### Scenario: 智能体写入文件

- **WHEN** 智能体在工作区中新增一个文件并完成运行
- **THEN** 该文件出现在当前会话的产出物文件树中
- **AND** 文件带有新增状态标记

#### Scenario: 修改已有文件

- **WHEN** 智能体修改工作区中已有文件
- **THEN** 该文件在产出物中显示修改状态
- **AND** 用户可以看到文件路径和所属运行

### Requirement: 文件树与状态筛选

本要求为强制要求（MUST）。

产出物面板必须按目录结构展示文件夹和文件，支持展开、收起和按新增、修改、信息状态筛选。文件夹展开状态必须按会话保存。

#### Scenario: 展开文件夹

- **WHEN** 用户展开一个产出物文件夹后切换到其他会话再返回
- **THEN** 该文件夹保持展开状态
- **AND** 文件树显示最新文件列表

#### Scenario: 筛选修改文件

- **WHEN** 用户选择「修改」筛选条件
- **THEN** 文件树只显示具有修改状态的文件
- **AND** 清除筛选后恢复完整文件树

### Requirement: 产出物预览

本要求为强制要求（MUST）。

用户必须能够预览 Markdown、代码和图片产出物。Markdown 必须按渲染结果展示并可切换原文，代码必须保留格式，图片必须可缩放查看；预览不得修改源文件。

#### Scenario: 预览 Markdown

- **WHEN** 用户选择一个 `.md` 产出物
- **THEN** 面板渲染 Markdown 内容
- **AND** 用户可以切换查看原始文本

#### Scenario: 不支持的预览类型

- **WHEN** 用户选择一个当前不支持预览的文件类型
- **THEN** 面板显示文件信息和下载或外部打开入口
- **AND** 不尝试用错误格式渲染文件

### Requirement: 用首选编辑器打开工作区

本要求为强制要求（MUST）。

会话头部必须提供编辑器选择器，支持访达、Cursor、VS Code、Zed、IntelliJ IDEA、终端和 Warp。选择后必须立即生效并在重启后保留；当前编辑器没有安装时，必须提供安装指引和复制路径。

#### Scenario: 选择 VS Code

- **WHEN** 用户从编辑器下拉选择 VS Code 并打开工作区
- **THEN** 系统用 VS Code 打开当前会话的工作区路径
- **AND** 下次打开时仍默认使用 VS Code

#### Scenario: 编辑器不可用

- **WHEN** 用户选择的编辑器命令不存在
- **THEN** 应用显示该编辑器的安装指引
- **AND** 提供可复制的当前工作区路径


```

Full source: docs/openspec/changes/p0-solo-vertical-slice/specs/workspace-artifacts/spec.md
