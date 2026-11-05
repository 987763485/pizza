import { spawn, type ChildProcess, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { RuntimeSpec } from './types'

export interface SpawnOptions {
  args?: string[]
  cwd?: string
  env?: Record<string, string>
}

/**
 * 启动运行时子进程。
 *
 * POSIX 下使用独立进程组（detached），取消时可以杀整棵树，避免 CLI 派生的
 * 子进程变成孤儿。stdout/stderr 保持管道，便于逐行解析协议。
 */
export function spawnRuntime(
  spec: RuntimeSpec,
  options: SpawnOptions = {},
): ChildProcessWithoutNullStreams {
  if (!spec.command) throw new Error(`运行时「${spec.kind}」未配置启动命令`)
  return spawn(spec.command, [...spec.args, ...(options.args ?? [])], {
    cwd: options.cwd ?? spec.cwd ?? process.cwd(),
    env: { ...process.env, ...spec.env, ...(options.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  })
}

/** 等待 spawn 成功或失败；`spawn()` 本身不会为 ENOENT 抛错。 */
export function waitForSpawn(child: ChildProcess): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSpawn = () => {
      child.off('error', onError)
      resolve()
    }
    const onError = (error: Error) => {
      child.off('spawn', onSpawn)
      reject(error)
    }
    if (child.pid) {
      resolve()
      return
    }
    child.once('spawn', onSpawn)
    child.once('error', onError)
  })
}

export function waitForExit(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.exitCode)
      return
    }
    child.once('error', () => resolve(null))
    child.once('close', (code) => resolve(code))
  })
}

/** 只终止当前进程，用于测试等明确没有子进程的场景。 */
export function killPid(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM'): void {
  if (!child.pid) return
  try {
    if (process.platform !== 'win32') process.kill(-child.pid, signal)
    else child.kill(signal)
  } catch {
    try {
      child.kill(signal)
    } catch {
      // 进程已经退出。
    }
  }
}

export function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
    } catch {
      child.kill('SIGKILL')
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    try {
      child.kill('SIGKILL')
    } catch {
      // 进程已经退出。
    }
  }
}

/** 先温和终止，宽限期后强杀整棵进程树。 */
export function terminateProcessTree(child: ChildProcess, graceMs = 1500): void {
  if (!child.pid || child.exitCode !== null) return
  killPid(child, 'SIGTERM')
  const timer = setTimeout(() => killProcessTree(child), graceMs)
  timer.unref?.()
  child.once('close', () => clearTimeout(timer))
}

/** 把可读流切成行；最后残留的半行也会在流结束时交付。 */
export function readLines(
  stream: NodeJS.ReadableStream,
  onLine: (line: string) => void,
): () => void {
  let buffer = ''
  const onData = (chunk: Buffer | string) => {
    buffer += chunk.toString()
    let index = buffer.indexOf('\n')
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, '')
      buffer = buffer.slice(index + 1)
      if (line.trim()) onLine(line)
      index = buffer.indexOf('\n')
    }
  }
  const onEnd = () => {
    if (buffer.trim()) onLine(buffer)
    buffer = ''
  }
  stream.on('data', onData)
  stream.on('end', onEnd)
  return () => {
    stream.off('data', onData)
    stream.off('end', onEnd)
  }
}

export function collectStderr(child: ChildProcess, limit = 20_000): () => string {
  let text = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    text += chunk.toString('utf8')
    if (text.length > limit) text = text.slice(-limit)
  })
  return () => text
}

/** 去掉终端颜色控制符，CLI 的诊断信息经常带 ANSI。 */
export function stripAnsi(value: string): string {
  return value.replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
}

export interface CaptureResult {
  code: number | null
  stdout: string
  stderr: string
  timedOut: boolean
}

/** 一次性执行命令并收集输出；用于版本探测、模型目录查询等短命令。 */
export function runCommand(
  spec: RuntimeSpec,
  args: string[],
  options: { input?: string; timeoutMs: number; signal?: AbortSignal; cwd?: string } = {
    timeoutMs: 20_000,
  },
): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams
    try {
      child = spawnRuntime(spec, { args, cwd: options.cwd })
    } catch (error) {
      resolve({
        code: null,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        timedOut: false,
      })
      return
    }
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const finish = (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
      resolve({ code, stdout, stderr, timedOut })
    }
    const timer = setTimeout(() => {
      timedOut = true
      terminateProcessTree(child, 1000)
      finish(null)
    }, options.timeoutMs)
    timer.unref?.()
    const abort = () => {
      terminateProcessTree(child, 1000)
      finish(null)
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
      if (stdout.length > 4_000_000) stdout = stdout.slice(-4_000_000)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
      if (stderr.length > 20_000) stderr = stderr.slice(-20_000)
    })
    child.once('error', (error) => {
      stderr += error.message
      finish(null)
    })
    child.once('close', (code) => finish(code))
    child.stdin.end(options.input ?? '')
  })
}

/** 把外部取消信号与内部超时合并为一个信号，调用方负责 cleanup。 */
export function linkSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  timer.unref?.()
  const onAbort = () => controller.abort()
  if (signal) {
    if (signal.aborted) controller.abort()
    else signal.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    },
  }
}

/** 把 abort 信号变成可等待的 Promise，供“请求与取消赛跑”使用。 */
export function abortPromise(signal: AbortSignal, message = '运行已取消'): Promise<never> {
  return new Promise((_, reject) => {
    if (signal.aborted) {
      reject(new Error(message))
      return
    }
    signal.addEventListener(
      'abort',
      () => reject(new Error(message)),
      { once: true },
    )
  })
}
