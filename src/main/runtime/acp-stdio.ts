import type { RuntimeConfig } from '@shared/types'
import {
  AcpStdioAdapter as SdkAcpStdioAdapter,
  parseAcpUpdate,
  type RuntimeModelCatalog,
  type RuntimeSession,
  type TestResult,
} from '@runtime-sdk'
import { toRuntimeSpec } from './spec'

export { parseAcpUpdate }

/** 应用层薄封装：数据库运行时配置 → SDK RuntimeSpec。 */
export class AcpStdioAdapter {
  private readonly inner = new SdkAcpStdioAdapter()
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
}
