# Comet Design Handoff

- Change: p0-capabilities-settings
- Phase: design
- Mode: compact
- Context hash: 2e6602e59599a4ecbe81faaf67e3e6d12431049cf36e3dcf5b3e1bdba181f7ad

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/p0-capabilities-settings/proposal.md

- Source: docs/openspec/changes/p0-capabilities-settings/proposal.md
- Lines: 1-41
- SHA256: 2db59147ca55e050bbfdc097ffe01a3dc8a8995eeafafa49920f1698d6082de7

```md
# Proposal

## Why

单智能体和团队切片能完成协作，但还不能作为普通用户可安装、可配置的产品交付：用户无法管理 Skill/MCP，无法审批敏感工具调用，也无法在图形界面中完成运行时、主题、语言和数据目录配置。P0 需要一个产品化收尾，把能力管理和设置放回用户手中。

## What Changes

- 新增 Skill 管理：列表、搜索、创建、从本地目录/ZIP/Git 导入、编辑、删除、挂载到智能体或团队成员、运行时注入、同名冲突处理和内置 Pizza 协作 Skill。
- 新增 MCP 管理：stdio/SSE/HTTP Server 的配置、连接测试、工具发现、挂载到智能体或团队成员、工具允许/拒绝、运行时注入和只写配置保护。
- 新增工具审批：ACP 权限请求和 CLI 审批钩子统一进入审批对话框，支持允许一次、总是允许和拒绝；拒绝向运行返回明确结果并写入审计。
- 新增设置中心：个人资料、语言与外观、系统默认值、已归档会话、关于 Pizza 和通知偏好；所有设置持久化并在重启后生效。
- 新增通知：智能体 `@用户` 时显示应用内通知、会话标记和系统托盘提示，点击跳转到对应消息；支持免打扰。
- 新增外观与本地化：浅色/深色/跟随系统、字号、密度、减少动效，以及简体中文/English 即时切换。
- 新增首次启动引导和桌面安装包：检测本机运行时、展示安装指引、引导创建第一个智能体和会话；macOS 安装包包含版本与关于信息。
- 本 change 不包含团队快照、统计与记忆的完整 P1 功能、自动更新、Windows/Linux 安装包、云同步和新的编排语义。

## Capabilities

### New Capabilities

- `skill-management`: Skill 的创建、导入、编辑、删除、挂载、运行时注入和冲突处理。
- `mcp-management`: MCP Server 的配置、连接测试、工具发现、挂载、注入和只写配置保护。
- `tool-approvals`: 运行时工具调用的审批请求、决定、超时和审计。
- `settings-center`: 设置导航、个人资料、系统默认值、已归档会话、关于页和持久化。
- `notifications`: 智能体请求用户介入时的应用内、会话和系统托盘通知。
- `appearance-localization`: 主题、字号、密度、减少动效和中英文即时切换。
- `desktop-distribution`: 首次启动引导、运行时检测、macOS 安装包和版本信息。

### Modified Capabilities

无。本 change 引入新的产品化能力；团队和单智能体协议不改变。

## Impact

- 扩展 SQLite 数据层：Skill、MCP、挂载关系、审批记录、通知偏好和设置。
- 扩展运行时适配层：Skill 物化、MCP 配置注入、ACP 权限请求和 CLI 审批钩子。
- 扩展设置外壳和导航；复用现有三栏 UI 和设计令牌。
- 新增 macOS 打包配置、资源、版本信息和首次启动检测。
- 用户明确要求生产代码使用 TypeScript；本 change 的所有新增代码继续使用 TypeScript。
- 参考项目仅用于行为研究，不复制代码或品牌资产。

```

## docs/openspec/changes/p0-capabilities-settings/design.md

- Source: docs/openspec/changes/p0-capabilities-settings/design.md
- Lines: 1-147
- SHA256: 3e87b77c81102b3dbedc7fb9fd5eb006ed4587e05b55e50419b5a932c9b1125f

[TRUNCATED]

```md
---
comet_change: p0-capabilities-settings
role: technical-design
canonical_spec: openspec
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

```

Full source: docs/openspec/changes/p0-capabilities-settings/design.md

## docs/openspec/changes/p0-capabilities-settings/tasks.md

- Source: docs/openspec/changes/p0-capabilities-settings/tasks.md
- Lines: 1-99
- SHA256: b3b819d5839d07a8862ef061d27a0294eabc0e1f09d4ed12ee64a75f6eb80bfa

[TRUNCATED]

