import type {
  ActorSnapshot,
  ActorState,
  RuntimeAdapter,
  RuntimeSession,
  RuntimeSpec,
  SchedulerEvent,
} from './types'

export class JobCancelledError extends Error {
  readonly code = 'JOB_CANCELLED'
  constructor(readonly jobId: string) {
    super(`任务已取消：${jobId}`)
    this.name = 'JobCancelledError'
  }
}

export class QueueFullError extends Error {
  readonly code = 'QUEUE_FULL'
  constructor(readonly key: string, readonly limit: number) {
    super(`会话队列已满（上限 ${limit}）`)
    this.name = 'QueueFullError'
  }
}

export interface ActorJob<T> {
  id: string
  priority?: number
  signal?: AbortSignal
  run(session: RuntimeSession): Promise<T>
}

interface QueuedJob<T> {
  job: ActorJob<T>
  resolve: (value: T) => void
  reject: (error: Error) => void
  seq: number
}

/**
 * Actor 需要宿主提供的调度能力；由 RuntimeSupervisor 实现。
 * 拆成接口是为了避免 Actor 与 Supervisor 的循环运行时依赖。
 */
export interface SupervisorHost {
  adapterFor(family: RuntimeSpec['family']): RuntimeAdapter
  acquireStart(): Promise<() => void>
  acquireTurn(key: string, priority: number): Promise<() => void>
  acquireWarmSlot(key: string): Promise<void>
  releaseWarm(key: string): void
  emit(event: SchedulerEvent): void
  wakeAdmissions(): void
  maxQueuePerSession: number
}

interface InternalActive {
  id: string
  priority: number
  startedAt: number
}

/**
 * 一个逻辑会话（单智能体会话、或团队中的成员槽位）的运行时状态机。
 *
 * 负责：懒启动、单飞、会话内 FIFO、空闲计时、失效重建。
 * 不负责：全局并发与 warm 名额，这些由 RuntimeSupervisor 决定。
 */
export class SessionRuntimeActor {
  private state: ActorState = 'dormant'
  private session: RuntimeSession | null = null
  private queue: Array<QueuedJob<unknown>> = []
  private active: InternalActive | null = null
  private pumping = false
  private disposed = false
  private seq = 0
  private specKey = ''
  private lastActiveAt: number | null = null
  private leaseUntil = 0
  private lastError: string | null = null

  constructor(
    readonly key: string,
    private spec: RuntimeSpec,
    private readonly host: SupervisorHost,
  ) {
    this.specKey = specFingerprint(spec)
  }

  get queuedCount(): number {
    return this.queue.length
  }

  get busy(): boolean {
    return Boolean(this.active || this.queue.length > 0)
  }

  get live(): boolean {
    return Boolean(this.session)
  }

  get currentState(): ActorState {
    return this.state
  }

  get activeJobId(): string | null {
    return this.active?.id ?? null
  }

  get isWarm(): boolean {
    return Boolean(this.session)
  }

  updateSpec(spec: RuntimeSpec): void {
    const next = specFingerprint(spec)
    if (next === this.specKey) return
    this.specKey = next
    this.spec = spec
    // 运行时配置变化后旧进程的能力已过期；下个任务前重建。
    this.dropSession()
  }

  touch(): void {
    this.lastActiveAt = Date.now()
  }

  lease(ttlMs = 90_000): void {
    this.leaseUntil = Date.now() + ttlMs
    this.touch()
  }

  isLeased(): boolean {
    return Date.now() < this.leaseUntil
  }

  snapshot(): ActorSnapshot {
    return {
      key: this.key,
      family: this.spec.family,
      state: this.state,
      queued: this.queue.length,
      activeJobId: this.active?.id ?? null,
      lastActiveAt: this.lastActiveAt,
      lastError: this.lastError,
      warm: Boolean(this.session),
    }
  }

