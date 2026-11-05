import { app } from 'electron'
import { homedir } from 'node:os'
import { join } from 'node:path'

// 数据目录在启动时由 DataDirService 解析；这里保存结果供各服务使用。
let dataDirOverride: string | null = null

export function setDataDir(dir: string): void {
  dataDirOverride = dir
}

export function getDefaultDataDir(): string {
  return process.env.PIZZA_DATA_DIR || join(homedir(), '.pizza')
}

export function getDataDir(): string {
  return dataDirOverride ?? getDefaultDataDir()
}

export function getDbPath(): string {
  return join(getDataDir(), 'pizza.db')
}

export function getAttachmentsDir(): string {
  return join(getDataDir(), 'attachments')
}

export function getRuntimeDir(): string {
  return join(getDataDir(), 'runtime')
}

export function getSkillsDir(): string {
  return join(getDataDir(), 'skills')
}

export function getArtifactsDir(): string {
  return join(getDataDir(), 'artifacts')
}

export function expandHome(input: string): string {
  if (input === '~') return homedir()
  if (input.startsWith('~/')) return join(homedir(), input.slice(2))
  return input
}

export function appInfo(): {
  version: string
  build: string
  platform: string
  dataDir: string
} {
  return {
    version: app.getVersion(),
    build:
      typeof __PIZZA_BUILD_NUMBER__ === 'string'
        ? __PIZZA_BUILD_NUMBER__
        : process.env.PIZZA_BUILD_NUMBER || 'dev',
    platform: process.platform,
    dataDir: getDataDir(),
  }
}
