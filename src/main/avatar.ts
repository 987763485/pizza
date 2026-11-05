// 与已确认原型一致的默认头像：纯色圆形背景加白色线条符号。
// 头像以 data URL 保存，避免应用依赖外部图片文件。
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

function hash(input: string): number {
  let value = 7
  for (const char of input) value = (value * 31 + char.codePointAt(0)!) >>> 0
  return value
}

export function makeAvatar(name: string): string {
  const seed = hash(name)
  const color = PALETTE[seed % PALETTE.length]
  const glyph = GLYPHS[(seed >>> 3) % GLYPHS.length]
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 40 40">
    <rect width="40" height="40" rx="20" fill="${color}"/>
    <circle cx="31" cy="9" r="14" fill="#fff" opacity=".10"/>
    <g transform="translate(10.5 10.5) scale(.79)" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" opacity=".96">${glyph}</g>
  </svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
