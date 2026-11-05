---
change: p0-capabilities-settings
design-doc: docs/openspec/changes/p0-capabilities-settings/design.md
base-ref: 45b2e89369fa20a46d541f88b76e962393fe1766
archived-with: 2026-11-04-p0-capabilities-settings
---

# Implementation Plan: P0 能力管理与产品化设置

## Approach

采用 autonomous 执行方式，按任务组顺序实施，采用 TDD：数据模型、设置仓储、Skill 路径校验、MCP 配置合并、审批策略、通知去重和 i18n 回退先写失败测试，再实现到通过；UI 使用组件测试与 Playwright 冒烟验证。每完成一个任务就运行其声明的验证，并在同一个 `tasks.md` 上勾选；本计划不复制 checkbox，任务正文与完成状态以 `tasks.md` 为权威。

实施顺序是「基础数据与设置 → 能力解析 → Skill → MCP → 审批 → 设置中心 → 通知 → 主题与国际化 → 首次启动与打包 → 集成验收」。先把迁移、设置仓储和共享 IPC 做稳，再叠加能力解析与注入，避免 Skill、MCP、团队覆盖各自实现一套解析；审批放在能力之后，因为它同时服务 ACP 和 CLI 两条运行路径；设置中心、通知、主题与国际化只消费已落库的设置与能力状态。设计权威为 `docs/openspec/changes/p0-capabilities-settings/design.md`，行为权威为同目录 `proposal.md` 与 `specs/`，任务权威为 `tasks.md`。

生产代码全部使用 TypeScript；不复制参考项目代码、品牌或资产；文档与代码中不出现禁止出现的项目名称。所有 Git 提交使用中文与约定前缀，按任务组阶段提交，不积累大批未提交改动。

## Dependencies and constraints

- 组 1 的迁移 v5 是组 2–8 的共同依赖；现有数据库（单智能体、团队）必须无损升级，迁移重复执行保持幂等。设置表 `app_setting` 若已存在，只补缺失键，不覆盖用户值。
- 组 1 的设置仓储与 IPC 是组 5、6、7 的前提；设置 schema 用 Zod 统一校验，主进程和渲染层共享类型，渲染层不直接写数据库。
- 组 2 的 `CapabilityResolver` 与 `InjectionPipeline` 是组 3、4 的共同依赖。解析结果写入运行快照，Skill 与 MCP 使用同一套「智能体 → 团队成员覆盖 → 全局默认」优先级，冲突时取更严格者。
- 组 2 的 Skill 物化依赖组 3 不成立的假设不存在：Skill 只依赖运行临时目录与数据目录，MCP 依赖 safeStorage 与适配器注入；两组可以按序实现，但共享 `InjectionPipeline` 的接口在组 2 先定义。
- 组 4 的审批服务同时被 ACP 适配器和 Claude CLI PreToolUse hook 调用；hook 脚本、本地 Unix socket 和临时 `--settings` 都必须可测试，hook 不可用时安全拒绝而不是放行。
- 组 5–7 只消费主进程 IPC 与查询结果，不在渲染层推断能力或审批状态。
- 组 8 的打包依赖 `package.json` 版本与构建号；`electron-builder` 只配置 macOS 未签名产物，不引入自动更新、签名或公证。
- 组 9 只做集成验收，不引入新功能；真实运行时或打包环境不可用时如实记录阻塞，不用假数据冒充通过。
- 新增依赖：`i18next`、`react-i18next`、`@modelcontextprotocol/sdk`、`fflate`（ZIP 解压）、`electron-builder`（devDependency）。安装使用 `npm install --cache /tmp/pizza-npm-cache`，避免 root 所有的全局缓存导致 EACCES。
- Electron 主进程 ESM/CJS 边界、`node:sqlite` 和 `nodeIntegration: false` 的现有约束保持不变；新增 IPC 必须经过 Zod 校验和 preload 白名单。

## Task mapping

<!-- comet-task-authority: docs/openspec/changes/p0-capabilities-settings/tasks.md -->

## 1. 设置与能力数据基础

