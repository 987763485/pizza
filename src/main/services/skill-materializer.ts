import { chmodSync, cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CapabilityDiagnostic, EffectiveSkill } from '@shared/types'
import { BUILTIN_SKILL_CONTENT } from './builtin-skills'

export interface MaterializedSkills {
  runDir: string
  /** Claude CLI 的 `--plugin-dir` 目标。 */
  pluginDir: string
  skills: EffectiveSkill[]
  manifest: string
  diagnostics: CapabilityDiagnostic[]
}

function safeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/-+/g, '-')
}

/**
 * 把本次运行生效的 Skill 物化到 `runtime/<runId>/`。
 *
 * 不修改运行时安装目录；运行结束后由调用方删除整个 runDir。
 */
export function materializeSkills(
  runtimeRoot: string,
  runId: string,
  skills: EffectiveSkill[],
): MaterializedSkills {
  const runDir = join(runtimeRoot, runId)
  const pluginDir = join(runDir, 'plugin')
  const skillsRoot = join(pluginDir, 'skills')
  mkdirSync(join(pluginDir, '.claude-plugin'), { recursive: true, mode: 0o700 })
  chmodSync(runDir, 0o700)
  writeFileSync(
    join(pluginDir, '.claude-plugin', 'plugin.json'),
    `${JSON.stringify(
      {
        name: 'pizza-run-skills',
        version: '1.0.0',
        description: 'Pizza 为本次运行物化的 Skill 集合',
      },
      null,
      2,
    )}\n`,
    'utf8',
  )

  const diagnostics: CapabilityDiagnostic[] = []
  const materialized: EffectiveSkill[] = []
  const used = new Set<string>()

  for (const skill of skills) {
    let folder = safeSegment(skill.name) || 'skill'
    if (used.has(folder)) folder = `${folder}-${skill.id.slice(0, 8)}`
    used.add(folder)
    const destination = join(skillsRoot, folder)

    try {
      if (skill.builtin) {
        mkdirSync(destination, { recursive: true })
        writeFileSync(join(destination, 'SKILL.md'), BUILTIN_SKILL_CONTENT, 'utf8')
      } else {
        if (!skill.path || !existsSync(skill.path)) {
          throw new Error(`Skill 内容不存在：${skill.path}`)
        }
        cpSync(skill.path, destination, { recursive: true })
      }
      materialized.push({ ...skill, path: destination })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // 物化失败时清理已写入的部分，并把运行标记为失败。
      rmSync(runDir, { recursive: true, force: true })
      throw new Error(`SKILL_MATERIALIZATION_FAILED: ${skill.name} (${message})`)
    }
  }

  return {
    runDir,
    pluginDir,
    skills: materialized,
    manifest: buildSkillManifest(materialized),
    diagnostics,
  }
}

export function buildSkillManifest(skills: EffectiveSkill[]): string {
  if (skills.length === 0) return ''
  const lines = skills.map(
    (skill) =>
      `- ${skill.name}${skill.builtin ? '（内置）' : ''}：${skill.description}\n  路径：${skill.path}`,
  )
  return `本次运行可用的 Skill：\n${lines.join('\n')}`
}

export function cleanupMaterialized(runDir: string): void {
  rmSync(runDir, { recursive: true, force: true })
}

/** Claude CLI 通过 `--plugin-dir` 加载物化目录。 */
export function claudePluginArgs(pluginDir: string | null): string[] {
  return pluginDir ? ['--plugin-dir', pluginDir] : []
}
