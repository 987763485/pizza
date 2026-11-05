import type { NormalizedRuntimeEvent, RuntimeModelCatalog } from '../types'

interface PiUsage {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
}

interface PiMessage {
  role?: string
  model?: string
  usage?: PiUsage
  stopReason?: string
  errorMessage?: string
}

interface PiStreamEvent {
  type?: string
  aborted?: boolean
  assistantMessageEvent?: { type?: string; delta?: string }
  toolCallId?: string
  toolName?: string
  args?: unknown
  result?: unknown
  isError?: boolean
  message?: unknown
  messages?: unknown
  success?: boolean
  finalError?: string
}

export interface ParsedPiEvent {
  events: NormalizedRuntimeEvent[]
  usage?: PiUsage
  error?: string
  settled?: boolean
}

function parseMessage(raw: unknown): PiMessage | null {
  if (!raw || typeof raw !== 'object') return null
  return raw as PiMessage
}

function lastAssistantMessage(raw: unknown): PiMessage | null {
  if (!Array.isArray(raw)) return null
  for (let index = raw.length - 1; index >= 0; index -= 1) {
    const message = parseMessage(raw[index])
    if (message?.role === 'assistant') return message
  }
  return null
}

/**
 * 解析 Pi / OMP `--mode json` 的一行事件。
 *
 * 事件字段参考参考实现的多版本兼容写法：只消费文本、工具、用量与终态，
 * 不为展示层复制完整思维链或内部消息结构。
 */
export function parsePiLine(line: string): ParsedPiEvent {
  let raw: PiStreamEvent
  try {
    raw = JSON.parse(line) as PiStreamEvent
  } catch {
    return { events: [] }
  }

  const events: NormalizedRuntimeEvent[] = []
  let usage: PiUsage | undefined
  let error: string | undefined
  let settled = false

  switch (raw.type) {
    case 'agent_start':
      events.push({ type: 'status', payload: { status: 'running' } })
      break
    case 'turn_start':
      events.push({ type: 'status', payload: { status: 'running' } })
      break
    case 'message_update': {
      const update = raw.assistantMessageEvent
      if (update?.type === 'text_delta' && update.delta) {
        events.push({ type: 'text_delta', payload: { text: update.delta } })
      }
      break
    }
    case 'tool_execution_start': {
      let input: Record<string, unknown> = {}
      if (raw.args && typeof raw.args === 'object') input = raw.args as Record<string, unknown>
      events.push({
        type: 'tool_started',
        payload: { id: raw.toolCallId, name: raw.toolName, input },
      })
      break
    }
    case 'tool_execution_end': {
      const output =
        typeof raw.result === 'string'
          ? raw.result
          : raw.result && typeof raw.result === 'object'
            ? JSON.stringify(raw.result)
            : ''
      events.push({
        type: raw.isError ? 'tool_updated' : 'tool_finished',
        payload: {
          id: raw.toolCallId,
          name: raw.toolName,
          output,
          error: raw.isError ? output : undefined,
        },
      })
      break
    }
    case 'turn_end': {
      const message = parseMessage(raw.message)
      if (message?.usage) usage = message.usage
      if (message?.stopReason === 'error') {
        error = message.errorMessage || 'Pi 结束了本轮但返回错误'
      }
      break
    }
    case 'agent_end': {
      const message = lastAssistantMessage(raw.messages)
      if (message?.usage) usage = message.usage
      if (message?.stopReason === 'error') {
        error = message.errorMessage || 'Pi 结束了运行但返回错误'
      }
      settled = true
      break
    }
    case 'error': {
      error = typeof raw.message === 'string' ? raw.message : 'Pi 返回错误'
      break
    }
    case 'auto_retry_end': {
      if (!raw.success) {
        error = raw.finalError || 'Pi 自动重试已耗尽'
      }
      break
    }
    default:
      break
  }

  return { events, usage, error, settled }
}

const PI_STANDARD_THINKING = ['minimal', 'low', 'medium', 'high', 'max']

function isPiDiscoveryNoise(line: string): boolean {
  const lower = line.toLowerCase()
  return (
    lower.includes('no models match pattern') ||
    lower.startsWith('warning:') ||
    lower.startsWith('error:') ||
    lower.startsWith('info:') ||
    lower.includes('unknown flag') ||
    lower.startsWith('usage:')
  )
}

/**
 * 解析 `pi --list-models` 的表格输出。
 *
 * 表格列为 `provider model context max-out thinking images`；thinking 为 yes
 * 时使用 Pi 的标准强度集合，否则不提供强度选项。
 */
export function parsePiModelTable(output: string): RuntimeModelCatalog {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean)
  const header = lines.find((line) => line.split(/\s+/)[0]?.toLowerCase() === 'provider')
  const headerFields = header?.split(/\s+/) ?? []
  const modelIndex = headerFields.indexOf('model')
  const thinkingIndex = headerFields.indexOf('thinking')
  const models: RuntimeModelCatalog['models'] = []
  const seen = new Set<string>()

  for (const line of lines) {
    if (line === header || isPiDiscoveryNoise(line)) continue
    const fields = line.split(/\s+/)
    if (fields.length < 2) continue
    let id: string
    if (fields[0].includes('/') || fields[0].includes(':')) {
      id = fields[0].replace(':', '/')
    } else {
      const model = fields[modelIndex >= 0 ? modelIndex : 1]
      if (!model) continue
      id = `${fields[0]}/${model}`
    }
    const slash = id.indexOf('/')
    if (slash <= 0 || slash === id.length - 1) continue
    if (seen.has(id)) continue
    seen.add(id)
    const thinking =
      thinkingIndex >= 0 ? fields[thinkingIndex]?.toLowerCase() === 'yes' : false
    models.push({
      id,
      label: id,
      provider: fields[0],
      thinkingLevels: thinking ? PI_STANDARD_THINKING : undefined,
    })
  }

  if (models.length > 0) models[0].default = true
  return { models }
}

interface OmpModelRow {
  id?: string
  provider?: string
  selector?: string
  name?: string
  reasoning?: boolean
  thinking?: boolean | string[]
}

/** 解析 `omp models --json` 的模型目录。 */
export function parseOmpModelCatalog(output: string): RuntimeModelCatalog {
  let rows: OmpModelRow[] = []
  try {
    const parsed = JSON.parse(output) as { models?: OmpModelRow[] }
    rows = Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return { models: [] }
  }

  const models: RuntimeModelCatalog['models'] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const bareId = (row.id ?? '').trim()
    if (!bareId) continue
    const provider = (row.provider ?? '').trim()
    const id = (row.selector ?? '').trim() || (provider ? `${provider}/${bareId}` : bareId)
    if (seen.has(id)) continue
    seen.add(id)
    const thinkingLevels = Array.isArray(row.thinking)
      ? row.thinking
      : row.thinking === true || row.reasoning === true
        ? PI_STANDARD_THINKING
        : undefined
    models.push({
      id,
      label: (row.name ?? '').trim() || id,
      provider: provider || undefined,
      thinkingLevels,
    })
  }
  if (models.length > 0) models[0].default = true
  return { models }
}
