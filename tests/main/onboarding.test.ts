import { describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { Store } from '../../src/main/db/store'
import { OnboardingService } from '../../src/main/services/onboarding-service'
import { SettingsService } from '../../src/main/services/settings-service'

function setup() {
  const db = openDatabase(':memory:')
  const store = new Store(db)
  const settings = new SettingsService(store)
  const runner = (
    command: string,
    args: string[],
  ): { status: number | null; stdout: string; stderr: string } => {
    if (command === 'which') {
      return args[0] === 'claude'
        ? { status: 0, stdout: '/usr/local/bin/claude\n', stderr: '' }
        : { status: 1, stdout: '', stderr: '' }
    }
    if (command === 'claude' && args[0] === '--version') {
      return { status: 0, stdout: '2.1.318 (Claude Code)\n', stderr: '' }
    }
    return { status: 1, stdout: '', stderr: 'not logged in' }
  }
  const onboarding = new OnboardingService(settings, runner)
  return { db, settings, onboarding }
}

describe('onboarding detection', () => {
  it('classifies installed, missing and login-required runtimes', () => {
    const { db, onboarding } = setup()
    const detections = onboarding.detect()
    expect(detections).toHaveLength(10)
    expect(detections.find((item) => item.adapter === 'claude-code')).toMatchObject({
      installed: true,
      needsLogin: false,
      version: '2.1.318 (Claude Code)',
    })
    expect(detections.find((item) => item.adapter === 'codex')).toMatchObject({
      installed: false,
      needsLogin: false,
    })

    const loginRunner = () => ({
      status: 0,
      stdout: '/usr/local/bin/pi\n',
      stderr: 'Please log in first',
    })
    const login = new OnboardingService(
      // 复用同一数据库连接即可。
      new SettingsService(new Store(db)),
      loginRunner,
    ).detect()
    expect(login.every((item) => item.needsLogin)).toBe(true)
    db.close()
  })

  it('persists completion so the guide does not reappear', () => {
    const { db, settings, onboarding } = setup()
    expect(onboarding.status().completed).toBe(false)
    onboarding.complete()
    expect(settings.get().onboardingCompleted).toBe(true)
    expect(onboarding.status().completed).toBe(true)
    db.close()
  })
})