```md
# Tasks

## 1. 数据与设置基础

- [ ] 1.1 新增 `skill`、`skill_binding`、`mcp_server`、`mcp_binding`、`approval`、`notification`、`app_setting` 表与迁移，验证现有数据库无损升级 <!-- comet-task:9b340f44-35d7-4573-8373-b71311bdf476 -->
- [ ] 1.2 所有新增主进程、preload、renderer 和共享模块使用 TypeScript，并开启严格类型检查，验证 `npm run typecheck` 通过 <!-- comet-task:440bcb94-22e2-4a32-8551-ababb3f5fe44 -->
- [ ] 1.3 实现类型化设置仓储与 Zod schema，验证默认值、范围校验和重启持久化测试通过 <!-- comet-task:e4d51857-2070-4672-95b8-f3a039157554 -->
- [ ] 1.4 实现设置读取/写入 IPC 和 preload 类型定义，验证不合法输入被拒绝的测试通过 <!-- comet-task:7af17915-a817-4eba-8f3f-1ba0a858f9be -->
- [ ] 1.5 实现数据目录的待迁移状态、启动检查和失败回退，验证迁移失败保留原目录的测试通过 <!-- comet-task:2bfc14bb-4df2-4242-ab4c-57f5e72b41f0 -->
- [ ] 1.6 记录能力与设置数据模型，验证文档中的表和字段与实际迁移一致 <!-- comet-task:145a299a-1bd6-4d6a-8908-306a537e72fd -->

## 2. Skill 管理

- [ ] 2.1 实现 Skill 列表、搜索、标签筛选和引用计数，验证列表与搜索组件测试通过 <!-- comet-task:31a92880-79bc-43aa-9758-f7bed9ddbcfa -->
- [ ] 2.2 实现 `SKILL.md` frontmatter 校验和创建表单，验证缺少必填字段被阻止的测试通过 <!-- comet-task:ccd0f6d2-9ae8-4987-b17b-b5e07e303073 -->
- [ ] 2.3 实现本地目录、ZIP 和 Git 导入及文件清单预览，验证导入后的来源信息持久化测试通过 <!-- comet-task:7039d81c-0528-462e-b041-02689ff5dad4 -->
- [ ] 2.4 实现导入路径规范化、越界拒绝和符号链接保护，验证路径穿越测试通过 <!-- comet-task:1f7984d1-b03a-4934-a0b5-f09249ffb76a -->
- [ ] 2.5 实现 Skill 编辑、删除影响提示和解绑流程，验证被引用 Skill 的删除确认测试通过 <!-- comet-task:1f473647-6264-466d-b69d-068df6a8388e -->
- [ ] 2.6 实现挂载到智能体与团队成员、覆盖和最终清单预览，验证团队覆盖优先的测试通过 <!-- comet-task:dc4c4834-0afb-4cad-b574-2878650972f3 -->
- [ ] 2.7 实现运行级 Skill 物化与上下文清单，验证成功物化和文件缺失失败的测试通过 <!-- comet-task:28e44ec8-f329-4a96-8cbd-b6a34023e453 -->
- [ ] 2.8 实现同名冲突的停止、覆盖、重命名和跳过策略，验证覆盖保留绑定的测试通过 <!-- comet-task:3edd0902-c798-4732-8e03-bb68691d346a -->
- [ ] 2.9 添加内置 Pizza 协作 Skill 和单次禁用开关，验证默认注入与单次禁用的测试通过 <!-- comet-task:44d84b88-04bd-4196-a4ce-a8ec6097461e -->
- [ ] 2.10 记录 Skill 目录结构、导入格式和物化流程，验证文档示例与实际路径一致 <!-- comet-task:b70e1b84-7a31-4e33-bd18-4f1c17e47b79 -->

## 3. MCP 管理

- [ ] 3.1 实现 MCP 列表、启停、状态和搜索，验证未就绪状态展示的组件测试通过 <!-- comet-task:39abdae8-84d3-479f-ba0e-277bacce4499 -->
- [ ] 3.2 实现 stdio 配置、环境变量加密和掩码展示，验证密钥重启后可连接且不回显的测试通过 <!-- comet-task:cd85cdb5-d81c-4595-bdff-a06467041243 -->
- [ ] 3.3 实现 SSE/HTTP 配置、Header 加密和超时校验，验证敏感 Header 掩码的测试通过 <!-- comet-task:3dd8af02-013d-4c97-978b-399c426974bd -->
- [ ] 3.4 接入 MCP TypeScript 客户端并实现连接测试与工具发现，验证假 stdio 和假 HTTP Server 的集成测试通过 <!-- comet-task:dc29ac52-51e6-4d70-b4fa-4ba4db249bf2 -->
- [ ] 3.5 实现工具清单、参数 schema 展示和失败诊断，验证连接失败不显示为空工具的测试通过 <!-- comet-task:44fa8934-378e-4a57-b62c-d7de5cf655f3 -->
- [ ] 3.6 实现挂载、工具允许/拒绝和最终工具清单预览，验证未允许工具不可调用的测试通过 <!-- comet-task:a81b19dc-3012-4777-adb8-44c797e9e8ec -->
- [ ] 3.7 实现智能体、工作区库和运行时本地配置的三层合并，验证覆盖来源标注的测试通过 <!-- comet-task:7f23ec53-7bba-4a2c-bc09-f58065818824 -->
- [ ] 3.8 实现 ACP 与 CLI 适配器的 MCP 注入，验证单个 Server 失败不影响其他 Server 的测试通过 <!-- comet-task:14801301-2e0e-4ccb-8bfe-816af0c80e18 -->
- [ ] 3.9 实现配置只写、整体替换和审计，验证读取时不返回明文且导出不含密钥的测试通过 <!-- comet-task:54037b98-be55-44b8-9d4a-d71bccaa0411 -->
- [ ] 3.10 记录 MCP 传输、注入和凭据处理文档，验证文档中的配置示例可被测试使用 <!-- comet-task:07c871c5-2f1c-4059-a6af-7fa380e42966 -->

## 4. 工具审批

- [ ] 4.1 定义统一审批请求、决定和状态类型，验证 ACP 与 CLI 事件映射测试通过 <!-- comet-task:9cb77402-07f3-4c56-b71d-d8eb2d0718cb -->
- [ ] 4.2 实现主进程审批服务、FIFO 队列和超时拒绝，验证并发请求不覆盖的测试通过 <!-- comet-task:90b0ff3a-92bb-4175-b26c-ddce14a65049 -->
- [ ] 4.3 实现允许一次、总是允许和拒绝的决定与运行结果回传，验证拒绝不执行工具的测试通过 <!-- comet-task:f7022cf8-91b8-4e50-874c-08e30dfad2d3 -->
- [ ] 4.4 实现危险操作默认询问和更严格策略优先，验证禁止策略直接拒绝的测试通过 <!-- comet-task:aaa94eaf-433b-4c35-a3f8-7d103ddbf868 -->
- [ ] 4.5 实现审批对话框、工具参数摘要和风险等级展示，验证多个请求依次展示的组件测试通过 <!-- comet-task:606032b9-2171-44e6-9ee7-62a5aaadaf51 -->
- [ ] 4.6 实现审批记录、策略来源和脱敏审计，验证审计不含完整敏感参数的测试通过 <!-- comet-task:000dcb40-441f-4b7a-ad4a-951c13d5782a -->
- [ ] 4.7 记录审批协议和策略解析顺序，验证文档与运行时适配器实现一致 <!-- comet-task:1deffaa3-80fb-4ddf-b28c-edf7baeade76 -->

## 5. 设置中心

- [ ] 5.1 实现独立设置视图与分组导航，验证所有入口可达和当前页高亮的组件测试通过 <!-- comet-task:bfde0d3b-e617-40ec-82dc-c85fe7c05775 -->
- [ ] 5.2 实现个人资料、头像上传和随机头像，验证重启后头像保持的测试通过 <!-- comet-task:9bf55c1d-6d1a-448b-a1a1-76e1b897f1bd -->
- [ ] 5.3 实现系统默认工作区、默认运行时、最大并发、数据目录、日志级别、自动更新和匿名统计设置，验证范围校验测试通过 <!-- comet-task:bb6b3a1b-d708-4adf-aa0d-38295f0c8187 -->
- [ ] 5.4 实现已归档会话恢复、永久删除和批量清理，验证二次确认的测试通过 <!-- comet-task:a73cbe34-b01a-42e7-93b4-aabbbc84ab0b -->
- [ ] 5.5 实现关于页版本、构建号、协议、第三方归属和反馈入口，验证版本与实际包一致的测试通过 <!-- comet-task:8f9760cd-2c1c-4fd3-971a-b552b40d002f -->
- [ ] 5.6 为记忆和统计 P1 页面提供不可用说明，验证不展示伪造数据的组件测试通过 <!-- comet-task:64430275-7f78-45e2-8ed4-1b376c5fc304 -->
- [ ] 5.7 实现设置变更后的跨页面同步，验证主题、语言和默认值立即生效的测试通过 <!-- comet-task:d567260a-34ee-4f10-977d-374f5f1519f7 -->
- [ ] 5.8 更新设置文案与页面说明，验证文档与 `docs/UI-SPEC.md` 一致 <!-- comet-task:44356a7d-0df6-4cb0-b03e-bc54e81f4bde -->

## 6. 通知

- [ ] 6.1 实现智能体提及用户时的待处理通知记录和会话标记，验证等待用户状态测试通过 <!-- comet-task:bd4f5e2d-99d2-4bb1-9bee-f8e8a0097202 -->
- [ ] 6.2 实现应用内通知和系统托盘通知，验证权限拒绝时降级为应用内通知的测试通过 <!-- comet-task:bb3a72cf-caa1-4e9f-a440-e308e7207955 -->
- [ ] 6.3 实现点击通知聚焦窗口、打开会话并定位消息，验证目标删除时的错误提示测试通过 <!-- comet-task:38e5a94d-a7f0-4a1a-a7cd-a22e658c8224 -->
- [ ] 6.4 实现免打扰和重复通知抑制，验证同一请求只发送一次系统通知的测试通过 <!-- comet-task:1e4aac70-c842-4fbc-ad0b-ac6cf6ff1656 -->
- [ ] 6.5 实现通知偏好设置，验证重启后保持的测试通过 <!-- comet-task:4a259ebc-9b81-414b-9fd9-2fa56ecee176 -->
- [ ] 6.6 记录通知触发条件与降级行为，验证文档与实现一致 <!-- comet-task:007211cd-82bb-41c2-8bd9-9135163dc296 -->

## 7. 外观与本地化

- [ ] 7.1 实现浅色、深色、跟随系统主题和启动前恢复，验证无首屏主题闪烁的测试通过 <!-- comet-task:d73f86be-ccbf-42a5-b76e-be92a2b37f90 -->
- [ ] 7.2 实现字号、密度和减少动效设置，验证布局不溢出主要操作的组件测试通过 <!-- comet-task:d4de5193-882b-441f-8a51-0147b044b216 -->
- [ ] 7.3 接入 i18next 与中英文资源，验证切换语言无需重启的测试通过 <!-- comet-task:f791c347-a2cd-46d6-b2b2-bc4320053ca6 -->
- [ ] 7.4 实现缺失翻译回退和原始键名扫描，验证测试能发现未翻译文案 <!-- comet-task:e9e27a8d-f5cb-48ba-8959-d815d61bd078 -->
- [ ] 7.5 使用 `Intl` 格式化日期和数字，验证中英文格式差异的测试通过 <!-- comet-task:57ca9784-fbd3-42bb-970c-f79cfb3e55c9 -->
- [ ] 7.6 更新主题令牌、语言资源和可访问性说明，验证文档与实现一致 <!-- comet-task:bbd0999c-5a53-489f-875b-7872eaea6dab -->

## 8. 首次启动与打包

- [ ] 8.1 实现六种运行时的本机探测和版本读取，验证已安装、未安装和需登录分类测试通过 <!-- comet-task:c483b94c-0cdc-402c-b9bc-52cab2e9fde8 -->
- [ ] 8.2 实现首次启动运行时检测页和安装指引，验证无运行时时仍可进入首页的测试通过 <!-- comet-task:cb46cc1b-cd50-4a28-a547-1c167b954e40 -->

```

