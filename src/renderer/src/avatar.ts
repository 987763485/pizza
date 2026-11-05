import i18n from './i18n'
import { genConfig, type AvatarFullConfig } from 'react-nice-avatar'

// 与已确认原型一致的默认头像生成器：彩色圆底 + 白色线性符号。
const PALETTE = ['#D9482B', '#D97706', '#16A34A', '#2563EB', '#7C3AED', '#0EA5E9', '#DB2777']

const GLYPHS = [
  '<path d="m12 3 2.4 5.4 5.9.6-4.4 3.9 1.3 5.8L12 15.9 6.8 18.7l1.3-5.8L3.7 9l5.9-.6z"/>',
  '<path d="M12 3l7.8 4.5v9L12 21l-7.8-4.5v-9z"/><path d="M12 8l3.5 2v4L12 16l-3.5-2v-4z"/>',
  '<path d="M5 19c8 0 14-5 14-14-9 0-14 5-14 14z"/><path d="M5 19c3-5 6-8 11-10"/>',
  '<path d="M13 2 4 14h6l-1 8 9-12h-6z"/>',
  '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  '<path d="m8 9-4 3 4 3"/><path d="m16 9 4 3-4 3"/><path d="m14 5-4 14"/>',
  '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>',
]

// 供角色标签等位置复用默认头像的主色，保证同一智能体的视觉标识一致。
export function agentColor(name: string): string {
  const seed = Array.from(name).reduce(
    (value, char) => (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
    7,
  )
  return PALETTE[seed % PALETTE.length]
}

export async function cropSquareDataUrl(file: File, size = 128): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error(i18n.t('ui.图片读取失败')))
    })
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d')
    if (!context) throw new Error(i18n.t('ui.无法创建图片画布'))
    const edge = Math.min(image.width, image.height)
    const sx = (image.width - edge) / 2
    const sy = (image.height - edge) / 2
    context.drawImage(image, sx, sy, edge, edge, 0, 0, size, size)
    return canvas.toDataURL('image/jpeg', 0.9)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function avatarSvg(color: string, glyph: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 40 40">
    <rect width="40" height="40" rx="20" fill="${color}"/>
    <circle cx="31" cy="9" r="14" fill="#fff" opacity=".10"/>
    <g transform="translate(10.5 10.5) scale(.79)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".96">${glyph}</g>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function seedOf(input: string): number {
  return Array.from(input).reduce(
    (value, char) => (value * 31 + (char.codePointAt(0) ?? 0)) >>> 0,
    7,
  )
}

/** react-nice-avatar 配置的存储前缀；头像字段仍是字符串，可继续落库与跨组件传递。 */
export const NICE_AVATAR_PREFIX = 'nice:'

export function randomAvatar(name: string, salt = Math.random().toString(36)): string {
  const config = genConfig(`${name}${salt}`)
  return `${NICE_AVATAR_PREFIX}${encodeURIComponent(JSON.stringify(config))}`
}

/** 解析随机头像配置；普通图片/空值返回 null，由调用方渲染 img 或回退。 */
export function parseNiceAvatar(src: string): AvatarFullConfig | null {
  if (!src.startsWith(NICE_AVATAR_PREFIX)) return null
  try {
    return JSON.parse(decodeURIComponent(src.slice(NICE_AVATAR_PREFIX.length))) as AvatarFullConfig
  } catch {
    return null
  }
}

// 角色色选择器需要真正使用选中的颜色，而不是从调色板里再随机一次。
export function avatarWithColor(name: string, color: string): string {
  const glyph = GLYPHS[seedOf(name) % GLYPHS.length]
  return avatarSvg(color, glyph)
}
