# Comet Design Handoff

- Change: p0-team-orchestration
- Phase: design
- Mode: compact
- Context hash: c4b73062192ffb481d47226fd3d59a9fae2f74bc7bcb8eaba5857e27af7a1e27

Generated-by: comet-handoff.sh
Task hash policy: task-content-v1. Read tasks.md for live completion; excerpts are design-time context.

OpenSpec remains the canonical capability spec. This handoff is a deterministic, source-traceable context pack, not an agent-authored summary.

## docs/openspec/changes/p0-team-orchestration/proposal.md

- Source: docs/openspec/changes/p0-team-orchestration/proposal.md
- Lines: 1-36
- SHA256: 54d3246b1012776e0f2eb211e7727eafdec3c2ac26ab135773c555fa49e144c4

```md
# Proposal

## Why

单智能体切片只能证明一个人和一个模型的对话闭环，无法证明 Pizza 的核心差异：把问题切开，`@` 给不同角色，让指挥者组织并行、辩论和收敛。没有团队协作，Pizza 仍然只是一个普通聊天客户端。

## What Changes

- 新增智能体团队管理：创建、编辑、复制、归档和删除团队，指定指挥者，添加、排序和移除成员，支持成员级 Prompt/Skill/MCP 覆盖字段和团队级编排 Prompt。
- 新增团队有效性校验：名称唯一、至少一名成员、指挥者必须在成员中、成员不得重复、团队引用不得循环。
- 新增内置「头脑风暴队」模板：主持人、产品经理、架构师、唱反调者、用户研究员，以及对应的指挥者协议。
- 新增 `@` 提及解析与路由：精确提及、用户提及、未知提及、重名歧义、重复目标去重、禁止自我提及，以及成员回复后的指挥者再触发。
- 新增团队回合编排：会话级队列、默认并发上限、并行/串行策略、上下文组装、用户插话、单个/全部停止、跳数/轮次/超时/token 预算和重复调用抑制。
- 新增团队对话界面：多参与者身份、回合分隔、运行状态、等待用户、对话轨迹和收敛后的 Markdown 产出物。
- 本 change 依赖 `p0-solo-vertical-slice`，不包含团队快照、指令来源模式二、`@全体`、自然语言并行声明、Skill/MCP 管理、完整设置和安装包。

## Capabilities

### New Capabilities

- `team-management`: 团队、成员、指挥者、成员级覆盖和团队模板的结构化配置。
- `mention-routing`: `@` 语法解析、目标解析、路由决策、再触发和歧义处理。
- `team-orchestration`: 团队回合的队列、并发、上下文组装、插话、停止、保护阈值和收敛。
- `team-conversation`: 团队会话中的多参与者消息、回合状态、等待用户、轨迹和汇总产出物。

### Modified Capabilities

无。团队能力在本 change 首次引入。

## Impact

- 在现有 SQLite 数据层新增 `team`、`team_member`、成员覆盖、消息提及和团队回合相关记录。
- 在运行时适配层之上新增编排器，复用单智能体切片的消息、运行和事件通道。
- 新增团队管理、团队会话、对话轨迹和产出物展示界面。
- 新增多智能体并发调度与成本保护逻辑；错误必须可追踪到具体参与者、运行和回合。
- 参考项目仅用于行为研究，不复制代码或品牌资产。

```

## docs/openspec/changes/p0-team-orchestration/design.md

- Source: docs/openspec/changes/p0-team-orchestration/design.md
- Lines: 1-144
- SHA256: e5f58c4fb7204f30168061e0e105207ae192244a9153884f0203a12156ef6abb

[TRUNCATED]