Full source: docs/openspec/changes/p0-capabilities-settings/tasks.md

## docs/openspec/changes/p0-capabilities-settings/.openspec.yaml

- Source: docs/openspec/changes/p0-capabilities-settings/.openspec.yaml
- Lines: 1-2
- SHA256: b6d27c089c6ee9596ce0433bd8f7f771b477758efe1ce7f7a7505af47316ecd0

```md
schema: spec-driven
created: 2026-11-03

```

## docs/openspec/changes/p0-capabilities-settings/specs/appearance-localization/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/appearance-localization/spec.md
- Lines: 1-79
- SHA256: d41a66f488f39a3444f6270913c50b11d5553bef73d42459197d0797794a535c

```md
# Spec Delta

## Purpose

定义主题、字号、密度、动效和中英文切换，使用户可以按环境调整界面，同时保持可访问性和一致的日期、数字格式。

## ADDED Requirements

### Requirement: 主题切换

本要求为强制要求（MUST）。

应用必须支持浅色、深色和跟随系统三种主题。切换后无需重启即可生效，并持久化到本地设置；跟随系统时必须在系统主题变化后更新界面。

#### Scenario: 手动切换深色

- **WHEN** 用户选择深色主题
- **THEN** 所有主要界面立即使用深色令牌
- **AND** 重启后仍为深色

#### Scenario: 跟随系统变化

- **WHEN** 主题为跟随系统且操作系统切换到深色
- **THEN** 应用界面同步切换到深色
- **AND** 不要求用户重启

### Requirement: 字号与密度

本要求为强制要求（MUST）。

用户必须能够调整界面字号和列表密度。调整后布局不得溢出或遮挡主要操作，会话列表和设置表格必须保持可用。

#### Scenario: 增大字号

- **WHEN** 用户把字号调大
- **THEN** 正文和控件同步放大
- **AND** 主要按钮和输入框仍可完整操作

### Requirement: 减少动效

本要求为强制要求（MUST）。

应用必须尊重系统的减少动效偏好，并提供手动开关。开启后不得播放非必要动画，流式文本和状态更新仍必须可见。

#### Scenario: 系统减少动效

- **WHEN** 操作系统开启减少动效
- **THEN** 应用默认关闭过渡动画
- **AND** 状态变化仍通过文字或静态标记呈现

### Requirement: 中英文切换

本要求为强制要求（MUST）。

应用必须支持简体中文和 English，切换后无需重启即可更新界面文案。日期、数字和代码字体必须跟随语言正确显示；缺失翻译不得显示原始键名。

#### Scenario: 切换到 English

- **WHEN** 用户选择 English
- **THEN** 导航、按钮、空状态和错误提示切换为英文
- **AND** 当前页面状态和未保存输入保持不变

#### Scenario: 缺失翻译

- **WHEN** 某个界面文案没有目标语言翻译
- **THEN** 应用回退到另一种已配置语言
- **AND** 不显示类似 `settings.title` 的原始键名

### Requirement: 外观设置持久化

本要求为强制要求（MUST）。

主题、语言、字号、密度和减少动效必须持久化并在应用启动时尽早应用，避免先显示错误主题再闪烁切换。

#### Scenario: 启动时恢复外观

- **WHEN** 用户上次使用深色主题和英文
- **THEN** 启动首屏即使用深色和英文
- **AND** 不出现明显的浅色闪烁

```

