# 运行时调度研究：AionUi/AionCore 与 Multica 模型及 Pizza 目标架构

> 状态：研究结论（已落地）
> 日期：2026-11-04
> 范围：运行时接入、会话调度、团队并行与资源回收。
> 结论一句话：**协议族适配器负责“怎么连”，SessionRuntimeActor 负责“一个会话怎么排”，RuntimeSupervisor 负责“整机资源怎么分”。**
>
> 实现位置：`packages/runtime-sdk/`。这是一个不依赖 Electron/SQLite 的独立 SDK，
> 主进程通过 `src/main/runtime/registry.ts` 把运行时配置映射为 SDK 的 `RuntimeSpec`；
> 协议族包括 Claude CLI、ACP、Codex app-server、Pi/OMP、DSH 与通用 CLI。

---

## 1. 摘要

Pizza 当前每次运行都会重新拉起运行时进程：`AgentRunExecutor` 在每次执行时 `openSession`，并在 `finally` 中 `close`，Claude 适配器也会在每次 `prompt` 时 `spawn` 一个新进程。这带来三个直接问题：

1. **冷启动成本高**：每轮对话都重新启动 CLI，Codex 等运行时的启动可能长达数十秒到数分钟。
2. **资源无上限**：多个会话或团队成员同时运行时，进程数量没有全局约束。
3. **接入面窄**：`src/main/runtime/registry.ts` 只分发 Claude CLI 与 ACP，Pi、Codex、DSH 等配置会在“尚未认证”处失败。

本文对比两套参考体系，它们代表了两种不同的最优点：

**AionUi / AionCore：交互式桌面端的会话级调度。**

- 每个会话一个运行时任务槽，turn 之间复用；
- 同一会话同一时刻只跑一个 turn（AionCore turn claim）；solo 的排队在前端，团队的排队在后端；
- 空闲回收由 AionCore idle scanner 执行：默认单人 10 分钟、团队 30 分钟；新的 Session 路径可挂起，但默认不启用；
- 团队成员各自拥有独立运行时，可并行启动；
- 团队以 Leader 就绪为可用闸门，单个成员失败不阻塞整体；
- 启动、超时、断连、重启都有明确的重试与恢复语义。

**Multica：多用户任务平台的机器级调度。**

- 调度器是 server + daemon 两层，任务由 server 排队、daemon 批量领取；
- 每个任务一个隔离执行环境，必要时使用独立 git worktree；
- 以协议族注册表接入 Claude、Codex、Pi、ACP 等不同运行时；
- 固定槽位信号量控制单机并发，默认 20 个任务；
- 任务级失败隔离、取消轮询、失败分类与恢复。

两者不是互斥方案：**AionUi/AionCore 强在“交互会话的低延迟与状态复用”，Multica 强在“多协议接入与任务级隔离”。** 本文建议 Pizza 采用 **“有界会话亲和运行时池 + 每会话单飞队列 + 协议族适配器”** 的混合模型：用 AionCore 的会话 actor 解决交互延迟，用 Multica 的协议族注册表解决非 Claude 运行时接入，用全局 supervisor 补上两者都不直接适用于单机桌面的资源约束。

---

## 2. 研究范围与方法

### 2.1 研究问题

- 多运行时（Claude Code、ACP、Pi/OMP、Codex、DSH 等）如何统一接入？
- 运行时进程应该在什么粒度创建、复用和回收？
- 同一会话的多条消息如何排队、取消和恢复？
- 团队多成员并行时，如何避免启动风暴和单点失败拖垮全局？
- 应用重启、崩溃、断连后如何恢复到可继续的状态？

### 2.2 研究材料

- AionUi 仓库：ACP 接入、会话运行时类型、团队槽位调度类型、系统设置、PRD 文档。
- AionCore 仓库：Rust workspace，包含 WorkerTaskManager、idle scanner、turn claim、SuspendController、团队 WorkCoordinator 等调度实现。
- Multica 仓库：Go server/daemon、协议族注册表、逐运行时 backend、任务级隔离环境、批量领取循环。
- Pizza 现有实现：运行时适配器、`RunService`、`AgentRunExecutor`、`TeamOrchestrator`。

> 说明：AionUi 的调度器主体是 AionCore。本次已将 `reference/AionCore` 克隆到本地并直接阅读 Rust 源码；AionUi 前端部分（IPC 契约、共享类型、PRD）与 AionCore 后端实现分别标注，二者不一致处已在 3.12 列出。Multica 的调度器源码在仓库内，结论可直接对应到 Go 文件与行号。文中均标注证据位置，便于复核。

---

## 3. AionUi / AionCore 的调度模型

### 3.1 分层架构

```
Electron Renderer ──HTTP/WS──> aioncore（调度器）──stdio/ACP──> 各 Agent CLI
       UI                         权威状态                  Claude / Codex / Gemini / ...
```

关键点：

- AionUi 依赖 `@agentclientprotocol/sdk`（`package.json:78`），外部 Agent 以 **ACP** 接入为主；同时保留内部 `aionrs` 后端。
- 调度器主体是 **AionCore**（Rust workspace，`reference/AionCore`）；AionUi 只是 Electron 外壳与渲染层。
- 渲染层不直接持有子进程，只消费运行时快照与事件。**调度权在 AionCore，不在 UI。**
- 这与 Pizza 的“主进程即权威”方向一致，只是 AionUi 把主进程换成了一个独立服务。

### 3.2 会话级运行时：懒启动、常驻、空闲回收

每个会话对应一个运行时摘要（AionUi `common/config/storage.ts:139-152`）：

```ts
type TConversationRuntimeSummary = {
  state: 'idle' | 'starting' | 'running' | 'cancelling' |
         'restarting' | 'waiting_confirmation'
  can_send_message: boolean
  is_processing: boolean
  pending_confirmations: number
  turn_id: string | null
  supports_midturn_delivery?: boolean
}
```

配套两个显式入口（AionUi `common/adapter/ipcBridge.ts:339-355`）：

- `POST /conversations/:id/runtime/ensure`：确保运行时已启动；
- `POST /conversations/:id/runtime/restart`：杀掉缓存进程、取消当前 turn、按原会话恢复上下文后重启。

生命周期规则（AionUi `docs/prds/conversations/acp/session.md`、`reliability.md`）：

| 规则 | 行为 |
| --- | --- |
| 进入会话 / 发送消息 | 懒启动；首次连接失败自动重试一次 |
| 会话空闲 | 前端 PRD 写 5 分钟；AionCore 实际默认单人 10 分钟、团队 30 分钟，每 60 秒扫描 |
| 空闲后再次使用 | 下次发送时自动重连并恢复上下文，用户无感 |
| 意外断连 | 保留已输出内容；下次发送自动重连 |
| 正在执行任务 / 等待审批 | 不触发空闲释放 |
| 连接超时 | 常规约 70 秒，Codex 约 150 秒 |
| 回复超时 | 默认 300 秒，可配置 30–3600 秒；按“无活动”计时 |

系统设置中的默认值可以直接在 AionUi 找到：

- `promptTimeout` 默认 300 秒，范围 30–3600；
- `agentIdleTimeout` 默认 5 分钟，范围 1–60；
- 位置：`renderer/components/settings/SettingsModal/contents/SystemModalContent/index.tsx:61-62, 268-280`。

