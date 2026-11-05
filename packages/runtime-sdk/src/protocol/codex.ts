import type { NormalizedRuntimeEvent, RuntimeModelCatalog } from '../types'

export interface CodexNotificationState {
  threadId: string | null
  turnId: string | null
  delivered: Map<string, string>
  error: string | null
  completed: boolean
  usage: { input: number; output: number }
}

export function createCodexState(): CodexNotificationState {
  return {
    threadId: null,
    turnId: null,
    delivered: new Map(),
    error: null,
    completed: false,
    usage: { input: 0, output: 0 },
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

function nestedString(value: unknown, ...keys: string[]): string {
  let current: unknown = value
  for (const key of keys) {
    current = record(current)[key]
  }
  return typeof current === 'string' ? current : ''
}

/**
 * 解析 Codex app-server 的 JSON-RPC 通知。
 *
 * 只处理与当前线程相关的生命周期、文本、工具与用量；其他线程（例如 Codex
 * 内部子代理）的通知直接忽略，避免污染当前会话。
 */
export function parseCodexNotification(
  method: string,
  params: Record<string, unknown>,
  state: CodexNotificationState,
): NormalizedRuntimeEvent[] {
  const threadId = typeof params.threadId === 'string' ? params.threadId : ''
  if (threadId && state.threadId && threadId !== state.threadId) return []

  const events: NormalizedRuntimeEvent[] = []

  switch (method) {
    case 'turn/started': {
      const turnId = nestedString(params, 'turn', 'id')
      if (turnId) state.turnId = turnId
      events.push({ type: 'status', payload: { status: 'running', turnId } })
      break
    }
    case 'item/agentMessage/delta': {
      const itemId = String(params.itemId ?? '')
      const delta = String(params.delta ?? '')
      if (!itemId || !delta) break
      state.delivered.set(itemId, (state.delivered.get(itemId) ?? '') + delta)
      events.push({ type: 'text_delta', payload: { text: delta, itemId } })
      break
    }
    case 'item/started': {
      const item = record(params.item)
      const itemId = String(item.id ?? '')
      const itemType = String(item.type ?? '')
      if (itemType === 'commandExecution') {
        events.push({
          type: 'tool_started',
          payload: {
            id: itemId,
            name: 'exec_command',
            input: { command: String(item.command ?? '') },
          },
        })
      } else if (itemType === 'fileChange') {
        events.push({
          type: 'tool_started',
          payload: { id: itemId, name: 'patch_apply', input: { changes: item.changes ?? [] } },
        })
      } else if (itemType === 'mcpToolCall') {
        events.push({
          type: 'tool_started',
          payload: {
            id: itemId,
            name: `${String(item.server ?? 'mcp')}:${String(item.tool ?? '')}`,
            input: record(item.arguments),
          },
        })
      }
      break
    }
    case 'item/completed': {
      const item = record(params.item)
      const itemId = String(item.id ?? '')
      const itemType = String(item.type ?? '')
      if (itemType === 'commandExecution') {
        events.push({
          type: 'tool_finished',
          payload: {
            id: itemId,
            name: 'exec_command',
            output: String(item.aggregatedOutput ?? ''),
            status: item.status,
          },
        })
      } else if (itemType === 'fileChange') {
        events.push({
          type: 'tool_finished',
          payload: {
            id: itemId,
            name: 'patch_apply',
            output: JSON.stringify(item.changes ?? []),
            status: item.status,
          },
        })
      } else if (itemType === 'mcpToolCall') {
        events.push({
          type: 'tool_finished',
          payload: {
            id: itemId,
            name: `${String(item.server ?? 'mcp')}:${String(item.tool ?? '')}`,
            output: item.result ?? item.output ?? '',
            status: item.status,
          },
        })
      } else if (itemType === 'agentMessage') {
        const text = String(item.text ?? '')
        const delivered = state.delivered.get(itemId) ?? ''
        if (text && text.startsWith(delivered)) {
          const suffix = text.slice(delivered.length)
          if (suffix) events.push({ type: 'text_delta', payload: { text: suffix, itemId } })
        } else if (text && !delivered) {
          events.push({ type: 'text_delta', payload: { text, itemId } })
        }
        state.delivered.delete(itemId)
      }
      break
    }
    case 'thread/tokenUsage/updated': {
      const usage = record(record(params.tokenUsage).last)
      const input = Number(usage.inputTokens ?? usage.input_tokens ?? 0)
      const output = Number(usage.outputTokens ?? usage.output_tokens ?? 0)
      if (input || output) {
        state.usage = { input, output }
        events.push({
          type: 'usage',
          payload: { tokensIn: input, tokensOut: output, cost: 0 },
        })
      }
      break
    }
    case 'turn/completed': {
      const status = nestedString(params, 'turn', 'status')
      const aborted = ['cancelled', 'canceled', 'aborted', 'interrupted'].includes(status)
      if (status === 'failed') {
        state.error =
          nestedString(params, 'turn', 'error', 'message') || 'Codex turn 执行失败'
        events.push({ type: 'failed', payload: { error: state.error } })
      } else if (aborted) {
        events.push({ type: 'cancelled', payload: { reason: '用户停止' } })
      } else {
        events.push({ type: 'completed', payload: { status } })
      }
      state.completed = true
      break
    }
    case 'error': {
      const willRetry = Boolean(params.willRetry)
      const message =
        nestedString(params, 'error', 'message') ||
        nestedString(params, 'message') ||
        'Codex 返回错误'
      if (!willRetry) {
        state.error = message
        events.push({ type: 'failed', payload: { error: message } })
      }
      break
    }
    default:
      break
  }

  return events
}

interface CodexModelRow {
  slug?: string
  display_name?: string
  description?: string
  default_reasoning_level?: string
  supported_reasoning_levels?: Array<{ effort?: string; description?: string }>
  visibility?: string
}

/**
 * 解析 `codex debug models` 的模型目录。
 *
 * Codex 用它自己的模型选择器展示 `visibility: "list"` 的条目；隐藏项不进入
 * 目录。思考强度来自每个模型的 supported_reasoning_levels。
 */
export function parseCodexModelCatalog(output: string): RuntimeModelCatalog {
  let rows: CodexModelRow[] = []
  try {
    const parsed = JSON.parse(output) as { models?: CodexModelRow[] }
    rows = Array.isArray(parsed.models) ? parsed.models : []
  } catch {
    return { models: [] }
  }

  const models: RuntimeModelCatalog['models'] = []
  for (const row of rows) {
    const id = (row.slug ?? '').trim()
    if (!id) continue
    if (row.visibility && row.visibility !== 'list') continue
    const levels = (row.supported_reasoning_levels ?? [])
      .map((level) => (level.effort ?? '').trim())
      .filter(Boolean)
    models.push({
      id,
      label: (row.display_name ?? '').trim() || id,
      description: row.description?.trim() || undefined,
      thinkingLevels: levels.length ? levels : undefined,
      defaultThinkingLevel: row.default_reasoning_level?.trim() || undefined,
    })
  }
  if (models.length > 0) models[0].default = true
  return { models }
}
