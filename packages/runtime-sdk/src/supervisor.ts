import { JobCancelledError, SessionRuntimeActor, type ActorJob, type SupervisorHost } from './session-actor'
import type {
  RuntimeAdapter,
  RuntimeFamily,
  RuntimeModelCatalog,
  RuntimeSpec,
  SchedulerEvent,
  SupervisorOptions,
  SupervisorSnapshot,
} from './types'

interface Waiter<T> {
  resolve: (value: T) => void
  reject: (error: Error) => void
}

interface PendingTurn extends Waiter<() => void> {
  key: string
  priority: number
  seq: number
}

const DEFAULTS: Required<SupervisorOptions> = {
  maxWarmSessions: 4,
  maxConcurrentStarts: 2,
  maxConcurrentTurns: 4,
  idleTimeoutMs: 5 * 60_000,
  idleSweepMs: 30_000,
  maxQueuePerSession: 20,
  cancelGraceMs: 1_500,
}

/**
 * 全局运行时资源层。
 *
 * 三层职责：Adapter 负责协议，Actor 负责单会话串行与复用，Supervisor 负责
 * 全局 warm 上限、启动信号量、turn 并发、优先级公平与空闲 LRU 回收。
 * 它不接触数据库或 IPC，调用方通过 run/cancel/snapshot 使用即可。
 */
export class RuntimeSupervisor implements SupervisorHost {
  readonly maxQueuePerSession: number
  private readonly options: Required<SupervisorOptions>
  private readonly adapters: Map<RuntimeFamily, RuntimeAdapter>
  private readonly actors = new Map<string, SessionRuntimeActor>()
  private readonly listeners = new Set<(event: SchedulerEvent) => void>()
  private readonly warm = new Set<string>()
  private readonly startQueue: Array<Waiter<() => void>> = []
  private readonly turnQueue: PendingTurn[] = []
  private readonly lastTurnStartedAt = new Map<string, number>()
  private warmWaiters: Array<() => void> = []
  private activeStarts = 0
  private activeTurns = 0
  private turnSeq = 0
  private disposed = false
  private readonly sweeper: NodeJS.Timeout

  constructor(
    adapters: Map<RuntimeFamily, RuntimeAdapter>,
    options: SupervisorOptions = {},
  ) {
    this.adapters = adapters
    this.options = { ...DEFAULTS, ...options }
    this.maxQueuePerSession = this.options.maxQueuePerSession
    this.sweeper = setInterval(() => void this.sweepIdle(), this.options.idleSweepMs)
    this.sweeper.unref?.()
  }