> **源码核对**：AionCore 的实际空闲回收由 `crates/aionui-ai-agent/src/idle_scanner.rs` 决定，默认值是 **单人 10 分钟、团队 30 分钟、每 60 秒扫描一次**，可用 `AIONUI_IDLE_TIMEOUT_SECS`、`AIONUI_TEAM_IDLE_TIMEOUT_SECS`、`AIONUI_IDLE_SCAN_INTERVAL_SECS` 覆盖。前端设置中的 5 分钟与后端默认值并不一致；排障时应以实际运行的 AionCore 版本为准。详见 3.8。

**核心收益**：冷启动成本被摊到整个会话生命周期；只有真正空闲的会话才被回收。

### 3.3 单会话调度：单飞 + 队列 + turn 边界

单个会话同一时刻只允许一个活跃 turn，其余消息进入队列。渲染层的队列实现（AionUi `renderer/pages/conversation/platforms/useConversationCommandQueue.ts`）具备以下语义：

- 队列按会话隔离，最多 20 条（`MAX_QUEUED_COMMANDS = 20`）；
- 支持 `auto`（turn 结束后自动发下一条）与 `manual`（手动释放）；
- 支持编辑、删除、拖拽重排、一键清空；
- 失败时恢复到队首并暂停，避免静默丢消息；
- 即使窗口不在该会话，后台 runner 仍会在 `turn.completed` 后继续排空队列；
- PRD 要求等待期间把多条排队消息合并成一条发出（`messaging.md` F-MSG-01）；
- “停止”只取消当前 turn，不断开连接；队列可选择保留或丢弃。

这是 **per-session serial queue**，不是全局任务队列。它的职责是保证同一会话的上下文顺序，而不是分配整机资源。

> **源码核对**：AionCore 本身不维护 solo 聊天的排队队列。`ConversationRuntimeStateService::try_claim_turn` 在会话已有 active turn 时直接返回 `ConversationError::Busy`，HTTP 层表现为 409；排队与重试由前端 `useConversationCommandQueue` 负责。后端真正实现队列的是团队调度器（见 3.10）。

### 3.4 团队调度：成员独立并行 + Leader 闸门 + 槽位状态

团队不是共享一个运行时，而是每个成员槽位（`slot_id`）拥有独立会话与独立运行时：

- 成员运行时可并行启动，状态为 `dormant | pending | ready | failed`；
- 团队会话状态为 `starting | ready | failed | stopped`；
- 进入团队时并行 warmup，但 **Leader 就绪即撤遮罩**；单个 teammate 失败不阻塞团队；
- 空闲回收后广播 `stopped`，下一次发送触发惰性恢复；
- `session_stopped` 明确不是致命阻塞，发送门保持可用（AionUi `team/components/teamSendRuntime.ts:44-70`）。

后端暴露的槽位调度状态（AionUi `common/types/team/teamTypes.ts:95-151`）：

```ts
type ITeamSlotWork = {
  slot_id: string
  state: 'idle' | 'queued' | 'starting' | 'running' | 'paused' | 'blocked'
  queued_foreground_count: number
  queued_background_count: number
  active_turn_id: string | null
  blocked_reason: 'runtime_starting' | 'runtime_failed' | 'removing' | 'session_stopped' | null
}

type ITeamRunEvent = {
  queued_intent_count: number
  starting_batch_count: number
  running_batch_count: number
  active_enqueue_lease_count: number
  slot_work: ITeamSlotWork[]
}
```

这组字段说明后端至少有四层机制：

1. **意图队列**（`queued_intent_count`）：用户或 Leader 的派发意图先入队，再按资源情况执行；
2. **分批启动**（`starting_batch_count / running_batch_count`）：避免一次性拉起全部成员；
3. **入队租约**（`active_enqueue_lease_count`）：防止并发重复入队；
4. **前后台区分**（foreground / background）：用户消息优先于 teammate 间消息与系统回执。

此外还有 `paused` 状态，表示“停止当前 turn 但保留队列”，与“彻底取消”区分。

### 3.5 超时、取消与恢复

AionUi 的超时策略不是固定总时长，而是基于活动：

- 收到文本增量、工具事件、用量事件都会重置计时；
- 工具调用执行期间不触发超时；
- 等待用户审批权限期间不触发超时；
- 真正无输出超过配置时间才取消并提示；
- 取消后保留已输出内容，输入框恢复可用。

启动失败分类处理：

- 未安装：引导安装；
- 配置错误：引导修复；
- 模式不支持：引导切换模式或升级工具；
- 首次启动失败：自动重试一次，二次失败才展示最终错误。

### 3.6 可借鉴与不可照搬

| AionUi / AionCore 做法 | 是否建议 Pizza 照搬 | 原因 |
| --- | --- | --- |
| 独立 `aioncore` HTTP/WS 服务 | 暂不 | 单机 Electron 多一层服务会增加打包、端口、鉴权与崩溃恢复成本；等 Web/移动端需要时再拆 |
| ACP 作为唯一接入协议 | 不 | Claude/Codex/Pi/DSH 并非都稳定提供 ACP；Pizza 已有 Claude CLI 适配器，应按协议族保留 |
| 每会话常驻运行时 | 有条件照搬 | 只对支持持久会话的适配器有效；无上限常驻会拖垮机器 |
| 前端队列作为权威 | 不 | 窗口关闭/重载会丢状态；Pizza 应把队列放主进程或数据库 |
| 固定总时长超时 | 不 | 长工具调用会被误杀；应采用活动超时 + 审批暂停 |
| 团队槽位独立运行时 | 照搬 | 这是团队并行的正确粒度 |
| Leader 就绪闸门 | 照搬 | 避免单个 teammate 阻塞整个团队 |
| 空闲 LRU 回收 + 惰性恢复 | 照搬 | 兼顾低延迟与资源上限 |

### 3.7 AionCore 的运行时管理层

AionCore 是 Rust workspace（`reference/AionCore`），其中与调度直接相关的有两个 crate：

- `aionui-ai-agent`：Agent 生命周期与 Worker 任务管理，当前 ACP/Aionrs/Session 三类 Agent 的统一入口；
- `aionui-session`：较新的“直连 CLI + ACP”会话模型，负责 FSM、命令、事件与进程挂起/唤醒。

#### 每会话一个任务槽

`WorkerTaskManagerImpl` 用 `DashMap<conversation_id, TaskSlot>` 管理运行中的 Agent，`TaskSlot` 是 `Arc<OnceCell<ManagedAgentTask>>`（`crates/aionui-ai-agent/src/task_manager.rs:98-120`）。

`get_or_build_task` 的关键行为：

- 同一 `conversation_id` 的并发调用共享同一个 `OnceCell`，工厂最多执行一次，避免 `/messages` 与 `/runtime/ensure` 同时到达时各自拉起一个 CLI 进程；
- 工厂失败时 `OnceCell` 保持空，下一次调用可以重试；
- 已存在的任务如果 `runtime_capabilities` 不满足新请求，会先 kill 再重建（`task_manager.rs:180-220`）。

这解决了“并发进入同一会话导致重复初始化”的竞态，和 AionUi PRD 中“并发进入同一会话不会重复初始化”的验收项对应。

#### Agent 变体与能力

`AgentInstance` 是封闭枚举（`crates/aionui-ai-agent/src/agent_task.rs:190-230`）：

```rust
enum AgentInstance {
    Acp(Arc<AcpAgentManager>),
    Aionrs(Arc<AionrsAgentManager>),
    Session(Arc<SessionAgentTask>), // clean-slate direct-CLI: claude/codex/antigravity
    // test-only Mock
}
```

`IAgentTask` 暴露生命周期所需的最小面（`agent_task.rs:30-110`）：

