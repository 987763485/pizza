---
change: p0-solo-vertical-slice
design-doc: docs/openspec/changes/p0-solo-vertical-slice/design.md
base-ref: 4bce946c8fbe4be7ba64d4bb0ce7515d72219c7a
archived-with: 2026-11-04-p0-solo-vertical-slice
---

# Implementation Plan: P0 单智能体纵向切片

## Approach

采用 autonomous 执行方式，按任务组顺序实施，采用 TDD：核心数据层、运行时协议解析、会话状态与产出物索引先写失败测试，再实现到通过。UI 和 Electron 壳层使用组件测试与 Playwright 冒烟验证。每个任务完成后运行其声明的验证命令，并在同一个 `tasks.md` 上勾选对应任务；本计划不复制 checkbox。

技术栈固定为 Electron + React + TypeScript + electron-vite，SQLite 使用 `better-sqlite3`，运行时首批实现 ACP stdio 与 Claude Code CLI。设计与规格的权威来源分别是 `docs/openspec/changes/p0-solo-vertical-slice/design.md` 和同目录 `specs/`。

## Dependencies and constraints

- 任务组 1 必须先完成，后续组依赖工程骨架和测试入口。
- 任务组 2 的数据层是组 3、4、5、6、7、8 的共同依赖。
- 组 4 的适配器契约必须先于组 6 的运行编排；组 6 的会话运行依赖组 4 的测试通过。
- 组 8 的产出物索引依赖组 6 的运行事件；组 9 只做集成验收。
- 所有新增生产代码使用 TypeScript；不复制参考项目代码或品牌资产。
- 不在本 change 实现团队、Skill/MCP、设置、主题/国际化、安装包或云同步。
- 真实运行时验收使用已安装的 Claude Code CLI；其他运行时预设保持实验性。

## Task mapping

<!-- comet-task-authority: docs/openspec/changes/p0-solo-vertical-slice/tasks.md -->

## 1. 工程基础

- 1.1 创建 Electron + React + TypeScript + electron-vite 工程骨架，配置 `dev`、`build`、`typecheck`、`test` 脚本，验证 `npm install` 与 `npm run build` 成功 <!-- comet-task-ref:a5a6cc37-24d9-4c14-97fd-e88bbd629c3e -->
- 1.2 建立主进程、preload、renderer 分层目录和最小窗口，验证应用能启动且 `contextIsolation` 已开启 <!-- comet-task-ref:5e25e4d4-87f4-4cd5-90fe-c2cb9dece2c7 -->
- 1.3 配置 CSP、禁止 `nodeIntegration`、限制外部导航，并用一个 preload IPC 冒烟测试验证 renderer 无法直接访问 Node <!-- comet-task-ref:8d43182e-268f-44b7-93ca-79a5d0da2db0 -->
- 1.4 建立共享类型、Zod IPC 输入校验和错误码，验证不合法 IPC 输入被拒绝的单元测试通过 <!-- comet-task-ref:d6345de3-0085-4535-9e1a-ec6aced2954d -->
- 1.5 移植 UI 设计令牌与三栏布局骨架，验证窗口宽度变化时侧栏和主区不重叠 <!-- comet-task-ref:66085657-c8a3-485a-a677-33fad336f72d -->
- 1.6 增加 Vitest 配置与一个示例单元测试，验证 `npm test` 可在干净环境运行 <!-- comet-task-ref:8b0b6a69-124b-4ea4-a992-b722f1e08428 -->

## 2. 本地数据层

