import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('shows the data directory path and recovery hint when initialization fails', async () => {
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-boot-error-'))
  const blocked = join(root, 'blocked-data')
  writeFileSync(blocked, 'not a directory')

  const app = await _electron.launch({
    args: [process.cwd()],
    env: { ...process.env, HOME: root, PIZZA_DATA_DIR: blocked },
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)

  await expect(page.locator('.boot-error')).toBeVisible()
  await expect(page.locator('.boot-error')).toContainText('无法打开本地数据目录')
  await expect(page.locator('.boot-error-path')).toContainText(blocked)
  await expect(page.locator('.boot-error')).toContainText('PIZZA_DATA_DIR')

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
