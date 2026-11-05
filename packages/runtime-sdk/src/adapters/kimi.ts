import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import {
  collectStderr,
  readLines,
  spawnRuntime,
  stripAnsi,
  terminateProcessTree,
  waitForExit,
  waitForSpawn,
} from '../process'
import { parseKimiLine } from '../protocol/kimi'
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

export const KIMI_PROFILE: AdapterProfile = {
  family: 'kimi',
  lifecycle: 'per-turn',
  supportsResume: true,
  supportsMidturnDelivery: false,
  startupCostMs: 2_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

/**
 * Kimi Code CLI 适配器。
 *
 * `kimi -p --output-format stream-json` 每行一个 JSON 记录；assistant 消息
 * 携带文本或工具调用，role=tool 返回工具结果，session.resume_hint 结束本轮
 * 并提供后续 `--session <id>` 恢复所需的标识。
 */
export class KimiAdapter implements RuntimeAdapter {
  readonly profile = KIMI_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动进程', status: 'pending' },
      { key: 'handshake', label: '握手 / 版本探测', status: 'pending' },
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
    const version = await this.runOnce(spec, ['--version'], 15_000, signal)
    if (version.code !== 0) {
      return fail('start', `无法启动 ${spec.command}：${version.stderr.slice(-500)}`)
    }
    steps[0] = {
      ...steps[0],
      status: 'ok',
      detail: stripAnsi(version.stdout).trim().slice(0, 200),
    }
    steps[1].status = 'ok'
    steps[2].status = 'ok'
    steps[3].status = 'running'

    const startedAt = Date.now()
    const message = await this.runOnce(
      spec,
      ['-p', 'Respond with the single word pong. Do not use tools.', '--output-format', 'stream-json'],
      60_000,
      signal,
    )
    let text = ''
    let error: string | null = null
    for (const line of message.stdout.split(/\r?\n/)) {
      const parsed = parseKimiLine(line)
      if (!parsed) continue
      if (parsed.text) text += parsed.text
      if (parsed.error) error = parsed.error
    }
    if (message.code !== 0 || (!text.trim() && !error)) {
      return fail(
        'message',
        error || stripAnsi(message.stderr).slice(-800) || '测试消息没有返回文本',
      )
    }
    steps[3] = {
      ...steps[3],
      status: 'ok',
      detail: text.trim().slice(0, 120) || 'pong',
    }
    steps[4].status = 'ok'
    return {
      ok: true,
      steps,
      capabilities: {
        protocolVersion: stripAnsi(version.stdout).trim().split('\n')[0],
        streaming: true,
        appendInput: false,
        mcp: true,
        skills: true,
        thinking: false,
        latencyMs: Date.now() - startedAt,
      },
    }
  }

  async listModels(): Promise<RuntimeModelCatalog> {
    return { models: [] }
  }

  async openSession(spec: RuntimeSpec): Promise<RuntimeSession> {
    let child: ChildProcessWithoutNullStreams | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const proc = spawnRuntime(spec, {
          args: this.buildPromptArgs(spec, request),
          cwd: request.cwd,
        })
        child = proc
        void waitForSpawn(proc).catch(() => undefined)
        proc.stdin.end()

        let text = ''
        let runtimeSessionId = request.runtimeSessionId
        let finalError: string | null = null
        let spawnError: string | null = null
        let completed = false
        let cancelled = false
        const startedTools = new Set<string>()
        const stderrTail = collectStderr(proc)
        proc.once('error', (error) => {
          spawnError = error.message
        })

        const emit = (event: NormalizedRuntimeEvent) => {
          if (event.type === 'text_delta' && typeof event.payload.text === 'string') {
            text += event.payload.text
          }
          request.onEvent(event)
        }

        const stopReading = readLines(proc.stdout, (line) => {
          const parsed = parseKimiLine(line)
          if (!parsed) return
          if (parsed.sessionId) runtimeSessionId = parsed.sessionId
          if (parsed.error) finalError = parsed.error
          if (parsed.text) emit({ type: 'text_delta', payload: { text: parsed.text } })
          for (const call of parsed.toolCalls) {
            if (startedTools.has(call.id)) continue
            startedTools.add(call.id)
            emit({
              type: 'tool_started',
              payload: { id: call.id, name: call.name, input: call.input },
            })
          }
          for (const result of parsed.toolResults) {
            emit({
              type: 'tool_finished',
              payload: {
                id: result.callId,
                name: 'tool',
                output: result.output,
                status: result.isError ? 'failed' : 'completed',
              },
            })
          }
          if (parsed.completed) completed = true
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

        if (cancelled) {
          emit({ type: 'cancelled', payload: { reason: '用户停止' } })
          throw new Error('运行已取消')
        }
        if (spawnError || code !== 0 || finalError) {
          const error =
            finalError ||
            spawnError ||
            stripAnsi(stderrTail()).slice(-1000) ||
            `进程退出码 ${code}`
          emit({ type: 'failed', payload: { error } })
          throw new Error(error)
        }
        if (!completed) {
          emit({ type: 'completed', payload: { inferred: true } })
        }
        return { text, runtimeSessionId, tokensIn: 0, tokensOut: 0, cost: 0 }
      },
      cancel: () => {
        if (child) terminateProcessTree(child, 1500)
        child = null
      },
      close: () => {
        if (child) terminateProcessTree(child, 500)
        child = null
      },
    }
  }

  private buildPromptArgs(spec: RuntimeSpec, request: RuntimePromptRequest): string[] {
    const attachments = request.attachmentPaths.length
      ? `\n\n用户附件（请按需读取）：\n${request.attachmentPaths
          .map((path) => `- ${path}`)
          .join('\n')}`
      : ''
    const system = request.systemPrompt?.trim()
    const prompt = `${system ? `${system}\n\n` : ''}${request.prompt}${attachments}`

    const args = ['-p', prompt, '--output-format', 'stream-json']
    if (request.runtimeSessionId) args.push('--session', request.runtimeSessionId)
    if (request.model) args.push('--model', request.model)
    return args
  }

  private async runOnce(
    spec: RuntimeSpec,
    args: string[],
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let child: ChildProcessWithoutNullStreams
      try {
        child = spawnRuntime(spec, { args })
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
      }, timeoutMs)
      const abort = () => {
        terminateProcessTree(child, 1000)
        finish(null)
      }
      signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk) => {
        stdout += String(chunk)
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.once('error', (error) => {
        stderr += error.message
        finish(null)
      })
      child.once('close', (code) => finish(code))
    })
  }
}
