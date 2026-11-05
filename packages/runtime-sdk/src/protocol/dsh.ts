import type { NormalizedRuntimeEvent, RuntimeModelCatalog } from '../types'

export const DSH_PROTOCOL_VERSION = 1

export interface DshModelFrame {
  id?: string
  label?: string
  provider?: string
  default?: boolean
  thinking?: {
    supported_levels?: string[]
    default_level?: string
  }
}

export interface DshFrame {
  v?: number
  type?: string
  runtime?: string
  request_id?: string
  session_id?: string
  content?: string
  call_id?: string
  name?: string
  arguments?: string
  output?: string
  is_error?: boolean
  provider?: string
  model?: string
  input_tokens?: number
  output_tokens?: number
  cache_read_tokens?: number
  cache_write_tokens?: number
  status?: string
  stop_reason?: string
  resume_rejected?: boolean
  error?: { code?: string; message?: string }
  code?: string
  message?: string
  models?: DshModelFrame[]
}

/**
 * 解析 `dsh --list-models` 输出的 `models` 帧。
 *
 * DSH 的 execute 命令按 `provider/model` 解析模型；目录里的 id 若只是裸模型
 * 名，则用 provider 补全，避免选中后无法回填。
 */
export function parseDshModelCatalog(output: string): RuntimeModelCatalog {
  const models: RuntimeModelCatalog['models'] = []
  const seen = new Set<string>()
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    let frame: DshFrame
    try {
      frame = JSON.parse(line) as DshFrame
    } catch {
      continue
    }
    if (frame.type !== 'models' || !Array.isArray(frame.models)) continue
    for (const row of frame.models) {
      const bareId = (row.id ?? '').trim()
      if (!bareId) continue
      const provider = (row.provider ?? '').trim()
      const id = bareId.includes('/') || !provider ? bareId : `${provider}/${bareId}`
      if (seen.has(id)) continue
      seen.add(id)
      models.push({
        id,
        label: (row.label ?? '').trim() || id,
        provider: provider || undefined,
        default: row.default,
        thinkingLevels: row.thinking?.supported_levels?.length
          ? row.thinking.supported_levels
          : undefined,
        defaultThinkingLevel: row.thinking?.default_level,
      })
    }
  }
  return { models }
}

export interface DshRunState {
  ready: boolean
  sessionId: string | null
  result: DshFrame | null
  protocolError: string | null
  usage: { input: number; output: number }
}

export function createDshState(): DshRunState {
  return {
    ready: false,
    sessionId: null,
    result: null,
    protocolError: null,
    usage: { input: 0, output: 0 },
  }
}

/**
 * DSH 使用版本化 JSONL：请求一行 `execute`，响应按 `type` 推送
 * `ready/session/text/tool_call/tool_result/usage/result`。
 */
export function parseDshFrame(
  line: string,
  state: DshRunState,
): NormalizedRuntimeEvent[] {
  let frame: DshFrame
  try {
    frame = JSON.parse(line) as DshFrame
  } catch {
    return []
  }
  if (frame.v !== undefined && frame.v !== DSH_PROTOCOL_VERSION) {
    state.protocolError = `DSH 协议版本不受支持：${frame.v}`
    return []
  }

  const events: NormalizedRuntimeEvent[] = []
  switch (frame.type) {
    case 'ready':
      state.ready = frame.runtime === 'dsh'
      break
    case 'session':
      state.sessionId = frame.session_id ?? null
      events.push({
        type: 'status',
        payload: { status: 'running', sessionId: state.sessionId },
      })
      break
    case 'text':
      if (frame.content) events.push({ type: 'text_delta', payload: { text: frame.content } })
      break
    case 'tool_call': {
      let input: Record<string, unknown> = {}
      if (frame.arguments) {
        try {
          input = JSON.parse(frame.arguments) as Record<string, unknown>
        } catch {
          input = { raw: frame.arguments }
        }
      }
      events.push({
        type: 'tool_started',
        payload: { id: frame.call_id, name: frame.name, input },
      })
      break
    }
    case 'tool_result':
      events.push({
        type: frame.is_error ? 'tool_updated' : 'tool_finished',
        payload: { id: frame.call_id, name: frame.name, output: frame.output ?? '' },
      })
      break
    case 'usage': {
      state.usage = {
        input: state.usage.input + Number(frame.input_tokens ?? 0),
        output: state.usage.output + Number(frame.output_tokens ?? 0),
      }
      events.push({
        type: 'usage',
        payload: { tokensIn: state.usage.input, tokensOut: state.usage.output, cost: 0 },
      })
      break
    }
    case 'protocol_error': {
      state.protocolError = `${frame.code ?? ''}: ${frame.message ?? ''}`.trim()
      break
    }
    case 'result': {
      state.result = frame
      const error = frame.error?.message
        ? `${frame.error.code ?? ''}: ${frame.error.message}`.trim()
        : null
      if (error) {
        state.protocolError = error
        events.push({ type: 'failed', payload: { error } })
      } else if (['cancelled', 'canceled', 'aborted'].includes(frame.status ?? '')) {
        events.push({ type: 'cancelled', payload: { reason: '用户停止' } })
      } else if (frame.status === 'failed') {
        state.protocolError = 'DSH 运行失败'
        events.push({ type: 'failed', payload: { error: state.protocolError } })
      } else {
        events.push({ type: 'completed', payload: { stopReason: frame.stop_reason } })
      }
      break
    }
    default:
      break
  }
  return events
}
