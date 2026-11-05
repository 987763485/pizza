import type { Agent } from '@shared/types'
import { Avatar } from './Avatar'
import { AvatarImage } from './AvatarImage'
import { BrandMark } from './Brand'

interface TeamAvatarProps {
  name: string
  src?: string | null
  members?: Array<Pick<Agent, 'name' | 'avatar'>>
  size?: number
}

/**
 * 团队头像优先使用上传图片；没有上传时，用前四名成员的头像拼贴，
 * 而不是再生成一个与成员无关的随机符号。
 */
export function TeamAvatar({ name, src, members = [], size = 40 }: TeamAvatarProps) {
  if (src) {
    return (
      <span
        className="avatar"
        style={{ width: size, height: size }}
        title={name}
      >
        <AvatarImage
          className="agent-avatar-img"
          src={src}
          name={name}
          style={{ width: size, height: size }}
        />
      </span>
    )
  }

  if (members.length === 0) {
    return (
      <span
        className="avatar team-avatar-default"
        style={{ width: size, height: size }}
        title={name}
      >
        <BrandMark size={Math.max(16, Math.round(size * 0.62))} />
      </span>
    )
  }

  const visible = members.slice(0, 4)
  const cell = Math.max(14, Math.round(size / 2))
  return (
    <span
      className="team-avatar-stack"
      style={{ width: size, height: size, gridTemplateColumns: `repeat(${visible.length > 1 ? 2 : 1}, ${cell}px)` }}
      title={name}
    >
      {visible.map((member, index) => (
        <Avatar
          key={`${member.name}-${index}`}
          name={member.name}
          src={member.avatar}
          size={cell}
        />
      ))}
    </span>
  )
}
