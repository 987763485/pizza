import type { RuntimeAdapterId } from '@shared/types'
import type { IconName } from './components/Icon'

/** 运行时适配器在列表与编辑页统一使用的图标。 */
export const ADAPTER_ICONS: Record<RuntimeAdapterId, IconName> = {
  'claude-code': 'sparkle',
  acp: 'plug',
  codex: 'terminal',
  pi: 'box',
  omp: 'zap',
  dsh: 'layers',
  hermes: 'plug',
  opencode: 'terminal',
  'qoder-cn': 'sparkle',
  gemini: 'sparkle',
  kimi: 'wand',
  custom: 'command',
}
