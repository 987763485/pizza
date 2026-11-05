import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  abortPromise,
  collectStderr,
  readLines,
  spawnRuntime,
  terminateProcessTree,
  waitForSpawn,
} from './process'
import type { RuntimeSpec } from './types'

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: unknown
  result?: unknown
  error?: { code?: number; message?: string; data?: unknown }
}

interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout
  cleanup?: () => void
}

export type ServerRequestHandler = (
  method: string,
  params: Record<string, unknown>,
) => Promise<unknown | undefined>

/**
 * 换行分隔的 JSON-RPC 2.0 客户端。
 *
 * ACP 与 Codex app-server 都使用同一套传输：一行一个 JSON 消息。
 * 进程生命周期与请求生命周期分开：请求被取消不会杀掉进程，由调用方决定。
 */
export class JsonRpcStdioClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private readonly pending = new Map<number | string, PendingRequest>()
  private nextId = 1
  private closed = false

  constructor(private readonly spec: RuntimeSpec) {}


  onNotification: ((method: string, params: Record<string, unknown>) => void) | null = null
  onServerRequest: ServerRequestHandler | null = null
  onExit: ((code: number | null) => void) | null = null

  private get stderrText(): string {
    return this.stderrReader?.() ?? ''
  }

  private stderrReader: (() => string) | null = null

  async start(args: string[], signal?: AbortSignal): Promise<void> {
    if (this.child) return
    const child = spawnRuntime(this.spec, { args })
    this.child = child
    this.stderrReader = collectStderr(child)
    readLines(child.stdout, (line) => this.handleLine(line))

    child.once('close', (code) => {
      this.closed = true
      const error = new Error(
        `运行时进程退出（${code ?? 'signal'}）：${this.stderrText.slice(-800)}`,
      )
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.cleanup?.()
        pending.reject(error)
      }
      this.pending.clear()
      this.onExit?.(code)
      this.child = null
    })

    const abort = () => this.close()
    signal?.addEventListener('abort', abort, { once: true })
    try {
      await waitForSpawn(child)
    } finally {
      signal?.removeEventListener('abort', abort)
    }
  }

  setStderrReader(reader: () => string): void {
    this.stderrReader = reader
  }

  isAlive(): boolean {
    return Boolean(this.child && !this.closed)
  }

  get processId(): number | undefined {
    return this.child?.pid
  }

  request<T = unknown>(
    method: string,
    params: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<T> {
    if (!this.child?.stdin.writable) {
      return Promise.reject(new Error('运行时进程未运行'))
    }
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`运行时请求超时：${method}`))
      }, timeoutMs)
      timer.unref?.()
      const onAbort = () => {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new Error('运行已取消'))
      }
      if (signal) {
        if (signal.aborted) {
          clearTimeout(timer)
          reject(new Error('运行已取消'))
          return
        }
        signal.addEventListener('abort', onAbort, { once: true })
      }
      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
        cleanup: () => signal?.removeEventListener('abort', onAbort),
      })
      this.write({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method: string, params: unknown): void {
    this.write({ jsonrpc: '2.0', method, params })
  }

  close(): void {
    const child = this.child
    if (!child) return
    this.child = null
    this.closed = true
    terminateProcessTree(child)
  }

  /** 用一个短请求确认进程仍然响应；用于把“进程还在但已失联”的会话判定为失效。 */
  async ping(method: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.request(method, {}, 5_000, signal)
      return true
    } catch {
      return false
    }
  }

  private write(message: JsonRpcMessage): void {
    if (!this.child?.stdin.writable) return
    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private handleLine(line: string): void {
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line) as JsonRpcMessage
    } catch {
      return
    }

    // 服务端 -> 客户端请求。
    if (message.id !== undefined && message.method) {
      void this.handleServerRequest(message)
      return
    }

    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      clearTimeout(pending.timer)
      pending.cleanup?.()
      if (message.error) {
        pending.reject(new Error(message.error.message || '运行时请求失败'))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    if (message.method) {
      this.onNotification?.(message.method, asRecord(message.params))
    }
  }

  private async handleServerRequest(message: JsonRpcMessage): Promise<void> {
    const id = message.id
    const method = message.method ?? ''
    try {
      const result = this.onServerRequest
        ? await this.onServerRequest(method, asRecord(message.params))
        : undefined
      if (result === undefined) {
        this.write({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unsupported method: ${method}` },
        })
      } else {
        this.write({ jsonrpc: '2.0', id, result })
      }
    } catch (error) {
      this.write({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: error instanceof Error ? error.message : String(error),
        },
      })
    }
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

export { abortPromise }
