import type { RuntimeAdapter, RuntimeFamily } from '../types'
import { AcpStdioAdapter } from './acp'
import { ClaudeCliAdapter } from './claude-cli'
import { CodexAppServerAdapter } from './codex-app-server'
import { DshAdapter } from './dsh'
import { KimiAdapter } from './kimi'
import { PiJsonAdapter } from './pi-json'
import { PlainCliAdapter } from './plain-cli'

export { AcpStdioAdapter } from './acp'
export { ClaudeCliAdapter } from './claude-cli'
export { CodexAppServerAdapter } from './codex-app-server'
export { DshAdapter } from './dsh'
export { KimiAdapter } from './kimi'
export { PiJsonAdapter } from './pi-json'
export { PlainCliAdapter } from './plain-cli'

/**
 * 默认协议族注册表。
 *
 * 调用方只按 `RuntimeSpec.family` 取适配器；新增运行时不需要改调度器，
 * 只需要在解析运行时身份时给出正确的 family。
 */
export function createDefaultAdapters(): Map<RuntimeFamily, RuntimeAdapter> {
  return new Map<RuntimeFamily, RuntimeAdapter>([
    ['claude-cli', new ClaudeCliAdapter()],
    ['acp', new AcpStdioAdapter()],
    ['pi-json', new PiJsonAdapter()],
    ['codex-app-server', new CodexAppServerAdapter()],
    ['dsh', new DshAdapter()],
    ['kimi', new KimiAdapter()],
    ['plain-cli', new PlainCliAdapter()],
  ])
}
