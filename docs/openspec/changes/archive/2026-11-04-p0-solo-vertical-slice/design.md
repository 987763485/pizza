---
comet_change: p0-solo-vertical-slice
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-04-p0-solo-vertical-slice
status: final
---

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

渲染层不会拿到原始子进程句柄。IPC 输入使用 Zod 校验，只接受白名单方法和经校验的文件路径。

理由：先落库再推送使崩溃恢复成为可能，也让渲染层可以根据数据库重建状态。

### 5. 渲染层状态与 UI 组合

使用 React Router 的内存或 hash 路由、Zustand 管理工作区/会话/消息 UI 状态，以及一个带类型的 IPC 客户端。三栏外壳遵循 `docs/UI-SPEC.md`：工作区/会话侧栏、对话主区、产出物面板。样式使用文档中的 CSS 变量和 CSS Modules，不直接引入静态原型代码。

消息渲染使用 `react-markdown` 与 GFM、代码高亮和虚拟列表。附件通过受限自定义协议从本地附件目录读取，不向渲染层暴露任意文件系统 URL。

理由：这能让 UI 后续平滑接入设置中心，也避免领域状态与 React 组件树耦合。

### 6. 产出物发现：运行期文件观察

每次活动运行开始时，在会话工作区启动监听器，忽略 `.git`、`node_modules`、构建产物和 SQLite 数据库。把监听事件与工具事件报告的文件路径合并，为运行期间新增或修改的文件写入或更新 `artifact` 记录。`.pizza/artifacts/` 始终纳入。

产出物面板读取索引并按需解析预览。Markdown、代码和图片内联展示；不支持的类型显示元数据和外部打开操作。编辑器偏好保存在 `app_setting`，通过小型编辑器适配表解析（`open`、`code`、`cursor`、`zed`、`idea`、终端与 Warp）。

理由：只依赖工具事件会漏掉脚本直接写入的文件；完整的前后差异扫描在大仓库上成本过高。运行期监听加工具提示是兼顾准确性和成本的方案。

### 7. 安全边界

- 开启 `contextIsolation`，关闭 `nodeIntegration`，只暴露窄 preload 桥，并设置严格 CSP。
- 运行时命令使用 argv 数组和明确的工作目录启动，不进行 shell 拼接。
- 外部链接通过白名单打开，禁止 `file://` 导航。
- 运行时密钥使用 `safeStorage`，日志脱敏，只保留 stderr 最后 20 行。
- 渲染层只能读取当前工作区、Pizza 数据目录或用户明确选择的附件路径内的文件。

### 8. 测试策略

- 使用 Vitest 覆盖数据库迁移、单智能体消息路由、运行状态转换、适配器流解析和产出物差异。
- 使用可输出确定性事件和模拟失败的假运行时做集成测试。
- 使用 Playwright Electron 冒烟测试覆盖创建智能体、创建会话、流式回复、重启恢复和产出物出现。
- 使用真实 Claude Code CLI（或可用 ACP 运行时）执行一次手工验收，产出文件必须出现在产出物面板。

## Risks / Trade-offs

- [Electron 原生模块需要重编译] `better-sqlite3` 必须匹配 Electron ABI → 固定 Electron 版本，在 CI 中重编译，并记录本地重建命令。
- [运行时协议漂移] CLI 输出和 ACP 形状可能随版本变化 → 解析器保持窄边界，在能力数据中记录运行时版本，失败时展示诊断而不是静默丢弃事件。
- [工作区监听成本] 大仓库会产生大量文件事件 → 忽略 `.git`、依赖和构建目录，做防抖，并限制单次运行索引数量。
- [CLI 会话连续性差异] 不同运行时的 resume 行为不同 → 每个会话保存运行时会话标识；不支持恢复时回退到新上下文，并插入可见系统事件。
- [崩溃导致数据丢失] 写入可能中断 → 消息、运行和事件更新使用事务，启动时把未完成运行标记为中断。
- [范围压力] 首个切片同时涉及 UI、持久化、进程管理和协议接入 → 团队、Skill/MCP 和设置功能明确列为非目标，先验证纵向闭环再扩展。

## Migration Plan

1. 在现有文档和原型之外搭建 Electron 应用骨架。
2. 建立初始 SQLite schema，只写入默认工作区和设置，不向生产存储写入演示数据。
3. M1 以开发构建交付。首次启动创建 `~/.pizza`，后续通过有序迁移升级 schema。
4. 迁移失败时停止启动，保留现有数据库并给出恢复路径；不自动删除或重建用户数据。
5. 安装包、自动更新和跨平台迁移由后续「能力与设置」变更处理。

## Open Questions

- 在 Claude Code CLI 和通用 ACP 之外，后续还能认证哪些运行时预设？这影响兼容性声明，不影响 M1 架构和任务拆分。
- 如果已有可用的渲染依赖，本切片是否补充 PDF 预览？它是 P1，不影响产出物索引设计。
