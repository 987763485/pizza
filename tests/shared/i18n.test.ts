import { describe, expect, it } from 'vitest'
import i18n from '../../src/renderer/src/i18n'
import { UI_EN } from '../../src/renderer/src/locales/ui'
import { localizeError } from '../../src/renderer/src/locales/errors'

function flatten(value: unknown, prefix = ''): string[] {
  if (!value || typeof value !== 'object') return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  )
}

describe('i18n resources', () => {
  it('keeps Chinese and English key sets in sync', () => {
    const zh = flatten(i18n.getResourceBundle('zh-CN', 'translation')).sort()
    const en = flatten(i18n.getResourceBundle('en', 'translation')).sort()
    expect(en).toEqual(zh)
  })

  it('switches language without a restart', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('settings.nav.skills')).toBe('Skills')
    expect(i18n.t('notifications.title')).toBe('Notifications')
    await i18n.changeLanguage('zh-CN')
    expect(i18n.t('notifications.title')).toBe('通知')
  })

  it('keeps every interface string fully translated in English', () => {
    const untranslated = Object.entries(UI_EN).filter(([, value]) =>
      /[\u4e00-\u9fff]/.test(value),
    )
    expect(untranslated).toEqual([])
    const placeholders = Object.entries(UI_EN).filter(
      ([key, value]) =>
        (key.match(/\{\{\s*\w+\s*\}\}/g) ?? []).join(',') !==
        (value.match(/\{\{\s*\w+\s*\}\}/g) ?? []).join(','),
    )
    expect(placeholders).toEqual([])
  })

  it('localizes known main-process errors without dropping diagnostics', async () => {
    await i18n.changeLanguage('en')
    expect(localizeError('Skill 总大小超过限制')).toBe(
      'The skill exceeds the total size limit.',
    )
    expect(localizeError('无法启动 claude：not found')).toBe(
      'Unable to launch claude: not found',
    )
    expect(localizeError('SOMETHING_ELSE')).toBe('SOMETHING_ELSE')
    await i18n.changeLanguage('zh-CN')
    expect(localizeError('Skill 总大小超过限制')).toBe('Skill 总大小超过限制')
  })

  it('falls back to a readable label instead of a raw key', async () => {
    await i18n.changeLanguage('en')
    expect(i18n.t('does.not.exist')).toBe('exist')
    await i18n.changeLanguage('zh-CN')
  })
})
