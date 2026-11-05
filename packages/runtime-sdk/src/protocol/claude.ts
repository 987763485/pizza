import type { NormalizedRuntimeEvent, RuntimeModelCatalog } from '../types'

interface ClaudeJson {
  type?: string
  subtype?: string
  session_id?: string
  result?: string
  is_error?: boolean
  usage?: Record<string, number>
  total_cost_usd?: number
  message?: {
    content?: Array<{
      type?: string
      text?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }>
  }
  event?: {
    type?: string
    content_block?: {
      type?: string
      id?: string
      name?: string
      input?: Record<string, unknown>
    }
    delta?: {
      type?: string
      text?: string
      partial_json?: string
    }
    index?: number
  }
}

export interface ParsedClaudeLine {
  events: NormalizedRuntimeEvent[]
  sessionId?: string
  resultText?: string
  usage?: { input: number; output: number; cost: number }
  error?: string
  completed?: boolean
}

function parseUsage(usage: Record<string, number> | undefined): {
  input: number
  output: number
} {
  if (!usage) return { input: 0, output: 0 }
  return {
    input: Number(usage.input_tokens ?? usage.inputTokens ?? 0),
    output: Number(usage.output_tokens ?? usage.outputTokens ?? 0),
  }
}

/** 解析 Claude Code `--output-format stream-json` 的一行输出。 */
export function parseClaudeLine(line: string): ParsedClaudeLine {
  const trimmed = line.trim()
  if (!trimmed) return { events: [] }

  let parsed: ClaudeJson
  try {
    parsed = JSON.parse(trimmed) as ClaudeJson
  } catch {
    return { events: [] }
  }

  const events: NormalizedRuntimeEvent[] = []
  const sessionId = parsed.session_id
  const usage = parsed.usage ? parseUsage(parsed.usage) : undefined

  if (parsed.type === 'system' && parsed.subtype === 'init') {
    events.push({
      type: 'status',
      payload: { status: 'running', sessionId: parsed.session_id },
    })
  }

  if (parsed.type === 'stream_event' && parsed.event) {
    const event = parsed.event
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'text_delta' &&
      event.delta.text
    ) {
      events.push({ type: 'text_delta', payload: { text: event.delta.text } })
    }
    if (event.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
      events.push({
        type: 'tool_started',
        payload: {
          id:
            event.index !== undefined ? `index-${event.index}` : event.content_block.id,
          name: event.content_block.name,
          input: event.content_block.input ?? {},
          index: event.index,
        },
      })
    }
    if (
      event.type === 'content_block_delta' &&
      event.delta?.type === 'input_json_delta' &&
      event.delta.partial_json
    ) {
      events.push({
        type: 'tool_updated',
        payload: { partialInput: event.delta.partial_json, index: event.index },
      })
    }
  }

  if (parsed.type === 'assistant' && parsed.message?.content) {
    for (const block of parsed.message.content) {
      if (block.type === 'tool_use') {
        events.push({
          type: 'tool_finished',
          payload: { id: block.id, name: block.name, input: block.input },
        })
      }
    }
  }

  if (parsed.type === 'result') {
    if (usage) {
      events.push({
        type: 'usage',
        payload: {
          tokensIn: usage.input,
          tokensOut: usage.output,
          cost: Number(parsed.total_cost_usd ?? 0),
        },
      })
    }
    if (parsed.is_error || parsed.subtype === 'error') {
      events.push({
        type: 'failed',
        payload: { error: parsed.result || 'Claude Code 返回错误' },
      })
    } else {
      events.push({ type: 'completed', payload: { subtype: parsed.subtype } })
    }
  }

  return {
    events,
    sessionId,
    resultText: parsed.result,
    usage: usage
      ? { ...usage, cost: Number(parsed.total_cost_usd ?? 0) }
      : undefined,
    error: parsed.is_error ? parsed.result || 'Claude Code 返回错误' : undefined,
    completed: parsed.type === 'result',
  }
}

interface ClaudeModelRow {
  value?: string
  resolvedModel?: string
  displayName?: string
  description?: string
  supportsEffort?: boolean
  supportedEffortLevels?: string[]
  disabled?: boolean
}

interface ClaudeControlResponse {
  type?: string
  response?: {
    subtype?: string
    request_id?: string
    response?: { models?: ClaudeModelRow[] }
  }
}

/**
 * 解析 `list_models` 控制请求的响应。
 *
 * `default` 行表示“由 CLI 决定”，Pizza 已经用空模型表达，所以折叠成第一个
 * 可用模型的 default 标记，而不是作为一个可选项展示。
 */
export function parseClaudeModelCatalog(output: string): RuntimeModelCatalog {
  let rows: ClaudeModelRow[] | null = null
  for (const line of output.split('\n')) {
    if (!line.trim()) continue
    let parsed: ClaudeControlResponse
    try {
      parsed = JSON.parse(line) as ClaudeControlResponse
    } catch {
      continue
    }
    if (parsed.type !== 'control_response' || parsed.response?.subtype !== 'success') {
      continue
    }
    rows = parsed.response.response?.models ?? null
    break
  }
  if (!rows) return { models: [] }

  let defaultRow: ClaudeModelRow | null = null
  for (const row of rows) {
    if ((row.value ?? '').trim() === 'default') defaultRow = row
  }
  const defaultModelId = defaultRow
    ? (defaultRow.resolvedModel ?? '').trim() || null
    : null

  const models: RuntimeModelCatalog['models'] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if ((row.value ?? '').trim() === 'default' || row.disabled) continue
    const id = (row.resolvedModel ?? '').trim() || (row.value ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      label: (row.displayName ?? '').trim() || id,
      provider: 'anthropic',
      description: row.description?.trim() || undefined,
      default: defaultModelId ? id === defaultModelId : undefined,
      thinkingLevels:
        row.supportsEffort && row.supportedEffortLevels?.length
          ? row.supportedEffortLevels
          : undefined,
    })
  }

  // 默认值解析到没有任何普通行列出的模型（例如组织受限的安装）时，
  // 仍然把它作为可选项，保证“由运行时管理”的强度配置有落点。
  if (defaultRow && defaultModelId && !seen.has(defaultModelId) && !defaultRow.disabled) {
    models.unshift({
      id: defaultModelId,
      label: (defaultRow.displayName ?? '').trim() || defaultModelId,
      provider: 'anthropic',
      description: defaultRow.description?.trim() || undefined,
      default: true,
      thinkingLevels:
        defaultRow.supportsEffort && defaultRow.supportedEffortLevels?.length
          ? defaultRow.supportedEffortLevels
          : undefined,
    })
  }

  if (models.length > 0 && !models.some((model) => model.default)) {
    models[0].default = true
  }
  return { models }
}
