import { JobCancelledError } from '@runtime-sdk'

interface Waiter {
  runId: string
  limit: number
  resolve: (release: () => void) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  onAbort: () => void
}

/**
 * 按智能体维度限制同时运行的任务数。
 *
 * 与 RuntimeSupervisor 的全局并发是两层独立限制：这里只回答“同一个智能体
 * 允许几个运行”，全局信号量仍负责运行时启动与 turn 的资源上限。
 */
export class AgentConcurrencyGate {
  private readonly running = new Map<string, number>()
  private readonly waiters = new Map<string, Waiter[]>()

  async acquire(input: {
    agentId: string
    runId: string
    limit: number
    signal?: AbortSignal
    /** 需要排队时同步回调，便于调用方先把消息标记为排队。 */
    onQueued?: () => void
  }): Promise<() => void> {
    const limit = Math.max(1, Math.trunc(input.limit) || 1)
    const active = this.running.get(input.agentId) ?? 0
    if (active < limit) {
      this.running.set(input.agentId, active + 1)
      return this.createRelease(input.agentId)
    }

    if (input.signal?.aborted) throw new JobCancelledError(input.runId)
    input.onQueued?.()

    return new Promise<() => void>((resolve, reject) => {
      const queue = this.waiters.get(input.agentId) ?? []
      this.waiters.set(input.agentId, queue)
      const waiter: Waiter = {
        runId: input.runId,
        limit,
        resolve,
        reject,
        signal: input.signal,
        onAbort: () => {},
      }
      waiter.onAbort = () => {
        const index = queue.indexOf(waiter)
        if (index >= 0) queue.splice(index, 1)
        this.cleanupQueue(input.agentId, queue)
        reject(new JobCancelledError(input.runId))
      }
      input.signal?.addEventListener('abort', waiter.onAbort, { once: true })
      queue.push(waiter)
    })
  }

  private createRelease(agentId: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const active = Math.max(0, (this.running.get(agentId) ?? 1) - 1)
      if (active === 0) this.running.delete(agentId)
      else this.running.set(agentId, active)
      this.drain(agentId)
    }
  }

  private drain(agentId: string): void {
    const queue = this.waiters.get(agentId)
    if (!queue) return
    while (queue.length > 0) {
      const active = this.running.get(agentId) ?? 0
      const waiter = queue[0]
      if (active >= waiter.limit) return
      queue.shift()
      waiter.signal?.removeEventListener('abort', waiter.onAbort)
      if (waiter.signal?.aborted) {
        waiter.reject(new JobCancelledError(waiter.runId))
        continue
      }
      this.running.set(agentId, active + 1)
      waiter.resolve(this.createRelease(agentId))
    }
    this.cleanupQueue(agentId, queue)
  }

  private cleanupQueue(agentId: string, queue: Waiter[]): void {
    if (queue.length === 0) this.waiters.delete(agentId)
  }
}