- 2.1 实现 SQLite 连接、WAL、外键和迁移执行器，验证空数据库启动后迁移到最新版本且重复启动不重复迁移 <!-- comet-task-ref:6a950166-fcbe-4b6b-b9da-64cf96263e57 -->
- 2.2 建立 `workspace`、`app_setting` 表及仓储，验证默认工作区读写和路径持久化测试通过 <!-- comet-task-ref:77aa5b91-80bb-4b46-865e-4b2b46f50781 -->
- 2.3 建立 `runtime`、`agent` 表及仓储，验证创建、更新、归档和唯一名称校验测试通过 <!-- comet-task-ref:df3f26e7-b0ee-4a3a-b2dd-45bc5e3bf17d -->
- 2.4 建立 `session`、`message`、`attachment`、`run`、`run_event`、`artifact` 表及仓储，验证外键级联和事务回滚测试通过 <!-- comet-task-ref:f97e2c30-3666-484b-8553-0c96a0d37b49 -->
- 2.5 建立 `message_fts` 与同步触发器，验证按标题、消息内容和智能体名称搜索的集成测试通过 <!-- comet-task-ref:7857a76f-5c24-4ae1-9a4e-608845be6fe9 -->
- 2.6 实现附件落盘到 `~/.pizza/attachments/` 并记录元数据，验证 20 MB 限制、重启后可读取和路径越界拒绝测试通过 <!-- comet-task-ref:6e5fbb6d-8e99-49da-a653-b8fb6c5fae0a -->
- 2.7 记录数据库与数据目录文档，验证文档中的路径和迁移命令与实际实现一致 <!-- comet-task-ref:bdcba48b-4612-4e98-8569-e4deb3cf17d0 -->

## 3. 工作区与应用壳

- 3.1 实现默认工作区 `~/Pizza` 的检测与按需创建，验证无工作区会话归入默认工作区的测试通过 <!-- comet-task-ref:266586a1-da09-4a35-b2a2-e93533afc6f5 -->
- 3.2 接入系统文件夹选择器并实现工作区注册、切换和错误提示，验证已有目录、新目录和无权限目录三个场景的测试通过 <!-- comet-task-ref:15c80112-023a-4037-8c0f-5103a52bc7fc -->
- 3.3 实现左侧栏工作区并列展示、当前工作区高亮和会话占位，验证多工作区渲染测试通过 <!-- comet-task-ref:a4c591b6-cede-455e-bb99-e53050d4d68e -->
- 3.4 实现应用启动恢复当前工作区并加载其会话，验证重启后工作区状态保持的测试通过 <!-- comet-task-ref:a122e575-9dc9-4bbd-ab4a-c3c935cd83b8 -->

## 4. 运行时连接

- 4.1 定义 `RuntimeAdapter`、标准化运行事件和能力数据结构，验证事件映射单元测试通过 <!-- comet-task-ref:8064fe99-d028-4bae-982e-32fd9a5597fd -->
- 4.2 实现 ACP stdio 的 JSON-RPC 客户端，覆盖 `initialize`、`session/new`、`session/prompt`、`session/cancel`，验证假 ACP 服务端集成测试通过 <!-- comet-task-ref:241b8f13-51cc-4720-a54a-a54e271a766e -->
- 4.3 实现 Claude Code CLI 适配器，解析流式 JSON 输出、工具事件和结果事件，验证夹具流解析测试通过 <!-- comet-task-ref:4d03ce9e-c99e-4304-ab47-76e11e878258 -->
- 4.4 实现连接测试的五阶段状态机和超时处理，验证成功、启动失败、握手失败和测试消息失败场景的测试通过 <!-- comet-task-ref:0ce2649a-4ad6-4867-9d90-c238d0b2b2ec -->
- 4.5 实现运行时注册、能力探测、在线状态与重连调度，验证未测试运行时不能被智能体绑定的测试通过 <!-- comet-task-ref:1666afb6-91cb-42cb-bd6c-c251fb62bef9 -->
- 4.6 实现运行时列表、添加/编辑表单、测试步骤和敏感字段掩码，验证表单校验与掩码展示的组件测试通过 <!-- comet-task-ref:f0283cde-24f7-40d1-ae7c-cdd15bf093c6 -->
- 4.7 增加六种运行时预设和「ACP/CLI 兼容」标识，验证预设填充和协议标识的组件测试通过 <!-- comet-task-ref:b9b7d86d-c9e2-4897-9d58-c980789037d7 -->
- 4.8 记录运行时适配器接口和新增适配器步骤，验证文档示例与现有适配器签名一致 <!-- comet-task-ref:62dba7dd-620c-44ee-b6d3-c1edc1f00af3 -->

## 5. 智能体管理