## docs/openspec/changes/p0-capabilities-settings/specs/desktop-distribution/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/desktop-distribution/spec.md
- Lines: 1-91
- SHA256: 02d9bb4b5c16f6aa668ee66dde224b5258b792306191d20c6e4369e2dca09e08

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义新用户如何从安装包启动 Pizza、检测本机运行时并完成首次配置，以及 macOS 安装包应包含哪些版本与许可信息。

## ADDED Requirements

### Requirement: 首次启动运行时检测

本要求为强制要求（MUST）。

首次启动时，应用必须在 30 秒内检测本机已安装的运行时，并区分可接入、未安装和需要登录。未检测到运行时也必须允许用户进入应用并查看安装指引，不得阻断启动。

#### Scenario: 检测到可用运行时

- **WHEN** 用户首次启动且本机已安装 Claude Code
- **THEN** 引导页列出 Claude Code 为可接入
- **AND** 用户可以直接进入连接测试

#### Scenario: 没有可用运行时

- **WHEN** 用户首次启动且没有检测到任何运行时
- **THEN** 应用仍进入首页并显示安装指引
- **AND** 新建会话时提示先接入运行时

### Requirement: 首次配置流程

本要求为强制要求（MUST）。

引导流程必须覆盖选择或填写运行时、测试连接、注册运行时、创建第一个智能体和进入首个会话。除安装运行时本身外，用户不得被要求使用命令行。

