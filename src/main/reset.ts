import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** 初始化时清理的应用数据；工作区目录不在其中，避免误删用户文件。 */
const RESET_TARGETS = [
  'pizza.db',
  'pizza.db-wal',
  'pizza.db-shm',
  'attachments',
  'skills',
  'artifacts',
  'runtime',
  // Pi/OMP 等运行时的会话文件也属于应用数据，初始化时一并清理。
  'sessions',
]

export function resetMarkerPath(userDataDir: string): string {
  return join(userDataDir, 'reset-requested')
}

export function clearAppData(dataDir: string): void {
  for (const target of RESET_TARGETS) {
    rmSync(join(dataDir, target), { recursive: true, force: true })
  }
}

/** 启动时执行待处理的重置；返回是否真的清理了数据。 */
export function applyPendingReset(userDataDir: string, dataDir: string): boolean {
  const marker = resetMarkerPath(userDataDir)
  if (!existsSync(marker)) return false
  clearAppData(dataDir)
  rmSync(marker, { force: true })
  return true
}
