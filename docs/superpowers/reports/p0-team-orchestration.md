# 验证报告：p0-team-orchestration

- 日期：2026-11-04
- Change：`p0-team-orchestration`
- 阶段：Verify（standard 审查深度）
- 任务：49/49 完成
- 需求/场景：32 个 Requirement，58 个 Scenario（4 份 delta specs）

## 1. 自动化检查

全部命令在当前工作区真实执行，结果以实际输出为准。

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `npm run typecheck` | 通过 |
| 单元/集成测试 | `npm test` | 11 个测试文件、71 个测试全部通过 |
| 生产构建 | `npm run build` | main、preload、renderer 均构建成功 |
| Electron E2E | `npm run test:e2e` | 2 通过、1 按设计跳过（真实运行时需显式开启） |
| Build Guard | `comet guard p0-team-orchestration build --apply -- npm run verify` | `ALL CHECKS PASSED — phase=verify` |
| 真实运行时（首次） | `PIZZA_REAL_E2E=1 npx playwright test tests/e2e/team-real.spec.ts` | 通过；五名角色、多轮收敛、中途插话、`team-turn-1.md`（5,407 字节） |
| 真实运行时（审查修复后重跑） | 同一命令 | 超时 600 秒；数据库显示指挥者运行未完成，无代码错误事件。真实模型/工具执行不稳定，未作为代码回归证据 |

补充说明：

- `npm test` 覆盖迁移升级、团队仓储与事务、团队校验、提及解析与路由矩阵、团队状态机、保护规则、上下文压缩、调度器并发/串行/插话/停止/失败隔离、非成员目标忽略与团队重试。
- `tests/e2e/team.spec.ts` 覆盖模板创建、团队搜索（名称与描述）、团队保存、首页选择团队、分派、回合分隔、三名智能体消息、轨迹页签、收敛产出物、等待用户后继续当前回合。
- 真实运行时验收使用本机 Claude Code CLI 2.1.318；真实测试默认跳过，避免日常检查产生模型费用。
- `node:sqlite` 的 ExperimentalWarning 是 Node 22 的预期提示，不是失败。

## 2. 规格覆盖

### 2.1 mention-routing（8 Requirement / 16 Scenario）

| 需求组 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 用户提及输入 | `src/shared/mentions.ts`；`Composer.tsx` contentEditable chip 与分组选择器 | `tests/shared/mentions.test.ts`；团队 E2E |
| 智能体精确提及 | `parseMentions(..., 'agent')` 仅识别链接 | 解析器测试；真实运行中指挥者链接成功分派 |
| 解析顺序与歧义 | 会话 → 团队 → 全局；重名返回 ambiguous | 表驱动测试 |
| 用户/智能体路由 | `routeUserMessage` / `routeAgentMessage` | 路由矩阵测试；调度器集成测试 |
| 自我提及 | `selfMentions` + `mention_ignored` 事件 | 解析器与调度器测试 |
| 再触发 | 成员返回调用者、显式提及优先、指挥者结束 | 调度器测试与团队 E2E |
| 上下文组装 | `team-context-builder.ts`；指挥者摘要与确定性压缩 | `team-context.test.ts` |

### 2.2 team-orchestration（9 Requirement / 17 Scenario）

| 需求组 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 回合队列/互斥 | `TeamOrchestrator` 队列 + active 去重 | 调度器测试；重复目标 `notice` |
| 并发上限 | 团队与全局并发取小值 | 五目标并发测试 `maxActive ≤ 3` |
| 并行/串行 | `fanoutStrategy`；串行前序结果注入 | 调度器测试 |
| 用户插话 | `queuedUser` + `user_interjection`；等待态回复继续回合 | 调度器测试；团队 E2E；真实运行插话 |
| 停止 | `stopRun` / `stopTurn`，保留文本 | 调度器测试 |
| 循环与成本保护 | `team-protections.ts`；跳数/轮次/超时/重复/A-B-A/token | 规则测试；真实运行触发跳数保护后收敛 |
| 指挥者协议 | `buildTeamRunContext` 系统协议 + 模板编排 Prompt | 上下文测试；真实运行 |
| 收敛与总结 | `finishTurn` 写 `.pizza/artifacts/team-turn-<seq>.md` | 调度器测试；团队 E2E；真实运行 |
| 异常与恢复 | 成员失败隔离；`markInterruptedRuns` 标记回合 `interrupted` | 调度器失败隔离测试；仓储恢复测试 |

### 2.3 team-conversation（6 Requirement / 12 Scenario）

| 需求组 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 多参与者身份 | `MessageList` 按 `senderAgentId` 解析参与者；角色标签；连续消息合并 | 团队 E2E 断言三条智能体消息 |
| 回合分隔 | `turn-divider` 显示「第 N 轮」与状态 | 团队 E2E |
| 运行状态 | 排队/运行/失败/停止/超时状态；超时文案 | 组件逻辑与 E2E |
| 插话状态 | 用户消息显示已排队/已发送与送达目标；插话按钮降级提示 | 团队 E2E；代码审查 |
| 对话轨迹 | `ArtifactPanel` 读取 `teamTurnEvents` | 团队 E2E 断言「分派给」「回合完成」 |
| 收敛产出物 | 会话内消息、右侧文件树、预览一致 | 团队 E2E；真实运行产出物 |