- 5.1 实现智能体创建、编辑、复制、归档和删除服务，验证必填校验、唯一名称和引用检查测试通过 <!-- comet-task-ref:b4882618-8e01-4605-ac1f-c648de3cb534 -->
- 5.2 实现智能体列表、搜索、在线状态和最近使用时间，验证 20 个智能体下列表渲染与搜索测试通过 <!-- comet-task-ref:d9e379a0-7c99-46b5-bd72-ade23191fe0c -->
- 5.3 实现智能体编辑表单、运行时能力门控、思考强度和 100k 步长上下文阈值，验证不兼容配置被阻止的测试通过 <!-- comet-task-ref:03e5ca74-5c44-4b4f-ae82-1fcf83e1faf6 -->
- 5.4 实现默认头像生成、随机头像和上传头像，验证 2 MB 限制、方形裁剪和重启后头像稳定的测试通过 <!-- comet-task-ref:809222b1-e943-4d98-85ad-4885de35c6d9 -->
- 5.5 实现不写入正式会话的智能体测试消息，验证测试运行不新增会话的集成测试通过 <!-- comet-task-ref:e02d8db4-9586-45d2-ab49-4d2fae871b79 -->
- 5.6 更新智能体配置的界面说明和错误文案，验证文案与 `docs/UI-SPEC.md` 对应页面一致 <!-- comet-task-ref:400e9009-6d03-4455-9bb1-2257d982b716 -->

## 6. 单智能体会话

- 6.1 实现从首页选择智能体并创建会话，验证首条消息生成标题和会话立即出现在侧栏的测试通过 <!-- comet-task-ref:a5dbca5f-8390-4ab4-bd68-7da39e99392b -->
- 6.2 实现会话绑定智能体的消息路由和单次运行编排，验证未提及时只路由绑定智能体的测试通过 <!-- comet-task-ref:a22d1060-330d-4fb5-840f-4e80aed0d1e7 -->
- 6.3 实现运行事件落库、IPC 推送与流式渲染，验证文本增量、工具事件和完成事件的集成测试通过 <!-- comet-task-ref:04527ed4-d73f-42f3-8607-cf961ebe5a32 -->
- 6.4 实现停止运行、失败保留和重试，验证停止两秒内生效、重试创建新运行且不删除原消息的测试通过 <!-- comet-task-ref:cdc57e02-66bf-4b1e-958d-c70cb12b1cad -->
- 6.5 实现运行中输入与排队提示，验证不支持追加的运行时显示「已排队」且结束后处理的测试通过 <!-- comet-task-ref:949a8e96-b7eb-4a7e-8496-4900c3dc9bbb -->
- 6.6 实现附件按钮、拖拽和粘贴上传，验证图片、文本、代码文件的消息内预览与持久化测试通过 <!-- comet-task-ref:128443ba-6f09-4bf4-b34f-8cdb7b151e17 -->
- 6.7 实现 Markdown、GFM 表格、代码高亮与工具调用折叠，验证复杂 Markdown 和失败工具调用的组件测试通过 <!-- comet-task-ref:b29187c9-4815-471e-9293-3ec83759df31 -->
- 6.8 实现发送失败草稿保留、错误摘要和日志入口，验证失败后原始输入不丢失的测试通过 <!-- comet-task-ref:c8d3f036-e719-41b5-9e09-f9617bc72a4c -->
- 6.9 实现启动时把未完成运行标记为中断并恢复已接收内容，验证模拟崩溃后的恢复测试通过 <!-- comet-task-ref:fd769f77-948f-498b-a3a4-b9a18d0d19d0 -->

## 7. 会话历史