- `status()`、`last_activity_at()`：空闲判断；
- `live_background_tasks()`：仍在运行的 workflow / background bash / background subagent，防止“状态已 Finished 但后台仍忙”被误杀；
- `supports_midturn_delivery()`：消息能否插入当前 turn；
- `send_message()` / `cancel()` / `kill()`。

#### 活跃租约

`ActiveLeaseRegistry` 为每个会话维护 90 秒 TTL 的租约（`crates/aionui-ai-agent/src/active_lease.rs:3`）。前端或内部调用可以周期续租；空闲扫描会跳过仍有活跃租约的会话。这把“用户正在看/正在操作”的会话与“真正闲置”的会话区分开，避免在用户刚切回来时被杀掉。

### 3.8 AionCore 的空闲回收：两套机制

AionCore 里存在两套不同的空闲回收机制，不能混为一谈。

#### 机制 A：Idle Scanner（当前 ACP 路径）

`crates/aionui-ai-agent/src/idle_scanner.rs`：

| 参数 | 默认值 | 环境变量 |
| --- | --- | --- |
| 单人会话空闲阈值 | 10 分钟 | `AIONUI_IDLE_TIMEOUT_SECS` |
| 团队会话空闲阈值 | 30 分钟 | `AIONUI_TEAM_IDLE_TIMEOUT_SECS` |
| 扫描间隔 | 60 秒 | `AIONUI_IDLE_SCAN_INTERVAL_SECS` |

扫描启动点在 `crates/aionui-app/src/commands/cmd_server.rs:316-340`。扫描器先按单人阈值调用 `collect_idle`，再交给 `TeamIdleCleanupCoordinator` 用团队阈值处理团队会话；因此团队会话不会按单人的 10 分钟被提前回收。

`WorkerTaskManagerImpl::collect_idle` 的入选条件（`task_manager.rs:301-360`）：

1. `AgentType::Acp`（当前 idle scanner 只回收 ACP Agent）；
2. `status` 为 `None`（仅 warmup、从未进入 turn）或 `Finished`；
3. 距 `last_activity_at` 超过阈值；
4. `live_background_tasks() == 0`；
5. 没有未过期的 active lease。

命中后并行执行 `kill_and_wait(..., AgentKillReason::IdleTimeout)`。这解释了为什么“空闲回收”在 AionCore 中是 **按会话 kill 整个 Agent 进程**，而不是只关闭一个连接。

#### 机制 B：SuspendController（新的 Session 路径）

`crates/aionui-session/src/backend/suspend.rs` 为拥有子进程的 backend 提供 Active ⇄ Dormant 控制器：

- `idle_ttl_ms = None` 是生产默认值——**不启用空闲挂起**；
- 配置了 TTL 后，空闲计时器在 `turn_active == false` 且超过 TTL 时关闭进程（abort reader → drop `io` → `kill_on_drop`）；
- 下一次 `dispatch` 通过 backend 自己的 `--resume` / `session/load` / `thread/resume` 唤醒，逻辑会话连续；
- suspend 与 wake 共用同一把 `slot` 锁，避免“计时器关闭”和“dispatch 唤醒”之间的 TOCTOU；
- 强制终止路径先 abort reader，再 group-kill 进程树，避免误发 `Detached`。

这套机制只对持久化进程型 backend 生效；`idle_ttl_ms` 默认不设置，因此生产默认不会挂起。AionUi 前端文档中的 5 分钟、AionCore idle scanner 的 10/30 分钟、以及 Session 路径的默认不挂起，是三个不同层次的配置，排障时必须区分。

### 3.9 单会话串行与 mid-turn 投递

AionCore 的会话串行由 `ConversationRuntimeStateService` 保证（`crates/aionui-conversation/src/runtime_state.rs:60-140`）：

- `try_claim_turn(conversation_id, turn_id)` 在已有 active turn 时返回 `ConversationError::Busy`，HTTP 层通常映射为 409；
- 同一会话同一时刻只有一个 turn 可以 claim；
- 停止、删除、重启各有独立状态位，避免把“取消中”误判为“空闲”；
- 延迟取消：如果取消在 Agent 尚未构建完成时到达，会记录 `deferred_cancel`，构建完成后、真正发送 prompt 前消费。

**mid-turn 投递**（`crates/aionui-conversation/src/service.rs:3860-3935`）：

- 如果当前有 active turn，且 Agent 的 `supports_midturn_delivery()` 为 true，消息直接进入当前 turn，不新开 turn；
- 如果有待确认的权限/问题卡片（`get_confirmations()` 非空），拒绝 mid-turn 投递，回落到 409，让前端走队列；
- 如果后端拒绝 steer（例如 codex 的 turn 刚好结束），回落到新开 turn，并复用已持久化的用户消息，避免重复行。

`ConversationRuntimeSummary` 的状态优先级（`runtime_state.rs:490-550`）：

```
Restarting > WaitingConfirmation > Cancelling > Starting > Running > Idle
```

`can_send_message = !is_processing`。这与 AionUi 前端类型定义一致，但权威计算在 AionCore。

**取消看门狗**（`service.rs:69, 4419-4440`）：取消后等待 15 秒（`ACP_CANCEL_DRAIN_TIMEOUT`）；如果 active turn 仍是同一个且仍处于 cancelling，则 `kill_and_wait(..., UserCancelTimeout)` 强制结束，避免取消卡死。

### 3.10 团队调度器：优先级车道 + 意图 + 批次 + 租约

AionCore 的团队调度比前端契约更完整，核心在 `crates/aionui-team/src/work_coordinator/`。

#### 优先级车道

每个槽位有四条队列（`work_coordinator/model.rs:20-45`）：

```
Foreground（用户驱动，最高）
  > Control（shutdown 请求/拒绝）
  > Directed（其他 Agent 发给本槽位的消息）
  > Background（系统通知、欢迎、成员变更、idle nudge）
```

`SlotWorkCoordinator::next` 按这个顺序 claim；用户消息永远优先。

#### 意图、批次、租约

- **WorkIntent**：一次待执行的工作意图，状态为 `Queued / Starting / Running / Completed / Failed / Cancelled`（`model.rs:60-100`）；
- **WorkBatch**：一次实际投递给 Agent 的批次，包含多个 intent、mailbox 消息、优先级、team run 绑定；
- **EnqueueLease**：入队租约，带 `session_generation`；提交时校验租约与 generation，防止并发重复入队；
- **RuntimeConstraint**：`Ready / Starting / Failed / Removing / SessionStopped`，决定槽位是否可 claim；
- **SlotPhase**：`Idle / Queued / Starting / Running / Paused / Blocked`。

#### 投递失败与暂停

`MAX_MESSAGE_DELIVERY_FAILURES = 3`（`model.rs:12`）：同一 mailbox 消息连续投递失败 3 次后，其槽位被 pause，避免无限重试。失败计数只在内存中，进程重启后重置——因为重启本身可能修复了导致失败的外部条件。

#### 团队运行状态

`TeamRunManager`（`crates/aionui-team/src/team_run/manager.rs`）维护团队级 run：

- 状态：`Accepted / Running / Cancelling / Completed / Cancelled / Failed`；
- `apply_work_summary` 根据 `queued_intent_count / starting_batch_count / running_batch_count / active_enqueue_lease_count / paused_intent_count / failed_intent_count` 推导状态；
- 没有工作且非 cancelling → `Completed`；有失败 intent → `Failed`；
- active turn 超过 10 分钟标记 `active_turn_slow`（`ACTIVE_TURN_SLOW_THRESHOLD_MS`），用于 UI 展示，不直接杀进程。

