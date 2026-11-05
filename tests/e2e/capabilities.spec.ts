import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('capability settings, appearance and first-run onboarding persist', async () => {
  test.setTimeout(180_000)
  const root = mkdtempSync(join(tmpdir(), 'pizza-cap-e2e-'))
  const home = join(root, 'home')
  const dataDir = join(root, 'data')
  const env = { ...process.env, HOME: home, PIZZA_DATA_DIR: dataDir }
  const projectRoot = process.cwd()

  const app = await _electron.launch({ args: [projectRoot], env })
  const page = await app.firstWindow()
  await page.waitForTimeout(1200)

  // 首次启动：没有运行时时仍可进入首页。
  await expect(page.locator('.onboarding-card')).toBeVisible()
  await expect(page.locator('.onboarding-runtime')).toHaveCount(0)
  await page.getByRole('button', { name: '开始检测' }).click()
  await expect(page.locator('.onboarding-runtime')).toHaveCount(10, { timeout: 30_000 })

  // 检测结果可直接勾选并一键导入，不再跳转单独配置页。
  const installedRuntime = page.locator('.onboarding-runtime.installed').first()
  if (await installedRuntime.count()) {
    const checkbox = installedRuntime.locator('input[type=checkbox]')
    await expect(checkbox).toBeEnabled()
    if (!(await checkbox.isChecked())) await checkbox.check()
    await expect(page.getByRole('button', { name: /导入所选运行时/ })).toBeVisible()
    await checkbox.uncheck()
    await expect(checkbox).not.toBeChecked()
    await checkbox.check()
  }

  await page.getByRole('button', { name: '进入首页' }).click()
  await expect(page.locator('.onboarding-card')).toHaveCount(0)

  // 个人资料姓名：输入期间不回退，失焦后保存并在重载后保留。
  await page.locator('.sidebar-footer .footer-btn').first().click()
  const nameInput = page
    .locator('.settings-row')
    .filter({ hasText: '姓名' })
    .locator('input')
  await nameInput.fill('端到端用户')
  await nameInput.blur()
  await expect(nameInput).toHaveValue('端到端用户')
  await page.getByRole('button', { name: '返回聊天' }).click()
  await expect(page.locator('.sidebar-account .account-name')).toHaveText('端到端用户')
  await page.reload()
  await page.waitForTimeout(800)
  await expect(page.locator('.sidebar-account .account-name')).toHaveText('端到端用户')

  // Skill：内置协作 Skill 默认存在；通过导入创建一个可启停/删除的 Skill。
  const skillSource = join(root, 'e2e-skill-source')
  mkdirSync(skillSource, { recursive: true })
  writeFileSync(
    join(skillSource, 'SKILL.md'),
    '---\nname: e2e-skill\ndescription: 端到端测试 Skill\nversion: 1.0.0\n---\n\nbody\n',
  )
  await page.evaluate(async (sourcePath) => {
    const api = (
      window as unknown as {
        pizza: {
          workspace: {
            list: () => Promise<Array<{ id: string; isDefault: boolean }>>
          }
          skill: {
            import: (input: {
              workspaceId: string
              sourceType: 'local'
              sourcePath: string
            }) => Promise<unknown>
          }
        }
      }
    ).pizza
    const workspaces = await api.workspace.list()
    const workspace = workspaces.find((item) => item.isDefault) ?? workspaces[0]
    if (!workspace) throw new Error('missing workspace')
    await api.skill.import({
      workspaceId: workspace.id,
      sourceType: 'local',
      sourcePath,
    })
  }, skillSource)

  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '初始化系统' }).click()
  await expect(page.locator('.settings-title')).toHaveText('初始化系统')
  await expect(page.getByRole('button', { name: '清理所有数据并重置' })).toBeVisible()
  await page.getByRole('button', { name: /^Skills/ }).click()
  await expect(page.locator('.settings-title')).toHaveText('Skills')
  await expect(page.locator('.settings-card')).toContainText('pizza-collaboration')

  await expect(page.locator('.settings-card')).toContainText('e2e-skill')

  const skillRow = page.locator('.settings-row').filter({ hasText: 'e2e-skill' })
  await skillRow.getByRole('button', { name: '停用 Skill' }).click()
  await expect(skillRow.getByRole('button', { name: '启用 Skill' })).toBeVisible()
  await skillRow.getByRole('button', { name: '删除' }).click()
  await page.getByText('删除 Skill').waitFor({ timeout: 5_000 })
  await expect(page.locator('.modal-foot')).toHaveCSS(
    'background-color',
    'rgba(0, 0, 0, 0)',
  )
  await page.locator('.modal-foot .btn-danger').click()
  await expect(page.locator('.settings-card')).not.toContainText('e2e-skill')

  // MCP：配置表单可保存 stdio 服务。
  await page.getByRole('button', { name: /^MCP/ }).click()
  await page.getByRole('button', { name: '添加服务器' }).click()
  await page.getByPlaceholder('例如：本机文件检索').fill('E2E MCP')
  await page
    .getByPlaceholder('例如：npx -y @modelcontextprotocol/server-filesystem')
    .fill('node')
  await page.getByRole('button', { name: '添加服务器', exact: true }).last().click()
  await expect(page.locator('.settings-card')).toContainText('E2E MCP')

  // 外观：主题、语言、密度立即生效。
  await page.getByRole('button', { name: '语言与外观' }).click()
  await page.getByRole('button', { name: '深色' }).click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark')
  await page
    .locator('.settings-row')
    .filter({ hasText: '密度' })
    .getByRole('button', { name: '紧凑', exact: true })
    .click()
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.density))
    .toBe('compact')

  await page.locator('.settings-content select.select').last().selectOption('en')
  await expect(page.locator('.settings-nav')).toContainText('Language & appearance')
  await expect(page.locator('.settings-nav')).toContainText('About Pizza')

  // 英文覆盖：列表页与编辑器不再回退中文。
  await page.getByRole('button', { name: /^Agents/ }).click()
  await expect(page.locator('.manage-head')).toContainText('Agents')
  await page.locator('.manage-head-actions').getByRole('button', { name: 'New' }).click()
  await expect(page.locator('.page-title')).toHaveText('New agent')
  await expect(page.locator('.editor-nav')).toContainText('Instructions')
  await expect(
    page.locator('.field').filter({ hasText: 'Description' }).locator('textarea'),
  ).toHaveCount(1)
  await expect(page.locator('.avatar-preview .nice-avatar')).toBeVisible()
  await page.getByRole('button', { name: 'Back to agents' }).click()
  await page.getByRole('button', { name: /^Runtimes/ }).click()
  await expect(page.locator('.page-title')).toHaveText('Runtime')
  await page.getByRole('button', { name: 'Add runtime' }).click()
  await expect(page.locator('.page-title')).toHaveText('Connect runtime')
  await expect(page.locator('.field-label').first()).toContainText('Adapter')

  // 非 Claude 运行时也能完成连接测试并注册：通用 CLI 用 node 自身作为命令。
  await page.getByRole('button', { name: /Custom CLI/ }).click()
  await page
    .locator('.field')
    .filter({ hasText: /^Command/ })
    .locator('input')
    .fill(process.execPath)
  await page.getByRole('button', { name: 'Test connection' }).click()
  await expect(page.locator('.test-result')).toContainText('Connected', {
    timeout: 20_000,
  })
  await page.getByRole('button', { name: 'Register runtime' }).click()
  await expect(page.locator('.page-title')).toHaveText('Runtime')

  // 刷新后设置仍在（首屏主题由主进程启动参数恢复）。
  await page.reload()
  await page.waitForTimeout(800)
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.theme))
    .toBe('dark')
  await expect(page.locator('.settings-nav')).toContainText('Language & appearance')

  await app.close()
  rmSync(root, { recursive: true, force: true })
})