#### Scenario: 完成首次配置

- **WHEN** 用户选择可接入运行时并通过连接测试
- **THEN** 应用注册运行时并预填通用助手智能体
- **AND** 用户可以进入首个会话

#### Scenario: 测试失败

- **WHEN** 运行时连接测试失败
- **THEN** 引导页显示失败步骤和修复建议
- **AND** 用户可以返回修改配置或稍后继续

### Requirement: 不打包用户运行时

本要求为强制要求（MUST）。

安装包不得捆绑或代替用户安装模型运行时。运行时由用户自行安装并登录，Pizza 只负责检测、连接和诊断。

#### Scenario: 查看安装包内容

- **WHEN** 用户检查安装包内容
- **THEN** 不应发现 Claude Code、Codex、Pi 等运行时的完整安装副本
- **AND** 关于页说明运行时需单独安装

### Requirement: macOS 安装包

本要求为强制要求（MUST）。

构建必须生成可在 macOS 13+ 启动的安装包，包含应用图标、版本、构建号和许可信息。安装后应用可以创建数据目录并打开主窗口。

#### Scenario: 安装并启动

- **WHEN** 用户安装构建产物并启动应用
- **THEN** 主窗口打开并创建本地数据目录
- **AND** 关于页版本与构建产物一致

### Requirement: 版本与许可信息

本要求为强制要求（MUST）。

安装包和关于页必须展示版本号、构建号、开源协议和第三方依赖归属。构建流程必须阻止版本号缺失或与包元数据不一致的产物发布。

#### Scenario: 版本号不一致

- **WHEN** 构建配置中的版本与包元数据不一致
- **THEN** 构建失败并指出不一致字段
- **AND** 不生成安装包