- 1.1 迁移 v5 新增能力、设置、审批与通知表，验证单智能体/团队数据库无损升级 <!-- comet-task-ref:9b340f44-35d7-4573-8373-b71311bdf476 -->
- 1.2 新增模块全部使用 TypeScript 并通过严格类型检查 <!-- comet-task-ref:440bcb94-22e2-4a32-8551-ababb3f5fe44 -->
- 1.3 类型化设置仓储与 Zod schema，验证默认值、范围校验与重启持久化 <!-- comet-task-ref:e4d51857-2070-4672-95b8-f3a039157554 -->
- 1.4 设置读取/写入 IPC 与 preload 类型，验证非法输入被拒绝 <!-- comet-task-ref:7af17915-a817-4eba-8f3f-1ba0a858f9be -->
- 1.5 数据目录待迁移状态、启动检查与失败回退 <!-- comet-task-ref:2bfc14bb-4df2-4242-ab4c-57f5e72b41f0 -->
- 1.6 记录能力与设置数据模型并与迁移对齐 <!-- comet-task-ref:145a299a-1bd6-4d6a-8908-306a537e72fd -->

## 2. Skill 管理

- 2.1 Skill 列表、搜索、标签筛选与引用计数 <!-- comet-task-ref:31a92880-79bc-43aa-9758-f7bed9ddbcfa -->
- 2.2 `SKILL.md` frontmatter 校验与创建表单 <!-- comet-task-ref:ccd0f6d2-9ae8-4987-b17b-b5e07e303073 -->
- 2.3 本地目录、ZIP 和 Git 导入及文件清单预览 <!-- comet-task-ref:7039d81c-0528-462e-b041-02689ff5dad4 -->
- 2.4 导入路径规范化、越界拒绝与符号链接保护 <!-- comet-task-ref:1f7984d1-b03a-4934-a0b5-f09249ffb76a -->
- 2.5 Skill 编辑、删除影响提示和解绑流程 <!-- comet-task-ref:1f473647-6264-466d-b69d-068df6a8388e -->
- 2.6 挂载到智能体与团队成员、覆盖与最终清单预览 <!-- comet-task-ref:dc4c4834-0afb-4cad-b574-2878650972f3 -->
- 2.7 运行级 Skill 物化与上下文清单 <!-- comet-task-ref:28e44ec8-f329-4a96-8cbd-b6a34023e453 -->
- 2.8 同名冲突的停止、覆盖、重命名与跳过策略 <!-- comet-task-ref:3edd0902-c798-4732-8e03-bb68691d346a -->
- 2.9 内置 Pizza 协作 Skill 与单次禁用开关 <!-- comet-task-ref:44d84b88-04bd-4196-a4ce-a8ec6097461e -->
- 2.10 记录 Skill 目录结构、导入格式与物化流程 <!-- comet-task-ref:b70e1b84-7a31-4e33-bd18-4f1c17e47b79 -->

## 3. MCP 管理

- 3.1 MCP 列表、启停、状态和搜索 <!-- comet-task-ref:39abdae8-84d3-479f-ba0e-277bacce4499 -->
- 3.2 stdio 配置、环境变量加密与掩码展示 <!-- comet-task-ref:cd85cdb5-d81c-4595-bdff-a06467041243 -->
- 3.3 SSE/HTTP 配置、Header 加密与超时校验 <!-- comet-task-ref:3dd8af02-013d-4c97-978b-399c426974bd -->
- 3.4 MCP TypeScript 客户端、连接测试与工具发现 <!-- comet-task-ref:dc29ac52-51e6-4d70-b4fa-4ba4db249bf2 -->
- 3.5 工具清单、参数 schema 展示与失败诊断 <!-- comet-task-ref:44fa8934-378e-4a57-b62c-d7de5cf655f3 -->
- 3.6 挂载、工具允许/拒绝与最终工具清单预览 <!-- comet-task-ref:a81b19dc-3012-4777-adb8-44c797e9e8ec -->
- 3.7 智能体、工作区库与运行时本地配置三层合并 <!-- comet-task-ref:7f23ec53-7bba-4a2c-bc09-f58065818824 -->
- 3.8 ACP 与 CLI 适配器的 MCP 注入与单点失败隔离 <!-- comet-task-ref:14801301-2e0e-4ccb-8bfe-816af0c80e18 -->
- 3.9 配置只写、整体替换与导出脱敏审计 <!-- comet-task-ref:54037b98-be55-44b8-9d4a-d71bccaa0411 -->
- 3.10 记录 MCP 传输、注入与凭据处理文档 <!-- comet-task-ref:07c871c5-2f1c-4059-a6af-7fa380e42966 -->

## 4. 统一工具审批

