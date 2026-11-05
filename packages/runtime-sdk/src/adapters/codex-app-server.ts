import { asRecord, JsonRpcStdioClient } from '../jsonrpc'
import { runCommand } from '../process'
import {
  createCodexState,
  parseCodexModelCatalog,
  parseCodexNotification,
  type CodexNotificationState,
} from '../protocol/codex'
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

export const CODEX_PROFILE: AdapterProfile = {
  family: 'codex-app-server',
  lifecycle: 'persistent',
  supportsResume: true,
  supportsMidturnDelivery: true,
  startupCostMs: 5_000,
  startupTimeoutMs: 120_000,
  maxSessionsPerProcess: 1,
}

function threadIdFrom(value: unknown): string {
  return String(asRecord(asRecord(value).thread).id ?? '')
}

function appServerArgs(spec: RuntimeSpec): string[] {
  // 用户自定义参数里已经声明 app-server 时不再重复追加。
  if (spec.args.includes('app-server')) return []
  return ['app-server', '--listen', 'stdio://']
}

/**
 * Codex app-server 适配器。
 *
 * 生命周期是 persistent：一个 Actor 持有一个 app-server 进程，多个 turn 复用；
 * 逻辑会话通过 thread/start 与 thread/resume 管理，thread id 作为 runtimeSessionId。
 */