```md
# Design

## Context

本 change 建立在 `p0-solo-vertical-slice` 已交付的 Electron 主进程、SQLite 数据层、运行时适配器、IPC 和会话 UI 之上。单智能体切片已经解决消息持久化、流式事件、停止/重试和产出物索引；团队编排必须复用这些基础，而不是新增第二套消息或运行时通道。

团队模式新增的核心是调度：一条用户消息可能触发多个运行，成员回复又可能触发指挥者或其他成员。调度状态必须可恢复、可审计，并且能在用户插话或停止时安全收敛。

## Goals / Non-Goals

**Goals:**

- 在现有会话模型上增加团队、成员、提及和回合概念，不破坏单智能体数据。
- 让 `@` 解析与调度成为独立、可测试的纯逻辑层。
- 让并发、插话、停止和收敛在应用重启后仍可解释。
- 用统一的运行事件模型驱动团队对话和对话轨迹，避免 UI 自己推断状态。

**Non-Goals:**

- 团队快照、从快照恢复、动态指令来源模式二、`@全体`、自然语言并行/串行声明。
- Skill/MCP 的实际注入与审批；成员覆盖字段只保留结构，能力管理由后续变更实现。
- 跨团队自动编排、云端协作、移动端。
- 所有运行时的运行中追加能力；不支持的运行时统一降级为排队。

## Decisions

### 1. 编排器位于主进程

新增 `TeamOrchestrator`，作为主进程服务运行，持有每个团队会话的队列、回合状态、并发计数器和取消令牌。渲染层只发送用户消息、插话和停止命令，并订阅标准化事件。

理由：调度必须在窗口刷新、页面切换和渲染层崩溃时继续；主进程已经是运行时进程和数据库的唯一管理者。把编排放进 renderer 会让后台运行依赖窗口生命周期。

备选方案：

- 渲染层编排：实现快，但窗口关闭或刷新会丢失调度状态。
- 独立本地服务进程：隔离性更好，但会重复 IPC 和进程监督，首个团队版本不划算。

### 2. 数据模型扩展

在现有表上新增：

- `team`：名称、描述、头像、指挥者、团队编排 Prompt、默认扇出策略、最大轮次、token 预算、归档状态。
- `team_member`：团队、智能体、排序、角色描述、私有成员标记、Prompt 覆盖模式与内容。
- `message_mention`：消息、目标类型、目标智能体、显示名称、位置、精确语法原文。
- `team_turn`：会话、回合序号、状态、开始/结束时间、触发消息、收敛原因。
- `team_turn_event`：回合、序号、事件类型、参与者、运行、负载 JSON。
- `run` 增加 `parent_run_id`、`team_turn_id`、`trigger_message_id`，用于追踪调用链。

成员级 Skill/MCP 覆盖以结构化 JSON 字段保留，但本 change 不执行实际注入；后续能力变更可以在不迁移表结构的情况下启用。

理由：回合和事件是审计、恢复和 UI 轨迹的共同事实来源。把调度状态只放在内存会导致崩溃后无法解释。

### 3. 提及解析为纯函数

实现 `parseMentions(content, context)`，输入消息内容和团队/会话上下文，输出目标列表、歧义列表、未知列表和规范化后的展示内容。

解析规则：

- 用户消息使用 chip 序列化后的稳定标识。
- 智能体消息优先识别 `[@名称](mention://agent/<id>)`；纯文本 `@名称` 不参与调度。
- 解析顺序为会话精确名称、团队内名称、全局唯一名称。
- 重名且无稳定标识时不猜测，返回歧义。
- 同一目标去重；自身提及忽略并记录审计。

理由：路由错误是多智能体系统最难排查的问题。纯函数可以用表驱动测试覆盖全部路由矩阵，不依赖 UI 或运行时。

### 4. 调度器采用事件驱动队列

每个团队回合创建一个调度队列，元素包含目标智能体、触发消息、父运行、上下文快照和优先级。调度器维护：

- 会话级最大并发数，默认 3。
- 每个智能体同时最多一个运行。
- 并行模式同时启动多个目标；串行模式按提及顺序启动，后一个等待前一个完成并取得其结果。
- 成员完成且没有显式提及其他目标时，向指挥者投递再触发事件；显式提及其他目标时只调度这些目标。
- 指挥者自己的发言不触发自身。

状态机：`dispatching → debating → converging → completed`。等待用户时回合保持未完成，用户回复后恢复。

理由：事件驱动队列可以在停止、失败和插话时精确取消单个运行，而不是取消整个回合。


```

Full source: docs/openspec/changes/p0-team-orchestration/design.md

## docs/openspec/changes/p0-team-orchestration/tasks.md

- Source: docs/openspec/changes/p0-team-orchestration/tasks.md
- Lines: 1-76
- SHA256: f0cbf867c97530419df8018bb0a75a4badd52ab8afbf2e24a7b74ba5a9fe32ac

```md
# Tasks

## 1. 团队数据模型

- [ ] 1.1 新增 `team`、`team_member`、`message_mention`、`team_turn`、`team_turn_event` 表与迁移，验证单智能体数据库可无损升级 <!-- comet-task:9e1e9fa5-8187-4b36-a204-0aa701189be5 -->
- [ ] 1.2 给 `run` 增加父运行、回合和触发消息外键，验证运行调用链查询测试通过 <!-- comet-task:e2412377-e401-4949-8999-3c5bbc0cdac5 -->
- [ ] 1.3 实现团队、成员、覆盖字段和编排 Prompt 的仓储，验证 CRUD 与事务回滚测试通过 <!-- comet-task:a9c89e6d-3069-4597-88b3-c7fd14a540c0 -->
- [ ] 1.4 实现团队有效性校验和引用检查，验证重名、空成员、指挥者不在列和循环引用测试通过 <!-- comet-task:3d90db28-3f72-4817-9b1f-2cf17efd3b92 -->
- [ ] 1.5 记录团队数据模型与迁移说明，验证文档中的表名和字段与实际迁移一致 <!-- comet-task:59c1261f-0657-46c4-ae34-f842b5cdddbb -->

## 2. 团队管理

- [ ] 2.1 实现团队列表、搜索和最近使用排序，验证团队列表渲染与搜索测试通过 <!-- comet-task:38708810-323c-4c10-9b13-d720859f7a76 -->
- [ ] 2.2 实现团队创建/编辑表单、头像生成与上传，验证名称唯一和头像限制测试通过 <!-- comet-task:a15009c3-c52a-4c99-bbcd-ed9d5fbcb400 -->
- [ ] 2.3 实现指挥者选择与「指挥者必须是成员」校验，验证更换指挥者即时生效的测试通过 <!-- comet-task:7b958585-1eb7-407d-b12e-d48a9c1ca6ff -->
- [ ] 2.4 实现成员添加、排序、移除和重复阻止，验证至少保留指挥者的测试通过 <!-- comet-task:56f52fd0-c690-40bc-b607-4183bdaf8af9 -->
- [ ] 2.5 实现成员级 Prompt 替换/追加、恢复继承和最终生效预览，验证覆盖与继承测试通过 <!-- comet-task:89ea5169-8ece-4f37-9e43-fbe09a492ddb -->
- [ ] 2.6 实现团队编排 Prompt 编辑与最终 Prompt 预览，验证两者分离展示的组件测试通过 <!-- comet-task:62a27e68-b842-4281-a4d0-0a78767b849e -->
- [ ] 2.7 实现内置头脑风暴模板和五名角色预填，验证从模板创建后可编辑的测试通过 <!-- comet-task:f014e3ad-8f68-4d51-8c94-770204988099 -->
- [ ] 2.8 实现团队归档、删除影响提示和二次确认，验证历史会话仍显示团队信息的测试通过 <!-- comet-task:f6e35b55-7dd1-4e4b-aa1d-bef0698a11e8 -->

## 3. 提及解析

- [ ] 3.1 实现用户提及 chip 的序列化与反序列化，验证目标标识、名称和位置持久化测试通过 <!-- comet-task:a9b260d9-3e20-4403-8924-715f3c62e22a -->
- [ ] 3.2 实现智能体精确提及语法解析，验证合法链接触发目标、纯文本不触发的测试通过 <!-- comet-task:fb1689d0-fab4-425e-87b0-c4aae43f024e -->
- [ ] 3.3 实现名称解析顺序和重名歧义，验证会话名、团队名、全局名和歧义场景的表驱动测试通过 <!-- comet-task:900f57b8-f1c4-4904-8059-c246fc3a7c1e -->
- [ ] 3.4 实现未知目标、自引用忽略和重复目标去重，验证系统提示与审计记录测试通过 <!-- comet-task:b644d2e5-5704-459d-9260-11ebc6a0fcb1 -->
- [ ] 3.5 实现用户消息路由矩阵，验证无提及、单目标、多目标、直接提及成员时抄送指挥者的测试通过 <!-- comet-task:d666f1f0-6bea-473a-a544-b8ee8d20aea5 -->
- [ ] 3.6 实现智能体消息路由矩阵，验证成员回复返回调用者、提及用户进入等待、再触发规则测试通过 <!-- comet-task:48a5a82b-9803-492f-85c8-d2aa631c5acd -->
- [ ] 3.7 实现指挥者上下文注入，验证自上次发言以来的成员摘要和原文可见的测试通过 <!-- comet-task:7cb53048-52f3-47ee-b5ba-0f253f1cc8be -->
- [ ] 3.8 记录提及语法、路由矩阵和歧义处理文档，验证文档示例可被解析器测试复用 <!-- comet-task:bb1ab6c5-db70-4fb8-acc9-dd1bebfb6174 -->

## 4. 团队编排

- [ ] 4.1 实现团队回合创建和 `dispatching → debating → converging → completed` 状态机，验证非法转换被拒绝的测试通过 <!-- comet-task:c45062bd-1ee7-4c0c-b76c-a45e5889ebc3 -->
- [ ] 4.2 实现会话级调度队列和同一智能体互斥，验证重复入队只执行一次的测试通过 <!-- comet-task:8f90f39c-30d2-4427-ba1f-6ab5671b58dd -->
- [ ] 4.3 实现默认并发上限 3 和排队状态，验证五目标请求最多三个并行的测试通过 <!-- comet-task:0e896a55-08ea-4f33-a336-95f521f96f4e -->
- [ ] 4.4 实现并行与串行扇出策略，验证串行时后一个成员能读取前一个结果的测试通过 <!-- comet-task:718b54c0-4164-4952-90c9-67de48697d9e -->
- [ ] 4.5 实现成员完成后的指挥者再触发和显式提及优先规则，验证重复再触发被去重的测试通过 <!-- comet-task:84913ef1-49cb-4801-bf13-ce03ecfb1091 -->
- [ ] 4.6 实现回合上下文组装与优先级压缩，验证超出阈值时保留任务、未决问题和产出物路径的测试通过 <!-- comet-task:9bcb7795-7b54-4446-afce-689c2a6ae2c0 -->
- [ ] 4.7 实现运行失败隔离，验证单个成员失败不影响其他成员和指挥者的测试通过 <!-- comet-task:c19f5087-8825-4690-bb72-fe716bf93e27 -->
- [ ] 4.8 记录编排状态机与队列规则，验证文档中的状态名与实现一致 <!-- comet-task:2e59eb8f-0183-4320-a6de-5dfc93a906d3 -->

## 5. 插话、停止与保护

- [ ] 5.1 实现用户插话队列和排队状态，验证运行结束后送达指定目标的测试通过 <!-- comet-task:23df2a0e-ef7a-4893-b821-7cc0d7d5856f -->
- [ ] 5.2 实现立即插话与运行时能力降级，验证不支持追加时转为排队并提示的测试通过 <!-- comet-task:7909f523-8ca4-48b1-b091-c0d7977f8fe8 -->
- [ ] 5.3 实现单个运行停止和本回合全部停止，验证只取消目标运行且保留已产生内容的测试通过 <!-- comet-task:0067a8c7-186b-4c59-9562-c57f37b57d71 -->
- [ ] 5.4 实现跳数、轮次、超时和 token 预算保护，验证各阈值触发系统事件与收敛的测试通过 <!-- comet-task:ebbc38c2-55b0-4183-a0cf-1de7dbd70589 -->
- [ ] 5.5 实现重复调用抑制和 A→B→A 检测，验证相似调用被抑制并记录原因的测试通过 <!-- comet-task:a07ff4ef-1ff0-48b6-ad96-6778755c0cfb -->
- [ ] 5.6 实现保护触发后的指挥者阶段性总结，验证达到跳数或预算时仍产出结构化总结的测试通过 <!-- comet-task:6f0ca607-2026-4d44-83cf-473bc84a3623 -->
- [ ] 5.7 实现团队回合崩溃恢复，验证重启后未完成运行标记中断且已完成结果保留的测试通过 <!-- comet-task:3777c064-ae36-403a-9915-a2cba7a491ed -->

## 6. 团队会话界面

- [ ] 6.1 实现团队会话创建和参与者选择器，验证选择团队进入团队模式并显示指挥者的测试通过 <!-- comet-task:eac21339-efc2-4b19-8802-679b67abc499 -->
- [ ] 6.2 实现多参与者消息头、角色标签和连续消息合并，验证五名成员身份可辨认的组件测试通过 <!-- comet-task:ceb79a02-cf2c-4598-b8fe-d8d79a414d1f -->
- [ ] 6.3 实现回合分隔、进行中参与者和等待用户状态，验证长会话中回合边界清晰的测试通过 <!-- comet-task:1670e7bf-bb7e-47a1-8c52-ece4c3d61376 -->
- [ ] 6.4 实现运行状态显示，验证排队、运行、失败、停止、超时和等待用户不被「正在输入」掩盖的组件测试通过 <!-- comet-task:b9076753-e657-4534-8689-d96ea8cbbe8d -->
- [ ] 6.5 实现插话状态与目标提示，验证只送达成员、送达指挥者和排队状态变化的测试通过 <!-- comet-task:6a84e810-1d36-4fb0-a6eb-52b72882fa15 -->
- [ ] 6.6 实现对话轨迹页签，验证参与者、调度、辩论、插话、停止和收敛事件同步更新的测试通过 <!-- comet-task:dbe83d70-570a-4f49-9416-981e9d5ee038 -->
- [ ] 6.7 实现收敛产出物在会话内和右侧面板的一致展示，验证写入失败时保留会话文本的测试通过 <!-- comet-task:961371c6-c40b-40ce-9bea-f872d17df4ec -->

## 7. 集成验收

- [ ] 7.1 使用假运行时完成五成员头脑风暴集成测试，验证分派、并行、辩论和收敛事件序列正确 <!-- comet-task:1d1e7664-5026-41c7-af39-7a2b948055ed -->
- [ ] 7.2 在集成测试中插入用户中途消息，验证下一轮上下文包含该约束且只送达指定目标 <!-- comet-task:509d1955-d970-493f-b5ba-5577ed8ec136 -->
- [ ] 7.3 建立 Playwright 团队冒烟测试，覆盖创建团队、发送任务、等待收敛和打开产出物，验证 `npm run test:e2e` 通过 <!-- comet-task:9c19ab6e-1106-4ae3-9989-ec5d90c87de2 -->
- [ ] 7.4 使用真实运行时完成一次五成员头脑风暴和一次中途插话，记录运行证据与产出物 <!-- comet-task:c280afca-273b-465c-a332-84ba758aa7cf -->
- [ ] 7.5 运行 `npm run typecheck`、`npm test`、`npm run build` 和 `npm run test:e2e`，记录全部真实结果 <!-- comet-task:970dd458-0b1e-4877-9be4-516dd9a2e381 -->
- [ ] 7.6 更新 `AGENTS.md` 的阶段、工作日志和团队协作已知限制，验证文档与实现一致 <!-- comet-task:548306c2-f933-4418-aa0c-071031fb0bb3 -->

## Workflow follow-up

- 在用户确认 Open 产物后进入 Design，确认正式技术设计后开始 Build。
- Verify 通过后归档本 change，并继续批量清单中的下一个拆分项。

```

## docs/openspec/changes/p0-team-orchestration/.openspec.yaml

- Source: docs/openspec/changes/p0-team-orchestration/.openspec.yaml
- Lines: 1-2
- SHA256: b6d27c089c6ee9596ce0433bd8f7f771b477758efe1ce7f7a7505af47316ecd0

```md
schema: spec-driven
created: 2026-11-03

```

## docs/openspec/changes/p0-team-orchestration/specs/mention-routing/spec.md

- Source: docs/openspec/changes/p0-team-orchestration/specs/mention-routing/spec.md
- Lines: 1-151
- SHA256: 56767d342bc1e0dea43e5c3fb81fec7ca24dc7ba8ceb547fd691d8247c52db1d

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义团队会话中 `@` 提及的解析与路由规则，确保跨智能体分派可追踪、可去重、可打断，并且不会因重名或未知目标产生错误调度。

## ADDED Requirements

### Requirement: 用户提及输入

本要求为强制要求（MUST）。

用户在团队会话输入 `@` 时必须看到分组选择器，至少包含指挥者、团队成员和我。选择后必须插入可识别的提及 chip，并保存目标标识、显示名称和位置。

#### Scenario: 选择团队成员

- **WHEN** 用户在输入框中输入 `@` 并从选择器选择一名成员
- **THEN** 输入框出现带该成员头像和名称的提及 chip
- **AND** 消息发送时保存该成员的稳定标识

#### Scenario: 选择我

- **WHEN** 用户从提及选择器选择「我」
- **THEN** 插入指向当前用户的提及
- **AND** 该提及不会触发任何智能体运行

### Requirement: 智能体精确提及语法

本要求为强制要求（MUST）。

智能体输出中的跨智能体分派必须使用精确提及语法 `[@名称](mention://agent/<id>)`。系统必须解析该语法并路由到对应成员；纯文本 `@名称` 不得触发智能体调度。

#### Scenario: 精确提及触发调度

- **WHEN** 指挥者输出 `[@架构师](mention://agent/agent-123)`
- **THEN** 编排器向 `agent-123` 创建一次运行
- **AND** 消息中保留可点击的提及 chip

#### Scenario: 纯文本提及不调度

- **WHEN** 智能体输出纯文本 `@架构师` 而没有精确提及链接
- **THEN** 文本保持原样显示
- **AND** 不创建新的智能体运行

### Requirement: 目标解析顺序

本要求为强制要求（MUST）。

提及目标必须按「本会话精确名称 → 本团队内名称 → 全局唯一名称」的顺序解析。重名且无法唯一确定时不得猜测，必须插入系统提示说明提及不明确。未知目标必须保留原文并显示「未找到该智能体」。

#### Scenario: 团队内重名

- **WHEN** 两个团队成员具有相同显示名称且没有稳定标识
- **THEN** 系统不调度任何成员
- **AND** 插入要求使用稳定标识的系统提示

#### Scenario: 未知目标

- **WHEN** 消息提及一个不在当前团队中的名称
- **THEN** 原文保持可见
- **AND** 消息旁显示未找到该智能体的提示

### Requirement: 用户消息路由

本要求为强制要求（MUST）。

用户消息未提及时必须默认路由给指挥者。用户直接提及一个或多个成员时，必须分别调度每个目标；同一条消息重复提及同一目标只调度一次，并向指挥者发送被动通知而不自动运行指挥者。

#### Scenario: 未提及时默认路由

- **WHEN** 用户在团队会话中发送一条没有提及的消息
- **THEN** 指挥者获得一次运行
- **AND** 其他成员不被调度

#### Scenario: 多个成员提及

- **WHEN** 用户在同一条消息中提及成员 A 和成员 B
- **THEN** A 和 B 各获得一次运行
- **AND** 同一条消息中重复提及 A 不会产生第二次运行


```

Full source: docs/openspec/changes/p0-team-orchestration/specs/mention-routing/spec.md

## docs/openspec/changes/p0-team-orchestration/specs/team-conversation/spec.md

- Source: docs/openspec/changes/p0-team-orchestration/specs/team-conversation/spec.md
- Lines: 1-115
- SHA256: 095611db67e0036c7b561fe33abe812bb835e8adeadc769f37754c0ac026669e

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义团队会话中如何呈现多参与者消息、回合边界、等待状态、对话轨迹和收敛产出物，让用户能够理解谁在做什么、为什么停住，以及最终结果是什么。

## ADDED Requirements

### Requirement: 多参与者消息身份

本要求为强制要求（MUST）。

团队会话必须为每条智能体消息显示头像、名称、指挥者或成员标签和运行状态。同一智能体连续消息可以合并头部，但不同参与者之间必须可快速辨认；五个智能体同时发言时不得混淆身份。

#### Scenario: 五名成员同时发言

- **WHEN** 一个团队回合中五名成员先后产生消息
- **THEN** 每条消息都能看到对应参与者的头像和名称
- **AND** 指挥者与普通成员具有不同的角色标签

#### Scenario: 连续消息合并头部

- **WHEN** 同一智能体连续发送两条消息且中间没有其他参与者
- **THEN** 第二条消息可以合并头部显示
- **AND** 消息内容和状态仍分别可见

### Requirement: 回合分隔

本要求为强制要求（MUST）。

团队会话必须在回合开始时显示「第 N 轮」，在成员处理时显示当前参与者，在等待用户时显示「等待你回复」。回合分隔必须弱化显示，不得抢占消息内容的主视觉。

#### Scenario: 新回合开始

- **WHEN** 用户发送一条团队消息并触发新回合
- **THEN** 消息流中插入第 N 轮分隔
- **AND** 分隔中显示即将处理的参与者或默认指挥者

#### Scenario: 等待用户

- **WHEN** 智能体精确提及用户并暂停回合
- **THEN** 消息流显示醒目的等待用户状态
- **AND** 输入框提示当前回合正在等待用户回复

### Requirement: 运行状态真实呈现

本要求为强制要求（MUST）。

每条运行必须显示排队、启动中、运行中、等待审批、完成、失败、已停止或超时状态。界面不得用「正在输入」掩盖失败、等待审批或等待用户。

#### Scenario: 成员运行失败

- **WHEN** 一名成员运行以错误结束
- **THEN** 该消息显示失败状态和错误摘要
- **AND** 不使用运行中动画掩盖失败

#### Scenario: 等待用户

- **WHEN** 团队回合因提及用户而暂停
- **THEN** 相关运行显示等待用户
- **AND** 用户可以继续输入回复

### Requirement: 用户插话状态

本要求为强制要求（MUST）。

用户在团队运行中发送的消息必须显示其投递状态：已排队、已插话或已发送。用户直接提及某成员时，状态必须说明该消息只送达该成员；未提及时说明送达指挥者。

#### Scenario: 插话只送达成员

- **WHEN** 用户在运行中提及成员 A 并发送消息
- **THEN** 消息显示送达成员 A
- **AND** 其他成员不收到该消息

#### Scenario: 排队状态更新

- **WHEN** 一条排队消息在运行结束后被送达
- **THEN** 其状态从已排队变为已发送
- **AND** 消息流中保留状态变化记录


```

Full source: docs/openspec/changes/p0-team-orchestration/specs/team-conversation/spec.md

## docs/openspec/changes/p0-team-orchestration/specs/team-management/spec.md

- Source: docs/openspec/changes/p0-team-orchestration/specs/team-management/spec.md
- Lines: 1-139
- SHA256: 063dba6edb0cbaf45f7f5426f9610c3b56618c7d9c0e25e3e35179967463fc6e

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义用户如何创建和维护智能体团队，包括指挥者、成员、成员级覆盖、团队编排 Prompt 与内置模板，并保证团队配置在进入会话前是有效且可解释的。

## ADDED Requirements

### Requirement: 团队列表与搜索

本要求为强制要求（MUST）。

设置中的团队列表必须展示团队头像、名称、描述、成员数、指挥者和最近使用时间，并支持按名称或描述搜索。团队列表必须按最近使用优先排序。

#### Scenario: 搜索团队

- **WHEN** 用户在团队搜索框输入名称片段
- **THEN** 列表只显示名称或描述匹配的团队
- **AND** 清空搜索后恢复按最近使用排序的完整列表

### Requirement: 创建与编辑团队

本要求为强制要求（MUST）。

用户必须能够创建和编辑团队，填写唯一名称、描述和头像。保存前必须校验名称唯一性；团队头像支持默认生成、上传和预设。

#### Scenario: 名称重复

- **WHEN** 用户输入已存在的团队名称并保存
- **THEN** 名称字段显示重复错误
- **AND** 团队配置不被保存

#### Scenario: 默认团队头像

- **WHEN** 用户创建一个没有上传头像的团队
- **THEN** 系统生成基于团队成员头像的默认头像
- **AND** 成员变化后该默认头像可以刷新

### Requirement: 指挥者必须是团队成员

本要求为强制要求（MUST）。

团队必须指定一名指挥者，且指挥者必须属于团队成员。更换指挥者必须立即生效；未指定指挥者或指挥者不在成员列表时不得保存。

#### Scenario: 选择非成员作为指挥者

- **WHEN** 用户选择一个不在成员列表中的智能体作为指挥者
- **THEN** 表单阻止保存并说明指挥者必须先是成员
- **AND** 用户可以先添加该智能体为成员

#### Scenario: 更换指挥者

- **WHEN** 用户把指挥者从成员 A 改为成员 B 并保存
- **THEN** 团队记录的指挥者立即更新为 B
- **AND** 后续新建团队会话默认路由给 B

### Requirement: 成员添加与排序

本要求为强制要求（MUST）。

用户必须能够从智能体库添加成员、调整成员顺序和移除成员。重复添加必须被阻止；团队必须至少保留指挥者，移除指挥者前必须先更换指挥者。

#### Scenario: 添加重复成员

- **WHEN** 用户尝试添加一个已在团队中的智能体
- **THEN** 该智能体在候选列表中被禁用或提示已添加
- **AND** 团队成员列表不出现重复项

#### Scenario: 移除最后一名成员

- **WHEN** 用户尝试移除团队唯一成员且该成员是指挥者
- **THEN** 应用阻止移除并提示先更换指挥者
- **AND** 团队成员列表保持不变

### Requirement: 成员级 Prompt 覆盖

本要求为强制要求（MUST）。

团队成员必须支持替换或追加 Prompt 覆盖。覆盖项必须在成员卡片上可见，并可一键恢复继承智能体自身配置。最终生效 Prompt 必须可预览。


```

Full source: docs/openspec/changes/p0-team-orchestration/specs/team-management/spec.md

## docs/openspec/changes/p0-team-orchestration/specs/team-orchestration/spec.md

- Source: docs/openspec/changes/p0-team-orchestration/specs/team-orchestration/spec.md
- Lines: 1-163
- SHA256: 3f86b6064974ecd2e63ecb6a181e43b4faa17f1e81061a8c9e84d0dd789743f0

[TRUNCATED]

```md
# Spec Delta

## Purpose

定义团队回合如何排队、并发、等待、介入和收敛，并通过可配置的保护阈值避免无限互 @、重复调用和成本失控。

## ADDED Requirements

### Requirement: 团队回合队列

本要求为强制要求（MUST）。

每个团队会话必须维护独立的调度队列。同一智能体同一时刻只能处理一个运行；同一会话的多个运行必须按队列和并发上限调度，不得因 UI 操作重复入队。

#### Scenario: 同一智能体重复入队

- **WHEN** 同一智能体在已有运行未结束时再次被提及
- **THEN** 新任务进入队列而不并行启动
- **AND** 当前运行结束后只处理一次新任务

### Requirement: 并发上限

本要求为强制要求（MUST）。

团队会话默认最大并发运行数为 3，并允许在团队配置范围内调整。达到上限时，新运行必须排队并显示排队状态，不得静默丢弃。

#### Scenario: 五个成员同时被提及

- **WHEN** 指挥者一次性精确提及五名成员
- **THEN** 最多三个运行同时开始，其余两个排队
- **AND** 界面显示每个成员的运行或排队状态

### Requirement: 并行与串行策略

本要求为强制要求（MUST）。

团队必须支持并行和串行两种扇出策略。并行时多个成员同时开始；串行时按提及顺序执行，后一个成员必须能看到前一个成员的结果。P0 使用团队配置的默认策略，不解析自然语言指令。

#### Scenario: 并行扇出

- **WHEN** 团队默认策略为并行且指挥者提及三名成员
- **THEN** 三名成员可以同时开始运行
- **AND** 结果分别返回指挥者

#### Scenario: 串行扇出

- **WHEN** 团队默认策略为串行且指挥者按顺序提及三名成员
- **THEN** 成员按提及顺序依次运行
- **AND** 后一个成员上下文包含前一个成员的结果

### Requirement: 用户插话

本要求为强制要求（MUST）。

团队运行中用户必须能够发送消息，输入框不得被阻塞。会话级插话模式为「排队」时，消息在当前运行结束后送达；为「立即插话」且运行时支持追加输入时，消息注入当前运行并标记为已插话，否则降级为排队并明确提示。

#### Scenario: 排队插话

- **WHEN** 团队运行中用户发送一条消息且会话为排队模式
- **THEN** 消息显示为已排队
- **AND** 当前运行结束后该消息送达指定目标

#### Scenario: 立即插话降级

- **WHEN** 用户选择立即插话但运行时不支持追加输入
- **THEN** 消息转为排队并显示降级提示
- **AND** 不中断当前运行

### Requirement: 停止运行

本要求为强制要求（MUST）。

用户必须能够停止单个运行或本回合全部运行。停止后两秒内界面必须显示已停止状态，保留已产生内容，并插入说明停止目标的系统事件。其他未停止运行不得被误取消。

#### Scenario: 停止单个成员

- **WHEN** 用户在多名成员运行时停止其中一名成员
- **THEN** 只有该成员的运行被取消
- **AND** 其他成员继续运行


```

Full source: docs/openspec/changes/p0-team-orchestration/specs/team-orchestration/spec.md
