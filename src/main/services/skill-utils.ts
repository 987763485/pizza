import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { isAbsolute, join, normalize, sep } from 'node:path'

export interface SkillFrontmatter {
  name: string
  description: string
  version: string
  body: string
}

export const MAX_FILES = 2_000
export const MAX_FILE_BYTES = 5 * 1024 * 1024
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024
export const MAX_ZIP_BYTES = 30 * 1024 * 1024

/** 拒绝绝对路径、`..` 段和空字节，导入与解压共用。 */
export function assertSafeRelativePath(input: string): string {
  if (!input || input.includes('\0')) throw new Error(`非法文件路径：${input}`)
  if (isAbsolute(input)) throw new Error(`不允许绝对路径：${input}`)
  const normalized = normalize(input).replaceAll('\\', '/')
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    throw new Error(`路径越界：${input}`)
  }
  if (normalized.startsWith('/')) throw new Error(`不允许绝对路径：${input}`)
  return normalized.replace(/^\.\//, '')
}

/**
 * 解析 SKILL.md 的 frontmatter。只支持简单 `key: value`，足够覆盖
 * Skill 规范中的 name/description/version，不引入完整 YAML 解析器。
 */
export function parseSkillFrontmatter(content: string): SkillFrontmatter {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!match) throw new Error('SKILL.md 缺少 frontmatter')
  const fields: Record<string, string> = {}
  for (const line of match[1].split(/\r?\n/)) {
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$/)
    if (!pair) continue
    let value = pair[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    fields[pair[1]] = value
  }
  const name = (fields.name ?? '').trim()
  const description = (fields.description ?? '').trim()
  if (!name) throw new Error('SKILL.md 缺少 name')
  if (!description) throw new Error('SKILL.md 缺少 description')
  if (!/^[a-z0-9][a-z0-9-_]*$/.test(name)) {
    throw new Error('Skill 名称必须为小写字母、数字、连字符或下划线')
  }
  return {
    name,
    description,
    version: (fields.version ?? '1.0.0').trim() || '1.0.0',
    body: match[2],
  }
}

export interface ScannedSkill {
  root: string
  files: string[]
  totalBytes: number
}

/**
 * 扫描目录并拒绝符号链接。Skill 只能包含普通文件和目录，避免通过链接
 * 把数据目录外的内容带进运行时。
 */
export function scanSkillDirectory(root: string): ScannedSkill {
  const files: string[] = []
  let totalBytes = 0

  const walk = (dir: string, prefix: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = assertSafeRelativePath(prefix ? `${prefix}/${entry.name}` : entry.name)
      const absolute = join(dir, entry.name)
      const stat = lstatSync(absolute)
      if (stat.isSymbolicLink()) throw new Error(`Skill 不能包含符号链接：${relative}`)
      if (stat.isDirectory()) {
        walk(absolute, relative)
        continue
      }
      if (!stat.isFile()) continue
      if (stat.size > MAX_FILE_BYTES) throw new Error(`文件过大：${relative}`)
      totalBytes += stat.size
      if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Skill 总大小超过限制')
      files.push(relative)
      if (files.length > MAX_FILES) throw new Error('Skill 文件数量超过限制')
    }
  }

  walk(root, '')
  return { root, files: files.sort(), totalBytes }
}

/** 找到包含 SKILL.md 的根目录：允许压缩包多包一层目录。 */
export function locateSkillRoot(root: string): string {
  const direct = join(root, 'SKILL.md')
  try {
    if (lstatSync(direct).isFile()) return root
  } catch {
    // 继续检查单层子目录。
  }
  const entries = readdirSync(root, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory() && !entry.name.startsWith('.'),
  )
  if (entries.length === 1) {
    const nested = join(root, entries[0].name)
    try {
      if (lstatSync(join(nested, 'SKILL.md')).isFile()) return nested
    } catch {
      // 没有 SKILL.md 时回落到原目录，由调用方给出明确错误。
    }
  }
  throw new Error('没有找到 SKILL.md')
}

export function readSkillManifest(root: string): SkillFrontmatter {
  const content = readFileSync(join(root, 'SKILL.md'), 'utf8')
  return parseSkillFrontmatter(content)
}

export function relativeJoin(root: string, relative: string): string {
  return join(root, ...relative.split('/'))
}

export function isUnder(root: string, path: string): boolean {
  const normalizedRoot = normalize(root).replace(/[\\/]+$/, '')
  const normalizedPath = normalize(path)
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`)
}
