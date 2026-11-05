# Pizza Runtime SDK

运行时调度 SDK：把“怎么连一个 Agent CLI”和“多个会话如何共享一台机器”拆成两个独立问题。

这个包**不依赖 Electron、SQLite、React 或任何主进程服务**，只使用 Node 标准库。它可以直接被其他 Node 应用复用，也可以作为 Rust 等语言重写时的行为规格。

## 目录结构

```
packages/runtime-sdk/
├── src/
│   ├── types.ts              # 公共契约：RuntimeSpec / Adapter / Actor 状态 / 调度事件
│   ├── process.ts            # 子进程、进程组、逐行读取、终止宽限期
│   ├── jsonrpc.ts            # 换行分隔 JSON-RPC 客户端（ACP / Codex 共用）
│   ├── session-actor.ts      # 单会话状态机：懒启动、单飞、FIFO、空闲计时
│   ├── supervisor.ts         # 全局资源层：warm 上限、启动/turn 信号量、LRU
│   ├── adapters/             # 协议族适配器
│   │   ├── claude-cli.ts     # Claude Code stream-json（per-turn）
│   │   ├── acp.ts            # ACP stdio（persistent）
│   │   ├── codex-app-server.ts
│   │   ├── pi-json.ts        # Pi / OMP JSON 事件（per-turn + 会话文件）
│   │   ├── dsh.ts            # DSH 版本化 JSONL（per-turn）
│   │   └── plain-cli.ts      # 任意 CLI 的纯文本兜底
│   └── protocol/             # 逐协议事件解析，纯函数，便于单测与移植
└── README.md
```

## 三层职责

```
RuntimeSupervisor        全局：warm 名额、启动并发、turn 并发、优先级、LRU
        │ acquire/release
SessionRuntimeActor      单会话：懒启动、单飞、FIFO、空闲计时、失效重建
        │ openSession / prompt
ProtocolFamilyAdapter    协议：argv、握手、事件解析、取消、关闭
```

适配器永远不感知队列；Actor 永远不感知其他会话；Supervisor 永远不解析协议。

## 会话状态机

```
dormant ──ensure──> starting ──ok──> ready ──prompt──> running
   ▲                   │                ▲                 │
   │                   └──fail──> failed│                 ├─ turn done ──> ready
   │                                    │                 │
   └──────── idle TTL / LRU ────────────┴─────────────────┘
```

- `persistent`：进程跨 turn 复用（ACP、Codex）。
- `per-turn`：每个 turn 重新启动，只缓存 `runtimeSessionId`（Claude、Pi/OMP、DSH、通用 CLI）。
- 同一会话任意时刻只有一个 turn；其余任务进入会话内 FIFO。
- `ready` 且无任务、无活跃租约时，才会被空闲或 LRU 回收。
- 启动失败自动重试一次；运行失败不会把整个运行时永久标记为不可用，下一次任务会重新 ensure。

## 调度参数

| 选项 | 默认值 | 作用 |
| --- | --- | --- |
| `maxWarmSessions` | 4 | 同时常驻的 persistent 会话上限 |
| `maxConcurrentStarts` | 2 | 同时冷启动的进程数 |
| `maxConcurrentTurns` | 4 | 全局同时执行的 turn 数 |
| `idleTimeoutMs` | 5 分钟 | 空闲回收阈值 |
| `idleSweepMs` | 30 秒 | 空闲扫描间隔 |
| `maxQueuePerSession` | 20 | 单会话排队上限 |
| `cancelGraceMs` | 1.5 秒 | 取消后杀进程树的宽限期 |

优先级：用户消息 `0` > 团队指挥者 `1` > 团队成员 `2` > 后台 `3`。同优先级下优先让最久没有获得 turn 的会话执行，避免大团队饿死其他会话。

## 最小用法

```ts
import { RuntimeSupervisor, createDefaultAdapters } from '@runtime-sdk'

const supervisor = new RuntimeSupervisor(createDefaultAdapters(), {
  maxWarmSessions: 4,
  maxConcurrentTurns: 4,
})

const result = await supervisor.run(
  `session-42`,
  {
    kind: 'pi',
    family: 'pi-json',
    command: 'pi',
    args: [],
    env: {},
    sessionDir: '/path/to/sessions',
  },
  {
    id: 'run-1',
    priority: 0,
    signal: abortController.signal,
    run: (session) =>
      session.prompt({
        prompt: '你好',
        systemPrompt: '',
        sessionId: 'session-42',
        runtimeSessionId: previousRuntimeSessionId,
        cwd: '/path/to/workspace',
        attachmentPaths: [],
        signal: abortController.signal,
        onEvent: (event) => console.log(event),
      }),
  },
)
```

`supervisor.run` 返回任务结果；排队、会话复用、空闲回收都由 Actor/Supervisor 处理。取消用传入的 `AbortSignal`，或调用 `supervisor.cancelJob(key, jobId)`。

## 协议族

