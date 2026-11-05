import type { RuntimeConfig } from '@shared/types'
import {
  ClaudeCliAdapter as SdkClaudeCliAdapter,
  parseClaudeLine,
  type RuntimeModelCatalog,
  type RuntimePromptResult,
  type RuntimeSession,
  type TestResult,
} from '@runtime-sdk'
import { toRuntimeSpec } from './spec'

export { parseClaudeLine }

/**
 * 应用层薄封装：把 `RuntimeConfig` 转成 SDK 的 `RuntimeSpec`。
 *
 * 真正的协议实现位于 `packages/runtime-sdk`，主进程只负责把数据库中的
 * 运行时配置交给 SDK。保留这个类是为了既有调用点与测试的稳定接口。
 */
export class ClaudeCliAdapter {
  private readonly inner = new SdkClaudeCliAdapter()
  readonly profile = this.inner.profile

  test(config: RuntimeConfig, signal: AbortSignal): Promise<TestResult> {
    return this.inner.test(toRuntimeSpec(config), signal)
  }

  listModels(
    config: RuntimeConfig,
    signal?: AbortSignal,
  ): Promise<RuntimeModelCatalog> {
    return this.inner.listModels(toRuntimeSpec(config), signal)
  }

  openSession(config: RuntimeConfig): Promise<RuntimeSession> {
    return this.inner.openSession(toRuntimeSpec(config))
  }

  // 保留给未来需要直接调用 SDK 会话的调用点。
  prompt(
    config: RuntimeConfig,
    request: Parameters<RuntimeSession['prompt']>[0],
  ): Promise<RuntimePromptResult> {
    return this.inner.openSession(toRuntimeSpec(config)).then((session) =>
      session.prompt(request).finally(() => session.close()),
    )
  }
}