  submit<T>(job: ActorJob<T>): Promise<T> {
    if (this.disposed) return Promise.reject(new Error('运行时会话已销毁'))
    if (this.queue.length >= this.host.maxQueuePerSession) {
      return Promise.reject(new QueueFullError(this.key, this.host.maxQueuePerSession))
    }
    return new Promise<T>((resolve, reject) => {
      this.queue.push({
        job,
        resolve: resolve as (value: unknown) => void,
        reject,
        seq: this.seq++,
      })
      this.emitQueue()
      void this.pump()
    })
  }

  /** 清空排队任务并返回被取消的任务 ID；活跃任务由调用方自行取消。 */
  clearQueue(): string[] {
    const ids = this.queue.map((item) => item.job.id)
    for (const item of this.queue.splice(0)) {
      item.reject(new JobCancelledError(item.job.id))
    }
    this.emitQueue()
    return ids
  }

  cancelJob(jobId: string): boolean {
    const index = this.queue.findIndex((item) => item.job.id === jobId)
    if (index >= 0) {
      const [item] = this.queue.splice(index, 1)
      item.reject(new JobCancelledError(jobId))
      this.emitQueue()
      return true
    }
    if (this.active?.id === jobId) {
      this.session?.cancel()
      return true
    }
    return false
  }

  /** 空闲回收：只允许回收 ready、无任务、无活跃租约的 Actor。 */
  async evict(reason: 'idle' | 'lru' | 'shutdown'): Promise<boolean> {
    if (this.active || this.queue.length > 0 || this.state !== 'ready') return false
    if (reason === 'idle' && this.isLeased()) return false
    const wasWarm = Boolean(this.session)
    this.dropSession()
    this.setState('dormant')
    if (wasWarm) this.host.emit({ type: 'evicted', key: this.key, reason })
    return true
  }