| family | 启动方式 | 生命周期 | 事件来源 |
| --- | --- | --- | --- |
| `claude-cli` | `claude -p --output-format stream-json` | per-turn | `system/stream_event/assistant/result` |
| `acp` | 用户配置的 ACP 命令 | persistent | JSON-RPC `session/update` |
| `codex-app-server` | `codex app-server --listen stdio://` | persistent | JSON-RPC 通知 `item/*`、`turn/*` |
| `pi-json` | `pi -p --mode json` | per-turn + 会话文件 | `message_update`、`tool_execution_*`、`turn_end` |
| `dsh` | `dsh --profile <jsonl-profile> --stdio` | per-turn | JSONL `ready/session/text/tool_*/usage/result`（官方 `acp` profile 请直接用 ACP 族） |
| `plain-cli` | 任意命令 | per-turn | stdout 纯文本 |

运行时身份（`claude-code` / `pi` / `omp` / `codex` / `dsh` / `custom`）由调用方映射到 family；新增运行时通常只需要一条映射，不需要改调度器。

## 模型与思考强度发现

`RuntimeAdapter.listModels(spec, signal?)` 返回 `RuntimeModelCatalog`：

```ts
interface RuntimeModelInfo {
  id: string                 // 原样传给运行时的模型值
  label: string
  provider?: string
  description?: string
  default?: boolean
  disabled?: boolean
  thinkingLevels?: string[]  // 该模型支持的强度
  defaultThinkingLevel?: string
}

interface RuntimeModelCatalog {
  models: RuntimeModelInfo[]
  thinkingLevels?: string[]  // 模型未单独声明时的运行时级强度
  defaultThinkingLevel?: string
}
```

`RuntimeSupervisor.listModels(spec, signal?)` 按协议族转发，不启动常驻进程，也不占用 warm 名额。

| family | 发现方式 |
| --- | --- |
| `claude-cli` | stream-json `control_request {subtype:"list_models"}`，不调用模型、不产生费用 |
| `acp` | 临时 `session/new` 的 `configOptions`（model / thought_level）；兼容旧版 `models.availableModels` |
| `codex-app-server` | `codex debug models`，失败时回退 `--bundled` |
| `pi-json`（Pi） | `pi --list-models` 表格 |
| `pi-json`（OMP） | `omp models --json` |
| `dsh` | `dsh --profile <name> --list-models` 的 `models` 帧 |
| `plain-cli` | 空目录，由调用方手动填写 |

发现失败返回空目录，而不是让运行时注册失败；调用方可以继续使用“由运行时管理”或手动模型值。

选中后的应用方式：Claude 用 `--model/--effort`；Codex 在 `thread/start` 与 `turn/start` 写入模型/effort，模型变化会重建线程；Pi/OMP 用 `--model/--thinking`；ACP 用 `session/set_config_option`（旧版用 `session/set_model`）；DSH 写入 execute 命令。

## Rust 移植映射

| TypeScript | Rust 建议 |
| --- | --- |
| `RuntimeAdapter` interface | `trait RuntimeAdapter`（`#[async_trait]`） |
| `RuntimeFamily` union | `enum RuntimeFamily` |
| `AdapterProfile` | `struct AdapterProfile`，随 adapter 返回 |
| `SessionRuntimeActor` | `struct SessionRuntimeActor` + `tokio::sync::Mutex<State>` |
| Actor 内 FIFO | `VecDeque<Job>`，单飞用 `Option<ActiveJob>` |
| `RuntimeSupervisor` | `struct RuntimeSupervisor` + `tokio::sync::Semaphore`（start/turn） |
| warm LRU | `HashMap<Key, Instant>` + `BinaryHeap` 或 `lru` crate |
| 空闲扫描 | `tokio::time::interval` |
| 子进程 | `tokio::process::Command`，POSIX 下 `process_group(0)` |
| 进程树终止 | 先 `kill(-pid, SIGTERM)`，宽限期后 `SIGKILL` |
| 逐行 JSON | `tokio::io::BufReader::lines()` + `serde_json` |
| `AbortSignal` | `CancellationToken` / `tokio::select!` |
| 事件回调 | `tokio::sync::mpsc::Sender<NormalizedEvent>` |

移植时保持三件事不变，其他都可以按语言习惯调整：

1. **每会话单飞**：同一 key 的 prompt 永不并发。
2. **启动与 turn 分离限流**：冷启动和正在跑的 turn 使用不同信号量。
3. **只有 ready、无任务、无租约的会话可回收**；persistent 复用进程，per-turn 只复用会话 ID。

## 测试

- `tests/runtime-sdk/scheduler.test.ts`：进程复用、单飞、FIFO、队列上限、启动/turn 并发、取消、空闲回收、LRU、租约保护。
- `tests/runtime-sdk/protocols.test.ts`：Pi、Codex、DSH 事件解析。
- `tests/main/runtime-registry.test.ts`：运行时身份到协议族的映射。

协议解析器都是纯函数，移植时可以用相同输入输出做对照测试。
