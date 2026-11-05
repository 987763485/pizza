import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  CapabilityBinding,
  Skill,
  SkillBindingInput,
  SkillConflictStrategy,
  SkillDetail,
  SkillImportInput,
  SkillUpdateInput,
} from '@shared/types'
import { unzipSync } from 'fflate'
import type { CapabilityStore } from '../db/capability-store'
import { BUILTIN_SKILL_CONTENT, BUILTIN_SKILL_NAME } from './builtin-skills'
import {
  assertSafeRelativePath,
  isUnder,
  locateSkillRoot,
  MAX_FILES,
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  MAX_ZIP_BYTES,
  readSkillManifest,
  relativeJoin,
  scanSkillDirectory,
} from './skill-utils'

export interface SkillServiceOptions {
  skillsDir: () => string
}

/** Skill 的存储、导入、校验与绑定。文件内容与数据库元数据分开保存。 */
export class SkillService {
  constructor(
    private readonly store: CapabilityStore,
    private readonly options: SkillServiceOptions,
  ) {}

  list(workspaceId: string): Skill[] {
    this.ensureBuiltin(workspaceId)
    return this.store.listSkills(workspaceId)
  }

  get(id: string): SkillDetail {
    const skill = this.store.getSkill(id)
    if (!skill) throw new Error('SKILL_NOT_FOUND')
    const content = this.store.getSkillContent(id)
    const files =
      skill.builtin && content?.contentDir.startsWith('builtin:')
        ? ['SKILL.md']
        : (content?.files ?? [])
    return { ...skill, files, references: this.store.listSkillReferences(id) }
  }

