import { useEffect, useState } from 'react'

// 工作区置顶是纯展示偏好，不进入业务数据库；保存在本机 localStorage，
// 与原型中的「置顶工作区」行为保持一致。
const STORAGE_KEY = 'pizza:pinned-workspaces'
const EVENT_NAME = 'pizza:pinned-workspaces-changed'

function readPinned(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function togglePinnedWorkspace(id: string): void {
  const current = readPinned()
  const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new Event(EVENT_NAME))
}

export function usePinnedWorkspaces(): string[] {
  const [pinned, setPinned] = useState<string[]>(readPinned)

  useEffect(() => {
    const refresh = () => setPinned(readPinned())
    window.addEventListener(EVENT_NAME, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT_NAME, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  return pinned
}
