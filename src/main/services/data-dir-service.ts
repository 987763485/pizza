import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export interface DataDirConfig {
  current: string | null
  pending: string | null
  error: string | null
}

export interface DataDirStatus {
  current: string
  pending: string | null
  error: string | null
  restartRequired: boolean
}

const CONFIG_NAME = 'data-dir.json'

function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return join(homedir(), input.slice(2))
  return input
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * 数据目录切换。
 *
 * 配置文件放在 Electron 的 userData 目录，而不是数据目录内部，否则切换后
 * 就找不到旧配置。迁移流程为「确认 → 下次启动复制 → 校验 → 切换 → 保留旧目录」；
 * 任一步失败都继续使用旧目录，并把错误展示在设置页。
 */
export class DataDirService {
  private readonly configPath: string
  private config: DataDirConfig

  constructor(
    private readonly userDataDir: string,
    private readonly envDir: string | undefined,
    private readonly fallbackDir: string,
  ) {
    this.configPath = join(userDataDir, CONFIG_NAME)
    this.config = this.readConfig()
  }

  currentDir(): string {
    if (this.envDir) return expandHome(this.envDir)
    return this.config.current ?? this.fallbackDir
  }

  status(): DataDirStatus {
    return {
      current: this.currentDir(),
      pending: this.config.pending,
      error: this.config.error,
      restartRequired: Boolean(this.config.pending),
    }
  }

  /** 申请切换数据目录；实际复制在下次启动、打开数据库之前执行。 */
  setPending(input: string): DataDirStatus {
    const target = resolve(expandHome(input.trim()))
    const current = resolve(this.currentDir())
    if (this.envDir) {
      throw new Error('PIZZA_DATA_DIR 正在覆盖数据目录，无法在此切换')
    }
    if (target === current) {
      throw new Error('新目录与当前目录相同')
    }
    if (isInside(current, target) || isInside(target, current)) {
      throw new Error('新目录不能与当前目录互相包含')
    }

    this.assertWritable(target)
    this.writeConfig({ current: this.config.current, pending: target, error: null })
    return this.status()
  }

  /**
   * 在打开数据库前执行待迁移目录。成功返回新目录，失败保留旧目录并记录错误。
   */
  applyPending(): DataDirStatus {
    if (this.envDir || !this.config.pending) return this.status()
    const source = resolve(this.currentDir())
    const target = resolve(this.config.pending)

    try {
      if (!existsSync(source)) throw new Error(`原数据目录不存在：${source}`)
      mkdirSync(target, { recursive: true })
      this.assertWritable(target)
      cpSync(source, target, { recursive: true, force: true })

      const dbPath = join(target, 'pizza.db')
      if (existsSync(dbPath)) this.verifyDatabase(dbPath)

      this.writeConfig({ current: target, pending: null, error: null })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.writeConfig({
        current: this.config.current,
        pending: null,
        error: `切换数据目录失败，继续使用原目录。${message}`,
      })
    }
    return this.status()
  }

  private readConfig(): DataDirConfig {
    try {
      const raw = JSON.parse(readFileSync(this.configPath, 'utf8')) as Partial<DataDirConfig>
      return {
        current: typeof raw.current === 'string' ? raw.current : null,
        pending: typeof raw.pending === 'string' ? raw.pending : null,
        error: typeof raw.error === 'string' ? raw.error : null,
      }
    } catch {
      return { current: null, pending: null, error: null }
    }
  }

  private writeConfig(config: DataDirConfig): void {
    mkdirSync(this.userDataDir, { recursive: true })
    this.config = config
    writeFileSync(this.configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  }

  private assertWritable(dir: string): void {
    mkdirSync(dir, { recursive: true })
    const probe = join(dir, `.pizza-write-${process.pid}-${Date.now()}`)
    try {
      const fd = openSync(probe, 'w')
      closeSync(fd)
    } finally {
      rmSync(probe, { force: true })
    }
    if (!statSync(dir).isDirectory()) throw new Error(`不是目录：${dir}`)
  }

  private verifyDatabase(dbPath: string): void {
    const db = new DatabaseSync(dbPath)
    try {
      const row = db.prepare('PRAGMA integrity_check').get() as
        | { integrity_check?: string }
        | undefined
      if (row?.integrity_check && row.integrity_check !== 'ok') {
        throw new Error(`数据库完整性检查失败：${row.integrity_check}`)
      }
    } finally {
      db.close()
    }
  }
}
