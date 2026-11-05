import type { RuntimeAdapterId } from '@shared/types'
import { ADAPTER_ICONS } from '../adapter-icons'
import { runtimeLogo } from '../runtime-logos'
import { Icon } from './Icon'

interface RuntimeLogoProps {
  adapter: RuntimeAdapterId
  size?: number
  className?: string
}

/**
 * 运行时品牌图标；没有品牌资源时回退到原来的线性图标。
 *
 * 单色 SVG 通过 CSS mask 使用 currentColor，自动跟随浅色/深色主题；
 * 彩色品牌图标直接作为图片渲染。
 */
export function RuntimeLogo({ adapter, size = 18, className }: RuntimeLogoProps) {
  const logo = runtimeLogo(adapter)
  if (!logo) return <Icon name={ADAPTER_ICONS[adapter]} size={size} />

  if (logo.mask) {
    const mask = `url("${logo.src}")`
    return (
      <span
        aria-hidden="true"
        className={className}
        style={{
          display: 'inline-block',
          width: size,
          height: size,
          flex: 'none',
          color: logo.color,
          backgroundColor: 'currentColor',
          maskImage: mask,
          WebkitMaskImage: mask,
          maskMode: 'alpha',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
        }}
      />
    )
  }

  return (
    <img
      src={logo.src}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={className}
      style={{ width: size, height: size, flex: 'none', objectFit: 'contain' }}
    />
  )
}
