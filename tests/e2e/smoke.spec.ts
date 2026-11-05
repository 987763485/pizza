import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('single-agent vertical slice stays usable after reload and relaunch', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-e2e-'))
  const home = join(root, 'home')
  const dataDir = join(root, 'data')
  const env = { ...process.env, HOME: home, PIZZA_DATA_DIR: dataDir }
  const projectRoot = process.cwd()
  const fakeRuntime = join(projectRoot, 'tests', 'fixtures', 'fake-claude.cjs')

  const launch = () =>
    _electron.launch({
      args: [projectRoot],
      env,
    })

  let app = await launch()
  let page = await app.firstWindow()
  await page.waitForTimeout(1000)
  expect(
    await page.evaluate(() => ({
      require: typeof (window as unknown as { require?: unknown }).require,
      process: typeof (window as unknown as { process?: unknown }).process,
    })),
  ).toEqual({ require: 'undefined', process: 'undefined' })

  // 首次启动引导会覆盖界面；这份用例关注主流程，先跳过引导。
  await page
    .locator('.onboarding-card')
    .waitFor({ timeout: 4_000 })
    .then(() => page.getByRole('button', { name: '进入首页' }).click())
    .catch(() => undefined)

  await expect(page.locator('.ws-name').first()).toHaveText('默认工作区')

  // 默认工作区不可删除：菜单不显示删除入口。
  await page.locator('.ws-more').first().click()
  await expect(page.locator('.session-menu')).toContainText('置顶工作区')
  await expect(page.locator('.session-menu')).not.toContainText('删除工作区')
  await page.locator('.brand-button').click()

  // 左下账户入口打开账户菜单，而不是直接跳转设置。
  await page.locator('.sidebar-account-btn').click()
  await expect(page.locator('.account-menu')).toBeVisible()
  await expect(page.locator('.account-menu')).toContainText('个人资料')
  await expect(page.locator('.account-menu')).toContainText('退出登录')
  await page
    .locator('.account-menu .account-item')
    .filter({ hasText: '主题' })
    .click()
  await expect(page.locator('.account-sub-title')).toHaveText('主题')
  await page
    .locator('.account-menu .account-item')
    .filter({ hasText: '返回' })
    .click()
  await page.locator('.popover-layer').click()
  await expect(page.locator('.account-menu')).toHaveCount(0)

  // 帮助入口打开帮助菜单，而不是跳转关于页。
  await page.locator('.sidebar-footer .footer-btn').nth(1).click()
  await expect(page.locator('.help-menu')).toBeVisible()
  await expect(page.locator('.help-menu')).toContainText('文档')
  await expect(page.locator('.help-menu')).toContainText('反馈')
  await page.locator('.help-menu .account-item').filter({ hasText: '反馈' }).click()
  await expect(page.locator('.toast')).toContainText('反馈入口随发布渠道提供')
  await expect(page.locator('.help-menu')).toHaveCount(0)

  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '运行时' }).click()
  await page.getByRole('button', { name: '添加运行时' }).click()
  await page.waitForSelector('.acp-layout')
  await page.locator('.acp-layout input.input').nth(0).fill('Fake Runtime')
  await page.getByPlaceholder('例如：npx -y @scope/acp-adapter').fill('node')
  await page.locator('.acp-layout textarea.runtime-args').first().fill(fakeRuntime)
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => document.body.innerText.includes('连接成功'),
    null,
    { timeout: 30_000 },
  )
  await page.getByRole('button', { name: '注册运行时' }).click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: '返回聊天' }).click()
  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: /^智能体(\s|$)/ }).click()
  await page.getByRole('button', { name: '新建', exact: true }).click()
  await page.waitForSelector('.editor-layout')
  await page.locator('.editor-layout input.input').first().fill('Fake Agent')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: '返回聊天' }).click()

  await page.locator('.home-card textarea').fill('请创建一个测试产出物')
  await page.locator('.home-card textarea').press('Enter')
  await page.waitForSelector('.msg-agent', { timeout: 30_000 })
  await expect(page.locator('.msg-user .msg-user-avatar').first()).toBeVisible()
  const userBubble = page.locator('.msg-user .bubble').first()
  const bubbleBox = await userBubble.boundingBox()
  expect(bubbleBox?.width ?? 0).toBeGreaterThan(120)
  expect(bubbleBox?.height ?? 0).toBeLessThan(60)
  await page.waitForFunction(
    () => document.body.innerText.includes('已创建 fake-artifact.md'),
    null,
    { timeout: 30_000 },
  )
  await page.waitForTimeout(600)
  await expect(page.locator('.msg-agent').last()).toContainText('已创建 fake-artifact.md')
  await expect(page.locator('.rightpanel')).toContainText('fake-artifact.md')

  // 外部打开菜单使用应用图标，并标记当前默认项。
  await page.locator('.editor-pill-caret').click()
  await expect(page.locator('.editor-menu')).toBeVisible()
  await expect(page.locator('.editor-menu')).toContainText('访达')
  await expect(page.locator('.editor-menu')).toContainText('终端')
  await expect(page.locator('.editor-menu')).toContainText('（默认）')
  await expect(page.locator('.editor-menu img.editor-app-icon').first()).toBeVisible()
  await page.locator('.editor-menu .editor-item').filter({ hasText: '访达' }).click()
  await expect(page.locator('.editor-menu')).toHaveCount(0)

  // 会话头部搜索只搜索当前对话，并标记命中片段，不打开全局命令面板。
  await page.getByRole('button', { name: '在对话中搜索' }).click()
  const findInput = page.getByPlaceholder('在对话中搜索…')
  await findInput.fill('fake-artifact')
  await expect(page.locator('.chat-find-count')).toHaveText(/[1-9]\d*\/[1-9]\d*/)
  await findInput.press('Enter')
  await expect(page.locator('.palette')).toHaveCount(0)
  await findInput.press('Escape')
  await expect(page.locator('.chat-find')).toHaveCount(0)

  // 搜索必须命中消息正文（而不只是会话标题），并跳转到命中的消息。
  await page.locator('.titlebar-left-actions .icon-btn').nth(1).click()
  await page.getByPlaceholder('搜索，或输入要做的事…').fill('fake-artifact')
  await page.waitForSelector('.palette-item')
  await expect(page.locator('.palette-snippet').first()).toContainText('fake-artifact')
  await page
    .locator('.palette-item')
    .filter({ hasText: '请创建一个测试产出物' })
    .first()
    .click()
  await page.waitForTimeout(500)
  await expect(page).toHaveURL(/message=/)
  await expect(page.locator('.msg-agent').last()).toContainText('已创建 fake-artifact.md')

  // 运行中的第二条消息应进入队列，而不是并发创建第二个运行。
  await page.locator('.composer textarea').fill('slow task')
  await page.locator('.composer textarea').press('Enter')
  await page.waitForSelector('.send-btn.stop', { timeout: 10_000 })
  await page.locator('.composer textarea').fill('second task')
  await page.locator('.composer textarea').press('Enter')
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.msg-agent .msg-state')).some((element) =>
        element.textContent?.includes('排队中'),
      ),
    null,
    { timeout: 10_000 },
  )
  await page.waitForFunction(
    () => !document.querySelector('.send-btn.stop'),
    null,
    { timeout: 30_000 },
  )

  // 停止后保留原消息；重试创建新运行且不删除已停止的内容。
  await page.locator('.composer textarea').fill('slow task')
  await page.locator('.composer textarea').press('Enter')
  await page.waitForSelector('.send-btn.stop', { timeout: 10_000 })
  await page.locator('.send-btn.stop').click()
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('.msg-agent .msg-state')).some((element) =>
        element.textContent?.includes('已停止'),
      ),
    null,
    { timeout: 10_000 },
  )
  const beforeRetry = await page.locator('.msg-agent').count()
  await page.locator('.msg-agent').last().hover()
  await page.locator('.msg-agent').last().getByRole('button', { name: '重试' }).click()
  await page.waitForFunction(
    (count) => document.querySelectorAll('.msg-agent').length > count,
    beforeRetry,
    { timeout: 10_000 },
  )
  await page.waitForFunction(
    () => !document.querySelector('.send-btn.stop'),
    null,
    { timeout: 20_000 },
  )
  await expect(
    page.locator('.msg-agent .msg-state', { hasText: '已停止' }).first(),
  ).toBeVisible()

  await page.reload()
  await page.waitForTimeout(800)
  await expect(page.locator('.msg-agent').last()).toContainText('已创建 fake-artifact.md')
  await expect(page.locator('.rightpanel')).toContainText('fake-artifact.md')

  await app.close()
  app = await launch()
  page = await app.firstWindow()
  await page.waitForTimeout(1000)
  await page.locator('.ws-session').first().click()
  await page.waitForTimeout(700)
  await expect(page.locator('.msg-agent').last()).toContainText('已创建 fake-artifact.md')
  await expect(page.locator('.rightpanel')).toContainText('fake-artifact.md')
  await app.close()

  rmSync(root, { recursive: true, force: true })
})
