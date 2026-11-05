import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const appBinary = join(
  process.cwd(),
  'release',
  'mac-arm64',
  'Pizza.app',
  'Contents',
  'MacOS',
  'Pizza',
)

test('packaged macOS app starts, initializes data and reports its version', async () => {
  test.skip(!existsSync(appBinary), '先运行 npm run package:mac 生成产物')
  test.setTimeout(120_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-packaged-'))
  const dataDir = join(root, 'data')
  const version = JSON.parse(
    readFileSync(join(process.cwd(), 'package.json'), 'utf8'),
  ).version as string

  const app = await _electron.launch({
    executablePath: appBinary,
    env: { ...process.env, HOME: root, PIZZA_DATA_DIR: dataDir },
    args: [],
  })
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)

  // 数据目录由主进程初始化，引导页可用。
  expect(existsSync(join(dataDir, 'pizza.db'))).toBe(true)
  await expect(page.locator('.onboarding-card')).toBeVisible()
  await page.getByRole('button', { name: '进入首页' }).click()

  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: /^关于 Pizza/ }).click()
  await expect(page.locator('.settings-content')).toContainText(version)

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
