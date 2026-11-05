import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('runtime model catalog populates the agent model picker', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-models-e2e-'))
  const env = { ...process.env, HOME: join(root, 'home'), PIZZA_DATA_DIR: join(root, 'data') }
  const fixture = join(process.cwd(), 'tests', 'fixtures', 'fake-pi.cjs')
  const app = await _electron.launch({ args: [process.cwd()], env })
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '进入首页' }).click()
  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '语言与外观' }).click()
  await page.locator('.settings-content select.select').last().selectOption('en')
  await page.getByRole('button', { name: /^Runtimes/ }).click()
  await page.getByRole('button', { name: 'Add runtime' }).click()
  await expect(page.locator('.page-title')).toHaveText('Connect runtime')
  await page.getByRole('button', { name: /^Pi CLI/ }).click()
  await page
    .locator('.field')
    .filter({ hasText: /^Command/ })
    .locator('input')
    .fill(process.execPath)
  await page
    .locator('.field')
    .filter({ hasText: 'Initial test command' })
    .locator('textarea')
    .fill(fixture)
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('.test-result')).toContainText('Connected', {
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Register runtime' }).click()

  await page.getByRole('button', { name: /^Agents/ }).click()
  await page.locator('.manage-head-actions').getByRole('button', { name: 'New' }).click()
  await page.locator('.editor-nav').getByRole('button', { name: 'Runtime' }).click()

  const configRow = (label: string) =>
    page.locator('.exec-config-row').filter({
      has: page.locator('.exec-config-label', { hasText: new RegExp(`^${label}$`) }),
    })

  const runtimeRow = configRow('Runtime')
  await expect(runtimeRow.locator('.config-select-trigger')).toContainText('Pi')
  await expect(runtimeRow.getByRole('button', { name: 'Change' })).toHaveCount(0)

  // 并发是单个智能体自己的设置，与系统全局上限分开。
  const concurrencyRow = configRow('Parallel')
  const concurrency = concurrencyRow.locator('input[type="number"]')
  await expect(concurrency).toHaveValue('3')
  await concurrency.fill('2')
  await expect(concurrency).toHaveValue('2')
  await expect(concurrencyRow).toContainText(
    'Limits concurrent tasks for this agent only',
  )

  const modelRow = configRow('Model')
  await modelRow.locator('.config-select-trigger').click()
  const modelOptions = page.locator('.config-select-menu .config-select-option')
  await expect(modelOptions).toContainText([
    'Managed by the runtime',
    'fake-provider/fake-sonnet',
    'fake-provider/fake-opus',
  ])
  await page
    .getByRole('option', { name: 'fake-provider/fake-sonnet' })
    .click()

  // 思考强度随所选模型的目录更新。
  const thinkingRow = configRow('Thinking')
  await thinkingRow.locator('.config-select-trigger').click()
  await expect(
    page.locator('.config-select-menu .config-select-option'),
  ).toContainText(['Minimal', 'Low', 'Medium', 'High', 'Max'])
  await page.keyboard.press('Escape')

  // 模型菜单支持搜索，并允许直接输入目录外的模型 ID。
  await modelRow.locator('.config-select-trigger').click()
  const search = page.getByPlaceholder('Search or type a model ID')
  await search.fill('opus')
  await expect(page.getByRole('option', { name: 'fake-provider/fake-opus' })).toBeVisible()
  await expect(
    page.getByRole('option', { name: 'fake-provider/fake-sonnet' }),
  ).toHaveCount(0)

  await search.fill('vendor/custom-model')
  await page.getByRole('option', { name: 'Use model ID vendor/custom-model' }).click()
  await expect(modelRow.locator('.config-select-trigger')).toContainText(
    'vendor/custom-model',
  )

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
