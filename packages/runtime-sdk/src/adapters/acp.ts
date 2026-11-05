import { asRecord, JsonRpcStdioClient } from '../jsonrpc'
import {
  parseAcpModelCatalog,
  parseAcpUpdate,
  readAcpModelConfig,
} from '../protocol/acp'
import type {
  AdapterProfile,
  RuntimeAdapter,
  RuntimeModelCatalog,
  RuntimePromptRequest,
  RuntimePromptResult,
  RuntimeSession,
  RuntimeSpec,
  TestResult,
  TestStep,
} from '../types'

export const ACP_PROFILE: AdapterProfile = {
  family: 'acp',
  lifecycle: 'persistent',
  supportsResume: true,
  supportsMidturnDelivery: false,
  startupCostMs: 3_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

function acpMcpServers(request: RuntimePromptRequest): unknown[] {
  return (request.capabilities?.acpMcpServers ?? []).map((server) =>
    'type' in server
      ? {
          name: server.name,
          type: server.type,
          url: server.url,
          headers: Object.entries(server.headers).map(([name, value]) => ({ name, value })),
        }
      : {
          name: server.name,
          command: server.command,
          args: server.args,
          env: Object.entries(server.env).map(([name, value]) => ({ name, value })),
        },
  )
}

/**
 * 通用 ACP stdio 适配器。
 *
 * 进程在 Actor 的整个生命周期内复用；一次 turn 结束后只发送 `session/cancel`
 * 或直接等待 `session/prompt` 返回，不关闭连接。只有进程退出或空闲回收才会 close。
 */
export class AcpStdioAdapter implements RuntimeAdapter {
  readonly profile = ACP_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动进程', status: 'pending' },
      { key: 'initialize', label: 'ACP initialize', status: 'pending' },
      { key: 'session', label: '创建临时会话', status: 'pending' },
      { key: 'message', label: '发送测试消息', status: 'pending' },
      { key: 'cleanup', label: '清理临时资源', status: 'pending' },
    ]

    const fail = (key: string, error: string): TestResult => {
      const index = steps.findIndex((step) => step.key === key)
      steps[index] = { ...steps[index], status: 'failed', detail: error }
      return { ok: false, steps, error }
    }

    if (!spec.command) return fail('start', '未配置 ACP 启动命令')

    const client = new JsonRpcStdioClient(spec)
    try {
      steps[0].status = 'running'
      await client.start([], signal)
      steps[0].status = 'ok'

      steps[1].status = 'running'
      const init = asRecord(
        await client.request(
          'initialize',
          {
            protocolVersion: 1,
            clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
          },
          20_000,
          signal,
        ),
      )
      steps[1] = { ...steps[1], status: 'ok', detail: String(init.protocolVersion ?? 'ACP') }

      steps[2].status = 'running'
      const session = asRecord(
        await client.request(
          'session/new',
          { cwd: spec.cwd || process.cwd(), mcpServers: [] },
          20_000,
          signal,
        ),
      )
      const sessionId = String(session.sessionId ?? '')
      if (!sessionId) throw new Error('ACP session/new 未返回 sessionId')
      steps[2].status = 'ok'

      steps[3].status = 'running'
      const promptStartedAt = Date.now()
      const promptResult = asRecord(
        await client.request(
          'session/prompt',
          {
            sessionId,
            prompt: [{ type: 'text', text: 'Respond with the single word pong.' }],
          },
          60_000,
          signal,
        ),
      )
      steps[3] = {
        ...steps[3],
        status: 'ok',
        detail: String(promptResult.stopReason ?? 'completed'),
      }
      steps[4].status = 'ok'

      return {
        ok: true,
        steps,
        capabilities: {
          protocolVersion: String(init.protocolVersion ?? '1'),
          streaming: true,
          appendInput: false,
          mcp: true,
          skills: false,
          thinking: false,
          latencyMs: Date.now() - promptStartedAt,
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

  /**
   * 通过一次临时 ACP 会话读取模型目录。
   *
   * 新协议从 `configOptions` 读取 model / thought_level；旧协议读取
   * `models.availableModels`。发现失败返回空目录，不阻塞运行时注册。
   */
  async listModels(
    spec: RuntimeSpec,
    signal?: AbortSignal,
  ): Promise<RuntimeModelCatalog> {
    if (!spec.command) return { models: [] }
    const client = new JsonRpcStdioClient(spec)
    const timer = setTimeout(() => client.close(), this.profile.startupTimeoutMs)
    timer.unref?.()
    try {
      await client.start([], signal)
      await client.request(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        },
        this.profile.startupTimeoutMs,
        signal,
      )
      const session = await client.request(
        'session/new',
        { cwd: spec.cwd || process.cwd(), mcpServers: [] },
        this.profile.startupTimeoutMs,
        signal,
      )
      return parseAcpModelCatalog(session)
    } catch {
      return { models: [] }
    } finally {
      clearTimeout(timer)
      client.close()
    }
  }

  async openSession(spec: RuntimeSpec, signal?: AbortSignal): Promise<RuntimeSession> {
    const client = new JsonRpcStdioClient(spec)
    try {
      await client.start([], signal)
      await client.request(
        'initialize',
        {
          protocolVersion: 1,
          clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
        },
        this.profile.startupTimeoutMs,
        signal,
      )
    } catch (error) {
      client.close()
      throw error
    }

    let sessionId: string | null = null
    let sessionConfig: Record<string, unknown> | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        let text = ''

        client.onNotification = (method, params) => {
          if (method !== 'session/update') return
          for (const event of parseAcpUpdate(params.update)) {
            if (event.type === 'text_delta') text += String(event.payload.text ?? '')
            request.onEvent(event)
          }
        }

        client.onServerRequest = async (method, params) => {
          if (method !== 'session/request_permission') return undefined
          const toolCall = asRecord(params.toolCall)
          const options = (Array.isArray(params.options) ? params.options : [])
            .map((option) => {
              const record = asRecord(option)
              return {
                optionId: String(record.optionId ?? record.id ?? ''),
                name: String(record.name ?? record.kind ?? ''),
                kind: typeof record.kind === 'string' ? record.kind : undefined,
              }
            })
            .filter((option) => option.optionId)
          const selected = await request.requestPermission?.({
            toolName: String(toolCall.title ?? toolCall.kind ?? 'tool'),
            toolInput: asRecord(toolCall.rawInput),
            options,
          })
          return {
            outcome: selected
              ? { outcome: 'selected', optionId: selected }
              : { outcome: 'cancelled' },
          }
        }

        if (!sessionId) {
          const mcpServers = acpMcpServers(request)
          const prior = request.runtimeSessionId
          if (prior) {
            try {
              const loaded = asRecord(
                await client.request(
                  'session/load',
                  { sessionId: prior, cwd: request.cwd, mcpServers },
                  this.profile.startupTimeoutMs,
                  request.signal,
                ),
              )
              sessionId = String(loaded.sessionId ?? prior)
              sessionConfig = loaded
            } catch {
              // 旧会话可能已被运行时回收；回退到新会话，不把恢复失败当运行失败。
              sessionId = null
            }
          }
          if (!sessionId) {
            const session = asRecord(
              await client.request(
                'session/new',
                { cwd: request.cwd, mcpServers },
                this.profile.startupTimeoutMs,
                request.signal,
              ),
            )
            sessionId = String(session.sessionId ?? '')
            if (!sessionId) throw new Error('ACP session/new 未返回 sessionId')
            sessionConfig = session
          }
        }

        // 每个 turn 都应用一次选择，覆盖智能体在会话中途修改模型/强度的情况。
        if (sessionId && sessionConfig) {
          const config = readAcpModelConfig(sessionConfig)
          const setOption = async (configId: string, value: string): Promise<void> => {
            const updated = asRecord(
              await client.request(
                'session/set_config_option',
                { sessionId, configId, value },
                20_000,
                request.signal,
              ),
            )
            if (Array.isArray(updated.configOptions)) {
              sessionConfig = {
                ...(sessionConfig ?? {}),
                configOptions: updated.configOptions,
              }
            }
          }

          if (
            request.model &&
            config.modelOptionId &&
            config.modelValues.includes(request.model) &&
            config.currentModel !== request.model
          ) {
            try {
              await setOption(config.modelOptionId, request.model)
            } catch (error) {
              if (!config.hasLegacyModels) throw error
              await client.request(
                'session/set_model',
                { sessionId, modelId: request.model },
                20_000,
                request.signal,
              )
            }
          } else if (
            request.model &&
            !config.modelOptionId &&
            config.hasLegacyModels &&
            config.legacyCurrentModel !== request.model
          ) {
            await client.request(
              'session/set_model',
              { sessionId, modelId: request.model },
              20_000,
              request.signal,
            )
          }

          if (request.thinkingLevel) {
            const refreshed = readAcpModelConfig(sessionConfig)
            if (
              refreshed.thinkingOptionId &&
              refreshed.thinkingValues.includes(request.thinkingLevel) &&
              refreshed.currentThinking !== request.thinkingLevel
            ) {
              try {
                await setOption(refreshed.thinkingOptionId, request.thinkingLevel)
              } catch {
                // 思考强度是可选能力；设置失败不阻塞本轮对话。
              }
            }
          }
        }

        // ACP 没有单独的 system prompt 字段；把系统提示与 Skill 清单写入本轮上下文。
        const prefix = [
          request.systemPrompt,
          request.capabilities?.skillManifest ?? '',
        ]
          .filter(Boolean)
          .join('\n\n')
        const promptText = prefix ? `${prefix}\n\n${request.prompt}` : request.prompt

        let result: Record<string, unknown> = {}
        try {
          result = asRecord(
            await client.request(
              'session/prompt',
              { sessionId, prompt: [{ type: 'text', text: promptText }] },
              30 * 60_000,
              request.signal,
            ),
          )
        } catch (error) {
          if (request.signal.aborted) {
            client.notify('session/cancel', { sessionId })
            request.onEvent({ type: 'cancelled', payload: { reason: '用户停止' } })
          }
          throw error
        }

        const usage = asRecord(result.usage)
        const tokensIn = Number(usage.inputTokens ?? usage.input_tokens ?? 0)
        const tokensOut = Number(usage.outputTokens ?? usage.output_tokens ?? 0)
        request.onEvent({ type: 'usage', payload: { tokensIn, tokensOut, cost: 0 } })
        request.onEvent({
          type: 'completed',
          payload: { stopReason: result.stopReason ?? 'end_turn' },
        })

        return { text, runtimeSessionId: sessionId, tokensIn, tokensOut, cost: 0 }
      },

      cancel: () => {
        if (sessionId) client.notify('session/cancel', { sessionId })
      },

      close: () => client.close(),

      alive: () => client.isAlive(),
    }
  }
}