  on(listener: (event: SchedulerEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: SchedulerEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 观察者异常不能影响调度。
      }
    }
  }

  adapterFor(family: RuntimeFamily): RuntimeAdapter {
    const adapter = this.adapters.get(family)
    if (!adapter) throw new Error(`未注册的运行时协议族：${family}`)
    return adapter
  }

  /** 查询某个运行时绑定的全部模型；不启动常驻进程，也不占用 warm 名额。 */
  listModels(spec: RuntimeSpec, signal?: AbortSignal): Promise<RuntimeModelCatalog> {
    return this.adapterFor(spec.family).listModels(spec, signal)
  }

  getActor(key: string, spec: RuntimeSpec): SessionRuntimeActor {
    const existing = this.actors.get(key)
    if (existing) {
      existing.updateSpec(spec)
      return existing
    }
    const actor = new SessionRuntimeActor(key, spec, this)
    this.actors.set(key, actor)
    return actor
  }

  /** 提交一个任务到指定会话；同一会话严格串行，其余任务在会话内 FIFO。 */
  run<T>(
    key: string,
    spec: RuntimeSpec,
    job: ActorJob<T>,
  ): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('运行时调度器已关闭'))
    return this.getActor(key, spec).submit(job)
  }

  cancelJob(key: string, jobId: string): boolean {
    return this.actors.get(key)?.cancelJob(jobId) ?? false
  }

  /** 应用退出时取消排队任务；活跃任务由调用方的 AbortController 处理。 */
  clearQueue(key: string): string[] {
    return this.actors.get(key)?.clearQueue() ?? []
  }

  touch(key: string): void {
    this.actors.get(key)?.touch()
  }

  /** 保护用户正在查看/操作的会话不被空闲或 LRU 回收。 */
  lease(key: string, ttlMs = 90_000): void {
    this.actors.get(key)?.lease(ttlMs)
  }

  isBusy(key: string): boolean {
    return this.actors.get(key)?.busy ?? false
  }

  hasActor(key: string): boolean {
    return this.actors.has(key)
  }

  snapshot(): SupervisorSnapshot {
    return {
      actors: Array.from(this.actors.values(), (actor) => actor.snapshot()),
      warm: this.warm.size,
      maxWarmSessions: this.options.maxWarmSessions,
      activeTurns: this.activeTurns,
      maxConcurrentTurns: this.options.maxConcurrentTurns,
      activeStarts: this.activeStarts,
      maxConcurrentStarts: this.options.maxConcurrentStarts,
      queuedTurns: this.turnQueue.length,
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    clearInterval(this.sweeper)
    for (const waiter of this.startQueue.splice(0)) {
      waiter.reject(new Error('运行时调度器已关闭'))
    }
    for (const waiter of this.turnQueue.splice(0)) {
      waiter.reject(new Error('运行时调度器已关闭'))
    }
    for (const waiter of this.warmWaiters.splice(0)) waiter()
    for (const actor of this.actors.values()) void actor.dispose()
    this.actors.clear()
    this.warm.clear()
  }

  // ---------- SupervisorHost ----------

  acquireStart(): Promise<() => void> {
    if (this.disposed) return Promise.reject(new Error('运行时调度器已关闭'))
    if (this.activeStarts < this.options.maxConcurrentStarts) {
      this.activeStarts += 1
      return Promise.resolve(this.startReleaser())
    }
    return new Promise((resolve, reject) => {
      this.startQueue.push({ resolve, reject })
    })
  }

  acquireTurn(key: string, priority: number): Promise<() => void> {
    if (this.disposed) return Promise.reject(new Error('运行时调度器已关闭'))
    if (this.activeTurns < this.options.maxConcurrentTurns) {
      this.admitTurn(key)
      return Promise.resolve(this.turnReleaser())
    }
    return new Promise((resolve, reject) => {
      this.turnQueue.push({ key, priority, seq: this.turnSeq++, resolve, reject })
    })
  }

  /**
   * 预留一个 persistent 会话的常驻名额。
   * 名额已满时先尝试 LRU 回收；没有可回收对象就等待其他 Actor 变为空闲。
   */
  async acquireWarmSlot(key: string): Promise<void> {
    while (!this.disposed) {
      if (this.warm.has(key)) return
      if (this.warm.size < this.options.maxWarmSessions) {
        this.warm.add(key)
        return
      }
      const victim = this.pickEvictable(key)
      if (victim) {
        const evicted = await victim.evict('lru')
        if (evicted) continue
        // 状态在检查与回收之间变化时不要忙等；等下一次状态变化再试。
        await new Promise<void>((resolve) => this.warmWaiters.push(resolve))
        continue
      }
      await new Promise<void>((resolve) => this.warmWaiters.push(resolve))
    }
  }

  releaseWarm(key: string): void {
    if (this.warm.delete(key)) this.wakeAdmissions()
  }

  wakeAdmissions(): void {
    const waiters = this.warmWaiters.splice(0)
    for (const resolve of waiters) resolve()
  }

  // ---------- internals ----------

  private startReleaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeStarts = Math.max(0, this.activeStarts - 1)
      const next = this.startQueue.shift()
      if (next) {
        this.activeStarts += 1
        next.resolve(this.startReleaser())
      }
    }
  }

  private turnReleaser(): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      this.activeTurns = Math.max(0, this.activeTurns - 1)
      const next = this.pickNextTurn()
      if (next) {
        this.admitTurn(next.key)
        next.resolve(this.turnReleaser())
      }
    }
  }

  private admitTurn(key: string): void {
    this.activeTurns += 1
    this.lastTurnStartedAt.set(key, Date.now())
  }

  /**
   * 优先级优先，其次让最久没有获得 turn 的会话先跑，避免大团队饿死其他会话。
   */
  private pickNextTurn(): PendingTurn | null {
    if (this.turnQueue.length === 0) return null
    let bestIndex = 0
    for (let index = 1; index < this.turnQueue.length; index += 1) {
      if (this.betterTurn(this.turnQueue[index], this.turnQueue[bestIndex])) {
        bestIndex = index
      }
    }
    return this.turnQueue.splice(bestIndex, 1)[0]
  }

  private betterTurn(a: PendingTurn, b: PendingTurn): boolean {
    if (a.priority !== b.priority) return a.priority < b.priority
    const aLast = this.lastTurnStartedAt.get(a.key) ?? 0
    const bLast = this.lastTurnStartedAt.get(b.key) ?? 0
    if (aLast !== bLast) return aLast < bLast
    return a.seq < b.seq
  }

  private pickEvictable(excludeKey: string): SessionRuntimeActor | null {
    let best: SessionRuntimeActor | null = null
    let bestAt = Number.POSITIVE_INFINITY
    for (const actor of this.actors.values()) {
      if (actor.key === excludeKey) continue
      if (!actor.isWarm) continue
      if (actor.currentState !== 'ready' || actor.busy || actor.isLeased()) continue
      const at = actor.snapshot().lastActiveAt ?? 0
      if (at < bestAt) {
        best = actor
        bestAt = at
      }
    }
    return best
  }

  private async sweepIdle(): Promise<void> {
    if (this.disposed) return
    const now = Date.now()
    for (const actor of this.actors.values()) {
      if (actor.currentState !== 'ready' || actor.busy || actor.isLeased()) continue
      const lastActiveAt = actor.snapshot().lastActiveAt ?? now
      if (now - lastActiveAt < this.options.idleTimeoutMs) continue
      await actor.evict('idle')
    }
  }
}

export { JobCancelledError }