### 2.4 team-management（9 Requirement / 13 Scenario）

| 需求组 | 实现证据 | 验证证据 |
| --- | --- | --- |
| 列表与搜索 | `TeamSettings`；名称与描述搜索；最近使用排序 | 团队 E2E（名称、描述） |
| 创建与编辑 | `TeamEditor`；名称唯一；头像上传/默认/成员预设 | `team-service.test.ts`；E2E 保存 |
| 指挥者校验 | 服务与 UI 均要求指挥者在成员中 | `team-service.test.ts` |
| 成员添加/排序/移除 | 成员卡片上下移动、候选过滤、指挥者不可移除 | UI 实现与 E2E |
| Prompt 覆盖 | inherit/append/replace、恢复继承、最终生效预览 | `team-service.test.ts`；编辑器预览 |
| 团队编排 Prompt | 独立编辑与最终生效预览 | `TeamEditor` 指令页 |
| 有效性校验 | 名称、空成员、指挥者、重复、阈值；P0 模型无团队嵌套 | `team-service.test.ts` |
| 头脑风暴模板 | 自动补齐五名角色并创建可编辑团队 | 团队 E2E；真实运行 |
| 归档与删除 | 软删除：列表/选择器移除，历史会话仍显示团队名与头像 | `team-service.test.ts` |

## 3. 设计一致性

- 共享 `AgentRunExecutor` 已抽取，`RunService` 保留单智能体 FIFO 队列；单智能体 E2E 回归通过。
- 团队运行使用独立 CLI 会话 ID，避免真实 Claude Code 并行时 `Session ID is already in use`（该问题在真实验收中发现并修复）。
- 数据模型、状态机、确定性上下文压缩、保护阈值、收敛产出物路径与 `design.md` 一致。
- 已接受偏差：P0 模型不允许团队嵌套，因此“循环引用校验”没有可表达的输入；校验器保留未来扩展点。

## 4. 独立审查

独立审查代理对 `7c6b93b..HEAD` 的最终 diff 做了只读审查，报告 2 个 CRITICAL、7 个 IMPORTANT、1 个行为回归。全部已修复并补充回归测试：

| # | 审查问题 | 修复 |
| --- | --- | --- |
| 1 | 提及非团队成员导致 `resolveMemberPrompt` 抛错、回合卡死 | `startDispatch` 增加成员校验与上下文构建 try/catch；用户提及过滤非成员并写系统消息；归档智能体不参与解析 |
| 2 | 指挥者失败/单停后成员继续运行，旧回调污染新回合 | `failTurn` 停止全部活动成员并清空队列/插话；`handleRunCompleted` 校验 `state.turnId === turn.id`，旧回调直接返回 |
| 3 | 保护收敛产出物可能被后完成成员文本覆盖 | 单独记录 `lastLeaderText/lastLeaderRunId`；产出物只使用指挥者最后文本 |
| 4 | 停止/失败后排队插话永久 `queued` | `stopTurn`/`failTurn` 显式把排队消息标记为 `cancelled` |
| 5 | 团队缺少单成员停止入口 | 智能体消息操作增加「停止此运行」，IPC 路由到 `orchestrator.stopRun` |
| 6 | 团队消息重试必然报错 | 新增 `TeamOrchestrator.retry`，IPC 按会话模式路由；重试在新回合中只调度原成员 |
| 7 | 未知用户提及无提示且静默回退指挥者 | 未知/歧义提及写系统消息；路由新增 `unresolved_mention`，不默认调度指挥者 |
| 8 | 有历史会话的团队无法删除 | 迁移 v4 增加 `team.deleted_at`，改为软删除：列表/选择器移除，历史会话仍显示团队名称与头像 |
| 9 | 单智能体被引入 30 分钟隐式超时 | 执行器不再设置默认超时；团队编排显式传入 30 分钟保护 |
| 10 | 退出应用未把活动单智能体会话恢复 idle | 执行器 `shutdown` 对活动会话写回 `idle` |

验证新增：非团队成员忽略、团队重试、未知提及不回落、软删除历史可读、失败隔离、插话目标等测试；测试总数从 68 增至 71。

## 5. 结论

独立审查发现的问题已全部修复并通过类型检查、71 个测试、构建与确定性 E2E；单智能体 E2E 回归通过。真实 Claude Code 五成员头脑风暴/中途插话在审查修复前基线通过并留下产出物（5,407 字节）；修复后的真实重跑在 600 秒超时，数据库未记录代码错误事件，该次重跑不计为通过。49/49 任务完成。残留风险是真实运行时可能长时间不返回，需要后续观察；不影响团队编排的确定性行为验证。
