import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { inTransaction, openDatabase } from '../../src/main/db/database'
import { MIGRATIONS } from '../../src/main/db/migrations'

const roots: string[] = []

function tempDbPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'pizza-db-'))
  roots.push(root)
  return join(root, 'pizza.db')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('database bootstrap', () => {
  it('enables WAL and foreign keys and applies migrations once', () => {
    const path = tempDbPath()
    const db = openDatabase(path)
    expect(db.prepare('PRAGMA journal_mode').get()).toMatchObject({ journal_mode: 'wal' })
    expect(db.prepare('PRAGMA foreign_keys').get()).toMatchObject({ foreign_keys: 1 })
    const first = db
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number }
    expect(first.count).toBe(MIGRATIONS.length)
    db.close()

    // 重复打开同一数据库不应重复执行迁移。
    const reopened = openDatabase(path)
    const second = reopened
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations')
      .get() as { count: number }
    expect(second.count).toBe(MIGRATIONS.length)
    reopened.close()
  })

  it('rolls back a transaction when the callback throws', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      inTransaction(db, () => {
        db.prepare(
          'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, ?, ?)',
        ).run('rollback-test', 'Rollback', '/tmp/rollback', 0, new Date().toISOString())
        throw new Error('rollback')
      }),
    ).toThrow('rollback')
    const row = db
      .prepare('SELECT COUNT(*) AS count FROM workspace WHERE id = ?')
      .get('rollback-test') as { count: number }
    expect(row.count).toBe(0)
    db.close()
  })
})