#### Lead 唤醒规则

`TeammateManager`（`crates/aionui-team/src/scheduler/state.rs`）：

- `try_wake` 只唤醒 `Idle` 的 Agent；非 Idle 直接返回 `None`，防止重复唤醒；
- `mark_idle` 时，非 Lead 变 Idle 会写 `idle_notification` 给 Lead，并在所有 teammate 都 settled 时返回 Lead slot，由调用方再唤醒 Lead；
- Lead 变 Idle 立刻返回 `None`，防止自唤醒死循环；
- 所有 mailbox 读取走原子 `read_unread_and_mark`，保证消息至多投递一次。

#### 成员运行时懒加载

`TeamSession::ensure_member_runtime_lazy`（`crates/aionui-team/src/session.rs:602-650`）：

- 槽位没有运行中的 event loop 时，先同步预留 attach lease，把 registry 快照翻到 `Attaching`；
- 并发 attach 通过 lease 去重；
- attach 成功后再 enqueue，避免向未就绪的成员投递。

这比前端的“warmup 遮罩”更底层：UI 只看到状态，真正的懒加载与去重在 AionCore 完成。

### 3.11 启动恢复：冷启动永远回到 Idle

AionCore 对崩溃/重启的恢复策略是“清掉中间态，回到 turn 边界”：

- `aionui-session/src/backend/rehydrate.rs`：冷启动重建的 `SessionState` **永远是 `Idle`**，只恢复 `backend_session_id` 与 `turn_gen` 作为 resume 锚点；未完成的权限、工具、subagent 等中间态不持久化，也不恢复；
- `aionui-conversation/src/startup_recovery.rs`：启动时扫描残留的 `work` 消息，把可见输出标为 `finish`，把空的占位消息标为 `finish + hidden`，把 `tool_call/tool_group` 的内容状态改写为 `canceled`；
- 硬杀后进程组已死，不会有 terminal 事件，启动恢复负责收尾，避免前端 spinner 永远转。

也就是说，AionCore 不尝试“断点续跑一个 turn”；它只保证会话锚点连续、UI 不悬挂，具体工作由用户或团队调度重新发起。

### 3.12 前端文档与 AionCore 源码的差异

| 主题 | 前端文档/类型描述 | AionCore 源码实际 |
| --- | --- | --- |
| 空闲回收 | 默认 5 分钟，可配 1–60 | idle scanner 默认单人 10 分钟、团队 30 分钟；Session 路径默认不挂起 |
| 单会话队列 | “单飞 + 队列” | 后端只做 turn claim，冲突返回 409；solo 队列在前端 |
| 团队队列 | `queued_foreground/background`、`active_enqueue_lease` | 后端有完整 WorkIntent/WorkBatch/EnqueueLease/优先级车道 |
| 运行时进程 | 每会话常驻 | ACP 路径每会话一个 `WorkerTaskManager` 槽；Session 路径可挂起/唤醒，默认不挂起 |
| 失败恢复 | 自动重连/重试 | 启动时只清理中间态回到 Idle；不自动续跑 turn |
| 取消 | 停止当前回复 | 15 秒取消看门狗，超时强制 kill |

这些差异不影响“会话级运行时 + 单飞 + 队列 + 空闲回收”的大方向，但说明：**AionUi 的前端 PRD 是体验描述，AionCore 的源码才是调度事实来源。** 本文后续的目标架构以 AionCore 的实际机制为参考，而不是照抄前端文案。

---

## 4. Multica 的调度模型

### 4.1 定位与分层

Multica 是“人与 Agent 共同处理任务”的平台，运行时分三层：

```
Server（任务与工作区权威）
   │  claim / report / status poll
   ▼
Daemon（每台机器一个）
   │  固定槽位信号量 + 批量领取
   ▼
Agent CLI 进程（每个任务一个隔离执行环境）
```

- **Server** 负责工作区、任务、Agent 分配、任务状态与队列；
- **Daemon** 负责发现本机运行时、向 Server 领取任务、启动 CLI、上报事件与结果；
- **Agent CLI** 在任务级隔离环境中执行，任务结束后进程退出。

与 AionUi 的“会话级常驻”相反，Multica 的调度单位是 **task/run**：任务完成后进程即退出，连续对话依赖 runtime session 的 resume 能力，而不是进程复用。

### 4.2 接入层：协议族注册表，而不是单一协议

Multica 没有把所有运行时统一成 ACP 或 MCP。它的接入层是 **“协议族 + 逐运行时 backend”**：

- `agent.New()` 按 provider 分派到不同 backend（`server/pkg/agent/agent.go:469`）：
  `claude`、`codex`、`pi`、`hermes`、`dsh`、`cursor`、`kimi` 等；
- `SupportedTypes` 是自定义运行时 profile 可选的协议族白名单（`agent.go:398`）；
- `BuiltinRuntimes` 描述“复用已有协议族的运行时身份”（`builtin_runtimes.go:89`），例如 `omp` 复用 `pi` 族；
- `ResolveBackend` 把运行时身份路由到协议族 backend（`builtin_runtimes.go:153` 起）；
- 每个 backend 自己构造 argv、启动进程、解析事件。例如：
  - Claude：`--output-format stream-json --input-format stream-json`（`claude.go:1164`）；
  - Codex：`codex app-server --listen stdio://`（`codex.go:375`）；
  - Pi：`pi -p --mode json`，按行解析 JSON 事件（`pi.go:1197`）；
  - Hermes：`hermes acp` 子命令（`hermes.go:427`）。

ACP 在 Multica 中是**一个重要的协议族，但不是唯一协议**。共用 `acp_session.go` 的 backend 包括 Hermes、Kimi、Kiro、Qoder、Trae、Grok、Dim、mcode、qwenpaw、reasonix、zeroclaw、Devin 等；Claude、Codex、Pi/OMP、DSH 等则走各自原生协议。

MCP 在 Multica 中同样只是**能力注入层**，不是控制面：

- Daemon 在 `runtime_mcp.go:36` 合并“运行时级 + Agent 级”MCP 配置；
- 按 provider 注入：ACP 放进 `session/new` 的 `mcpServers`，Claude 走自身 MCP 配置，Pi 走扩展/配置目录等；
- 任务工作区还会写入 `AGENTS.md`、技能清单和任务级配置。

Multica 代码里的 “A2A” 指产品内部 Agent 之间的任务委派、mention 授权与 originator 权限链（如 `server/internal/handler/agent_access.go`），**不是 Google A2A 线协议**，也不承担运行时接入。

### 4.3 执行层：任务级隔离环境

Multica 的执行环境按任务创建（`server/internal/daemon/execenv/execenv.go`）：

- 每个任务一个 `envRoot`，内含 `workdir`、`output`、`logs` 等；
- `workdir` 可以是用户仓库的任务级 checkout；`LocalWorktree` 模式为每个任务创建独立 git worktree；
- 任务结束后清理 `workdir`，保留输出与日志；
- 任务根目录有稳定的身份记录，避免路径漂移和错误复用；
- Agent 的 `AGENTS.md`、技能、MCP 配置都按任务环境生成，不污染用户全局配置。

这带来很强的隔离性：任务之间不会共享工作目录、配置或进程；崩溃、取消、超时都只影响当前任务。代价是每个任务都要承担环境准备与 CLI 冷启动。

### 4.4 调度层：固定槽位 + 批量领取

