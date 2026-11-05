import { dialog } from 'electron'
import { accessSync, constants, mkdirSync, realpathSync, statSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { Workspace } from '@shared/types'
import type { Store } from '../db/store'
import { expandHome } from '../paths'
import type { SettingsService } from './settings-service'

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

export class WorkspaceService {
  constructor(
    private readonly store: Store,
    private readonly settings: SettingsService,
  ) {}

  ensureDefault(): Workspace {
    const path = expandHome(this.settings.get().defaultWorkspacePath)
    mkdirSync(path, { recursive: true })
    const workspace = this.store.ensureDefaultWorkspace(canonical(path))
    const current = this.settings.get().currentWorkspaceId
    if (!current || !this.store.getWorkspace(current)) {
      this.settings.setCurrentWorkspace(workspace.id)
    }
    return workspace
  }

  list(): Workspace[] {
    return this.store.listWorkspaces()
  }

  current(): Workspace {
    const id = this.settings.get().currentWorkspaceId
    const workspace = id ? this.store.getWorkspace(id) : null
    return workspace ?? this.ensureDefault()
  }

  select(id: string): Workspace {
    const workspace = this.store.getWorkspace(id)
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
    if (!statSync(workspace.rootPath, { throwIfNoEntry: false })?.isDirectory()) {
      throw new Error('WORKSPACE_PATH_UNAVAILABLE')
    }
    this.settings.setCurrentWorkspace(id)
    return workspace
  }

  remove(id: string): Workspace {
    const workspace = this.store.getWorkspace(id)
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')
    if (workspace.isDefault) throw new Error('WORKSPACE_DEFAULT')
    if (this.store.listWorkspaces().length <= 1) throw new Error('WORKSPACE_LAST')
    const wasCurrent = this.settings.get().currentWorkspaceId === id
    const next = this.store.deleteWorkspace(id)
    if (!next) throw new Error('WORKSPACE_LAST')
    if (wasCurrent) this.settings.setCurrentWorkspace(next.id)
    return wasCurrent ? next : (this.store.getWorkspace(this.settings.get().currentWorkspaceId ?? '') ?? next)
  }

  async pick(): Promise<Workspace | null> {
    const result = await dialog.showOpenDialog({
      title: '选择工作区文件夹',
      properties: ['openDirectory', 'createDirectory'],
      buttonLabel: '使用此文件夹',
    })
    if (result.canceled || !result.filePaths[0]) return null

    const rootPath = canonical(result.filePaths[0])
    const stat = statSync(rootPath, { throwIfNoEntry: false })
    if (!stat?.isDirectory()) throw new Error('WORKSPACE_PATH_UNAVAILABLE')
    // 目录存在不代表当前用户可以读取；提前拦截无权限目录，
    // 让界面显示明确错误，而不是在后续运行中才失败。
    try {
      accessSync(rootPath, constants.R_OK | constants.X_OK)
    } catch {
      throw new Error('WORKSPACE_PATH_PERMISSION_DENIED')
    }

    const existing = this.store.findWorkspaceByPath(rootPath)
    const workspace =
      existing ??
      this.store.createWorkspace(rootPath)
    this.settings.setCurrentWorkspace(workspace.id)
    return workspace
  }

  ensureWorkspaceForPath(rootPath: string): Workspace {
    const normalized = canonical(rootPath)
    const existing = this.store.findWorkspaceByPath(normalized)
    if (existing) return existing
    mkdirSync(normalized, { recursive: true })
    return this.store.createWorkspace(normalized)
  }

  displayName(rootPath: string): string {
    return basename(rootPath) || 'Pizza'
  }
}