  async dispose(): Promise<void> {
    this.disposed = true
    for (const item of this.queue.splice(0)) {
      item.reject(new JobCancelledError(item.job.id))
    }
    this.session?.close()
    this.session = null
    this.state = 'dormant'
    this.host.releaseWarm(this.key)
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.disposed || this.active) return
    this.pumping = true
    try {
      while (!this.disposed && !this.active && this.queue.length > 0) {
        // 先出队再启动：启动中的任务不应继续占用“等待队列”的名额。
        const item = this.queue.shift() as QueuedJob<unknown>
        this.emitQueue()
        if (this.disposed || item.job.signal?.aborted) {
          item.reject(new JobCancelledError(item.job.id))
          continue
        }

        let session: RuntimeSession
        try {
          session = await this.ensureSession(item.job.signal)
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)))
          this.dropSession()
          this.setState('failed', errorMessage(error))
          continue
        }

        if (this.disposed || item.job.signal?.aborted) {
          // 会话已经就绪但任务在启动期间被取消：不执行它。
          if (this.adapter.profile.lifecycle === 'per-turn') this.dropSession()
          item.reject(new JobCancelledError(item.job.id))
          continue
        }
        let releaseTurn: () => void
        try {
          releaseTurn = await this.host.acquireTurn(this.key, item.job.priority ?? 0)
        } catch (error) {
          // 调度器关闭等外部原因导致拿不到 turn 名额：结算任务，避免悬挂。
          if (this.adapter.profile.lifecycle === 'per-turn') this.dropSession()
          item.reject(error instanceof Error ? error : new Error(String(error)))
          continue
        }
        if (this.disposed || item.job.signal?.aborted) {
          releaseTurn()
          if (this.adapter.profile.lifecycle === 'per-turn') this.dropSession()
          item.reject(new JobCancelledError(item.job.id))
          continue
        }

        this.active = {
          id: item.job.id,
          priority: item.job.priority ?? 0,
          startedAt: Date.now(),
        }
        this.setState('running')
        this.touch()
        this.emitQueue()
        this.host.emit({
          type: 'turn_started',
          key: this.key,
          jobId: item.job.id,
          priority: item.job.priority ?? 0,
        })

        const startedAt = Date.now()
        let ok = false
        try {
          const result = await item.job.run(session)
          ok = true
          item.resolve(result)
        } catch (error) {
          item.reject(error instanceof Error ? error : new Error(String(error)))
        } finally {
          this.active = null
          this.lastActiveAt = Date.now()
          releaseTurn()
          this.host.emit({
            type: 'turn_finished',
            key: this.key,
            jobId: item.job.id,
            ok,
            durationMs: Date.now() - startedAt,
          })
          // per-turn 适配器每个任务一个会话；persistent 会话继续常驻。
          if (this.adapter.profile.lifecycle === 'per-turn') this.dropSession()
          this.refreshStateAfterTurn(ok)
          this.emitQueue()
          this.host.wakeAdmissions()
        }
      }
    } finally {
      this.pumping = false
      if (!this.disposed && !this.active && this.queue.length > 0) {
        queueMicrotask(() => void this.pump())
      }
    }
  }

  private async ensureSession(signal?: AbortSignal): Promise<RuntimeSession> {
    if (this.session && this.sessionAlive(this.session)) {
      if (this.state !== 'running') this.setState('ready')
      return this.session
    }
    this.dropSession()

    const adapter = this.adapter
    const persistent = adapter.profile.lifecycle === 'persistent'
    if (persistent) {
      await this.host.acquireWarmSlot(this.key)
      if (this.disposed || signal?.aborted) {
        this.host.releaseWarm(this.key)
        throw new JobCancelledError('startup')
      }
    }

    const releaseStart = await this.host.acquireStart()
    if (this.disposed || signal?.aborted) {
      releaseStart()
      if (persistent) this.host.releaseWarm(this.key)
      throw new JobCancelledError('startup')
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), adapter.profile.startupTimeoutMs)
    timer.unref?.()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })

    this.setState('starting')
    try {
      // 启动失败自动重试一次；认证/配置错误通常也会在第二次立即失败。
      let lastError: unknown = null
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (controller.signal.aborted) break
        try {
          const session = await adapter.openSession(this.spec, controller.signal)
          this.session = session
          this.lastError = null
          this.lastActiveAt = Date.now()
          this.setState('ready')
          return session
        } catch (error) {
          lastError = error
          if (controller.signal.aborted) break
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError))
    } catch (error) {
      if (persistent) this.host.releaseWarm(this.key)
      this.host.emit({
        type: 'start_failed',
        key: this.key,
        error: errorMessage(error),
      })
      throw error
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      releaseStart()
    }
  }

  private get adapter(): RuntimeAdapter {
    return this.host.adapterFor(this.spec.family)
  }

  private refreshStateAfterTurn(ok: boolean): void {
    if (this.disposed) return
    if (this.adapter.profile.lifecycle === 'per-turn') {
      this.setState('dormant')
      return
    }
    if (this.session && this.sessionAlive(this.session)) {
      this.setState('ready')
      return
    }
    this.dropSession()
    this.setState(ok ? 'dormant' : 'failed')
  }

  private sessionAlive(session: RuntimeSession): boolean {
    return session.alive ? session.alive() : true
  }

  private dropSession(): void {
    if (!this.session) return
    this.session.close()
    this.session = null
    this.host.releaseWarm(this.key)
  }

  private setState(state: ActorState, error?: string): void {
    if (error !== undefined) this.lastError = error
    if (this.state === state) return
    this.state = state
    this.host.emit({ type: 'state_changed', key: this.key, state, error })
  }

  private emitQueue(): void {
    this.host.emit({
      type: 'queue_changed',
      key: this.key,
      queued: this.queue.length,
      activeJobId: this.active?.id ?? null,
    })
  }
}

function specFingerprint(spec: RuntimeSpec): string {
  return JSON.stringify({
    kind: spec.kind,
    family: spec.family,
    command: spec.command ?? '',
    args: spec.args,
    cwd: spec.cwd ?? '',
    env: spec.env,
    sessionDir: spec.sessionDir ?? '',
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
