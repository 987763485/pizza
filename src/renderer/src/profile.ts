import i18n from './i18n'
import { useAppStore } from './store'

// 本地单用户资料保存在 app_setting 中，随数据库一起迁移，不进入工作区。
export interface LocalProfile {
  name: string
  about: string
  avatar: string | null
}

const DEFAULT_PROFILE: LocalProfile = {
  name: i18n.t('ui.Pizza 用户'),
  about: '',
  avatar: null,
}

export function readProfile(): LocalProfile {
  const settings = useAppStore.getState().settings
  return {
    name: settings?.profileName?.trim() || DEFAULT_PROFILE.name,
    about: settings?.profileAbout ?? DEFAULT_PROFILE.about,
    avatar: settings?.profileAvatar ?? DEFAULT_PROFILE.avatar,
  }
}

let pendingWrite: Promise<void> = Promise.resolve()

// 连续输入会触发多次保存；串行写入避免较慢的旧响应覆盖新值。
function persistProfile(patch: Partial<LocalProfile>): void {
  pendingWrite = pendingWrite
    .then(() =>
      useAppStore.getState().updateSettings({
        profileName: patch.name,
        profileAbout: patch.about,
        profileAvatar: patch.avatar,
      }),
    )
    .catch(() => undefined)
}

export function saveProfile(patch: Partial<LocalProfile>): LocalProfile {
  const current = readProfile()
  const next = { ...current, ...patch }
  persistProfile(patch)
  return next
}

export function useProfile(): LocalProfile {
  const name = useAppStore((state) => state.settings?.profileName)
  const about = useAppStore((state) => state.settings?.profileAbout)
  const avatar = useAppStore((state) => state.settings?.profileAvatar)
  return {
    name: name?.trim() || DEFAULT_PROFILE.name,
    about: about ?? '',
    avatar: avatar ?? null,
  }
}
