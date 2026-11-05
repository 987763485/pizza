import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('team template dispatches, converges and exposes the artifact', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-team-e2e-'))
  const home = join(root, 'home')
  const dataDir = join(root, 'data')
  const env = { ...process.env, HOME: home, PIZZA_DATA_DIR: dataDir }
  const projectRoot = process.cwd()
  const fakeRuntime = join(projectRoot, 'tests', 'fixtures', 'fake-claude.cjs')

  const app = await _electron.launch({ args: [projectRoot], env })
  const page = await app.firstWindow()
  await page.waitForTimeout(1000)
  await page
    .locator('.onboarding-card')
    .waitFor({ timeout: 4_000 })
    .then(() => page.getByRole('button', { name: '进入首页' }).click())
    .catch(() => undefined)

  // 先注册确定性运行时，模板会在这台运行时上补齐五名角色智能体。
  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '运行时' }).click()
  await page.getByRole('button', { name: '添加运行时' }).click()
  await page.waitForSelector('.acp-layout')
  await page.locator('.acp-layout input.input').nth(0).fill('Team Fake Runtime')
  await page.getByPlaceholder('例如：npx -y @scope/acp-adapter').fill('node')
  await page.locator('.acp-layout textarea.runtime-args').first().fill(fakeRuntime)
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => document.body.innerText.includes('连接成功'),
    null,
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: '注册运行时' }).click()
  await page.waitForTimeout(400)

  await page.getByRole('button', { name: '智能体团队' }).click()
  await page.getByRole('button', { name: '从模板创建' }).click()
  await page.waitForSelector('.modal select')
  await page.getByRole('button', { name: '创建团队' }).click()
  await page.waitForSelector('.editor-layout', { timeout: 30_000 })
  await expect(page.locator('.editor-layout input.input').first()).toHaveValue(
    '头脑风暴小组',
  )
  await expect(
    page.locator('.field').filter({ hasText: '描述' }).locator('textarea'),
  ).toHaveCount(1)
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(500)
  await expect(page.locator('.team-grid').first()).toContainText('头脑风暴小组')
  await page.getByPlaceholder('搜索团队…').fill('头脑风暴')
  await expect(page.locator('.team-grid').first()).toContainText('头脑风暴小组')
  await page.getByPlaceholder('搜索团队…').fill('议题')
  await expect(page.locator('.team-grid').first()).toContainText('头脑风暴小组')
  await page.getByPlaceholder('搜索团队…').fill('不存在的团队')
  await expect(page.locator('.team-card')).toHaveCount(1)
  await page.getByPlaceholder('搜索团队…').fill('')

  await page.getByRole('button', { name: '返回聊天' }).click()
  await page.locator('.participant-btn').click()
  await page.getByRole('button', { name: /头脑风暴小组/ }).click()
  await expect(page.locator('.participant-name')).toContainText('头脑风暴小组')
  await page.locator('.home-card textarea').fill('请开始团队测试')
  await page.locator('.home-card textarea').press('Enter')

  await page.waitForSelector('.turn-divider', { timeout: 30_000 })
  await page.waitForFunction(
    () => document.body.innerText.includes('团队测试完成'),
    null,
    { timeout: 60_000 },
  )
  await expect(page.locator('.turn-divider').first()).toContainText('第 1 轮')
  await expect(page.locator('.msg-agent')).toHaveCount(3, { timeout: 30_000 })

  // 轨迹页签完全由 team_turn_event 驱动。
  await page.locator('.rp-tab', { hasText: '轨迹' }).click()
  await expect(page.locator('.rightpanel')).toContainText('回合完成，已生成收敛产出物')
  await expect(page.locator('.rightpanel')).toContainText('分派给')
  await page.locator('.rp-tab', { hasText: '产出物' }).click()

  // 收敛产出物必须出现在右侧面板，并且可以打开预览。
  await page.waitForFunction(
    () => document.body.innerText.includes('team-turn-1.md'),
    null,
    { timeout: 30_000 },
  )
  await page.locator('.file-filter input').fill('team-turn-1')
  await page.locator('.file-tree').getByText('team-turn-1.md').first().click()
  await page.waitForTimeout(400)
  await expect(page.locator('.modal, .preview-modal')).toContainText('团队测试完成')
  await page.locator('.modal .icon-btn').first().click()

  // 指挥者提及用户时进入等待；用户回复应继续当前回合，而不是新建回合。
  await page.locator('.mention-editor').fill('请团队等待用户')
  await page.locator('.mention-editor').press('Enter')
  await page.waitForSelector('.waiting-card', { timeout: 30_000 })
  // 指挥者精确提及用户后，应用内通知应出现未读标记并可定位回会话。
  await expect(page.locator('.notification-count')).toBeVisible()
  await page.locator('.notification-btn').click()
  await expect(page.locator('.notification-item').first()).toBeVisible()
  await page.locator('.notification-item').first().click()
  await expect(page).toHaveURL(/\/session\//)
  await page.locator('.mention-editor').fill('继续')
  await page.locator('.mention-editor').press('Enter')
  await page.waitForFunction(
    () => document.body.innerText.includes('已确认继续'),
    null,
    { timeout: 30_000 },
  )
  await expect(page.locator('.waiting-card')).toHaveCount(0)

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
