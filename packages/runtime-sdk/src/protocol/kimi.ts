export interface KimiToolCall {
  id: string
  name: string
  input: unknown
}

export interface KimiToolResult {
  callId: string
  output: string
  isError: boolean
}

export interface ParsedKimiLine {
  sessionId: string | null
  text: string
  toolCalls: KimiToolCall[]
  toolResults: KimiToolResult[]
  completed: boolean
  error: string | null
}

interface KimiRecord {
  role?: string
  content?: unknown
  tool_calls?: unknown
  tool_call_id?: string
  type?: string
  session_id?: string
  message?: string
  is_error?: boolean
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const value = part as { type?: unknown; text?: unknown }
      if (value.type === 'think') return ''
      return typeof value.text === 'string' ? value.text : ''
    })
    .join('')
}

function parseArguments(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function parseToolCalls(value: unknown): KimiToolCall[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return []
    const call = item as {
      id?: unknown
      function?: { name?: unknown; arguments?: unknown }
    }
    const name = typeof call.function?.name === 'string' ? call.function.name : 'tool'
    const id = typeof call.id === 'string' ? call.id : `kimi-tool-${index}`
    return [{ id, name, input: parseArguments(call.function?.arguments) }]
  })
}

/**
 * Kimi Code `-p --output-format stream-json` 的 JSONL 记录。
 *
 * 普通回复是 assistant 消息；工具调用先出现带 tool_calls 的 assistant
 * 消息，再出现 role=tool 的结果。`session.resume_hint` 是结束信号，并携带
 * 后续恢复所需的 session_id。
 */
export function parseKimiLine(line: string): ParsedKimiLine | null {
  let record: KimiRecord
  try {
    record = JSON.parse(line) as KimiRecord
  } catch {
    return null
  }
  if (!record || typeof record !== 'object') return null

  const result: ParsedKimiLine = {
    sessionId: null,
    text: '',
    toolCalls: [],
    toolResults: [],
    completed: false,
    error: null,
  }

  if (record.role === 'meta' && record.type === 'session.resume_hint') {
    result.sessionId = typeof record.session_id === 'string' ? record.session_id : null
    result.completed = true
    return result
  }

  if (record.role === 'meta' && record.type === 'error') {
    result.error = contentText(record.content) || record.message || 'Kimi 运行失败'
    return result
  }

  if (record.role === 'tool') {
    result.toolResults = [
      {
        callId: typeof record.tool_call_id === 'string' ? record.tool_call_id : '',
        output: contentText(record.content),
        isError: Boolean(record.is_error),
      },
    ]
    return result
  }

  if (record.role === 'assistant') {
    result.text = contentText(record.content)
    result.toolCalls = parseToolCalls(record.tool_calls)
    return result
  }

  if (record.role === 'user') return result

  if (record.type === 'error') {
    result.error = record.message || 'Kimi 运行失败'
  }
  return result
}
