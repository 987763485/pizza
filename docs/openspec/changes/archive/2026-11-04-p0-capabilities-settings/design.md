---
comet_change: p0-capabilities-settings
role: technical-design
canonical_spec: openspec
archived-with: 2026-11-04-p0-capabilities-settings
status: final
---

# Design

## Context

本 change 建立在 `p0-solo-vertical-slice` 和可选的 `p0-team-orchestration` 之上。单智能体切片已经提供 Electron 主进程、React 渲染层、SQLite、运行时适配器、IPC 和会话 UI；团队切片提供成员配置与编排器。本 change 负责把能力管理、审批、设置、通知、国际化、首次启动和安装包补齐。

用户明确要求生产代码使用 TypeScript，因此主进程、preload、渲染层、共享类型、测试和构建脚本均使用 TypeScript；不引入 Go 服务端或其他语言的核心实现。

## Goals / Non-Goals

**Goals:**

- 让 Skill 和 MCP 成为可管理、可挂载、可审计的一等配置，并在运行时正确注入。
- 让工具审批成为所有运行时共用的安全边界，而不是每个适配器各写一套。
- 让设置、主题、语言和通知在图形界面内完成，并在重启后保持。
- 让新用户从安装包开始，在不使用命令行的情况下完成运行时接入和首个会话。
- 保持独立实现、TypeScript 和本地优先架构，不复制参考项目代码或品牌资产。

**Non-Goals:**

- 记忆管理和统计的完整 P1 功能。
- 自动更新、代码签名和公证、Windows/Linux 安装包。
- 团队快照、动态角色指令、新编排语义。
- 云端同步、多人协作、插件市场。

## Decisions

### 1. 能力解析与注入管线

新增 `CapabilityResolver`，在每次运行前解析智能体、团队成员覆盖和系统默认值，得到最终生效的 Skill 与 MCP 清单。解析结果写入运行快照，再交给 `InjectionPipeline` 转换为运行时格式。

管线顺序：

1. 解析智能体配置和团队覆盖。
2. 校验 Skill 文件与 MCP 配置。
3. 物化 Skill 到运行临时目录。
4. 生成 ACP `mcpServers` 或 CLI 原生配置。
5. 把能力清单写入系统上下文。
6. 失败时阻止对应能力并记录诊断，不静默忽略。

理由：Skill/MCP 的生效规则必须可预览、可审计、可复现。把解析与注入分开，可以让团队覆盖、单次引用和设置默认值使用同一套逻辑。

### 2. Skill 存储与物化

Skill 存放在 `~/.pizza/skills/<skill-id>/<version>/`，数据库保存元数据、来源和绑定关系。导入时校验 `SKILL.md` frontmatter、文件清单和路径；拒绝绝对路径、`..`、符号链接越界和不可读文件。

运行前把生效 Skill 复制到 `~/.pizza/runtime/<run-id>/skills/`，再把该目录写入适配器的 Skill 搜索路径：

- Claude CLI：生成运行级 plugin 目录（`.claude-plugin/plugin.json` + `skills/<name>/SKILL.md`），通过 `--plugin-dir <run-plugin-dir>` 加载。
- ACP：若运行时声明 `skills` 能力，在系统上下文注入 Skill 名称、描述和物化路径；否则把清单写入上下文并标记该运行时未原生加载 Skill。

内置 Pizza 协作 Skill 作为只读资源随应用发布，不写入用户可删除的 Skill 目录。所有运行结束后清理 `~/.pizza/runtime/<run-id>/`。

理由：直接修改运行时安装目录会污染用户环境，也无法保证回滚。运行级物化让每次运行的能力集合独立且可清理。

### 3. MCP 客户端与配置

使用 `@modelcontextprotocol/sdk` 的 TypeScript 客户端实现 stdio、SSE 和 HTTP 传输。MCP 配置保存在 SQLite，敏感值使用 `safeStorage` 加密；读取时只返回掩码和是否已设置。

连接测试完成以下步骤：启动/连接、握手、列出工具、关闭。工具清单保存为能力快照。运行时注入时：

- Claude CLI：把启用 Server 写成运行级临时 `--mcp-config` JSON；stdio、SSE、HTTP 均按 CLI 支持格式注入。
- ACP：在 `session/new` 的 `mcpServers` 中传入 stdio Server；SSE/HTTP 在该 ACP 运行时未声明远程 MCP 能力时标记为不可用并写诊断，不影响其他 Server。

转换失败的 Server 标记为不可用，其他 Server 继续。工具允许/拒绝清单同时用于能力清单和 CLI 注入。

理由：官方 SDK 减少协议实现风险；把敏感值与普通配置分开存储，避免日志和导出泄露。

备选方案：

- 自行实现 MCP JSON-RPC：可控但重复工作，且工具 schema 变化快。
- 只支持 stdio：实现简单，但无法覆盖 HTTP/SSE Server。

### 4. 统一审批服务

新增 `ApprovalService`，位于主进程。ACP 的 `session/request_permission` 和 CLI 适配器的审批钩子都调用同一个 `requestApproval()`；它创建待审批记录、推送 UI、等待用户决定或超时。

