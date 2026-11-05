import {
  RUNTIME_PRESETS,
  type RuntimeAdapterId,
  type RuntimeProtocol,
  type RuntimeTransport,
} from '@shared/types'

export interface RuntimeFormState {
  name: string
  adapter: RuntimeAdapterId
  protocol: RuntimeProtocol
  transport: RuntimeTransport
  command: string
  argsText: string
  cwd: string
  url: string
  envText: string
  timeoutMs: number
  autoReconnect: boolean
}

export const EMPTY_RUNTIME_FORM: RuntimeFormState = {
  name: 'Claude Code',
  adapter: 'claude-code',
  protocol: 'CLI',
  transport: 'stdio',
  command: 'claude',
  argsText: '',
  cwd: '',
  url: '',
  envText: '',
  timeoutMs: 30_000,
  autoReconnect: true,
}

/**
 * 从首次启动探测结果生成添加运行时的初始参数。
 * 命令优先使用探测到的绝对路径；未知适配器回退到默认表单。
 */
export function seedRuntimeForm(
  adapter?: string | null,
  command?: string | null,
): RuntimeFormState {
  const preset = RUNTIME_PRESETS.find((item) => item.adapter === adapter)
  if (!preset) return { ...EMPTY_RUNTIME_FORM }
  return {
    ...EMPTY_RUNTIME_FORM,
    adapter: preset.adapter,
    protocol: preset.protocol,
    transport: preset.transport,
    command: command?.trim() || preset.command || '',
    argsText: preset.args.join('\n'),
    name: preset.name,
  }
}
