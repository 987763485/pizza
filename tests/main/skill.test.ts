import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zipSync } from 'fflate'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CapabilityStore } from '../../src/main/db/capability-store'
import { SkillService } from '../../src/main/services/skill-service'
import { parseSkillFrontmatter } from '../../src/main/services/skill-utils'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-skill-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function setup() {
  const root = tempRoot()
  const db = openDatabase(':memory:')
  db.prepare(
    'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run('11111111-1111-4111-8111-111111111111', 'W', root, new Date().toISOString())
  const store = new CapabilityStore(db)
  const skills = new SkillService(store, { skillsDir: () => join(root, 'skills') })
  return { root, db, store, skills, workspaceId: '11111111-1111-4111-8111-111111111111' }
}

function skillSource(root: string, name = 'writer', body = 'body'): string {
  const dir = join(root, `source-${name}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: 写作助手\nversion: 1.2.0\n---\n\n${body}\n`,
  )
  writeFileSync(join(dir, 'script.js'), 'console.log(1)\n')
  return dir
}

describe('skill frontmatter', () => {
  it('parses required fields and rejects missing descriptions', () => {
    expect(parseSkillFrontmatter('---\nname: a\ndescription: d\n---\nx')).toMatchObject({
      name: 'a',
      description: 'd',
      version: '1.0.0',
    })
    expect(() => parseSkillFrontmatter('---\nname: a\n---\nx')).toThrow(/description/)
  })
})

describe('skill service', () => {
  it('imports a local skill, stores its manifest and lists the builtin', async () => {
    const { root, db, skills, workspaceId } = setup()
    const imported = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: skillSource(root),
      tags: ['写作'],
    })
    expect(imported.name).toBe('writer')
    expect(imported.fileCount).toBe(2)
    expect(skills.get(imported.id).files).toEqual(['SKILL.md', 'script.js'])

    const all = skills.list(workspaceId)
    expect(all.some((skill) => skill.builtin && skill.name === 'pizza-collaboration')).toBe(true)
    db.close()
  })

  it('honors the enabled flag when importing', async () => {
    const { root, db, skills, workspaceId } = setup()
    const disabled = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: skillSource(root, 'disabled-skill'),
      enabled: false,
    })
    expect(disabled.enabled).toBe(false)

    const enabled = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: skillSource(root, 'enabled-skill'),
    })
    expect(enabled.enabled).toBe(true)
    db.close()
  })

  it('rejects path traversal inside a zip', async () => {
    const { root, db, skills, workspaceId } = setup()
    const zipPath = join(root, 'evil.zip')
    writeFileSync(
      zipPath,
      Buffer.from(
        zipSync({
          'SKILL.md': new TextEncoder().encode('---\nname: evil\ndescription: x\n---\n'),
          '../escape.txt': new TextEncoder().encode('bad'),
        }),
      ),
    )
    await expect(
      skills.import({ workspaceId, sourceType: 'zip', sourcePath: zipPath }),
    ).rejects.toThrow(/越界|非法/)
    db.close()
  })

  it('rejects an oversized file inside a zip before extracting it', async () => {
    const { root, db, skills, workspaceId } = setup()
    const zipPath = join(root, 'bomb.zip')
    writeFileSync(
      zipPath,
      Buffer.from(
        zipSync({
          'SKILL.md': new TextEncoder().encode('---\nname: bomb\ndescription: x\n---\n'),
          'big.bin': new Uint8Array(6 * 1024 * 1024),
        }),
      ),
    )
    await expect(
      skills.import({ workspaceId, sourceType: 'zip', sourcePath: zipPath }),
    ).rejects.toThrow(/文件过大|总大小/)
    db.close()
  })

  it('rejects symlinks in the imported directory', async () => {
    const { root, db, skills, workspaceId } = setup()
    const source = skillSource(root, 'linked')
    symlinkSync('/etc/hosts', join(source, 'hosts-link'))
    await expect(
      skills.import({ workspaceId, sourceType: 'local', sourcePath: source }),
    ).rejects.toThrow(/符号链接/)
    db.close()
  })

  it('handles stop, skip, rename and overwrite conflicts', async () => {
    const { root, db, skills, workspaceId } = setup()
    const source = skillSource(root)
    const first = await skills.import({ workspaceId, sourceType: 'local', sourcePath: source })
    await expect(
      skills.import({ workspaceId, sourceType: 'local', sourcePath: source }),
    ).rejects.toThrow(/SKILL_EXISTS/)
    const skipped = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: source,
      conflict: 'skip',
    })
    expect(skipped.id).toBe(first.id)
    const renamed = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: source,
      conflict: 'rename',
    })
    expect(renamed.name).toBe('writer-2')
    const overwritten = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: source,
      conflict: 'overwrite',
    })
    expect(overwritten.id).toBe(first.id)
    db.close()
  })

  it('blocks deleting a bound skill and allows deletion after unbinding', async () => {
    const { root, db, store, skills, workspaceId } = setup()
    const imported = await skills.import({
      workspaceId,
      sourceType: 'local',
      sourcePath: skillSource(root),
    })
    skills.setBinding({
      skillId: imported.id,
      scopeType: 'workspace',
      scopeId: workspaceId,
    })
    expect(() => skills.remove(imported.id)).toThrow(/SKILL_IN_USE/)
    skills.removeBinding({
      skillId: imported.id,
      scopeType: 'workspace',
      scopeId: workspaceId,
    })
    skills.remove(imported.id)
    expect(store.getSkill(imported.id)).toBeNull()
    db.close()
  })
})
