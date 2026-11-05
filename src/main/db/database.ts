import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './migrations'

export type PizzaDatabase = DatabaseSync

export function openDatabase(dbPath: string): PizzaDatabase {
  if (dbPath !== ':memory:') {
    mkdirSync(dirname(dbPath), { recursive: true })
  }

  const db = new DatabaseSync(dbPath)
  db.exec('PRAGMA journal_mode = WAL;')
  db.exec('PRAGMA foreign_keys = ON;')
  db.exec('PRAGMA busy_timeout = 5000;')
  migrate(db)
  return db
}

export function migrate(db: PizzaDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `)

  const applied = new Set(
    db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all()
      .map((row) => Number((row as { version: number }).version)),
  )

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) continue

    if (migration.disableForeignKeys) db.exec('PRAGMA foreign_keys = OFF;')
    db.exec('BEGIN IMMEDIATE;')
    try {
      db.exec(migration.sql)
      if (migration.disableForeignKeys) {
        const violations = db.prepare('PRAGMA foreign_key_check').all()
        if (violations.length > 0) {
          throw new Error(`迁移 ${migration.version} 产生外键违规`)
        }
      }
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)',
      ).run(migration.version, new Date().toISOString())
      db.exec('COMMIT;')
    } catch (error) {
      db.exec('ROLLBACK;')
      throw error
    } finally {
      if (migration.disableForeignKeys) db.exec('PRAGMA foreign_keys = ON;')
    }
  }
}

export function inTransaction<T>(db: PizzaDatabase, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;')
  try {
    const result = fn()
    db.exec('COMMIT;')
    return result
  } catch (error) {
    db.exec('ROLLBACK;')
    throw error
  }
}
