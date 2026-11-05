import type { AppSettings } from '@shared/types'
import { settingsUpdateSchema, type SettingsPatch } from '@shared/ipc'
import type { Store } from '../db/store'

/**
 * 设置默认值。
 *
 * 设置整体以 JSON 存在 app_setting 的一个键里，新增字段只补缺失项，
 * 老版本数据库升级时保留用户已经保存的值。
 */
export const DEFAULT_SETTINGS: AppSettings = {
  currentWorkspaceId: null,
  defaultWorkspacePath: '~/Pizza',
  defaultRuntimeId: null,
  defaultEditor: 'vscode',
  theme: 'light',
  language: 'zh-CN',
  maxConcurrency: 3,
  logLevel: 'info',
  autoUpdate: false,
  anonymousStats: false,
  fontSize: 'standard',
  density: 'comfortable',
  reducedMotion: 'system',
  profileName: '我',
  profileAbout: '',
  profileAvatar: null,
  notifications: {
    enabled: true,
    system: true,
    sound: false,
    doNotDisturb: false,
  },
  onboardingCompleted: false,
  dataDir: '',
  pendingDataDir: null,
  dataDirError: null,
}

export interface DataDirInfo {
  current: string
  pending: string | null
  error: string | null
}

export class SettingsService {
  constructor(
    private readonly store: Store,
    private readonly dataDirInfo: () => DataDirInfo = () => ({
      current: '',
      pending: null,
      error: null,
    }),
  ) {}

  get(): AppSettings {
    const saved = this.store.getSetting<Partial<AppSettings>>('settings', {})
    const info = this.dataDirInfo()
    return {
      ...DEFAULT_SETTINGS,
      ...saved,
      // 数据目录是运行时事实，不能从历史设置里回填过期路径。
      dataDir: info.current,
      pendingDataDir: info.pending,
      dataDirError: info.error,
      notifications: {
        ...DEFAULT_SETTINGS.notifications,
        ...(saved.notifications ?? {}),
      },
    }
  }

  update(patch: SettingsPatch): AppSettings {
    const parsed = settingsUpdateSchema.parse(patch)
    const current = this.get()
    const next = {
      ...current,
      ...parsed,
      // 通知偏好是嵌套对象，patch 只覆盖给出的布尔字段。
      notifications: {
        ...current.notifications,
        ...(parsed.notifications ?? {}),
      },
    }
    // 数据目录字段由 DataDirService 维护，不接受渲染层直接写入。
    this.store.setSetting('settings', {
      ...next,
      dataDir: undefined,
      pendingDataDir: undefined,
      dataDirError: undefined,
    })
    return next
  }

  setCurrentWorkspace(id: string | null): AppSettings {
    return this.update({ currentWorkspaceId: id })
  }

  setDefaultRuntime(id: string | null): AppSettings {
    return this.update({ defaultRuntimeId: id })
  }
}
