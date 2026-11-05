import type { CSSProperties } from 'react'
import NiceAvatar from 'react-nice-avatar'
import { parseNiceAvatar } from '../avatar'

interface AvatarImageProps {
  src: string
  name: string
  className?: string
  style?: CSSProperties
}

/**
 * 统一渲染已保存的头像：随机头像以 `nice:` 配置存储并交给
 * react-nice-avatar 绘制，上传图片继续使用普通 img。
 */
export function AvatarImage({ src, name, className, style }: AvatarImageProps) {
  const config = parseNiceAvatar(src)
  if (config) {
    return (
      <NiceAvatar
        shape="circle"
        {...config}
        className={`${className ?? ''} nice-avatar`.trim()}
        style={{ width: '100%', height: '100%', ...style }}
      />
    )
  }
  return <img className={className} src={src} alt={name} style={style} />
}
