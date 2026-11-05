import type { RuntimeConfig } from '@shared/types'
import type { RuntimeFamily, RuntimeSpec } from '@runtime-sdk'

/**
 * 运行时身份到协议族的映射。
 *
 * 这里只回答“用哪个协议说话”，不关心协议实现；新增运行时通常只需要
 * 增加一条映射，而不是在调度器里再加一个 if。
 */
export function runtimeFamily(config: RuntimeConfig): RuntimeFamily {
  switch (config.adapter) {
    case 'claude-code':
      return 'claude-cli'
    case 'acp':
    case 'hermes':
    case 'opencode':
    case 'gemini':
      return 'acp'
    case 'pi':
    case 'omp':
      return 'pi-json'
    case 'codex':
      return 'codex-app-server'
    case 'qoder-cn':
      return 'claude-cli'
    case 'kimi':
      return 'kimi'
    case 'dsh':
      // 官方 DSH 的 acp profile 直接提供 ACP；只有自定义 JSONL profile
      // （协议选择 CLI）才走 DSH 原生协议族。
      return config.protocol === 'ACP' ? 'acp' : 'dsh'
    case 'custom':
      // 自定义运行时按用户选择的协议归类；CLI 走纯文本兜底，不再直接报“未认证”。
      return config.protocol === 'ACP' ? 'acp' : 'plain-cli'
    default:
      return 'plain-cli'
  }
}

export function toRuntimeSpec(config: RuntimeConfig, sessionRoot?: string): RuntimeSpec {
  const family = runtimeFamily(config)
  return {
    kind: config.adapter,
    family,
    command: config.command,
    args: config.args ?? [],
    cwd: config.cwd,
    env: config.env ?? {},
    sessionDir: sessionRoot,
  }
}
