import type { NormalizedRuntimeEvent, RuntimeModelCatalog } from '../types'
import { asRecord } from '../jsonrpc'

export interface AcpSelectValue {
  value: string
  name: string
  description?: string
  provider?: string
}

export interface AcpModelConfig {
  catalog: RuntimeModelCatalog
  modelOptionId: string | null
  thinkingOptionId: string | null
  modelValues: string[]
  thinkingValues: string[]
  currentModel: string | null
  currentThinking: string | null
  legacyCurrentModel: string | null
  hasLegacyModels: boolean
}

const THINKING_OPTION_IDS = new Set([
  'reasoning_effort',
  'thought_level',
  'thinking',
  'effort',
])

function flattenSelectOptions(options: unknown[]): AcpSelectValue[] {
  const values: AcpSelectValue[] = []
  for (const option of options) {
    const record = asRecord(option)
    if (Array.isArray(record.options)) {
      const provider = String(record.group ?? record.name ?? '')
      for (const child of flattenSelectOptions(record.options)) {
        values.push({ ...child, provider: child.provider ?? (provider || undefined) })
      }
      continue
    }
    if (record.value === undefined) continue
    const value = String(record.value)
    values.push({
      value,
      name: String(record.name ?? value),
      description:
        typeof record.description === 'string' ? record.description : undefined,
      provider: typeof record.provider === 'string' ? record.provider : undefined,
    })
  }
  return values
}

/**
 * 从 ACP `session/new` / `session/load` 响应中读取模型与思考强度。
 *
 * 新协议把选择项放在 `configOptions`（category: model / thought_level）；
 * 旧协议（Hermes、Gemini CLI 等）仍返回 `models.availableModels`。两者都兼容。
 */
export function readAcpModelConfig(rawSession: unknown): AcpModelConfig {
  const session = asRecord(rawSession)
  const configOptions = Array.isArray(session.configOptions)
    ? session.configOptions.map(asRecord)
    : []

  const modelOption = configOptions.find(
    (option) => option.category === 'model' || option.id === 'model',
  )
  const thinkingOption = configOptions.find(
    (option) =>
      option.category === 'thought_level' ||
      (typeof option.id === 'string' && THINKING_OPTION_IDS.has(option.id)),
  )

  const modelValues = modelOption?.options
    ? flattenSelectOptions(modelOption.options as unknown[])
    : []
  const thinkingValues = thinkingOption?.options
    ? flattenSelectOptions(thinkingOption.options as unknown[])
    : []

  const currentModel =
    modelOption?.currentValue !== undefined ? String(modelOption.currentValue) : null
  const currentThinking =
    thinkingOption?.currentValue !== undefined
      ? String(thinkingOption.currentValue)
      : null

  const models: RuntimeModelCatalog['models'] = modelValues
    .filter((entry) => entry.value !== '')
    .map((entry) => ({
      id: entry.value,
      label: entry.name || entry.value,
      provider: entry.provider,
      description: entry.description,
      default: currentModel ? entry.value === currentModel : undefined,
    }))

  const legacy = asRecord(session.models)
  const availableModels = Array.isArray(legacy.availableModels)
    ? legacy.availableModels.map(asRecord)
    : []
  const legacyCurrent = String(legacy.currentModelId ?? '')
  let hasLegacyModels = false
  for (const entry of availableModels) {
    const id = String(entry.modelId ?? entry.model_id ?? entry.id ?? '')
    if (!id || models.some((model) => model.id === id)) continue
    hasLegacyModels = true
    models.push({
      id,
      label: String(entry.name ?? entry.label ?? id),
      description:
        typeof entry.description === 'string' ? entry.description : undefined,
      default: legacyCurrent ? id === legacyCurrent : undefined,
    })
  }

  if (models.length > 0 && !models.some((model) => model.default)) {
    models[0].default = true
  }

  return {
    catalog: {
      models,
      thinkingLevels: thinkingValues.length
        ? thinkingValues.map((entry) => entry.value)
        : undefined,
      defaultThinkingLevel: currentThinking ?? undefined,
    },
    modelOptionId:
      modelOption && typeof modelOption.id === 'string' ? modelOption.id : null,
    thinkingOptionId:
      thinkingOption && typeof thinkingOption.id === 'string'
        ? thinkingOption.id
        : null,
    modelValues: modelValues.map((entry) => entry.value),
    thinkingValues: thinkingValues.map((entry) => entry.value),
    currentModel,
    currentThinking,
    legacyCurrentModel: legacyCurrent || null,
    hasLegacyModels,
  }
}

export function parseAcpModelCatalog(rawSession: unknown): RuntimeModelCatalog {
  return readAcpModelConfig(rawSession).catalog
}

/** 把 ACP `session/update` 的 update 映射为统一事件。 */
export function parseAcpUpdate(update: unknown): NormalizedRuntimeEvent[] {
  const record = asRecord(update)
  const kind = String(record.sessionUpdate ?? record.type ?? '')
  const events: NormalizedRuntimeEvent[] = []

  if (kind === 'agent_message_chunk' || kind === 'agent_message') {
    const content = asRecord(record.content)
    const text = typeof content.text === 'string' ? content.text : ''
    if (text) events.push({ type: 'text_delta', payload: { text } })
  }

  if (kind === 'tool_call') {
    events.push({
      type: 'tool_started',
      payload: {
        id: record.toolCallId ?? record.id,
        name: record.title ?? record.kind ?? 'tool',
        input: record.rawInput ?? record.input ?? {},
        status: record.status,
      },
    })
  }

  if (kind === 'tool_call_update') {
    const status = String(record.status ?? '')
    events.push({
      type: status === 'completed' || status === 'failed' ? 'tool_finished' : 'tool_updated',
      payload: {
        id: record.toolCallId ?? record.id,
        status,
        output: record.rawOutput ?? record.content,
      },
    })
  }

  if (kind === 'plan') {
    events.push({ type: 'status', payload: { plan: record.entries ?? record } })
  }

  return events
}