Daemon 的并发模型是“固定槽位 + 单循环批量领取”：

- `MaxConcurrentTasks` 默认 **20**（`server/internal/daemon/config.go:72`），可用 `MULTICA_DAEMON_MAX_CONCURRENT_TASKS` 覆盖；
- 槽位是预先填满 0..N-1 的带缓冲 channel（`newTaskSlotSemaphore`，`daemon.go:5592`），槽位 ID 稳定；
- `runBatchPoller` 是单机唯一的“领取 + 派发”循环（`daemon.go:5369`）：
  1. 先阻塞等待至少一个槽位；
  2. 再把当前所有空闲槽位一次性取走；
  3. 向 Server 一次领取最多“空闲槽位数”个任务；
  4. 每个任务派发到一个槽位，任务退出后释放槽位并唤醒 poller；
  5. 如果所有槽位都被填满，立即进入下一轮，避免任务在 Server 排队；
  6. 如果领取失败或容量不足，按退避间隔重试；
  7. WebSocket 有任务可用推送，轮询只是漏事件兜底。

关键设计是 **slot-before-claim**：先拿到本地执行能力，再向 Server 领取任务，避免任务在 Server 侧变成 `dispatched` 但本地没有槽位、最终触发 dispatch-timeout。

此外还有：

- 任务在 Server 侧排队，Daemon 只领取自己跑得动的数量；
- 同一 `(issue, agent)` 的串行化，避免同一问题被同一 Agent 并发处理；
- 任务开始前取消低优先级的仓库维护，避免 Git 操作重叠；
- 自动更新屏障：更新准备期间拒绝领取新任务；
- 任务取消通过状态轮询感知：终态或任务被删除时中断本地 Agent，普通网络错误不会误杀。

### 4.5 失败处理与恢复

Multica 把“任务失败”作为一等状态处理：

- 任务有明确的 `running / completed / failed / cancelled` 终态；
- 领取后若 Server 已终结任务，Daemon 会中断本地 Agent，避免继续消耗；
- 失败分类与恢复逻辑集中在 `server/pkg/taskfailure`，区分可恢复与不可恢复错误；
- 连续会话通过 runtime session 的 resume/load 恢复，而不是复用进程；
- 重复执行有保护：同一个任务不会被多个执行者同时完成。

### 4.6 优点与局限

| 维度 | 优点 | 局限 |
| --- | --- | --- |
| 协议接入 | 协议族注册表可覆盖大量异构 CLI | 每个协议族都要维护独立 backend，成本高 |
| 隔离性 | 任务级 workdir/worktree，崩溃不扩散 | 任务间无法共享热进程 |
| 并发 | 固定槽位 + 批量领取，容量可控 | 默认 20 对单机桌面偏高，需要按机器调低 |
| 恢复 | 失败分类、取消轮询、resume | 冷启动与环境准备成本落到每个任务 |
| 多用户 | Server 统一排队，适合多机器/多用户 | 需要独立 Server 与 Daemon，单机部署偏重 |
| 交互延迟 | 任务级调度吞吐高 | 不适合“连续追问、低延迟”的桌面会话 |

**结论**：Multica 的最优场景是“多用户、多机器、任务吞吐优先”；AionUi 的最优场景是“单用户、交互式、会话延迟优先”。Pizza 属于后者，但需要借用前者的协议族注册表来解决非 Claude 运行时接入。

---

## 5. 对比：AionUi/AionCore、Multica 与 Pizza 现状

| 维度 | AionUi / AionCore | Multica | Pizza 当前 |
| --- | --- | --- | --- |
| 调度单位 | 会话（conversation） | 任务（task/run） | 会话 + 团队回合 |
| 接入层 | ACP 优先 + 内部后端 | 协议族注册表 + 逐运行时 backend | 仅 Claude CLI + 通用 ACP |
| 进程粒度 | 每会话一个任务槽（可常驻；Session 路径可挂起） | 每个任务一个隔离进程 | 每个 run 一个进程 |
| 会话复用 | 强，turn 间复用 | 弱，依赖 session resume | 无，每轮 spawn |
| 空闲回收 | 单人 10 分钟 / 团队 30 分钟扫描；Session 路径默认不挂起 | 任务结束即退出 | 无（因为没有缓存） |
| 单会话并发 | 后端 turn claim（冲突 409）+ 前端队列 | 每任务独立 | 单飞 + 内存 FIFO |
| 团队并发 | 槽位独立 + 优先级车道 + 意图/批次/租约 | Server 任务队列 + 单机槽位 | `maxConcurrency` + 内存队列 |
| 全局资源上限 | 主要靠空闲扫描 + active lease（未见固定 warm 上限） | `MaxConcurrentTasks` 默认 20 | 无显式上限 |
| 隔离方式 | 会话级进程 | 任务级 envRoot / worktree | 进程级，无独立工作区 |
| 失败隔离 | 单槽位失败不阻塞团队 | 单任务失败不影响其他任务 | 部分有 |
| 调度权归属 | backend | Server + daemon | 主进程（方向正确） |
| 最适合 | 单用户交互桌面 | 多用户任务平台 | 单用户桌面 |

### 5.1 Pizza 现状的具体证据

- 每次运行创建并关闭适配器会话：
  `src/main/services/agent-run-executor.ts:269`（`openSession`）、`:408`（`close`）。
- Claude 适配器在每次 `prompt` 时才 `spawn`：
  `src/main/runtime/claude-cli.ts:273` 起。
- ACP 适配器在 `prompt` 内首次启动子进程，运行结束后随会话关闭：
  `src/main/runtime/acp-stdio.ts:175` 起。
- 单会话已有 FIFO 队列与单飞检查：
  `src/main/services/run-service.ts` 的 `queues`、`enqueue`、`drainQueue`、`isSessionActive`。
- 团队已有 `maxConcurrency`，但只在本进程内约束，且没有全局运行时资源层：
  `src/main/services/team-orchestrator.ts:570`。
- 适配器注册表只接受 `claude-code / acp / hermes`：
  `src/main/runtime/registry.ts`。

结论：Pizza 的“会话 FIFO”和“团队并发上限”方向正确，缺的是 **运行时资源层** 与 **协议族适配器分发**。

---

## 6. 目标架构：有界会话亲和运行时池

### 6.1 分层

```
                    ┌──────────────────────────────────────────┐
UI IPC events  <──  │ RuntimeSupervisor（主进程，全局唯一）      │
                    │  - 启动信号量 / 全局 warm 上限              │
                    │  - 优先级与公平队列                         │
                    │  - 空闲 LRU 回收                            │
                    └───────────────┬──────────────────────────┘
                                    │ acquire / release
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
     SessionRuntimeActor   SessionRuntimeActor   SessionRuntimeActor
       (session A)            (session B)          (team slot C)
       - 状态机                - 单飞 turn           - 独立队列
       - 适配器会话缓存         - 队列                 - 失败隔离
              │
              ▼
     ProtocolFamilyAdapter
     claude-cli | acp | pi-json | codex-app-server | dsh | custom
```

三层职责必须分开，避免出现第二套运行时通道：

1. **Adapter**：只负责“启动进程、发送 prompt、解析事件、取消与关闭”。
2. **Actor**：只负责“一个会话的状态机、单飞、队列、恢复”。
3. **Supervisor**：只负责“全局许可、公平性、回收、启动风暴保护”。

### 6.2 SessionRuntimeActor 状态机

每个会话（含团队每个成员槽位）一个 actor：

