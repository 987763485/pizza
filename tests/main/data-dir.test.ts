import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { DataDirService } from '../../src/main/services/data-dir-service'

const roots: string[] = []

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-datadir-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('data dir service', () => {
  it('copies the database and attachments on next startup and keeps the old dir', () => {
    const root = tempRoot()
    const userData = join(root, 'userData')
    const source = join(root, 'old')
    const target = join(root, 'new')
    mkdirSync(source, { recursive: true })
    const db = openDatabase(join(source, 'pizza.db'))
    db.close()
    mkdirSync(join(source, 'attachments'))
    writeFileSync(join(source, 'attachments', 'note.txt'), 'kept')

    const service = new DataDirService(userData, undefined, source)
    service.setPending(target)
    const status = service.applyPending()

    expect(status.current).toBe(target)
    expect(status.pending).toBeNull()
    expect(readFileSync(join(target, 'attachments', 'note.txt'), 'utf8')).toBe('kept')
    // 原目录保留，便于用户回滚。
    expect(readFileSync(join(source, 'attachments', 'note.txt'), 'utf8')).toBe('kept')
  })

  it('keeps the old dir and reports the error when migration fails', () => {
    const root = tempRoot()
    const userData = join(root, 'userData')
    const source = join(root, 'old')
    mkdirSync(source, { recursive: true })
    const target = join(root, 'not-a-dir')
    writeFileSync(target, 'occupied')

    mkdirSync(userData, { recursive: true })
    writeFileSync(
      join(userData, 'data-dir.json'),
      JSON.stringify({ current: source, pending: target, error: null }),
    )

    const service = new DataDirService(userData, undefined, source)
    const status = service.applyPending()
    expect(status.current).toBe(source)
    expect(status.error).toContain('切换数据目录失败')
    expect(service.status().pending).toBeNull()
  })

  it('refuses nested targets and env overrides', () => {
    const root = tempRoot()
    const source = join(root, 'old')
    mkdirSync(source, { recursive: true })
    const service = new DataDirService(join(root, 'userData'), undefined, source)
    expect(() => service.setPending(join(source, 'nested'))).toThrow()

    const overridden = new DataDirService(
      join(root, 'userData-2'),
      join(root, 'env-data'),
      source,
    )
    expect(() => overridden.setPending(join(root, 'next'))).toThrow(/PIZZA_DATA_DIR/)
  })
})
