import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { Store } from '../../src/main/db/store'
import {
  DEFAULT_SETTINGS,
  SettingsService,
} from '../../src/main/services/settings-service'

function makeService() {
  const db = openDatabase(':memory:')
  const store = new Store(db)
  const service = new SettingsService(store, () => ({
    current: '/tmp/pizza-data',
    pending: null,
    error: null,
  }))
  return { db, service }
}

describe('settings service', () => {
  it('returns versioned defaults for a fresh database', () => {
    const { db, service } = makeService()
    const settings = service.get()
    expect(settings.theme).toBe('light')
    expect(settings.language).toBe('zh-CN')
    expect(settings.fontSize).toBe('standard')
    expect(settings.notifications).toEqual(DEFAULT_SETTINGS.notifications)
    expect(settings.dataDir).toBe('/tmp/pizza-data')
    db.close()
  })

  it('persists nested notification changes without dropping other fields', () => {
    const { db, service } = makeService()
    const updated = service.update({
      theme: 'dark',
      notifications: { doNotDisturb: true },
    })
    expect(updated.theme).toBe('dark')
    expect(updated.notifications.enabled).toBe(true)
    expect(updated.notifications.doNotDisturb).toBe(true)
    expect(service.get().notifications.system).toBe(true)
    db.close()
  })

  it('rejects out-of-range values', () => {
    const { db, service } = makeService()
    expect(() => service.update({ maxConcurrency: 99 })).toThrow()
    expect(() => service.update({ fontSize: 'huge' as never })).toThrow()
    db.close()
  })
})
