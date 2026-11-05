import { test, expect } from '@playwright/test'
import { _electron } from 'playwright'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * 真实运行时验收默认跳过，只有显式设置 PIZZA_REAL_E2E=1 才运行，
 * 避免 CI 和日常检查产生模型费用与不稳定性。
 */
test.skip(process.env.PIZZA_REAL_E2E !== '1', '真实运行时验收需显式开启')

test('real Claude Code runs a five-member brainstorm with an interjection', async () => {
  test.setTimeout(600_000)
  const dataDir = mkdtempSync(join(tmpdir(), 'pizza-real-team-'))
  const projectRoot = process.cwd()
  const env = { ...process.env, PIZZA_DATA_DIR: dataDir }

  const app = await _electron.launch({ args: [projectRoot], env })
  const page = await app.firstWindow()
  await page.waitForTimeout(1000)
  await page
    .locator('.onboarding-card')
    .waitFor({ timeout: 4_000 })
    .then(() => page.getByRole('button', { name: '进入首页' }).click())
    .catch(() => undefined)

  await page.locator('.sidebar-footer .footer-btn').first().click()
  await page.getByRole('button', { name: '运行时' }).click()
  await page.getByRole('button', { name: '添加运行时' }).click()
  await page.waitForSelector('.acp-layout')
  await page.locator('.acp-layout input.input').nth(0).fill('Claude Code')
  await page.getByPlaceholder('例如：npx -y @scope/acp-adapter').fill('claude')
  await page.getByRole('button', { name: '测试连接' }).click()
  await page.waitForFunction(
    () => document.body.innerText.includes('连接成功'),
    null,
    { timeout: 120_000 },
  )
  await page.getByRole('button', { name: '注册运行时' }).click()
  await page.waitForTimeout(500)

  await page.getByRole('button', { name: '智能体团队' }).click()
  await page.getByRole('button', { name: '从模板创建' }).click()
  await page.waitForSelector('.modal select')
  await page.getByRole('button', { name: '创建团队' }).click()
  await page.waitForSelector('.editor-layout', { timeout: 60_000 })
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await page.waitForTimeout(600)

  await page.getByRole('button', { name: '返回聊天' }).click()
  await page.locator('.participant-btn').click()
  await page.getByRole('button', { name: /头脑风暴小组/ }).click()
  await page.locator('.home-card textarea').fill(
    '请围绕「Pizza 团队模式是否值得在 P0 交付」做一次简短头脑风暴。请用精确提及链接让产品经理、架构师、唱反调者、用户研究员分别给出 1-2 句观点，最后由主持人收敛。',
  )
  await page.locator('.home-card textarea').press('Enter')

  await page.waitForSelector('.msg-agent', { timeout: 120_000 })
  await page.locator('.mention-editor').fill('补充约束：必须考虑本地优先与成本。')
  await page.locator('.mention-editor').press('Enter')

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator('.waiting-card').count()) > 0) {
      await page
        .locator('.mention-editor')
        .fill('请直接输出最终结论并收敛，不要再 @我。')
      await page.locator('.mention-editor').press('Enter')
    }
    try {
      await page.waitForFunction(
        () => document.body.innerText.includes('team-turn-1.md'),
        null,
        { timeout: 120_000 },
      )
      break
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
  await page.waitForTimeout(1000)

  const artifactPath = join(process.env.HOME ?? '', 'Pizza', '.pizza', 'artifacts', 'team-turn-1.md')
  expect(statSync(artifactPath).isFile()).toBe(true)
  const content = readFileSync(artifactPath, 'utf8')
  expect(content).toContain('结论')
  expect(content).toContain('关键依据')
  console.log('REAL_TEAM_EVIDENCE', JSON.stringify({ artifactPath, length: content.length }))

  await app.close()
  rmSync(dataDir, { recursive: true, force: true })
})
