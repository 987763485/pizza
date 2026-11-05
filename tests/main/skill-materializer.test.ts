import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { materializeSkills } from '../../src/main/services/skill-materializer'
import type { EffectiveSkill } from '../../src/shared/types'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-materialize-'))
  roots.push(root)
  return root
}

function skill(overrides: Partial<EffectiveSkill>): EffectiveSkill {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'writer',
    description: '写作',
    version: '1.0.0',
    path: '',
    builtin: false,
    sourceType: 'local',
    ...overrides,
  }
}

describe('skill materialization', () => {
  it('writes builtin skills into the run plugin and includes them in the manifest', () => {
    const root = tempRoot()
    const result = materializeSkills(root, 'run-1', [
      skill({ name: 'pizza-collaboration', builtin: true, sourceType: 'builtin' }),
    ])
    const file = join(result.pluginDir, 'skills', 'pizza-collaboration', 'SKILL.md')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8')).toContain('name: pizza-collaboration')
    expect(result.manifest).toContain('pizza-collaboration')
  })

  it('fails the run when a skill file is missing', () => {
    const root = tempRoot()
    expect(() =>
      materializeSkills(root, 'run-2', [skill({ path: join(root, 'missing') })]),
    ).toThrow(/SKILL_MATERIALIZATION_FAILED/)
  })
})