  /** 从头创建一个只有 SKILL.md 的 Skill，供设置页的「新建」使用。 */
  create(input: {
    workspaceId: string
    name: string
    description: string
    body?: string
  }): Skill {
    if (this.store.findSkillByName(input.workspaceId, input.name)) {
      throw new Error(`SKILL_EXISTS: ${input.name}`)
    }
    const content = `---\nname: ${input.name}\ndescription: ${input.description}\nversion: 1.0.0\n---\n\n${
      input.body?.trim() || `# ${input.name}\n\n在这里描述这个 Skill 的工作方式。\n`
    }\n`
    const created = this.store.createSkill({
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      version: '1.0.0',
      sourceType: 'manual',
      sourceRef: null,
      tags: [],
      enabled: true,
      builtin: false,
      contentDir: '',
      files: ['SKILL.md'],
    })
    try {
      const dir = join(this.options.skillsDir(), created.id, '1.0.0')
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'SKILL.md'), content, 'utf8')
      return this.store.updateSkill(created.id, { contentDir: dir }) ?? created
    } catch (error) {
      this.store.deleteSkill(created.id)
      throw error
    }
  }

  async import(input: SkillImportInput): Promise<Skill> {
    const conflict = input.conflict ?? 'stop'
    const tempRoot = mkdtempSync(join(tmpdir(), 'pizza-skill-'))
    try {
      const extracted = join(tempRoot, 'extracted')
      mkdirSync(extracted, { recursive: true })
      await this.extract(input, extracted)
      const root = locateSkillRoot(extracted)
      const scanned = scanSkillDirectory(root)
      const frontmatter = readSkillManifest(root)

      const existing = this.store.findSkillByName(input.workspaceId, frontmatter.name)
      if (existing) {
        if (conflict === 'stop') {
          throw new Error(`SKILL_EXISTS: ${frontmatter.name}`)
        }
        if (conflict === 'skip') return existing
        if (conflict === 'overwrite') {
          this.copyContent(root, existing.id, frontmatter.version, true)
          return (
            this.store.updateSkill(existing.id, {
              description: frontmatter.description,
              version: frontmatter.version,
              tags: input.tags ?? existing.tags,
              files: scanned.files,
              enabled: input.enabled ?? true,
            }) ?? existing
          )
        }
      }

      const name =
        conflict === 'rename' && existing
          ? this.uniqueName(input.workspaceId, frontmatter.name)
          : input.name || frontmatter.name
      if (this.store.findSkillByName(input.workspaceId, name)) {
        throw new Error(`SKILL_EXISTS: ${name}`)
      }

      // 先创建数据库记录拿到稳定 ID，再写入最终目录；写目录失败时删除记录。
      const created = this.store.createSkill({
        workspaceId: input.workspaceId,
        name,
        description: frontmatter.description,
        version: frontmatter.version,
        sourceType: input.sourceType,
        sourceRef: input.sourcePath ?? input.gitUrl ?? null,
        tags: input.tags ?? [],
        enabled: input.enabled ?? true,
        builtin: false,
        contentDir: '',
        files: scanned.files,
      })
      try {
        this.copyContent(root, created.id, frontmatter.version, false)
        return (
          this.store.updateSkill(created.id, {
            files: scanned.files,
            version: frontmatter.version,
          }) ?? created
        )
      } catch (error) {
        this.store.deleteSkill(created.id)
        throw error
      }
    } finally {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  }

  update(id: string, input: SkillUpdateInput): Skill {
    const skill = this.store.getSkill(id)
    if (!skill) throw new Error('SKILL_NOT_FOUND')
    if (skill.builtin) {
      // 内置 Skill 只允许启停，不能改名或改描述，避免运行结果不可复现。
      if (input.enabled === undefined) throw new Error('BUILTIN_SKILL_READONLY')
      return this.store.updateSkill(id, { enabled: input.enabled }) ?? skill
    }
    if (input.name && input.name !== skill.name) {
      const existing = this.store.findSkillByName(skill.workspaceId, input.name)
      if (existing) throw new Error(`SKILL_EXISTS: ${input.name}`)
    }
    return this.store.updateSkill(id, input) ?? skill
  }

  remove(id: string): void {
    const skill = this.store.getSkill(id)
    if (!skill) throw new Error('SKILL_NOT_FOUND')
    if (skill.builtin) throw new Error('BUILTIN_SKILL_READONLY')
    const references = this.store.countSkillBindings(id)
    if (references > 0) throw new Error(`SKILL_IN_USE: ${references}`)
    const content = this.store.getSkillContent(id)
    this.store.deleteSkill(id)
    rmSync(join(this.options.skillsDir(), id), { recursive: true, force: true })
    if (content?.contentDir) {
      rmSync(content.contentDir, { recursive: true, force: true })
    }
  }

  bindings(scopeType: CapabilityBinding['scopeType'], scopeId: string): CapabilityBinding[] {
    return this.store.listSkillBindings(scopeType, scopeId)
  }

  setBinding(input: SkillBindingInput): CapabilityBinding {
    if (!this.store.getSkill(input.skillId)) throw new Error('SKILL_NOT_FOUND')
    return this.store.upsertSkillBinding(input)
  }

  removeBinding(input: SkillBindingInput): void {
    this.store.removeSkillBinding(input.skillId, input.scopeType, input.scopeId)
  }

  contentDir(id: string): string | null {
    const content = this.store.getSkillContent(id)
    if (!content) return null
    if (content.contentDir.startsWith('builtin:')) return content.contentDir
    return content.contentDir
  }

  readBuiltinContent(): string {
    return BUILTIN_SKILL_CONTENT
  }

  /** 读取 Skill 内的文本文件用于详情预览；拒绝越界路径。 */
  readFile(id: string, relative: string): { path: string; content: string } {
    const skill = this.store.getSkill(id)
    const content = this.store.getSkillContent(id)
    if (!skill || !content) throw new Error('SKILL_NOT_FOUND')
    const safe = assertSafeRelativePath(relative)
    if (!content.files.includes(safe)) throw new Error('SKILL_FILE_NOT_FOUND')
    if (content.contentDir.startsWith('builtin:')) {
      if (safe !== 'SKILL.md') throw new Error('SKILL_FILE_NOT_FOUND')
      return { path: safe, content: BUILTIN_SKILL_CONTENT }
    }
    const target = relativeJoin(content.contentDir, safe)
    if (!content.contentDir || !isUnder(content.contentDir, target)) {
      throw new Error('SKILL_FILE_OUTSIDE_ROOT')
    }
    const buffer = readFileSync(target)
    const text = buffer.subarray(0, 200_000).toString('utf8')
    return { path: safe, content: text }
  }

  private ensureBuiltin(workspaceId: string): void {
    if (this.store.findSkillByName(workspaceId, BUILTIN_SKILL_NAME)) return
    this.store.createSkill({
      workspaceId,
      name: BUILTIN_SKILL_NAME,
      description: 'Pizza 的团队协作约定：提及、交接、等待用户与收敛结果的统一写法。',
      version: '1.0.0',
      sourceType: 'builtin',
      sourceRef: null,
      tags: ['内置', '协作'],
      enabled: true,
      builtin: true,
      contentDir: `builtin:${BUILTIN_SKILL_NAME}`,
      files: ['SKILL.md'],
    })
  }

  private async extract(input: SkillImportInput, target: string): Promise<void> {
    if (input.sourceType === 'local') {
      if (!input.sourcePath) throw new Error('缺少 Skill 目录路径')
      cpSync(input.sourcePath, target, { recursive: true })
      return
    }

    if (input.sourceType === 'zip') {
      if (!input.sourcePath) throw new Error('缺少 ZIP 路径')
      const archive = new Uint8Array(readFileSync(input.sourcePath))
      if (archive.byteLength > MAX_ZIP_BYTES) {
        throw new Error('ZIP 文件超过大小限制')
      }
      // 在解压前按中央目录的 originalSize/数量过滤，避免压缩炸弹先耗尽内存。
      let fileCount = 0
      let totalBytes = 0
      const entries = unzipSync(archive, {
        filter: (file) => {
          const relative = assertSafeRelativePath(file.name)
          if (relative.endsWith('/')) return true
          if (file.originalSize > MAX_FILE_BYTES) {
            throw new Error(`文件过大：${relative}`)
          }
          totalBytes += file.originalSize
          fileCount += 1
          if (totalBytes > MAX_TOTAL_BYTES) throw new Error('ZIP 总大小超过限制')
          if (fileCount > MAX_FILES) throw new Error('ZIP 文件数量超过限制')
          return true
        },
      })
      for (const [entry, data] of Object.entries(entries)) {
        const relative = assertSafeRelativePath(entry)
        if (relative.endsWith('/')) continue
        const destination = relativeJoin(target, relative)
        mkdirSync(join(destination, '..'), { recursive: true })
        writeFileSync(destination, data)
      }
      return
    }

    if (!input.gitUrl) throw new Error('缺少 Git 仓库地址')
    if (!/^(https?:\/\/|git@|file:\/\/|\/)/.test(input.gitUrl)) {
      throw new Error('Git 地址只支持 http(s)、ssh、file 或本地路径')
    }
    const result = spawnSync(
      'git',
      ['clone', '--depth', '1', '--', input.gitUrl, target],
      { encoding: 'utf8', timeout: 120_000 },
    )
    if (result.status !== 0) {
      throw new Error(`Git 克隆失败：${(result.stderr || result.stdout).slice(-500)}`)
    }
  }

  private copyContent(
    root: string,
    skillId: string,
    version: string,
    overwrite: boolean,
  ): void {
    const versioned = join(this.options.skillsDir(), skillId, version)
    if (existsSync(versioned)) {
      if (!overwrite) rmSync(versioned, { recursive: true, force: true })
      else rmSync(versioned, { recursive: true, force: true })
    }
    mkdirSync(join(versioned, '..'), { recursive: true })
    cpSync(root, versioned, { recursive: true, force: true })
    // 内容目录以版本目录为准，更新后指向同一条记录。
    this.store.updateSkill(skillId, {
      contentDir: versioned,
      version,
    })
  }

  private uniqueName(workspaceId: string, base: string): string {
    for (let index = 2; index < 100; index += 1) {
      const candidate = `${base}-${index}`
      if (!this.store.findSkillByName(workspaceId, candidate)) return candidate
    }
    throw new Error('无法生成不冲突的 Skill 名称')
  }
}

export function readBuiltinSkillFile(): string {
  return BUILTIN_SKILL_CONTENT
}
