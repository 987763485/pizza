import type { RuntimeAdapterId } from '@shared/types'
import claude from './assets/runtime-logos/claude.svg'
import codex from './assets/runtime-logos/codex.png'
import dsh from './assets/runtime-logos/dsh.svg'
import gemini from './assets/runtime-logos/gemini.svg'
import hermes from './assets/runtime-logos/hermes.svg'
import kimi from './assets/runtime-logos/kimi.svg'
import omp from './assets/runtime-logos/omp.svg'
import opencode from './assets/runtime-logos/opencode.svg'
import pi from './assets/runtime-logos/pi.svg'
import qoder from './assets/runtime-logos/qoder.png'

/**
 * 官方运行时品牌图标。
 *
 * 图标来自 AionUi / AionCore 随附的 agent logo 资源（Apache-2.0），
 * 商标与图形版权归各自厂商所有，仅用于标识对应的运行时。
 * `mask` 表示图标使用 currentColor 单色绘制，需要跟随明暗主题着色。
 */
export interface RuntimeLogoAsset {
  src: string
  mask?: boolean
  /** 单色遮罩的固定品牌色；缺省时跟随当前文字颜色。 */
  color?: string
}

const RUNTIME_LOGOS: Partial<Record<RuntimeAdapterId, RuntimeLogoAsset>> = {
  'claude-code': { src: claude },
  codex: { src: codex, mask: true },
  dsh: { src: dsh },
  gemini: { src: gemini },
  hermes: { src: hermes, mask: true, color: '#7C3AED' },
  kimi: { src: kimi },
  omp: { src: omp, mask: true },
  opencode: { src: opencode },
  pi: { src: pi, mask: true },
  'qoder-cn': { src: qoder },
}

export function runtimeLogo(adapter: RuntimeAdapterId): RuntimeLogoAsset | null {
  return RUNTIME_LOGOS[adapter] ?? null
}