```
dormant ──ensure──> starting ──ok──> ready ──prompt──> running
   ▲                   │                ▲                 │
   │                   └──fail──> failed│                 ├─ turn done ──> ready
   │                                    │                 │
   └──────── idle TTL / LRU ────────────┴─────────────────┘
                                      cancelling ──> ready / failed
```

状态语义：

| 状态 | 含义 | 允许发送 | 可被回收 |
| --- | --- | --- | --- |
| `dormant` | 无 live 进程，只有持久化会话 | 是（触发 ensure） | 不适用 |
| `starting` | 正在启动 / 握手 | 否（消息入队） | 否 |
| `ready` | 进程可用，空闲 | 是 | 是 |
| `running` | 有活跃 turn | 否（消息入队） | 否 |
| `cancelling` | 已请求取消，等待退出 | 否 | 否 |
| `failed` | 启动或运行失败 | 视错误类型重试 | 是（重建） |

Actor 职责：

1. **串行化**：同一会话永远只有一个 `prompt` 在飞。
2. **进程复用**：`persistent` 适配器保留 `RuntimeSession`；`per-turn` 适配器只缓存 `runtimeSessionId`。
3. **事件归属**：把 adapter 事件写入 run event、消息、UI 广播，保持现有 `AgentRunExecutor` 的落库职责。
4. **空闲计时**：每次活动重置；`running`、有队列、等待审批时不回收。
5. **恢复**：`failed` 后按错误类型决定是否重建；断连后下一次发送前 `ensure`。

> AionCore 对应机制：`WorkerTaskManagerImpl` 的每会话 `OnceCell` 任务槽负责“只构建一次”，`ConversationRuntimeStateService::try_claim_turn` 负责“同一会话只有一个 turn”，`collect_idle` 负责“按会话 kill”。Pizza 的 actor 把这三件事收敛到一个对象里，并额外负责队列持久化。

### 6.3 适配器能力声明

不要让调度器猜测适配器行为。`RuntimeAdapter` 增加能力画像：

```ts
interface RuntimeAdapterProfile {
  /** persistent：进程可跨 turn 复用；per-turn：每轮重新启动 */
  lifecycle: 'persistent' | 'per-turn'
  supportsResume: boolean
  supportsMidturnDelivery: boolean
  startupCostMs: number
  startupTimeoutMs: number
  maxSessionsPerProcess: number
}
```

根据画像决定策略：

| 适配器 | lifecycle | 策略 |
| --- | --- | --- |
| ACP（Hermes 等） | `persistent` | 会话内复用进程；空闲 TTL 回收；`session/load` 恢复 |
| Pi / OMP JSON | `persistent`（`--session`） | 复用进程或至少复用 session 文件；空闲回收 |
| Codex app-server | `persistent` | 复用 app-server；支持 turn interrupt |
| Claude CLI（当前 `-p`） | `per-turn` | 不缓存进程，只缓存 `runtimeSessionId`；受全局并发限制 |
| DSH | 按实际协议 | 单独实现后再声明 |

> 如果后续把 Claude 适配器改为长驻 stream-json / ACP 模式，再把它升级为 `persistent`；调度器不需要改。

### 6.4 RuntimeSupervisor 调度规则

建议参数（均可配置，运行时级可覆盖）：

| 参数 | 建议默认 | 作用 |
| --- | --- | --- |
| `maxWarmSessions` | 4 | 同时常驻的 persistent 运行时上限 |
| `maxConcurrentStarts` | 2 | 同时冷启动的进程数，避免启动风暴 |
| `idleTimeoutMs` | 5 分钟 | 与 AionUi 对齐，1–60 可配 |
| `startupTimeoutMs` | 20 秒；Codex 90–150 秒 | 按协议族覆盖 |
| `turnInactivityTimeoutMs` | 5 分钟 | 基于活动而非总时长 |
| `cancelGraceMs` | 1.5 秒后 SIGKILL | 终止进程组，避免孤儿进程 |
| `maxQueuePerSession` | 20 | 与 AionUi 对齐 |
| `maxConcurrentTurns` | 3–4 | 全局 turn 上限，按机器能力调整 |

> AionCore 的策略是“空闲扫描 + active lease”，没有固定 warm 上限；Pizza 增加 `maxWarmSessions` 是为了在大量会话同时存在时防止常驻进程无限增长。这个上限是 Pizza 对 AionCore 模型的补充，不是照搬。

调度算法：

1. **前台优先**：用户主动发送 > 团队 Leader > 团队成员 > 后台/定时任务。
2. **会话内 FIFO**：不跨会话抢占，不改变用户消息顺序。
3. **启动准入**：先取 `maxConcurrentStarts` 许可；启动完成后释放启动许可，但占用 warm 名额。
4. **warm 满了**：优先回收最久未使用且 `ready` 的 actor；没有可回收对象则把新会话置为 `queued`，而不是无限 spawn。
5. **公平性**：启动队列按工作区/会话轮转，避免一个大团队饿死其他会话。
6. **回收条件**：`ready`、无活跃 turn、无队列、无待审批、非团队 warmup 阶段。
7. **回收顺序**：LRU；同优先级下优先回收 `startupCostMs` 较低的会话，保留冷启动成本高的运行时。

### 6.5 会话内队列与停止语义

建议保留 Pizza 已有的会话 FIFO，但把权威从内存提升到可恢复状态：

- 队列项至少包含 `userMessageId / runId / attachmentPaths / seq`；
- 队列状态落 SQLite，或由 `run` 表按 `status = queued` 推导；
- turn 完成后由 actor 主动 `drain`，不依赖渲染层事件；
- 应用重启后把 `running` 标记为 `interrupted`，`queued` 保留并继续排空。

停止语义必须区分：

| 操作 | 当前 turn | 队列 |
| --- | --- | --- |
| 停止当前回复 | 取消 | 保留 |
| 停止并清空 | 取消 | 清空 |
| 打断并发送新消息 | 取消 | 新消息插到队首 |
| 应用退出 | 取消 | 标记为 `cancelled`，避免下次启动误执行 |

可选优化：多条排队消息合并为一条（AionUi PRD 有此要求）。建议默认关闭，避免改变用户逐条发送的语义；团队内部消息可默认合并。

### 6.6 团队调度

团队不需要第二套执行通道，直接复用 SessionRuntimeActor：

- 每个团队成员 run 使用独立 actor；
- `TeamOrchestrator` 只负责 DAG/回合编排，不再管理进程；
- 并发上限取三者最小：`team.maxConcurrency`、全局 `maxConcurrentTurns`、运行时 `maxSessions`；
- Leader 优先获得启动许可；teammate 失败只标记该槽位 `failed`，不终止整个 turn；
- 每个槽位维护 `queuedForeground / queuedBackground / activeTurnId / blockedReason`；
- 入队使用 `turnId + seq` 作为幂等键，重复 dispatch 直接丢弃；
- warmup 并行 ensure 所有成员，但 UI 闸门只看 Leader；其余成员后台继续，失败可单独重试；
- 团队停止时先暂停槽位（保留队列），再决定是否清空。

> AionCore 对应机制：团队调度由 `SlotWorkCoordinator` 和 `TeamRunManager` 完成。前者维护四条优先级车道（Foreground > Control > Directed > Background）、WorkIntent/WorkBatch、EnqueueLease 和 RuntimeConstraint；后者把 `queued_intent_count / starting_batch_count / running_batch_count / active_enqueue_lease_count` 汇总为团队 run 状态。Pizza 不需要一次性实现全部结构，但至少应保留“优先级 + 意图/批次 + 幂等键 + 失败暂停”这四个语义。