```

Full source: docs/openspec/changes/p0-capabilities-settings/specs/desktop-distribution/spec.md

## docs/openspec/changes/p0-capabilities-settings/specs/mcp-management/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/mcp-management/spec.md
- Lines: 1-127
- SHA256: ec88ef7db15c95cd0be3a9afda6a27a4aa39367ddbb893738c4a451136cbac26

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 MCP Server 如何被配置、测试、发现工具、挂载到智能体或团队成员，并在不泄露凭据的前提下注入运行时。

## ADDED Requirements

### Requirement: MCP Server 列表

本要求为强制要求（MUST）。

设置中的 MCP 列表必须展示名称、传输方式、状态、工具数和被引用次数，并支持启用、禁用和搜索。未通过连接测试的 Server 必须显示为未就绪。

#### Scenario: 禁用 MCP Server

- **WHEN** 用户禁用一个已挂载的 MCP Server
- **THEN** 列表状态变为已禁用
- **AND** 后续运行不再注入该 Server

### Requirement: stdio 配置

本要求为强制要求（MUST）。

用户必须能够创建 stdio MCP Server，填写命令、参数、环境变量和工作目录。环境变量值必须加密存储并以掩码展示；支持引用系统环境变量而不复制其明文。

#### Scenario: 保存 stdio 配置

- **WHEN** 用户填写命令、参数和一个密钥环境变量并保存
- **THEN** Server 记录保存成功且密钥字段显示为掩码
- **AND** 重启应用后仍可连接

#### Scenario: 缺少命令

- **WHEN** 用户未填写 stdio 启动命令
- **THEN** 表单阻止保存并说明必填项
- **AND** 不创建 Server 记录

### Requirement: SSE 与 HTTP 配置

本要求为强制要求（MUST）。

用户必须能够创建 SSE 或 HTTP MCP Server，填写 URL、Header 和超时。Header 中的密钥必须掩码显示，日志不得输出完整值。

#### Scenario: 保存 HTTP Header

- **WHEN** 用户添加一个包含 Authorization 的 Header
- **THEN** 列表和编辑页只显示掩码
- **AND** 连接测试可以使用原始值但日志不记录它

### Requirement: 连接测试与工具发现

本要求为强制要求（MUST）。

连接测试必须尝试建立连接并列出可用工具的名称、描述和参数 schema。失败时必须展示连接阶段、错误摘要和可操作建议，不得把失败显示为「无工具」。

#### Scenario: 测试成功

- **WHEN** 用户对有效 MCP Server 点击测试连接
- **THEN** 界面显示连接状态和工具清单
- **AND** 每个工具显示参数 schema

#### Scenario: 测试失败

- **WHEN** MCP Server 拒绝连接或超时
- **THEN** 界面显示失败阶段和脱敏错误
- **AND** Server 保持未就绪状态

### Requirement: 挂载与工具白名单

本要求为强制要求（MUST）。

用户必须能够把 MCP Server 挂载到智能体或团队成员，并按工具配置允许或拒绝。保存前必须预览最终工具清单；未挂载的工具不得出现在运行中。

#### Scenario: 限制工具

- **WHEN** 用户只允许某个 Server 的两个工具
- **THEN** 运行上下文只包含这两个工具
- **AND** 其他工具调用被拒绝并记录


```

Full source: docs/openspec/changes/p0-capabilities-settings/specs/mcp-management/spec.md

## docs/openspec/changes/p0-capabilities-settings/specs/notifications/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/notifications/spec.md
- Lines: 1-67
- SHA256: a210dadfc55c95671ef519011bea87be597829e07d6380faa62ac5d028a2a06e

```md
# Spec Delta

## Purpose

定义智能体请求用户介入时如何通知用户，并确保通知可定位、可关闭且不会在免打扰时打扰用户。

## ADDED Requirements

### Requirement: 用户提及通知

本要求为强制要求（MUST）。

团队会话中智能体精确提及用户时，系统必须产生应用内通知、会话标记和系统托盘提示。通知必须包含会话名称、发起智能体和问题摘要。

#### Scenario: 智能体请求拍板

- **WHEN** 智能体提及用户并暂停回合
- **THEN** 应用内通知显示会话、智能体和问题摘要
- **AND** 对应会话出现等待用户标记

### Requirement: 点击跳转

本要求为强制要求（MUST）。

用户点击应用内通知或系统通知时，应用必须聚焦窗口、打开对应会话并定位到发起通知的消息。目标会话已被删除时显示不可用提示。

#### Scenario: 点击通知跳转

- **WHEN** 用户点击一条待处理通知
- **THEN** 应用聚焦并打开对应会话
- **AND** 消息流定位到触发通知的消息

### Requirement: 免打扰

本要求为强制要求（MUST）。

用户必须能够关闭系统托盘通知或设置免打扰。免打扰开启时不得发送系统通知，但必须保留应用内通知和会话标记。

#### Scenario: 免打扰期间请求

- **WHEN** 免打扰开启且智能体提及用户
- **THEN** 不发送系统托盘通知
- **AND** 应用内仍显示待处理标记

### Requirement: 重复通知抑制

本要求为强制要求（MUST）。

同一会话中同一待处理请求不得重复发送系统通知；请求状态变化或出现新的用户提及时才生成新通知。

#### Scenario: 同一请求多次渲染

- **WHEN** 界面因状态刷新多次渲染同一个待处理请求
- **THEN** 系统只发送一次通知
- **AND** 会话标记保持为待处理

### Requirement: 通知权限与降级

本要求为强制要求（MUST）。

系统通知权限被拒绝或托盘不可用时，应用必须降级为应用内通知并说明原因，不得静默丢失提醒。

#### Scenario: 系统通知权限被拒绝

- **WHEN** 用户拒绝系统通知权限
- **THEN** 应用内通知仍正常显示
- **AND** 设置页说明系统通知不可用

```

