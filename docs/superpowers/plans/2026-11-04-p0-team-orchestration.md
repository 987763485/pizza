---
change: p0-team-orchestration
design-doc: docs/openspec/changes/p0-team-orchestration/design.md
base-ref: 7c6b93bf0d4d6daaf462ea08e9c262b53149e0b8
archived-with: 2026-11-04-p0-team-orchestration
---

# Implementation Plan: P0 团队编排

## Approach

采用 autonomous 执行方式，按任务组顺序实施，采用 TDD：数据层、提及解析、调度状态机、保护与恢复先写失败测试，再实现到通过；UI 使用组件测试与 Playwright 冒烟验证。每完成一个任务就运行其声明的验证，并在同一个 `tasks.md` 上勾选；本计划不复制 checkbox。

实施顺序先抽出共享执行器并回归单智能体，再叠加团队数据、解析、编排、保护和界面，避免在团队路径上复制第二套运行时生命周期。设计权威为 `docs/openspec/changes/p0-team-orchestration/design.md`，行为权威为同目录 `proposal.md` 与 `specs/`，任务权威为 `tasks.md`。

## Dependencies and constraints

- 组 1 的数据模型是组 2–7 的共同依赖；单智能体数据库必须能无损升级，迁移重复执行保持幂等。
- 组 1 完成后先抽取 `AgentRunExecutor`，以现有 22 个单元/集成测试和 Electron E2E 守护 `RunService` 公共行为不变，再实现团队调度。
- 组 3 的提及解析是主进程和渲染层共享的纯函数，组 4、5、6 都依赖其稳定语法与路由结果。
- 组 4 的回合状态机与队列是组 5 保护、插话、停止和组 6 轨迹展示的前提。
- 组 6 只消费主进程事件与查询结果，不在渲染层推断调度状态。
- 组 7 只做集成验收，不引入新功能；真实运行时验收不可用时如实记录阻塞，不用假数据冒充通过。
- 生产代码全部使用 TypeScript；不复制参考项目代码、品牌或资产；不出现禁止出现的项目名称。
- 所有 Git 提交使用中文与约定前缀，按任务组阶段提交，不积累大批未提交改动。

## Task mapping

<!-- comet-task-authority: docs/openspec/changes/p0-team-orchestration/tasks.md -->

## 1. 团队数据模型

- 1.1 迁移新增团队、成员、提及、回合与回合事件表，验证单智能体数据库无损升级 <!-- comet-task-ref:9e1e9fa5-8187-4b36-a204-0aa701189be5 -->
- 1.2 运行表增加父运行、回合和触发消息外键，验证调用链查询 <!-- comet-task-ref:e2412377-e401-4949-8999-3c5bbc0cdac5 -->
- 1.3 团队、成员、覆盖字段与编排 Prompt 仓储，验证 CRUD 与事务回滚 <!-- comet-task-ref:a9c89e6d-3069-4597-88b3-c7fd14a540c0 -->
- 1.4 团队有效性与引用校验，覆盖重名、空成员、指挥者不在列与循环引用 <!-- comet-task-ref:3d90db28-3f72-4817-9b1f-2cf17efd3b92 -->
- 1.5 记录团队数据模型与迁移说明并与实际 schema 对齐 <!-- comet-task-ref:59c1261f-0657-46c4-ae34-f842b5cdddbb -->

## 2. 团队管理

- 2.1 团队列表、搜索与最近使用排序 <!-- comet-task-ref:38708810-323c-4c10-9b13-d720859f7a76 -->
- 2.2 团队创建/编辑表单、头像生成与上传 <!-- comet-task-ref:a15009c3-c52a-4c99-bbcd-ed9d5fbcb400 -->
- 2.3 指挥者选择与「指挥者必须是成员」校验 <!-- comet-task-ref:7b958585-1eb7-407d-b12e-d48a9c1ca6ff -->
- 2.4 成员添加、排序、移除与重复阻止 <!-- comet-task-ref:56f52fd0-c690-40bc-b607-4183bdaf8af9 -->
- 2.5 成员级 Prompt 替换/追加、恢复继承与最终生效预览 <!-- comet-task-ref:89ea5169-8ece-4f37-9e43-fbe09a492ddb -->
- 2.6 团队编排 Prompt 编辑与最终 Prompt 预览 <!-- comet-task-ref:62a27e68-b842-4281-a4d0-0a78767b849e -->
- 2.7 内置头脑风暴模板与五名角色预填 <!-- comet-task-ref:f014e3ad-8f68-4d51-8c94-770204988099 -->
- 2.8 团队归档、删除影响提示与二次确认，历史会话保留团队信息 <!-- comet-task-ref:f6e35b55-7dd1-4e4b-aa1d-bef0698a11e8 -->

