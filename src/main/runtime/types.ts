/**
 * 主进程使用的运行时类型统一从 SDK 再导出。
 *
 * 业务代码只依赖这里的名字，SDK 可以在不触碰 Electron/SQLite 的情况下
 * 独立演进，也便于以后用 Rust 重写同一套契约。
 */
export type {
  AdapterLifecycle,
  AdapterProfile,
  ActorSnapshot,
  ActorState,
  NormalizedRuntimeEvent,
  RuntimeAdapter,
  RuntimeCapabilityInjection,
  RuntimeFamily,
  RuntimePermissionOption,
  RuntimePermissionRequest,
  RuntimePromptRequest,
  RuntimePromptResult,
  RuntimeSession,
  RuntimeSpec,
  SchedulerEvent,
  SupervisorOptions,
  SupervisorSnapshot,
  TestResult as RuntimeAdapterTestResult,
  TestStep,
} from '@runtime-sdk'

import type { RuntimeCapabilities } from '@shared/types'

export type RuntimeCapabilityReport = RuntimeCapabilities