## docs/openspec/changes/p0-capabilities-settings/specs/settings-center/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/settings-center/spec.md
- Lines: 1-109
- SHA256: 4e1b57eca0b9519883335053e9afab66c1f3b0b7d010ab9d7a0dbc749efe4100

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 Pizza 设置中心的导航、个人与系统配置、归档会话和关于信息，确保用户可以在图形界面中完成日常配置，且设置在重启后保持有效。

## ADDED Requirements

### Requirement: 设置导航

本要求为强制要求（MUST）。

设置中心必须提供分组导航：个人包含个人资料、语言与外观；数据包含记忆管理和已归档会话；团队包含智能体、智能体团队、Skills、MCP、运行时和统计；系统包含系统设置和关于 Pizza。当前页必须高亮，所有入口可达。

#### Scenario: 打开设置

- **WHEN** 用户从侧栏点击设置
- **THEN** 打开独立设置视图并显示品牌与分组导航
- **AND** 当前页具有可见高亮

#### Scenario: 未交付的 P1 页面

- **WHEN** 用户打开尚未完整交付的记忆或统计页面
- **THEN** 页面明确标注规划中或不可用
- **AND** 不展示伪造数据

### Requirement: 个人资料

本要求为强制要求（MUST）。

用户必须能够查看和修改个人显示名称、头像和本地账户说明。头像支持上传和随机生成，上传限制与智能体头像一致；修改后应用内头像立即更新并持久化。

#### Scenario: 修改个人头像

- **WHEN** 用户上传一张不超过 2 MB 的图片
- **THEN** 左下角账户头像和设置页预览同时更新
- **AND** 重启应用后仍显示新头像

### Requirement: 系统默认值

本要求为强制要求（MUST）。

系统设置必须支持默认工作区 `~/Pizza`、默认运行时 Pi、最大并发数、数据目录 `~/.pizza`、日志级别、自动更新开关和匿名统计开关。修改必须说明影响；需要重启的项必须明确标注。

#### Scenario: 修改默认工作区

- **WHEN** 用户设置新的默认工作区并保存
- **THEN** 后续没有指定工作区的新会话使用该目录
- **AND** 已有会话路径保持不变

#### Scenario: 数据目录不可写

- **WHEN** 用户选择一个不可写的数据目录
- **THEN** 设置页显示路径和权限错误
- **AND** 不切换数据目录

### Requirement: 数据目录变更

本要求为强制要求（MUST）。

修改数据目录前必须提示需要重启并确认迁移方式。应用必须在重启后迁移或切换到新目录；迁移失败时保留原目录并给出恢复说明，不得删除原数据。

#### Scenario: 确认迁移

- **WHEN** 用户选择新的数据目录并确认迁移
- **THEN** 应用记录待迁移状态并在重启后执行
- **AND** 失败时继续使用原目录

### Requirement: 已归档会话

本要求为强制要求（MUST）。

设置中的已归档会话必须支持恢复、永久删除和批量清理。永久删除前必须二次确认；恢复后会话回到原工作区并保留消息。

#### Scenario: 批量清理

- **WHEN** 用户选择多个归档会话并确认永久删除
- **THEN** 这些会话及其消息被删除
- **AND** 未选中的归档会话保持不变


```

Full source: docs/openspec/changes/p0-capabilities-settings/specs/settings-center/spec.md

## docs/openspec/changes/p0-capabilities-settings/specs/skill-management/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/skill-management/spec.md
- Lines: 1-127
- SHA256: f57886ab8faf94e67ebd59adc467130b55eff3cc79c2fe598b982284f34fc806

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义 Skill 如何被创建、导入、校验、挂载到智能体或团队成员，并在运行时安全物化，使用户能够复用能力包而不修改运行时安装目录。

## ADDED Requirements

### Requirement: Skill 列表与搜索

本要求为强制要求（MUST）。

设置中的 Skill 列表必须展示名称、描述、版本、来源、被引用次数和启用状态，并支持按名称搜索和按标签筛选。

#### Scenario: 搜索 Skill

- **WHEN** 用户在 Skill 搜索框输入名称片段
- **THEN** 列表只显示名称或描述匹配的 Skill
- **AND** 清空搜索后恢复完整列表

### Requirement: 创建与 frontmatter 校验

本要求为强制要求（MUST）。

用户必须能够创建包含 `SKILL.md` 和资源文件的 Skill。保存前必须校验 frontmatter 的必填字段；缺少名称、描述或版本时不得保存，并定位到具体字段。

#### Scenario: frontmatter 缺少名称

- **WHEN** 用户保存一个 `SKILL.md` 缺少名称字段的 Skill
- **THEN** 表单显示名称字段错误
- **AND** Skill 不被保存

### Requirement: 从本地目录、ZIP 和 Git 导入

本要求为强制要求（MUST）。

用户必须能够从本地文件夹、ZIP 或 Git 仓库导入 Skill。导入前必须展示文件清单、来源和冲突项；导入后必须保留来源信息，便于后续更新。

#### Scenario: 从 ZIP 导入

- **WHEN** 用户选择一个包含 `SKILL.md` 的 ZIP 文件
- **THEN** 应用展示文件清单和校验结果
- **AND** 用户确认后 Skill 出现在列表中

#### Scenario: 导入路径越界

- **WHEN** 导入包包含指向 Skill 目录之外的路径
- **THEN** 应用拒绝导入并说明越界文件
- **AND** 不写入任何文件到数据目录

### Requirement: 编辑与删除影响提示

本要求为强制要求（MUST）。

用户必须能够编辑和删除 Skill。删除前列出受影响的智能体和团队成员；被引用时必须要求用户确认或先解绑，不得静默破坏现有配置。

#### Scenario: 删除被引用的 Skill

- **WHEN** 用户删除一个被智能体挂载的 Skill
- **THEN** 应用展示受影响智能体列表
- **AND** 用户取消时不删除 Skill 或绑定

### Requirement: 挂载到智能体与团队成员

本要求为强制要求（MUST）。

用户必须能够把启用的 Skill 挂载到智能体或团队成员，并在保存前预览最终生效清单。团队成员级覆盖可以增加或移除 Skill；冲突时以团队覆盖为准。

#### Scenario: 预览生效清单

- **WHEN** 用户为团队成员增加一个 Skill 并移除另一个
- **THEN** 预览显示最终挂载清单
- **AND** 被移除项不再出现在运行上下文

### Requirement: 运行时物化

本要求为强制要求（MUST）。

运行开始前，系统必须把生效 Skill 物化到运行时能够读取的临时或工作目录，并把 Skill 名称和描述写入运行上下文。物化失败时必须给出可诊断错误，不得假装 Skill 已生效。


```

