import {
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  collectStderr,
  readLines,
  runCommand,
  spawnRuntime,
  stripAnsi,
  terminateProcessTree,
  waitForExit,
  waitForSpawn,
} from '../process'
import { parseOmpModelCatalog, parsePiLine, parsePiModelTable } from '../protocol/pi'
import type {
  AdapterProfile,
  NormalizedRuntimeEvent,
  RuntimeAdapter,
  RuntimeModelCatalog,
  RuntimePromptRequest,
  RuntimePromptResult,
  RuntimeSession,
  RuntimeSpec,
  TestResult,
  TestStep,
} from '../types'

export const PI_PROFILE: AdapterProfile = {
  family: 'pi-json',
  lifecycle: 'per-turn',
  supportsResume: true,
  supportsMidturnDelivery: false,
  startupCostMs: 3_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

function defaultSessionDir(): string {
  return join(tmpdir(), 'pizza-runtime-sessions', 'pi')
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  if (!existsSync(path)) writeFileSync(path, '')
}

function newestTranscript(dir: string): string | null {
  try {
    const entries = readdirSync(dir)
      .filter((name) => name.endsWith('.jsonl'))
      .map((name) => join(dir, name))
      .filter((path) => {
        try {
          return statSync(path).size > 0
        } catch {
          return false
        }
      })
    return entries.length === 1 ? entries[0] : null
  } catch {
    return null
  }
}

/**
 * Pi / OMP 的 JSON 事件适配器。
 *
 * `pi -p --mode json` 每个 turn 启动一次进程，但通过 `--session <jsonl>`
 * 保留上下文。Actor 因此把它视为 per-turn + 可恢复：进程不常驻，会话文件复用。
 *
 * OMP 的 `--session` 只用于恢复；新会话由 OMP 自己创建，运行结束后从临时目录
 * 里取回它实际写入的 transcript 路径，作为下一次的 runtimeSessionId。
 */
export class PiJsonAdapter implements RuntimeAdapter {
  readonly profile = PI_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动进程', status: 'pending' },
      { key: 'session', label: '创建临时会话', status: 'pending' },
      { key: 'message', label: '发送测试消息', status: 'pending' },
      { key: 'cleanup', label: '清理临时资源', status: 'pending' },
    ]
    const fail = (key: string, error: string): TestResult => {
      const index = steps.findIndex((step) => step.key === key)
      steps[index] = { ...steps[index], status: 'failed', detail: error }
      return { ok: false, steps, error }
    }
    if (!spec.command) return fail('start', '未配置启动命令')

    steps[0].status = 'running'
    const version = await this.runVersion(spec, signal)
    if (version.code !== 0 && !version.stdout.trim()) {
      return fail('start', stripAnsi(version.stderr).slice(-600) || '无法启动运行时')
    }
    steps[0] = {
      ...steps[0],
      status: 'ok',
      detail: stripAnsi(`${version.stdout}\n${version.stderr}`).trim().split('\n')[0],
    }

    steps[1].status = 'ok'
    steps[2].status = 'running'
    const startedAt = Date.now()
    const session = await this.openSession(spec)
    const events: NormalizedRuntimeEvent[] = []
    try {
      const result = await session.prompt({
        prompt: 'Respond with the single word pong.',
        systemPrompt: '',
        sessionId: randomUUID(),
        runtimeSessionId: null,
        cwd: spec.cwd || process.cwd(),
        attachmentPaths: [],
        signal,
        onEvent: (event) => events.push(event),
      })
      if (!result.text.trim()) {
        return fail('message', '测试消息没有返回文本')
      }
      steps[2] = { ...steps[2], status: 'ok', detail: result.text.slice(0, 120) }
      steps[3].status = 'ok'
      return {
        ok: true,
        steps,
        capabilities: {
          protocolVersion: stripAnsi(version.stdout).trim().split('\n')[0],
          streaming: true,
          appendInput: false,
          mcp: false,
          skills: true,
          thinking: true,
          latencyMs: Date.now() - startedAt,
        },
      }
    } catch (error) {
      return fail('message', error instanceof Error ? error.message : String(error))
    } finally {
      session.close()
    }
  }

  async listModels(
    spec: RuntimeSpec,
    signal?: AbortSignal,
  ): Promise<RuntimeModelCatalog> {
    if (!spec.command) return { models: [] }
    if (spec.kind === 'omp') {
      const result = await runCommand(spec, ['models', '--json'], {
        timeoutMs: 20_000,
        signal,
      })
      if (result.code !== 0) return { models: [] }
      return parseOmpModelCatalog(result.stdout)
    }
    const result = await runCommand(spec, ['--list-models'], {
      timeoutMs: 20_000,
      signal,
    })
    // 旧版 pi 可能把目录写到 stderr 并以非零退出；只要 stdout/stderr 有目录就解析。
    return parsePiModelTable(result.stdout || result.stderr)
  }

  async openSession(spec: RuntimeSpec): Promise<RuntimeSession> {
    let child: ReturnType<typeof spawnRuntime> | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const isOmp = spec.kind === 'omp'
        const baseDir = spec.sessionDir ?? defaultSessionDir()
        let sessionPath: string | null = null
        let tempDir: string | null = null

        if (request.runtimeSessionId) {
          sessionPath = request.runtimeSessionId
          if (!isOmp) ensureFile(sessionPath)
        } else if (isOmp) {
          tempDir = join(baseDir, `omp-${randomUUID()}`)
          mkdirSync(tempDir, { recursive: true })
        } else {
          sessionPath = join(baseDir, `${randomUUID()}.jsonl`)
          ensureFile(sessionPath)
        }

        const prefix = [request.systemPrompt, request.capabilities?.skillManifest ?? '']
          .filter(Boolean)
          .join('\n\n')
        const promptText = prefix ? `${prefix}\n\n${request.prompt}` : request.prompt

        const args = ['-p', '--mode', 'json']
        if (isOmp) {
          // OMP 的 --session 是 Pi 的旧接口；OMP 使用 --resume 恢复，
          // 新会话则指定 --session-dir 后从目录里取回实际 transcript。
          if (sessionPath) args.push('--resume', sessionPath)
          else if (tempDir) args.push('--session-dir', tempDir)
        } else if (sessionPath) {
          args.push('--session', sessionPath)
        }
        if (request.model) args.push('--model', request.model)
        if (request.thinkingLevel) args.push('--thinking', request.thinkingLevel)
        args.push(...spec.args)

        const proc = spawnRuntime(spec, { args, cwd: request.cwd })
        child = proc
        void waitForSpawn(proc).catch(() => undefined)
        proc.stdin.end(promptText)

        let text = ''
        let tokensIn = 0
        let tokensOut = 0
        let finalError: string | null = null
        let spawnError: string | null = null
        let cancelled = false
        let completed = false
        const stderrTail = collectStderr(proc)
        proc.once('error', (error) => {
          spawnError = error.message
        })

        const emit = (event: NormalizedRuntimeEvent) => {
          if (event.type === 'text_delta' && typeof event.payload.text === 'string') {
            text += event.payload.text
          }
          if (event.type === 'usage') {
            tokensIn = Number(event.payload.tokensIn ?? tokensIn)
            tokensOut = Number(event.payload.tokensOut ?? tokensOut)
          }
          request.onEvent(event)
        }

        const stopReading = readLines(proc.stdout, (line) => {
          const parsed = parsePiLine(line)
          if (parsed.usage) {
            tokensIn = Number(parsed.usage.input ?? tokensIn)
            tokensOut = Number(parsed.usage.output ?? tokensOut)
          }
          if (parsed.error) finalError = parsed.error
          for (const event of parsed.events) emit(event)
          if (parsed.events.some((event) => event.type === 'completed')) completed = true
        })

        const abort = () => {
          cancelled = true
          terminateProcessTree(proc, 1500)
        }
        request.signal.addEventListener('abort', abort, { once: true })
        const code = await waitForExit(proc)
        stopReading()
        request.signal.removeEventListener('abort', abort)
        child = null

        if (tokensIn || tokensOut) {
          emit({ type: 'usage', payload: { tokensIn, tokensOut, cost: 0 } })
        }

        if (isOmp && !sessionPath && tempDir) {
          sessionPath = newestTranscript(tempDir)
        }

        if (cancelled) {
          emit({ type: 'cancelled', payload: { reason: '用户停止' } })
          throw new Error('运行已取消')
        }
        if (finalError || spawnError || code !== 0) {
          const error =
            finalError ||
            spawnError ||
            stripAnsi(stderrTail()).slice(-1000) ||
            `进程退出码 ${code}`
          emit({ type: 'failed', payload: { error } })
          throw new Error(error)
        }
        if (!completed) emit({ type: 'completed', payload: { inferred: true } })

        return { text, runtimeSessionId: sessionPath, tokensIn, tokensOut, cost: 0 }
      },

      cancel: () => {
        if (child) terminateProcessTree(child, 1500)
      },

      close: () => {
        if (child) terminateProcessTree(child, 500)
        child = null
      },
    }
  }

  private async runVersion(
    spec: RuntimeSpec,
    signal: AbortSignal,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawnRuntime>
      try {
        child = spawnRuntime(spec, { args: ['--version'] })
      } catch (error) {
        resolve({
          code: null,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        })
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve({ code, stdout, stderr })
      }
      const timer = setTimeout(() => {
        terminateProcessTree(child, 1000)
        finish(null)
      }, 10_000)
      timer.unref?.()
      const abort = () => {
        terminateProcessTree(child, 1000)
        finish(null)
      }
      signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.once('error', (error) => {
        stderr += error.message
        finish(null)
      })
      child.once('close', (code) => finish(code))
    })
  }
}