- 4.1 审批请求、决定与状态类型及 ACP/CLI 事件映射 <!-- comet-task-ref:9cb77402-07f3-4c56-b71d-d8eb2d0718cb -->
- 4.2 主进程审批服务、FIFO 队列与超时拒绝 <!-- comet-task-ref:90b0ff3a-92bb-4175-b26c-ddce14a65049 -->
- 4.3 允许一次、总是允许、拒绝与运行结果回传 <!-- comet-task-ref:f7022cf8-91b8-4e50-874c-08e30dfad2d3 -->
- 4.4 危险操作默认询问与更严格策略优先 <!-- comet-task-ref:aaa94eaf-433b-4c35-a3f8-7d103ddbf868 -->
- 4.5 审批对话框、工具参数摘要与风险等级展示 <!-- comet-task-ref:606032b9-2171-44e6-9ee7-62a5aaadaf51 -->
- 4.6 审批记录、策略来源与脱敏审计 <!-- comet-task-ref:000dcb40-441f-4b7a-ad4a-951c13d5782a -->
- 4.7 记录审批协议与策略解析顺序 <!-- comet-task-ref:1deffaa3-80fb-4ddf-b28c-edf7baeade76 -->

## 5. 设置中心

- 5.1 独立设置视图与分组导航 <!-- comet-task-ref:bfde0d3b-e617-40ec-82dc-c85fe7c05775 -->
- 5.2 个人资料、头像上传与随机头像 <!-- comet-task-ref:9bf55c1d-6d1a-448b-a1a1-76e1b897f1bd -->
- 5.3 系统默认工作区、运行时、并发、数据目录、日志、更新与统计设置 <!-- comet-task-ref:bb6b3a1b-d708-4adf-aa0d-38295f0c8187 -->
- 5.4 已归档会话恢复、永久删除与批量清理 <!-- comet-task-ref:a73cbe34-b01a-42e7-93b4-aabbbc84ab0b -->
- 5.5 关于页版本、构建号、协议、第三方归属与反馈入口 <!-- comet-task-ref:8f9760cd-2c1c-4fd3-971a-b552b40d002f -->
- 5.6 记忆与统计 P1 页面的不可用说明 <!-- comet-task-ref:64430275-7f78-45e2-8ed4-1b376c5fc304 -->
- 5.7 设置变更后的跨页面同步 <!-- comet-task-ref:d567260a-34ee-4f10-977d-374f5f1519f7 -->
- 5.8 更新设置文案与页面说明并核对 UI-SPEC <!-- comet-task-ref:44356a7d-0df6-4cb0-b03e-bc54e81f4bde -->

## 6. 通知

- 6.1 智能体提及用户时的待处理通知记录与会话标记 <!-- comet-task-ref:bd4f5e2d-99d2-4bb1-9bee-f8e8a0097202 -->
- 6.2 应用内通知与系统托盘通知及权限降级 <!-- comet-task-ref:bb3a72cf-caa1-4e9f-a440-e308e7207955 -->
- 6.3 点击通知聚焦窗口、打开会话并定位消息 <!-- comet-task-ref:38e5a94d-a7f0-4a1a-a7cd-a22e658c8224 -->
- 6.4 免打扰与重复通知抑制 <!-- comet-task-ref:1e4aac70-c842-4fbc-ad0b-ac6cf6ff1656 -->
- 6.5 通知偏好设置与重启保持 <!-- comet-task-ref:4a259ebc-9b81-414b-9fd9-2fa56ecee176 -->
- 6.6 记录通知触发条件与降级行为 <!-- comet-task-ref:007211cd-82bb-41c2-8bd9-9135163dc296 -->

## 7. 主题与国际化

- 7.1 浅色、深色、跟随系统主题与启动前恢复 <!-- comet-task-ref:d73f86be-ccbf-42a5-b76e-be92a2b37f90 -->
- 7.2 字号、密度与减少动效设置 <!-- comet-task-ref:d4de5193-882b-441f-8a51-0147b044b216 -->
- 7.3 接入 i18next 与中英文资源，切换无需重启 <!-- comet-task-ref:f791c347-a2cd-46d6-b2b2-bc4320053ca6 -->
- 7.4 缺失翻译回退与原始键名扫描 <!-- comet-task-ref:e9e27a8d-f5cb-48ba-8959-d815d61bd078 -->
- 7.5 使用 `Intl` 格式化日期与数字 <!-- comet-task-ref:57ca9784-fbd3-42bb-970c-f79cfb3e55c9 -->
- 7.6 更新主题令牌、语言资源与可访问性说明 <!-- comet-task-ref:bbd0999c-5a53-489f-875b-7872eaea6dab -->

## 8. 首次启动与打包