- 7.1 实现按工作区归组的会话列表、未读/运行中/失败状态，验证状态标记不只依赖颜色的组件测试通过 <!-- comet-task-ref:15055029-1c85-42b5-8cb0-4315601486e5 -->
- 7.2 实现会话搜索与命中跳转，验证标题、消息内容和智能体名称三种命中的集成测试通过 <!-- comet-task-ref:f6edb7b5-e200-4e69-accc-bcc463219c44 -->
- 7.3 实现会话重命名、分叉、归档、恢复和永久删除，验证分叉不改变原会话、归档可恢复、删除二次确认的测试通过 <!-- comet-task-ref:760f9822-96d3-4163-bf38-421e3972e2eb -->
- 7.4 实现已归档会话设置页和批量清理入口，验证恢复与永久删除操作测试通过 <!-- comet-task-ref:9d04034b-7d18-4da2-9ce2-1024ba49f545 -->
- 7.5 更新会话操作文案与快捷键说明，验证文档中的菜单项与实际 UI 一致 <!-- comet-task-ref:7b30b984-490e-4dfe-bc1b-3cc80e0f8030 -->

## 8. 产出物与编辑器

- 8.1 实现运行期工作区监听、忽略规则和产出物索引，验证新增、修改、忽略目录和 `.pizza/artifacts` 场景的测试通过 <!-- comet-task-ref:ab68944b-7d30-4161-85f5-b874103e0bc6 -->
- 8.2 实现产出物文件树、展开状态持久化和状态筛选，验证切换会话后展开状态保持的测试通过 <!-- comet-task-ref:851cf5cc-84e6-4fef-b7e7-58434088af94 -->
- 8.3 实现 Markdown、代码、图片预览和不支持类型的降级展示，验证预览不修改源文件的测试通过 <!-- comet-task-ref:2d7731d8-40dc-4ffd-8221-7a683085e66b -->
- 8.4 实现编辑器偏好、七种编辑器适配和路径不存在提示，验证选择持久化和不可用编辑器指引的测试通过 <!-- comet-task-ref:2b0151a6-5927-4b7b-b2c1-9786487af308 -->
- 8.5 移除产出物面板中重复的打开工作区入口，验证头部编辑器操作是唯一入口的组件测试通过 <!-- comet-task-ref:e5438e1c-01b1-4b69-88b0-0af41a02366f -->

## 9. 集成验收

- 9.1 建立 Playwright Electron 冒烟测试，覆盖创建智能体、创建会话、流式回复、重启恢复和产出物出现，验证 `npm run test:e2e` 通过 <!-- comet-task-ref:6f56b60b-fad7-45fc-ade3-b85cb9ca82fd -->
- 9.2 使用 Claude Code CLI 或可用 ACP 运行时完成一次真实编码任务，验证产出文件出现在右侧面板并记录运行证据 <!-- comet-task-ref:2c9cbd85-b91b-45a7-ade6-f888413461e0 -->
- 9.3 运行 `npm run typecheck`、`npm test`、`npm run build` 和 `npm run test:e2e`，记录全部真实结果 <!-- comet-task-ref:ed576722-244e-4e78-9a8a-13e43204d5f1 -->
- 9.4 更新 `AGENTS.md` 的阶段、工作日志和已知限制，验证文档描述与当前实现一致 <!-- comet-task-ref:9706d8b4-9b83-46ed-b214-37e2bee46782 -->

## Workflow follow-up


## Verification strategy

- 每个任务执行其描述中的单元、集成或组件验证。
- 组 9 运行 `npm run typecheck`、`npm test`、`npm run build` 和 `npm run test:e2e`，并记录真实输出。
- 使用 Claude Code CLI 完成一次真实编码任务，确认产出物出现在右侧面板；若当前环境不可用，记录阻塞原因，不用假数据冒充通过。
- Build 阶段结束时运行当前工作区明确的全量检查，并由 Comet build guard 提交证据。

## Risk handling

- `better-sqlite3` 与 Electron ABI 不匹配时，固定 Electron 版本并记录重建命令；失败时先修复本地原生模块，不绕过测试。
- ACP 或 CLI 输出格式变化时，保留原始事件日志并让解析器失败可见，不静默丢弃。
- 应用崩溃或运行中断时，先落库再推送，启动时标记 `interrupted` 并提供重试。
- 大工作区监听产生噪声时，忽略 `.git`、依赖和构建目录，并限制单次运行索引数量。
- 如果某个任务暴露出范围变化或需要新决策，暂停该任务，按 Comet 阶段规则处理，不擅自扩大范围。
