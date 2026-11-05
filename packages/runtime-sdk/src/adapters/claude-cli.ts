import { dirname } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
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
import { parseClaudeLine, parseClaudeModelCatalog } from '../protocol/claude'
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

export const CLAUDE_PROFILE: AdapterProfile = {
  family: 'claude-cli',
  lifecycle: 'per-turn',
  supportsResume: true,
  supportsMidturnDelivery: false,
  startupCostMs: 2_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

interface ClaudePromptArgsInput {
  prompt: string
  systemPrompt: string
  sessionId: string
  runtimeSessionId: string | null
  model?: string | null
  thinkingLevel?: string
  attachmentPaths: string[]
  capabilities?: RuntimePromptRequest['capabilities']
}

/**
 * 构造 Claude 协议族的单轮参数。
 *
 * Qoder CN 复用 Claude 的 stream-json 事件格式，但没有 `--verbose` 和
 * `--effort`：前者会直接报 unknown option，后者需要改用
 * `--reasoning-effort`。其余参数两边保持兼容。
 */
export function buildClaudePromptArgs(kind: string, request: ClaudePromptArgsInput): string[] {
  const qoder = kind === 'qoder-cn'
  const attachments = request.attachmentPaths.length
    ? `\n\n用户附件（请按需读取）：\n${request.attachmentPaths
        .map((path) => `- ${path}`)
        .join('\n')}`
    : ''

  const systemPrompt = request.capabilities?.skillManifest
    ? `${request.systemPrompt}\n\n${request.capabilities.skillManifest}`
    : request.systemPrompt

  const args = [
    '-p',
    `${request.prompt}${attachments}`,
    '--output-format',
    'stream-json',
    ...(qoder ? [] : ['--verbose']),
    '--include-partial-messages',
    '--permission-mode',
    'acceptEdits',
    '--append-system-prompt',
    systemPrompt,
  ]

  // 运行级 Skill 插件与 MCP 配置只影响本次运行，不写用户全局配置。
  if (request.capabilities?.pluginDir) {
    args.push('--plugin-dir', request.capabilities.pluginDir)
  }
  if (request.capabilities?.mcpConfigPath) {
    args.push('--mcp-config', request.capabilities.mcpConfigPath, '--strict-mcp-config')
  }
  if (request.capabilities?.settingsPath) {
    args.push('--settings', request.capabilities.settingsPath)
  }

  if (request.runtimeSessionId) {
    args.push('--resume', request.runtimeSessionId)
  } else if (request.sessionId) {
    args.push('--session-id', request.sessionId)
  }
  if (request.model) args.push('--model', request.model)
  if (request.thinkingLevel && request.thinkingLevel !== 'medium') {
    const effort = request.thinkingLevel === 'minimal' ? 'low' : request.thinkingLevel
    args.push(qoder ? '--reasoning-effort' : '--effort', effort)
  }
  for (const attachment of request.attachmentPaths) {
    args.push('--add-dir', dirname(attachment))
  }
  return args
}

/**
 * Claude Code CLI 适配器。
 *
 * Claude `-p` 模式一次进程只处理一个 turn，因此调度层只缓存
 * `runtimeSessionId`，每轮由 Actor 重新调用 `openSession`。
 */
export class ClaudeCliAdapter implements RuntimeAdapter {
  readonly profile = CLAUDE_PROFILE

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

    const testPrompt = 'Respond with the single word pong. Do not use tools.'
    const messageStartedAt = Date.now()
    const message = await this.runOnce(
      spec,
      ['-p', testPrompt, '--output-format', 'json', '--permission-mode', 'acceptEdits'],
      60_000,
      signal,
    )
    if (message.code !== 0) {
      return fail('message', stripAnsi(message.stderr).slice(-800) || '测试消息失败')
    }

    let parsed: ReturnType<typeof parseClaudeLine> | null = null
    const lines = message.stdout.trim().split('\n').filter(Boolean)
    for (const line of lines.reverse()) {
      const candidate = parseClaudeLine(line)
      if (candidate.completed) {
        parsed = candidate
        break
      }
    }
    if (!parsed || parsed.error) {
      return fail('message', parsed?.error || '测试消息没有返回有效 JSON')
    }
    steps[3] = {
      ...steps[3],
      status: 'ok',
      detail: parsed.resultText?.slice(0, 120) || 'pong',
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
        thinking: true,
        latencyMs: Date.now() - messageStartedAt,
      },
    }
  }

  /**
   * 通过 Claude 的 `list_models` 控制请求查询模型。
   *
   * 这是只读会话：不写入用户消息，不会调用模型，也不会产生费用；stdin 写入
   * 请求后立即关闭，CLI 自行退出。旧版本不支持时返回空目录，由 UI 回退到
   * “由运行时管理”。
   */
  async listModels(
    spec: RuntimeSpec,
    signal?: AbortSignal,
  ): Promise<RuntimeModelCatalog> {
    if (!spec.command) return { models: [] }

    // Qoder CN 不实现 Claude 的 list_models 控制请求，改用 `--list-models`
    // 的纯文本输出；首行 `MODEL` 是表头。
    if (spec.kind === 'qoder-cn') {
      const result = await runCommand(spec, ['--list-models'], {
        timeoutMs: 20_000,
        signal,
      })
      if (result.code !== 0) return { models: [] }
      const ids = [
        ...new Set(
          result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line && line.toUpperCase() !== 'MODEL'),
        ),
      ]
      return {
        models: ids.map((id) => ({
          id,
          label: id,
          provider: 'qoder',
          default: id === 'Auto',
        })),
      }
    }

    const request = JSON.stringify({
      type: 'control_request',
      request_id: 'pizza-list-models',
      request: { subtype: 'list_models' },
    })
    const result = await runCommand(
      spec,
      [
        '--print',
        '--verbose',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--strict-mcp-config',
      ],
      { input: `${request}\n`, timeoutMs: 20_000, signal },
    )
    if (result.code !== 0) return { models: [] }
    return parseClaudeModelCatalog(result.stdout)
  }

  async openSession(spec: RuntimeSpec): Promise<RuntimeSession> {
    let child: ChildProcessWithoutNullStreams | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const args = this.buildPromptArgs(spec, request)
        const proc = spawnRuntime(spec, {
          args,
          cwd: request.cwd,
        })
        child = proc
        void waitForSpawn(proc).catch(() => undefined)
        proc.stdin.end()

        let text = ''
        let resultText = ''
        let runtimeSessionId = request.runtimeSessionId
        let tokensIn = 0
        let tokensOut = 0
        let cost = 0
        let finalError: string | null = null
        let spawnError: string | null = null
        let completed = false
        let cancelled = false
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
            cost = Number(event.payload.cost ?? cost)
          }
          request.onEvent(event)
        }

        const stopReading = readLines(proc.stdout, (line) => {
          const parsed = parseClaudeLine(line)
          if (parsed.sessionId) runtimeSessionId = parsed.sessionId
          if (parsed.error) finalError = parsed.error
          if (parsed.resultText) resultText = parsed.resultText
          for (const event of parsed.events) emit(event)
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

        if (!text && resultText) {
          emit({ type: 'text_delta', payload: { text: resultText, final: true } })
        }

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

        return { text, runtimeSessionId, tokensIn, tokensOut, cost }
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

  private buildPromptArgs(spec: RuntimeSpec, request: RuntimePromptRequest): string[] {
    return buildClaudePromptArgs(spec.kind, request)
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
        stderr += '\n测试超时'
        finish(null)
      }, timeoutMs)
      timer.unref?.()
      const abort = () => {
        terminateProcessTree(child, 1000)
        stderr += '\n测试被取消'
        finish(null)
      }
      signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
        if (stdout.length > 200_000) stdout = stdout.slice(-200_000)
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
    })
  }
}