- 8.1 六种运行时本机探测与版本读取 <!-- comet-task-ref:c483b94c-0cdc-402c-b9bc-52cab2e9fde8 -->
- 8.2 首次启动运行时检测页与安装指引 <!-- comet-task-ref:cb46cc1b-cd50-4a28-a547-1c167b954e40 -->
- 8.3 引导流程：选择、测试、注册、创建智能体与首个会话 <!-- comet-task-ref:d2757ffc-43b9-49ae-b861-986ab5808bbf -->
- 8.4 `electron-builder` macOS 打包、图标、版本与第三方归属 <!-- comet-task-ref:bd3ab179-758b-4798-a243-96adf51d4b98 -->
- 8.5 版本与包元数据一致性校验 <!-- comet-task-ref:3629fd07-28de-492a-bdd3-df7c7d2833f7 -->
- 8.6 安装后首次启动的数据目录初始化与失败提示 <!-- comet-task-ref:7bd3a983-c7b4-44cd-9e57-83bd30c80eca -->
- 8.7 记录安装、首次启动与运行时安装说明 <!-- comet-task-ref:f1330cbd-e4c0-4b6a-8ff6-ca035d0ccc9d -->

## 9. 集成验收

- 9.1 假 ACP 运行时的 Skill、MCP 与审批允许集成测试 <!-- comet-task-ref:0c754dc6-9a7f-4ae9-b9e6-6a7654a21f9a -->
- 9.2 审批拒绝、超时与危险操作默认询问 <!-- comet-task-ref:6d8ae270-84f6-4a0b-9800-56de8a27a159 -->
- 9.3 Playwright 覆盖主题、语言、通知跳转与首次启动引导 <!-- comet-task-ref:f0b04f81-7e0e-42b6-87ad-5e772282d8e4 -->
- 9.4 安装 macOS 产物并完成一次真实运行时接入 <!-- comet-task-ref:a5a93179-6a58-44f0-8915-d55d36d2dd85 -->
- 9.5 运行完整检查并记录真实结果 <!-- comet-task-ref:8b6f34f8-f3a2-4c35-97a1-36b3c845d1f6 -->
- 9.6 更新 `AGENTS.md` 阶段、工作日志与已知限制 <!-- comet-task-ref:9a3ff0c5-64fa-4320-a8c9-d2637ebb5dd7 -->

## Verification strategy

- 每个任务执行其描述中的单元、集成或组件验证；TDD 任务先确认 RED，再实现并验证 GREEN。
- 组 1 完成后立即运行现有全部测试与 Electron E2E，确认迁移和设置基础未改变单智能体/团队行为。
- 组 9 运行 `npm run typecheck`、`npm test`、`npm run build`、`npm run test:e2e` 和 `npm run package:mac`，并在 `docs/ACCEPTANCE.md` 记录真实输出。
- 真实运行时验收使用本机已注册的 Claude Code CLI，以及安装后的 macOS 产物；若环境不可用，记录阻塞原因，不以假数据代替。
- Build 阶段结束时通过 `comet guard p0-capabilities-settings build --apply -- npm run verify` 提交完整检查证据；Verify 阶段由独立 reviewer 复核最终 diff，报告写入 `docs/superpowers/reports/p0-capabilities-settings.md`。

## Risk handling

- 迁移失败或半完成：迁移在事务内执行，版本号单调递增；升级前备份数据库文件，失败保留原文件并按回退流程恢复。
- Skill 路径穿越：导入和解压都规范化路径，拒绝绝对路径、`..` 和符号链接越界；在临时目录完成校验后再原子移入。
- MCP 凭据泄露：env/Header 用 `safeStorage` 加密；IPC 只返回掩码和 `hasSecret`；日志与导出白名单脱敏。
- 审批阻塞运行：默认 120 秒超时拒绝；FIFO 不覆盖未处理请求；hook 无法连接时安全拒绝并写诊断。
- 运行时注入差异：适配器各自实现注入，但共享解析结果和能力清单；单个 Server/Skill 失败只影响该能力。
- 数据目录迁移：复制 → 校验 → 切换 → 保留原目录；失败继续使用原目录并显示恢复说明。
- 打包环境限制：只验收未签名 macOS 产物；签名、公证和自动更新留给后续变更。
- 国际化遗漏：文案集中管理，测试扫描缺失键和原始键名；默认简体中文，缺失时回退英文。
- 如果任务暴露范围变化或需要新决策，暂停该任务，按 Comet 阶段规则处理，不擅自扩大范围。
