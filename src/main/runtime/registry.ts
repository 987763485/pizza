import type { RuntimeConfig } from '@shared/types'
import {
  createDefaultAdapters,
  RuntimeSupervisor,
  type RuntimeAdapter,
  type SupervisorOptions,
} from '@runtime-sdk'
import { runtimeFamily, toRuntimeSpec } from './spec'

/**
 * 协议族注册表。
 *
 * 适配器无状态，按协议族共享；运行时身份（claude-code / pi / omp / codex ...）
 * 只影响 `toRuntimeSpec` 生成的启动参数。调度器永远不会因为某个运行时 ID
 * 没有单独分支而拒绝它。
 */
const adapters = createDefaultAdapters()

export function getRuntimeAdapter(config: RuntimeConfig): RuntimeAdapter {
  return adapters.get(runtimeFamily(config)) as RuntimeAdapter
}

export function createRuntimeSupervisor(options?: SupervisorOptions): RuntimeSupervisor {
  return new RuntimeSupervisor(adapters, options)
}

export function testRuntime(
  config: RuntimeConfig,
  signal: AbortSignal,
  sessionRoot?: string,
) {
  return getRuntimeAdapter(config).test(toRuntimeSpec(config, sessionRoot), signal)
}

export { runtimeFamily, toRuntimeSpec }

export function protocolLabel(config: RuntimeConfig): string {
  return config.protocol === 'ACP' ? 'ACP' : 'CLI 兼容'
}