## 3. 提及解析

- 3.1 用户提及 chip 的序列化、反序列化与位置持久化 <!-- comet-task-ref:a9b260d9-3e20-4403-8924-715f3c62e22a -->
- 3.2 智能体精确提及语法解析，纯文本不触发 <!-- comet-task-ref:fb1689d0-fab4-425e-87b0-c4aae43f024e -->
- 3.3 名称解析顺序与重名歧义 <!-- comet-task-ref:900f57b8-f1c4-4904-8059-c246fc3a7c1e -->
- 3.4 未知目标、自引用忽略与重复目标去重 <!-- comet-task-ref:b644d2e5-5704-459d-9260-11ebc6a0fcb1 -->
- 3.5 用户消息路由矩阵 <!-- comet-task-ref:d666f1f0-6bea-473a-a544-b8ee8d20aea5 -->
- 3.6 智能体消息路由矩阵 <!-- comet-task-ref:48a5a82b-9803-492f-85c8-d2aa631c5acd -->
- 3.7 指挥者上下文注入，自上次发言以来的摘要与原文 <!-- comet-task-ref:7cb53048-52f3-47ee-b5ba-0f253f1cc8be -->
- 3.8 提及语法、路由矩阵与歧义处理文档 <!-- comet-task-ref:bb1ab6c5-db70-4fb8-acc9-dd1bebfb6174 -->

## 4. 团队编排

- 4.1 回合创建与状态机，非法转换拒绝 <!-- comet-task-ref:c45062bd-1ee7-4c0c-b76c-a45e5889ebc3 -->
- 4.2 会话级调度队列与同一智能体互斥 <!-- comet-task-ref:8f90f39c-30d2-4427-ba1f-6ab5671b58dd -->
- 4.3 默认并发上限 3 与排队状态 <!-- comet-task-ref:0e896a55-08ea-4f33-a336-95f521f96f4e -->
- 4.4 并行与串行扇出策略 <!-- comet-task-ref:718b54c0-4164-4952-90c9-67de48697d9e -->
- 4.5 成员完成后的指挥者再触发与显式提及优先 <!-- comet-task-ref:84913ef1-49cb-4801-bf13-ce03ecfb1091 -->
- 4.6 回合上下文组装与优先级压缩 <!-- comet-task-ref:9bcb7795-7b54-4446-afce-689c2a6ae2c0 -->
- 4.7 运行失败隔离 <!-- comet-task-ref:c19f5087-8825-4690-bb72-fe716bf93e27 -->
- 4.8 编排状态机与队列规则文档 <!-- comet-task-ref:2e59eb8f-0183-4320-a6de-5dfc93a906d3 -->

## 5. 插话、停止与保护

- 5.1 用户插话队列与排队状态 <!-- comet-task-ref:23df2a0e-ef7a-4893-b821-7cc0d7d5856f -->
- 5.2 立即插话与运行时能力降级 <!-- comet-task-ref:7909f523-8ca4-48b1-b091-c0d7977f8fe8 -->
- 5.3 单个运行停止与本回合全部停止 <!-- comet-task-ref:0067a8c7-186b-4c59-9562-c57f37b57d71 -->
- 5.4 跳数、轮次、超时与 token 预算保护 <!-- comet-task-ref:ebbc38c2-55b0-4183-a0cf-1de7dbd70589 -->
- 5.5 重复调用抑制与 A→B→A 检测 <!-- comet-task-ref:a07ff4ef-1ff0-48b6-ad96-6778755c0cfb -->
- 5.6 保护触发后的指挥者阶段性总结 <!-- comet-task-ref:6f0ca607-2026-4d44-83cf-473bc84a3623 -->
- 5.7 团队回合崩溃恢复 <!-- comet-task-ref:3777c064-ae36-403a-9915-a2cba7a491ed -->

