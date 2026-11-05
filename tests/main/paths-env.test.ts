import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  collectExecutableDirs,
  ensureExecutablePath,
} from '../../src/main/paths-env'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function tempHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-path-'))
  roots.push(root)
  return root
}

describe('executable PATH helpers', () => {
  it('adds nvm, bun and local bin directories on macOS', () => {
    const home = tempHome()
    const nvm = join(home, '.nvm', 'versions', 'node', 'v22.23.3', 'bin')
    const bun = join(home, '.bun', 'bin')
    const local = join(home, '.local', 'bin')
    const fnm = join(
      home,
      'Library',
      'Application Support',
      'fnm',
      'node-versions',
      'v20.0.0',
      'installation',
      'bin',
    )
    const opencode = join(home, '.opencode', 'bin')
    const qoder = join(home, '.qoder-cn', 'entry')
    const kimi = join(home, '.kimi-code', 'bin')
    for (const dir of [nvm, bun, local, fnm, opencode, qoder, kimi]) {
      mkdirSync(dir, { recursive: true })
    }

    const dirs = collectExecutableDirs(home, 'darwin', { PATH: '' }, existsSync)
    expect(dirs).toContain(nvm)
    expect(dirs).toContain(bun)
    expect(dirs).toContain(local)
    expect(dirs).toContain(fnm)
    expect(dirs).toContain(opencode)
    expect(dirs).toContain(qoder)
    expect(dirs).toContain(kimi)
  })

  it('prepends detected directories without dropping or duplicating PATH entries', () => {
    const home = tempHome()
    const nvm = join(home, '.nvm', 'versions', 'node', 'v22.23.3', 'bin')
    mkdirSync(nvm, { recursive: true })
    const env = { PATH: ['/usr/bin', '/bin', nvm].join(delimiter) }

    ensureExecutablePath(env, home, 'darwin')

    const parts = (env.PATH ?? '').split(delimiter)
    expect(parts.indexOf(nvm)).toBeGreaterThanOrEqual(0)
    expect(parts.indexOf(nvm)).toBeLessThan(parts.indexOf('/usr/bin'))
    expect(parts).toContain('/usr/bin')
    expect(parts).toContain('/bin')
    expect(parts.filter((dir) => dir === nvm)).toHaveLength(1)
  })

  it('uses the Windows npm and package-manager directories', () => {
    const home = tempHome()
    const appData = join(home, 'AppData', 'Roaming')
    const npm = join(appData, 'npm')
    const bun = join(home, '.bun', 'bin')
    for (const dir of [npm, bun]) mkdirSync(dir, { recursive: true })

    const dirs = collectExecutableDirs(
      home,
      'win32',
      { APPDATA: appData, LOCALAPPDATA: join(home, 'AppData', 'Local'), PATH: '' },
      existsSync,
    )
    expect(dirs).toContain(npm)
    expect(dirs).toContain(bun)
  })
})