CLI 审批通过 Claude Code 的 PreToolUse hook 接入：每次运行把 hook 配置写入临时 `--settings`，hook 脚本读取工具名和参数，连接主进程的本地 Unix socket，等待与 ACP 相同的审批对话框决定，再向 CLI 输出 `permissionDecision`。hook 不可用、无法连接或超时都按拒绝处理并写诊断，不静默放行。这样不需要依赖 CLI 交互式 permission prompt，也不把审批逻辑放进渲染层。

决定类型：

- `allow_once`：只放行当前请求。
- `always_allow`：对同一智能体、工具和策略范围持久化允许。
- `deny`：向运行返回拒绝结果。

危险工具默认 `ask`。策略按「智能体 > 团队成员覆盖 > 全局默认」解析，冲突时取更严格者。审批超时默认拒绝。多个审批请求进入 FIFO 队列，不覆盖未处理请求。

理由：审批是安全边界，必须由主进程统一执行。渲染层不能直接放行工具调用，也不能伪造审批结果。

### 5. 设置存储与启动应用

设置保存在 SQLite 的 `app_setting` 键值表中，使用 Zod schema 校验类型和范围。主进程在窗口创建前读取外观、语言和窗口状态，通过 preload 提供给渲染层，避免首屏主题闪烁。

数据目录变更记录为待迁移状态；下次启动时在确认后复制或移动数据库与附件，失败则继续使用原目录并显示恢复说明。迁移过程不删除原目录，直到新目录验证成功。

### 6. 国际化与外观

使用 `i18next` 与 `react-i18next`，文案按命名空间集中管理，默认语言为简体中文，支持 English。缺失键回退到另一语言，不显示原始键名。日期和数字使用 `Intl`，代码使用等宽字体。

主题通过 CSS 变量切换，支持浅色、深色和跟随系统。字号、密度和减少动效作为根元素属性或 CSS 变量应用；系统 `prefers-reduced-motion` 作为默认值。

### 7. 通知

使用 Electron `Notification` 和系统托盘。团队会话中检测到指向用户的精确提及时，写入待处理通知记录、更新会话标记，并发送系统通知。点击通知聚焦窗口并定位消息。免打扰只抑制系统通知，不抑制应用内标记；同一待处理请求去重。

### 8. 首次启动与打包

首次启动检测使用 `which` 或运行时预设的探测命令，配合 `--version` 获取版本；不执行未知 shell 脚本。检测结果分为已安装、未安装和需要登录。引导流程复用运行时连接测试和智能体创建表单。

使用 `electron-builder` 生成 macOS 13+ 安装包，版本和构建号来自 `package.json`，构建前校验一致性。安装包包含应用图标、许可和第三方归属，不包含任何模型运行时。自动更新和签名留给后续变更。

### 9. 测试策略

- Vitest 覆盖能力解析、Skill 路径校验、MCP 配置合并、审批策略、设置 schema 和 i18n 回退。
- 使用假 MCP Server 验证 stdio/HTTP 连接测试和工具发现。
- 使用假 ACP/CLI 运行时验证审批请求、允许、拒绝、超时和并发队列。
- Playwright 覆盖设置切换、语言切换、通知跳转和首次启动引导。
- 打包冒烟测试安装并启动构建产物，检查版本、数据目录和关于页。

## Risks / Trade-offs

- [Skill 路径穿越] 恶意 Skill 包可能写入数据目录之外 → 导入和物化都做规范化与根目录校验，拒绝符号链接越界，并在临时目录中解压。
- [MCP 凭据泄露] 配置、日志或导出可能带出密钥 → `safeStorage` 加密、只写字段、日志脱敏和导出白名单。
- [审批阻塞] 用户长时间不处理审批会挂起运行 → 设置超时默认拒绝，并在会话中显示待处理原因。
- [运行时注入差异] ACP 与 CLI 的 Skill/MCP 格式不同 → 适配器各自实现注入，但共享解析结果和能力清单；转换失败只影响该能力。
- [数据目录迁移失败] 迁移中断可能造成数据不一致 → 复制到新目录并验证后再切换，失败保留原目录。
- [打包体积] Electron 安装包较大 → 本 change 只交付 macOS 基础包，不捆绑运行时；后续评估按需下载组件。
- [国际化遗漏] 文案分散会留下硬编码中文 → 文案集中管理，并在测试中扫描缺失键和原始键名。

## Migration Plan

1. 迁移版本 5 新增 `skill`、`skill_binding`、`mcp_server`、`mcp_binding`、`approval`、`notification` 表，并扩展现有 `app_setting` 的默认键；现有会话、智能体和团队数据不回填。
2. 默认设置由迁移写入；已有数据库升级时保留用户值，只补缺失键。
3. 首次启动检测和引导只在没有有效运行时或没有智能体时出现，不打断老用户。
4. 数据目录迁移采用「确认 → 复制 → 校验 → 切换 → 保留原目录」流程；回滚时切回原目录。
5. 安装包发布前校验版本、构建号和许可；自动更新与签名在后续变更处理。

## Open Questions

- 记忆管理和统计何时从 P1 进入正式实现？本 change 只保留入口和不可用说明，不伪造数据。
- 自动更新与代码签名采用何种发布渠道？这不影响本 change 的设置、通知和打包架构。
