import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 真实模型验收默认跳过，避免日常检查产生费用与外部依赖。
test.skip(process.env.PIZZA_REAL_E2E !== '1', '设置 PIZZA_REAL_E2E=1 后运行')
test.setTimeout(300_000)

test('packaged app completes a real Claude Code session without a terminal', async () => {
  const appBinary = join(
    process.cwd(),
    'release',
    'mac-arm64',
    'Pizza.app',
    'Contents',
    'MacOS',
    'Pizza',
  )
  test.skip(!existsSync(appBinary), '先运行 npm run package:mac 生成产物')

  const root = mkdtempSync(join(tmpdir(), 'pizza-packaged-real-'))
  const dataDir = join(root, 'data')
  const app = await _electron.launch({
    executablePath: appBinary,
    env: { ...process.env, HOME: root, PIZZA_DATA_DIR: dataDir },
    args: [],
  })
  const page = await app.firstWindow()

  await page.locator('.onboarding-card').waitFor({ timeout: 8_000 })
  // 从引导页直接选择检测到的 Claude Code，进入接入表单。
  await page
    .locator('.onboarding-runtime')
    .filter({ hasText: 'Claude Code' })
    .first()
    .click()
  await page.waitForSelector('.acp-layout', { timeout: 30_000 })
  await page.locator('.acp-layout input.input').nth(0).fill('Claude Code Real')
  const command = page.getByPlaceholder('例如：npx -y @scope/acp-adapter')
  if (await command.count()) await command.fill('claude')
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => document.body.innerText.includes('连接成功'),
    null,
    { timeout: 60_000 },
  )
  await page.getByRole('button', { name: '注册运行时' }).click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: '返回聊天' }).click()
  // 引导第二步：创建通用助手并进入首个会话。
  await page.getByRole('button', { name: '创建通用助手并开始' }).click()
  await page.waitForSelector('.composer textarea, .mention-editor', { timeout: 30_000 })

  const composer = page.locator('.composer textarea, .composer .mention-editor').first()
  await composer.fill('只回复一个单词：pong')
  await composer.press('Enter')
  await expect(page.locator('.msg-agent').last()).toContainText('pong', {
    timeout: 180_000,
  })
  // 等运行完成落库后再退出，避免把 completed 覆盖成 cancelled。
  await page.waitForFunction(
    () => !document.querySelector('.composer .send-btn.stop'),
    null,
    { timeout: 30_000 },
  )

  // 打包应用在 macOS 关闭窗口后不会自动退出；用真实退出路径验证 before-quit。
  await app.evaluate(({ app }) => app.quit()).catch(() => undefined)
  await app.close().catch(() => undefined)
  rmSync(root, { recursive: true, force: true })
})