### 6.7 超时、取消与进程树

- **连接超时**：按协议族配置；启动失败自动重试一次，认证/配置错误不重试。
- **活动超时**：收到文本、工具、用量事件都重置；权限等待与工具执行期间暂停计时。
- **取消**：先发协议级取消（ACP `session/cancel`、Codex `turn/interrupt`），宽限期后杀进程组。
- **取消看门狗**：借鉴 AionCore 的 15 秒 `ACP_CANCEL_DRAIN_TIMEOUT`；超时仍未 drain 就 `kill_and_wait`。
- **进程组**：子进程使用独立进程组，取消时杀整棵树，避免 CLI 派生的子进程成为孤儿。
- **结果区分**：`cancelled`（用户）与 `timeout`（系统）分别落库和展示。

### 6.8 数据与事件

建议新增或明确的持久化字段：

- `runtime_session`：`sessionId / runtimeId / adapter / state / runtimeSessionId / lastActiveAt / lastError`；
- `run`：`queueSeq / startedAt / endedAt / cancelReason`；
- `message`：保持现有状态，但增加 `queued` 与 `cancelled` 的明确边界。

建议新增 IPC 事件：

- `runtime:state-changed`：actor 状态迁移；
- `runtime:queue-changed`：队列长度与队首摘要；
- `runtime:warmup-changed`：团队/成员就绪状态；
- `runtime:evicted`：空闲回收，UI 可显示“下次发送会自动恢复”。

### 6.9 从 AionCore 源码可直接落到 Pizza 的取舍

| AionCore 机制 | Pizza 是否采用 | 说明 |
| --- | --- | --- |
| 每会话 `DashMap + OnceCell` 任务槽 | 采用 | 直接解决并发 `/send` + `/ensure` 重复拉起进程的竞态 |
| 运行时能力变化触发重建 | 采用 | adapter/模型/配置变化时先 kill 再重建，避免旧能力继续服务 |
| `ActiveLeaseRegistry`（90 秒 TTL） | 采用 | 保护“用户正在看/正在操作”的会话不被 LRU 回收 |
| `live_background_tasks` 保护 | 采用 | 防止状态已 Finished 但后台仍有 workflow/bash/subagent 的会话被误杀 |
| 空闲扫描按会话 kill | 采用，但改为有界池 | AionCore 没有 warm 上限；Pizza 需要 `maxWarmSessions` + LRU |
| solo 前端队列 | 不采用其位置 | Pizza 应把队列权威放主进程/DB，避免窗口重载丢队列 |
| 团队 WorkCoordinator 优先级车道 | 采用 | Foreground > Control > Directed > Background |
| 意图/批次/入队租约 | 采用 | 防止并发重复入队，支持按资源分批启动 |
| 投递失败 3 次后 pause | 采用 | 避免坏消息无限重试拖垮槽位 |
| 15 秒取消看门狗 | 采用 | 取消不 drain 时强制 kill 进程树 |
| 冷启动永远回 Idle | 采用 | 不尝试断点续跑 turn；启动时清理残留 `work` 消息 |
| 两套空闲机制并存 | 不采用 | Pizza 统一为“per-session actor + 可配置 TTL”，按 adapter 能力决定是否可挂起 |

---

## 7. 落地路线

### 阶段 1：运行时资源层（最高收益）

1. 新增 `src/main/runtime/supervisor.ts`：全局许可、启动队列、warm 名额、空闲 LRU。
2. 新增 `src/main/runtime/session-actor.ts`：状态机、单飞、队列、事件转发。
3. 扩展 `RuntimeAdapter`：`lifecycle`、`supportsResume`、`supportsMidturnDelivery`、`startupTimeoutMs`。
4. 改造 `AgentRunExecutor.execute`：从“每次 `openSession` → `prompt` → `close`”改为“`supervisor.acquire(sessionId, runtime)` → `prompt` → 按策略 release/keep”。
5. `RunService` 队列改为委托 actor；保留现有 run/message 落库与 IPC 契约。

**验收点**：

- 同一会话连续两轮对话不重复冷启动（persistent 适配器）；
- 并发启动数不超过 `maxConcurrentStarts`；
- 取消后进程组完全退出；
- 现有单智能体与团队测试不回归。

### 阶段 2：空闲回收与恢复

1. 增加 `runtimeIdleTimeoutMs` 设置（默认 5 分钟，1–60）。
2. actor 空闲计时、LRU 回收、下次发送惰性恢复。
3. 新增 `restart runtime` IPC：取消当前 turn、重建进程、恢复 `runtimeSessionId`。
4. 应用重启时把 `starting/running` 标记为 `interrupted`，队列保留为 `queued`。

**验收点**：

- 空闲超时后进程退出，内存下降；
- 再次发送自动恢复，历史不丢；
- 重启运行时不会重复写入历史消息。

### 阶段 3：团队接入

1. `TeamOrchestrator` 的 `execute` 改用 actor，删除自建进程生命周期。
2. 增加槽位工作状态与事件：`queuedForeground/Background`、`activeTurnId`、`blockedReason`。
3. warmup 并行 + Leader 闸门 + 单成员重试。
4. 入队租约/幂等键。

**验收点**：

- 团队成员并行启动，Leader 就绪即可用；
- 单个成员失败不阻塞其他成员；
- `maxConcurrency` 与全局限制同时生效；
- 停止某成员不影响其他成员。

### 阶段 4：协议族适配器

按协议族扩展，而不是把运行时 ID 硬编码进 registry：

1. **Pi / OMP**：`pi -p --mode json`，解析逐行 JSON 事件；OMP 复用同一族。
2. **Codex**：`codex app-server --listen stdio://`，实现 turn/start、turn/interrupt、事件流。
3. **DSH**：按实际协议单独实现。
4. **Hermes**：继续走 ACP，验证 `session/new` 的 MCP 注入。
5. **custom**：用户选择协议族 + 命令/参数覆盖，不再直接报“尚未认证”。

**验收点**：

- 运行时检测、参数预填、连接测试、真实发送全链路可用；
- 非 Claude 运行时不再被 registry 拒绝；
- 各协议族共享同一套 actor/supervisor 调度。

### 阶段 5：可观测性

- 记录 `queued / started / ready / turn_started / turn_finished / evicted / start_failed`；
- 暴露每个运行时的活跃会话数、队列长度、最近错误；
- UI 增加“运行时状态”与“排队中 N”提示；
- 为调度参数提供设置项与诊断日志。

---

## 8. 风险与取舍

| 风险 | 说明 | 缓解 |
| --- | --- | --- |
| 常驻进程占用内存 | persistent 适配器越多，内存越高 | `maxWarmSessions` + 空闲 TTL + LRU |
| 进程复用导致状态污染 | 同一进程跨会话复用会串上下文 | 按会话隔离 actor，不跨会话复用进程 |
| 队列持久化复杂 | 需要处理崩溃、重启、重复执行 | 幂等键 + 状态机 + 启动时对账 |
| 取消不彻底 | CLI 派生子进程可能残留 | 进程组 + 宽限期 + 强制 SIGKILL |
| 协议差异 | 各适配器的取消、超时、审批能力不同 | 能力画像 + 按族策略，不强行统一 |
| 公平性 | 大团队可能占满 warm 名额 | 按工作区轮转 + 前台优先 + 可配置配额 |
| 调度层膨胀 | actor/supervisor 与业务耦合 | 三层职责分离，adapter 不感知队列 |

