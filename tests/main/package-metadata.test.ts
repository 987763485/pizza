import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const script = join(process.cwd(), 'scripts', 'check-package-metadata.mjs')

describe('package metadata', () => {
  it('accepts the current package and builder configuration', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('打包元数据校验通过')
  })

  it('rejects an invalid build number', () => {
    const result = spawnSync(process.execPath, [script], {
      encoding: 'utf8',
      env: { ...process.env, PIZZA_BUILD_NUMBER: 'abc' },
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('PIZZA_BUILD_NUMBER')
  })
})