Full source: docs/openspec/changes/p0-capabilities-settings/specs/skill-management/spec.md

## docs/openspec/changes/p0-capabilities-settings/specs/tool-approvals/spec.md

- Source: docs/openspec/changes/p0-capabilities-settings/specs/tool-approvals/spec.md
- Lines: 1-97
- SHA256: 552146ec2181d9a6fea4c5778b8cdcec42fc8745324d09b66a58b81209dc43e8

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义智能体工具调用在需要用户授权时如何请求、展示、决定和审计，确保危险操作不会在用户不知情的情况下执行。

## ADDED Requirements

### Requirement: 统一审批请求

本要求为强制要求（MUST）。

ACP 权限请求和 CLI 审批钩子必须统一进入同一个审批服务，并向用户展示工具名称、参数摘要、风险等级、发起智能体和所属会话。不同运行时的审批不得各自实现一套 UI。

#### Scenario: ACP 请求写文件

- **WHEN** ACP 运行时请求在工作区外写入文件
- **THEN** 应用显示包含工具、路径和风险等级的审批对话框
- **AND** 运行进入等待审批状态

#### Scenario: CLI 请求执行命令

- **WHEN** CLI 适配器报告需要审批的命令
- **THEN** 应用使用同一审批对话框展示命令和参数
- **AND** 不自动执行命令

### Requirement: 审批决定

本要求为强制要求（MUST）。

审批必须支持允许一次、总是允许和拒绝。允许一次只对当前请求生效；总是允许只对同一智能体、工具和策略范围生效；拒绝必须向运行返回明确结果。

#### Scenario: 允许一次

- **WHEN** 用户选择允许一次
- **THEN** 当前工具调用继续执行
- **AND** 下一次同类调用仍会请求审批

#### Scenario: 拒绝执行

- **WHEN** 用户选择拒绝
- **THEN** 运行收到拒绝结果并显示可见错误
- **AND** 工具不被执行

### Requirement: 危险操作默认询问

本要求为强制要求（MUST）。

删除、覆盖、执行任意命令、访问工作区外路径和网络写操作必须默认每次询问。用户可以把某个工具设置为总是允许或禁止，但危险操作不得默认放行。

#### Scenario: 默认策略

- **WHEN** 一个新智能体第一次请求危险工具
- **THEN** 应用请求用户审批
- **AND** 不沿用未明确配置的全局放行

### Requirement: 审批策略

本要求为强制要求（MUST）。

用户必须能够为工具配置「总是允许」「每次询问」和「禁止」。策略按智能体和 MCP 工具范围生效，冲突时以更严格的策略为准。

#### Scenario: 禁止策略

- **WHEN** 用户把一个工具设置为禁止
- **THEN** 该工具调用直接返回拒绝
- **AND** 不弹出审批对话框

### Requirement: 超时与并发

本要求为强制要求（MUST）。

审批请求必须有超时；超时后按拒绝处理并向运行返回明确原因。多个审批同时到达时必须排队展示，不得丢失或覆盖尚未处理的请求。

#### Scenario: 审批超时

- **WHEN** 用户在超时时间内没有作出决定
- **THEN** 该请求按拒绝处理
- **AND** 运行收到超时原因


```

Full source: docs/openspec/changes/p0-capabilities-settings/specs/tool-approvals/spec.md
