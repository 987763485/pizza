import type { CSSProperties } from 'react'
import { AvatarImage } from './AvatarImage'

interface AvatarProps {
  name: string
  src?: string | null
  size?: number
  presence?: 'online' | 'running' | 'offline' | 'waiting'
  className?: string
  style?: CSSProperties
}

function initials(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() || 'P'
}

export function Avatar({
  name,
  src,
  size = 28,
  presence,
  className = '',
  style,
}: AvatarProps) {
  return (
    <span
      className={`avatar ${className}`}
      style={{ width: size, height: size, ...style }}
      title={name}
    >
      {src ? (
        <AvatarImage
          src={src}
          name={name}
          className="agent-avatar-img"
          style={{ width: size, height: size }}
        />
      ) : (
        <span
          className="avatar-fallback"
          style={{
            width: size,
            height: size,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--surface-3)',
            color: 'var(--ink-2)',
            fontSize: Math.max(10, size * 0.38),
            fontWeight: 650,
          }}
        >
          {initials(name)}
        </span>
      )}
      {presence ? <span className={`presence ${presence}`} /> : null}
    </span>
  )
}
