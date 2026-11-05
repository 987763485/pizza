import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('runtime row menu stays inside a narrow window', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-menu-e2e-'))
  const env = { ...process.env, HOME: join(root, 'home'), PIZZA_DATA_DIR: join(root, 'data') }
  const app = await _electron.launch({ args: [process.cwd()], env })
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)
  await page.getByRole('button', { name: '进入首页' }).click()
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(620, 720)
  })
  await page.waitForTimeout(300)
  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '语言与外观' }).click()
  await page.locator('.settings-content select.select').last().selectOption('en')
  await page.getByRole('button', { name: /^Runtimes/ }).click()
  await page.getByRole('button', { name: 'Add runtime' }).click()
  await page.getByRole('button', { name: /Custom CLI/ }).click()
  await page
    .locator('.field')
    .filter({ hasText: /^Command/ })
    .locator('input')
    .fill(process.execPath)
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('.test-result')).toContainText('Connected', {
    timeout: 30_000,
  })
  await page.getByRole('button', { name: 'Register runtime' }).click()

  await page.getByRole('button', { name: 'Runtime menu' }).click()
  const menu = page.locator('.session-menu')
  await expect(menu).toBeVisible()
  const box = await menu.boundingBox()
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }))
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
