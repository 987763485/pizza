import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { applyPendingReset, clearAppData, resetMarkerPath } from '../../src/main/reset'

const roots: string[] = []

function tempDir(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-reset-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('app reset', () => {
  it('clears app-owned data while keeping workspace files', () => {
    const dataDir = tempDir()
    mkdirSync(join(dataDir, 'attachments'), { recursive: true })
    mkdirSync(join(dataDir, 'skills'), { recursive: true })
    mkdirSync(join(dataDir, 'workspace'), { recursive: true })
    writeFileSync(join(dataDir, 'pizza.db'), 'db')
    writeFileSync(join(dataDir, 'pizza.db-wal'), 'wal')
    writeFileSync(join(dataDir, 'attachments', 'a.txt'), 'a')
    writeFileSync(join(dataDir, 'skills', 's.txt'), 's')
    writeFileSync(join(dataDir, 'workspace', 'keep.txt'), 'keep')

    clearAppData(dataDir)

    expect(existsSync(join(dataDir, 'pizza.db'))).toBe(false)
    expect(existsSync(join(dataDir, 'pizza.db-wal'))).toBe(false)
    expect(existsSync(join(dataDir, 'attachments'))).toBe(false)
    expect(existsSync(join(dataDir, 'skills'))).toBe(false)
    expect(existsSync(join(dataDir, 'workspace', 'keep.txt'))).toBe(true)
  })

  it('applies a pending reset on the next startup', () => {
    const userDataDir = tempDir()
    const dataDir = tempDir()
    mkdirSync(join(dataDir, 'attachments'), { recursive: true })
    mkdirSync(join(dataDir, 'workspace'), { recursive: true })
    writeFileSync(join(dataDir, 'pizza.db'), 'db')
    writeFileSync(join(dataDir, 'workspace', 'keep.txt'), 'keep')
    writeFileSync(resetMarkerPath(userDataDir), 'pending')

    expect(applyPendingReset(userDataDir, dataDir)).toBe(true)
    expect(existsSync(join(dataDir, 'pizza.db'))).toBe(false)
    expect(existsSync(join(dataDir, 'attachments'))).toBe(false)
    expect(existsSync(join(dataDir, 'workspace', 'keep.txt'))).toBe(true)
    expect(existsSync(resetMarkerPath(userDataDir))).toBe(false)
    expect(applyPendingReset(userDataDir, dataDir)).toBe(false)
  })

  it('uses a marker outside the data directory', () => {
    expect(resetMarkerPath('/tmp/userData')).toBe('/tmp/userData/reset-requested')
  })
})