export class CodexAppServerAdapter implements RuntimeAdapter {
  readonly profile = CODEX_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动 app-server', status: 'pending' },
      { key: 'initialize', label: '初始化握手', status: 'pending' },
      { key: 'thread', label: '创建临时线程', status: 'pending' },
      { key: 'message', label: '发送测试消息', status: 'pending' },
      { key: 'cleanup', label: '清理临时资源', status: 'pending' },
    ]
    const fail = (key: string, error: string): TestResult => {
      const index = steps.findIndex((step) => step.key === key)
      steps[index] = { ...steps[index], status: 'failed', detail: error }
      return { ok: false, steps, error }
    }
    if (!spec.command) return fail('start', '未配置 Codex 启动命令')

    const client = new JsonRpcStdioClient(spec)
    const state = createCodexState()
    try {
      steps[0].status = 'running'
      await client.start(appServerArgs(spec), signal)
      steps[0].status = 'ok'

      steps[1].status = 'running'
      const init = asRecord(
        await client.request(
          'initialize',
          {
            clientInfo: { name: 'pizza-runtime-sdk', title: 'Pizza Runtime SDK', version: '0.1.0' },
            capabilities: { experimentalApi: true },
          },
          this.profile.startupTimeoutMs,
          signal,
        ),
      )
      client.notify('initialized', {})
      steps[1] = {
        ...steps[1],
        status: 'ok',
        detail: String(init.userAgent ?? init.protocolVersion ?? 'codex app-server'),
      }

      steps[2].status = 'running'
      const startResult = asRecord(
        await client.request(
          'thread/start',
          { cwd: spec.cwd || process.cwd(), persistExtendedHistory: true },
          this.profile.startupTimeoutMs,
          signal,
        ),
      )
      const threadId = threadIdFrom(startResult)
      if (!threadId) throw new Error('Codex thread/start 未返回线程 ID')
      state.threadId = threadId
      steps[2].status = 'ok'

      steps[3].status = 'running'
      const turnStartedAt = Date.now()
      client.onNotification = (method, params) => {
        parseCodexNotification(method, params, state)
      }
      await client.request(
        'turn/start',
        {
          threadId,
          input: [{ type: 'text', text: 'Respond with the single word pong.' }],
        },
        this.profile.startupTimeoutMs,
        signal,
      )
      await this.waitForTurn(state, signal, 60_000)
      if (state.error) return fail('message', state.error)
      steps[3] = { ...steps[3], status: 'ok', detail: 'turn/completed' }
      steps[4].status = 'ok'

      return {
        ok: true,
        steps,
        capabilities: {
          protocolVersion: 'app-server',
          streaming: true,
          appendInput: true,
          mcp: true,
          skills: true,
          thinking: true,
          latencyMs: Date.now() - turnStartedAt,
        },
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const running = steps.find((step) => step.status === 'running')
      return fail(running?.key ?? 'start', message)
    } finally {
      client.close()
    }
  }

  async listModels(
    spec: RuntimeSpec,
    signal?: AbortSignal,
  ): Promise<RuntimeModelCatalog> {
    if (!spec.command) return { models: [] }
    const live = await runCommand(spec, ['debug', 'models'], {
      timeoutMs: 15_000,
      signal,
    })
    if (live.code === 0) {
      const catalog = parseCodexModelCatalog(live.stdout)
      if (catalog.models.length > 0) return catalog
    }
    const bundled = await runCommand(spec, ['debug', 'models', '--bundled'], {
      timeoutMs: 15_000,
      signal,
    })
    if (bundled.code !== 0) return { models: [] }
    return parseCodexModelCatalog(bundled.stdout)
  }

  async openSession(spec: RuntimeSpec, signal?: AbortSignal): Promise<RuntimeSession> {
    const client = new JsonRpcStdioClient(spec)
    try {
      await client.start(appServerArgs(spec), signal)
      await client.request(
        'initialize',
        {
          clientInfo: {
            name: 'pizza-runtime-sdk',
            title: 'Pizza Runtime SDK',
            version: '0.1.0',
          },
          capabilities: { experimentalApi: true },
        },
        this.profile.startupTimeoutMs,
        signal,
      )
      client.notify('initialized', {})
    } catch (error) {
      client.close()
      throw error
    }

    let threadId: string | null = null
    let threadModel: string | null = null
    let cancelActive: (() => void) | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const state: CodexNotificationState = createCodexState()
        let text = ''

        let settle: (() => void) | null = null
        let failWait: ((error: Error) => void) | null = null
        const completion = new Promise<void>((resolve, reject) => {
          settle = resolve
          failWait = reject
        })

        client.onNotification = (method, params) => {
          const events = parseCodexNotification(method, params, state)
          for (const event of events) {
            if (event.type === 'text_delta') text += String(event.payload.text ?? '')
            request.onEvent(event)
          }
          if (method === 'turn/completed') settle?.()
        }
        client.onExit = () => failWait?.(new Error('Codex app-server 已退出'))

        client.onServerRequest = async (method, params) => {
          if (method !== 'execCommandApproval' && method !== 'applyPatchApproval') {
            return undefined
          }
          const toolName = method === 'execCommandApproval' ? 'exec_command' : 'patch_apply'
          const optionId = await request.requestPermission?.({
            toolName,
            toolInput: asRecord(params),
            options: [
              { optionId: 'approved', name: '允许一次', kind: 'allow_once' },
              { optionId: 'denied', name: '拒绝', kind: 'reject_once' },
            ],
          })
          return { decision: optionId === 'approved' ? 'approved' : 'denied' }
        }

        // 模型变化后旧线程仍绑定旧模型；重新开线程，让选择立即生效。
        const modelChanged = Boolean(
          threadId && (request.model ?? null) !== threadModel,
        )
        if (modelChanged) threadId = null

        const startParams: Record<string, unknown> = {
          cwd: request.cwd,
          model: request.model ?? null,
          persistExtendedHistory: true,
          approvalPolicy: 'on-request',
        }
        if (request.thinkingLevel) {
          startParams.config = { model_reasoning_effort: request.thinkingLevel }
        }

        if (!threadId && request.runtimeSessionId && !modelChanged) {
          try {
            const resumed = asRecord(
              await client.request(
                'thread/resume',
                {
                  threadId: request.runtimeSessionId,
                  cwd: request.cwd,
                  model: request.model ?? null,
                  excludeTurns: true,
                },
                this.profile.startupTimeoutMs,
                request.signal,
              ),
            )
            threadId = threadIdFrom(resumed) || request.runtimeSessionId
            threadModel = request.model ?? null
          } catch {
            // 旧线程可能已被服务端回收；回退到新线程。
            threadId = null
          }
        }
        if (!threadId) {
          const started = asRecord(
            await client.request(
              'thread/start',
              startParams,
              this.profile.startupTimeoutMs,
              request.signal,
            ),
          )
          threadId = threadIdFrom(started)
          if (!threadId) throw new Error('Codex thread/start 未返回线程 ID')
          threadModel = request.model ?? null
        }
        state.threadId = threadId

        const prefix = [request.systemPrompt, request.capabilities?.skillManifest ?? '']
          .filter(Boolean)
          .join('\n\n')
        const promptText = prefix ? `${prefix}\n\n${request.prompt}` : request.prompt

        const abort = () => {
          if (threadId) {
            void client
              .request('turn/interrupt', { threadId, turnId: state.turnId }, 5_000)
              .catch(() => undefined)
          }
          failWait?.(new Error('运行已取消'))
        }
        request.signal.addEventListener('abort', abort, { once: true })
        cancelActive = abort

        const turnParams: Record<string, unknown> = {
          threadId,
          input: [{ type: 'text', text: promptText }],
        }
        if (request.thinkingLevel) turnParams.effort = request.thinkingLevel

        try {
          const turn = asRecord(
            await client.request(
              'turn/start',
              turnParams,
              this.profile.startupTimeoutMs,
              request.signal,
            ),
          )
          const turnId = String(asRecord(turn.turn).id ?? '')
          if (turnId) state.turnId = turnId
          await completion
        } finally {
          request.signal.removeEventListener('abort', abort)
          cancelActive = null
        }

        const tokensIn = state.usage.input
        const tokensOut = state.usage.output
        request.onEvent({ type: 'usage', payload: { tokensIn, tokensOut, cost: 0 } })

        if (request.signal.aborted) {
          throw new Error('运行已取消')
        }
        if (state.error) throw new Error(state.error)

        return { text, runtimeSessionId: threadId, tokensIn, tokensOut, cost: 0 }
      },

      cancel: () => cancelActive?.(),

      close: () => client.close(),

      alive: () => client.isAlive(),
    }
  }

  private waitForTurn(
    state: CodexNotificationState,
    signal: AbortSignal,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      if (state.completed) {
        resolve()
        return
      }
      const startedAt = Date.now()
      const timer = setInterval(() => {
        if (state.completed) {
          clearInterval(timer)
          signal.removeEventListener('abort', abort)
          resolve()
          return
        }
        if (signal.aborted) {
          clearInterval(timer)
          reject(new Error('运行已取消'))
          return
        }
        if (Date.now() - startedAt > timeoutMs) {
          clearInterval(timer)
          signal.removeEventListener('abort', abort)
          reject(new Error('Codex 测试消息超时'))
        }
      }, 100)
      timer.unref?.()
      const abort = () => {
        clearInterval(timer)
        reject(new Error('运行已取消'))
      }
      signal.addEventListener('abort', abort, { once: true })
    })
  }
}
