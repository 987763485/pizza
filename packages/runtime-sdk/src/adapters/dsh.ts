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
import {
  createDshState,
  DSH_PROTOCOL_VERSION,
  parseDshFrame,
  parseDshModelCatalog,
  type DshRunState,
} from '../protocol/dsh'
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

export const DSH_PROFILE: AdapterProfile = {
  family: 'dsh',
  lifecycle: 'per-turn',
  supportsResume: true,
  supportsMidturnDelivery: false,
  startupCostMs: 2_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

function launchArgs(spec: RuntimeSpec): string[] {
  const args = [...spec.args]
  if (!args.includes('--stdio')) args.push('--stdio')
  return args
}

function modelSelection(model: string | null | undefined): Record<string, string> | null {
  if (!model) return null
  const index = model.indexOf('/')
  if (index <= 0) return null
  return { provider: model.slice(0, index), id: model.slice(index + 1) }
}

function mcpServers(request: RuntimePromptRequest): Array<Record<string, unknown>> {
  return (request.capabilities?.acpMcpServers ?? []).map((server) =>
    'type' in server
      ? {
          name: server.name,
          transport: server.type,
          url: server.url,
          headers: server.headers,
        }
      : {
          name: server.name,
          transport: 'stdio',
          command: server.command,
          args: server.args,
          env: server.env,
        },
  )
}

/**
 * DeepSeek Harness（DSH）版本化 JSONL 适配器。
 *
 * 每个 turn 一个进程：向 stdin 写一条 `execute` 命令，stdout 按行推送帧；
 * `result` 帧携带终态与会话 ID。取消时先写 `cancel`，宽限期后杀进程树。
 */
export class DshAdapter implements RuntimeAdapter {
  readonly profile = DSH_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动进程', status: 'pending' },
      { key: 'session', label: '协商协议版本', status: 'pending' },
      { key: 'message', label: '发送测试消息', status: 'pending' },
      { key: 'cleanup', label: '清理临时资源', status: 'pending' },
    ]
    const fail = (key: string, error: string): TestResult => {
      const index = steps.findIndex((step) => step.key === key)
      steps[index] = { ...steps[index], status: 'failed', detail: error }
      return { ok: false, steps, error }
    }
    if (!spec.command) return fail('start', '未配置 DSH 启动命令')

    steps[0].status = 'running'
    const session = await this.openSession(spec)
    try {
      const startedAt = Date.now()
      steps[0].status = 'ok'
      steps[1].status = 'ok'
      steps[2].status = 'running'
      const result = await session.prompt({
        prompt: 'Respond with the single word pong.',
        systemPrompt: '',
        sessionId: randomUUID(),
        runtimeSessionId: null,
        cwd: spec.cwd || process.cwd(),
        attachmentPaths: [],
        signal,
        onEvent: () => undefined,
      })
      if (!result.text.trim()) return fail('message', '测试消息没有返回文本')
      steps[2] = { ...steps[2], status: 'ok', detail: result.text.slice(0, 120) }
      steps[3].status = 'ok'
      return {
        ok: true,
        steps,
        capabilities: {
          protocolVersion: `dsh/${DSH_PROTOCOL_VERSION}`,
          streaming: true,
          appendInput: false,
          mcp: true,
          skills: false,
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
    const result = await runCommand(spec, ['--list-models'], {
      timeoutMs: 20_000,
      signal,
    })
    if (result.code !== 0 && !result.stdout.trim()) return { models: [] }
    return parseDshModelCatalog(result.stdout)
  }

  async openSession(spec: RuntimeSpec): Promise<RuntimeSession> {
    let child: ReturnType<typeof spawnRuntime> | null = null
    let cancellable: (() => void) | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const proc = spawnRuntime(spec, { args: launchArgs(spec), cwd: request.cwd })
        child = proc
        void waitForSpawn(proc).catch(() => undefined)

        const stderrTail = collectStderr(proc)
        let spawnError: string | null = null
        proc.once('error', (error) => {
          spawnError = error.message
        })
        const state: DshRunState = createDshState()
        const requestId = randomUUID()
        let text = ''
        let cancelled = false
        let settled = false
        let resolveResult: (() => void) | null = null
        const done = new Promise<void>((resolve) => {
          resolveResult = resolve
        })

        const emit = (event: NormalizedRuntimeEvent) => {
          if (event.type === 'text_delta') text += String(event.payload.text ?? '')
          request.onEvent(event)
        }

        const prefix = [request.systemPrompt, request.capabilities?.skillManifest ?? '']
          .filter(Boolean)
          .join('\n\n')
        const promptText = prefix ? `${prefix}\n\n${request.prompt}` : request.prompt

        const stopReading = readLines(proc.stdout, (line) => {
          const events = parseDshFrame(line, state)
          for (const event of events) emit(event)
          if (state.result && !settled) {
            settled = true
            resolveResult?.()
          }
        })

        const write = (payload: Record<string, unknown>) => {
          if (!proc.stdin.writable) return
          proc.stdin.write(`${JSON.stringify(payload)}\n`)
        }

        const cancel = () => {
          cancelled = true
          write({
            v: DSH_PROTOCOL_VERSION,
            type: 'cancel',
            request_id: requestId,
          })
          setTimeout(() => terminateProcessTree(proc, 1000), 3000).unref?.()
          resolveResult?.()
        }
        cancellable = cancel
        request.signal.addEventListener('abort', cancel, { once: true })

        write({
          v: DSH_PROTOCOL_VERSION,
          type: 'execute',
          request_id: requestId,
          cwd: request.cwd,
          prompt: promptText,
          resume_session_id: request.runtimeSessionId ?? undefined,
          model: modelSelection(request.model) ?? undefined,
          reasoning_effort: request.thinkingLevel,
          mcp_servers: mcpServers(request),
        })

        const exitCode = await Promise.race([waitForExit(proc), done.then(() => null)])
        stopReading()
        request.signal.removeEventListener('abort', cancel)
        cancellable = null
        child = null
        // 正常完成时 DSH 可能仍保持进程；给一个短宽限期再清理。
        if (!cancelled) terminateProcessTree(proc, 1_500)

        if (cancelled) {
          emit({ type: 'cancelled', payload: { reason: '用户停止' } })
          throw new Error('运行已取消')
        }
        if (state.protocolError) {
          emit({ type: 'failed', payload: { error: state.protocolError } })
          throw new Error(state.protocolError)
        }

        const result = state.result
        const status = result?.status ?? ''
        if (!result || status === 'failed') {
          const error =
            result?.error?.message ||
            spawnError ||
            stripAnsi(stderrTail()).slice(-1000) ||
            `DSH 进程退出码 ${exitCode}`
          emit({ type: 'failed', payload: { error } })
          throw new Error(error)
        }

        return {
          text,
          runtimeSessionId: result.session_id ?? state.sessionId,
          tokensIn: state.usage.input,
          tokensOut: state.usage.output,
          cost: 0,
        }
      },

      cancel: () => cancellable?.(),
      close: () => {
        if (child) terminateProcessTree(child, 500)
        child = null
      },
    }
  }
}