## 6. 团队会话界面

- 6.1 团队会话创建与参与者选择器 <!-- comet-task-ref:eac21339-efc2-4b19-8802-679b67abc499 -->
- 6.2 多参与者消息头、角色标签与连续消息合并 <!-- comet-task-ref:ceb79a02-cf2c-4598-b8fe-d8d79a414d1f -->
- 6.3 回合分隔、进行中参与者与等待用户状态 <!-- comet-task-ref:1670e7bf-bb7e-47a1-8c52-ece4c3d61376 -->
- 6.4 运行状态显示，区分排队、运行、失败、停止、超时与等待用户 <!-- comet-task-ref:b9076753-e657-4534-8689-d96ea8cbbe8d -->
- 6.5 插话状态与目标提示 <!-- comet-task-ref:6a84e810-1d36-4fb0-a6eb-52b72882fa15 -->
- 6.6 对话轨迹页签 <!-- comet-task-ref:dbe83d70-570a-4f49-9416-981e9d5ee038 -->
- 6.7 收敛产出物在会话与右侧面板一致展示 <!-- comet-task-ref:961371c6-c40b-40ce-9bea-f872d17df4ec -->

## 7. 集成验收

- 7.1 五成员头脑风暴集成测试与事件序列 <!-- comet-task-ref:1d1e7664-5026-41c7-af39-7a2b948055ed -->
- 7.2 用户中途消息影响下一轮上下文 <!-- comet-task-ref:509d1955-d970-493f-b5ba-5577ed8ec136 -->
- 7.3 Playwright 团队冒烟测试 <!-- comet-task-ref:9c19ab6e-1106-4ae3-9989-ec5d90c87de2 -->
- 7.4 真实运行时五成员头脑风暴与中途插话验收 <!-- comet-task-ref:c280afca-273b-465c-a332-84ba758aa7cf -->
- 7.5 运行类型检查、单元/集成测试、构建与 E2E 并记录真实结果 <!-- comet-task-ref:970dd458-0b1e-4877-9be4-516dd9a2e381 -->
- 7.6 更新 `AGENTS.md` 阶段、工作日志与已知限制 <!-- comet-task-ref:548306c2-f933-4418-aa0c-071031fb0bb3 -->

## Verification strategy

- 每个任务执行其描述中的单元、集成或组件验证；TDD 任务先确认 RED，再实现并验证 GREEN。
- 执行器抽取后立即运行现有 22 个测试和 Electron E2E，确认单智能体行为未变；团队路径的回归由新增假运行时测试覆盖。
- 组 7 运行 `npm run typecheck`、`npm test`、`npm run build` 和 `npm run test:e2e`，并记录真实输出。
- 真实运行时验收使用本机已注册的 Claude Code CLI 完成五成员头脑风暴和中途插话；若环境不可用，记录阻塞原因，不以假数据代替。
- Build 阶段结束时通过 `comet guard <change> build --apply -- npm run verify` 提交完整检查证据；Verify 阶段由独立 reviewer 复核最终 diff。

## Risk handling

- 执行器抽取导致单智能体回归时，先以现有测试定位差异，保持 `RunService` 公共 API 与队列语义，再继续团队实现。
- 并发与状态竞态：每个会话的状态转换串行化，事务内写回合与事件；事件落库后再推送。
- 无限互 @：跳数、轮次、重复抑制、A→B→A 和 token 预算共同限制；保护触发必须落事件并可解释。
- 上下文膨胀：确定性结构化压缩保留任务、未决问题、决策与产出物路径，原始消息不删除。
- 运行时插话能力差异：P0 统一降级为排队并显示原因，不修改适配器能力声明。
- 崩溃恢复：启动时把未完成运行标记 `interrupted`、非终态回合标记 `interrupted`，保留已完成文本，不自动重放。
- 如果任务暴露范围变化或需要新决策，暂停该任务，按 Comet 阶段规则处理，不擅自扩大范围。