---

## 9. 结论

**最优的运行时调度不是“选 ACP 还是 MCP”，也不是“每任务一进程还是全常驻”，而是三层分工：**

1. **接入层**：协议族适配器，保留 Claude CLI + ACP，按需新增 Pi JSON、Codex app-server、DSH；`custom` 映射到协议族。
2. **执行层**：每会话一个 SessionRuntimeActor，单飞 + 队列 + 空闲回收；persistent 适配器复用进程，per-turn 适配器复用会话 ID。
3. **资源层**：RuntimeSupervisor 提供全局 warm 上限、启动信号量、优先级、公平性与 LRU 回收。
4. **团队层**：成员槽位独立 actor，Leader 优先，失败隔离，租约防重。
5. **可靠性**：启动重试一次、活动超时、审批暂停计时、断连惰性恢复、重启恢复队列。

这套模型同时获得 AionUi / AionCore 的低延迟与会话复用、Multica 的多协议接入与任务隔离，并避免两者在单机桌面上过重的部分。AionCore 源码进一步确认了三个关键事实：**每会话一个任务槽、空闲回收按会话 kill、团队调度用优先级车道 + 意图/批次/租约**；Pizza 可以直接复用这些结构，但必须补上 AionCore 没有的全局 warm 上限，并把 solo 队列从渲染层移到主进程。

**建议第一步**：先做阶段 1 的 supervisor/actor，再实现 Pi/OMP 适配器。这样既能立刻解决非 Claude 运行时无法接入的问题，也为 Codex、DSH 和团队调度打好同一套运行时资源层。

---

## 附录 A：查证位置

### A.1 AionUi

| 主题 | 位置 |
| --- | --- |
| ACP SDK 依赖 | `package.json:78` |
| 会话运行时摘要 | `packages/desktop/src/common/config/storage.ts:139-152` |
| ensure / restart 接口 | `packages/desktop/src/common/adapter/ipcBridge.ts:339-355` |
| 提示超时与空闲超时默认值 | `packages/desktop/src/renderer/components/settings/SettingsModal/contents/SystemModalContent/index.tsx:61-62, 268-280` |
| 单会话命令队列 | `packages/desktop/src/renderer/pages/conversation/platforms/useConversationCommandQueue.ts` |
| 会话生命周期 PRD | `docs/prds/conversations/acp/session.md` |
| 消息队列与合并 PRD | `docs/prds/conversations/acp/messaging.md` |
| 超时与错误恢复 PRD | `docs/prds/conversations/acp/reliability.md` |
| 团队槽位调度类型 | `packages/desktop/src/common/types/team/teamTypes.ts:95-151` |
| 团队 warmup 钩子 | `packages/desktop/src/renderer/pages/team/hooks/useTeamWarmup.ts` |
| 空闲回收后的发送门 | `packages/desktop/src/renderer/pages/team/components/teamSendRuntime.ts:44-70` |
| 团队运行体验 PRD | `docs/prds/teams/team-runtime-experience.md` |

### A.2 AionCore

| 主题 | 位置 |
| --- | --- |
| WorkerTaskManager / 每会话任务槽 | `crates/aionui-ai-agent/src/task_manager.rs:98-220` |
| 并发构建去重（OnceCell） | `crates/aionui-ai-agent/src/task_manager.rs:180-220` |
| 空闲任务筛选 | `crates/aionui-ai-agent/src/task_manager.rs:301-360` |
| Idle scanner 默认值（10/30/60） | `crates/aionui-ai-agent/src/idle_scanner.rs:11-24` |
| Active lease（90 秒） | `crates/aionui-ai-agent/src/active_lease.rs:3` |
| Agent 变体（Acp/Aionrs/Session） | `crates/aionui-ai-agent/src/agent_task.rs:190-230` |
| IAgentTask 生命周期接口 | `crates/aionui-ai-agent/src/agent_task.rs:30-110` |
| Turn claim（冲突 409） | `crates/aionui-conversation/src/runtime_state.rs:60-140` |
| Runtime summary 状态优先级 | `crates/aionui-conversation/src/runtime_state.rs:490-550` |
| Mid-turn 投递与确认门 | `crates/aionui-conversation/src/service.rs:3860-3935` |
| 取消看门狗（15 秒） | `crates/aionui-conversation/src/service.rs:69, 4419-4440` |
| 启动恢复（清理残留 work 消息） | `crates/aionui-conversation/src/startup_recovery.rs` |
| SuspendController（Active ⇄ Dormant） | `crates/aionui-session/src/backend/suspend.rs` |
| Session Orchestrator / FSM | `crates/aionui-session/src/backend/orchestrator.rs` |
| Admission（Started/Queued/NoTurn） | `crates/aionui-session/src/backend/types.rs:220-240` |
| 冷启动恢复为 Idle | `crates/aionui-session/src/backend/rehydrate.rs` |
| 团队 WorkCoordinator（优先级/意图/批次/租约） | `crates/aionui-team/src/work_coordinator/` |
| 团队 run 状态机 | `crates/aionui-team/src/team_run/manager.rs` |
| Lead 唤醒 / 状态机 | `crates/aionui-team/src/scheduler/state.rs` |
| 团队调度说明 | `crates/aionui-team/docs/internals.md` |

### A.3 Multica

| 主题 | 位置 |
| --- | --- |
| 协议族分派 | `server/pkg/agent/agent.go:469` |
| 协议族白名单 | `server/pkg/agent/agent.go:398` |
| 内置运行时描述与派生 | `server/pkg/agent/builtin_runtimes.go:89, 153, 170` |
| Claude stream-json | `server/pkg/agent/claude.go:1164` |
| Codex app-server | `server/pkg/agent/codex.go:375` |
| Pi JSON 模式 | `server/pkg/agent/pi.go:1197` |
| Hermes ACP | `server/pkg/agent/hermes.go:427` |
| 共用 ACP 会话客户端 | `server/pkg/agent/acp_session.go` |
| 单机并发默认值（20） | `server/internal/daemon/config.go:72` |
| 固定槽位信号量 | `server/internal/daemon/daemon.go:5592` |
| 批量领取 + 派发循环 | `server/internal/daemon/daemon.go:5369` |
| 任务级隔离环境 / worktree | `server/internal/daemon/execenv/execenv.go` |
| MCP 配置合并与注入 | `server/internal/daemon/runtime_mcp.go:36` |
| 运行时探测 | `server/internal/daemon/agents_probe.go` |
| 失败分类与恢复 | `server/pkg/taskfailure/` |
| A2A 内部协作语义 | `server/internal/handler/agent_access.go` 等 |

### A.4 Pizza

| 主题 | 位置 |
| --- | --- |
| 适配器注册表 | `src/main/runtime/registry.ts` |
| 适配器接口 | `src/main/runtime/types.ts` |
| 每次运行创建/关闭会话 | `src/main/services/agent-run-executor.ts:269, 408` |
| Claude 每轮 spawn | `src/main/runtime/claude-cli.ts:273` 起 |
| ACP 会话生命周期 | `src/main/runtime/acp-stdio.ts:175` 起 |
| 单会话 FIFO | `src/main/services/run-service.ts` |
| 团队并发控制 | `src/main/services/team-orchestrator.ts:570` |
| 运行时设置与测试 | `src/main/services/runtime-service.ts` |

> 注：`reference/AionUi`、`reference/AionCore` 与 `reference/multica` 均为只读参考资料，不参与构建与发布；本文只记录结论与查证位置，不复制其源码。
