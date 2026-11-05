#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')

const args = process.argv.slice(2)
const printIndex = args.findIndex((arg) => arg === '-p' || arg === '--print')
const prompt = printIndex >= 0 ? args[printIndex + 1] ?? '' : ''
const outputFormatIndex = args.findIndex((arg) => arg === '--output-format')
const outputFormat =
  outputFormatIndex >= 0 ? args[outputFormatIndex + 1] : 'text'
const systemIndex = args.findIndex((arg) => arg === '--append-system-prompt')
const systemPrompt = systemIndex >= 0 ? args[systemIndex + 1] ?? '' : ''
const isTeamRun = systemPrompt.includes('协作协议') && /团队「/.test(systemPrompt)

if (args.includes('--version')) {
  process.stdout.write('2.0.0 (fake-claude)\n')
  process.exit(0)
}

if (outputFormat === 'json') {
  process.stdout.write(
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: prompt.toLowerCase().includes('pong') ? 'pong' : 'ok',
      session_id: 'fake-session',
      usage: { input_tokens: 3, output_tokens: 1 },
      total_cost_usd: 0,
    }) + '\n',
  )
  process.exit(0)
}

const artifactPath = path.join(process.cwd(), 'fake-artifact.md')
if (!isTeamRun) {
  fs.writeFileSync(
    artifactPath,
    '# Fake artifact\n\nThis file was written by the deterministic test runtime.\n',
    'utf8',
  )
}

let responseText = '已创建 fake-artifact.md。'
if (isTeamRun) {
  // 团队编排 Prompt 会附在每名成员后面，不能据此判断角色；只看成员自身
  // 的生效 Prompt（在“你正在团队”协议之前）。
  const ownPrompt = systemPrompt.split('\n\n你正在团队')[0]
  const isLeader = ownPrompt.includes('你是团队的主持人')
  const memberMatch = systemPrompt.match(/- (.+?)（成员，id=([^）]+)）/)
  if (isLeader) {
    if (prompt.includes('继续')) {
      responseText = '## 结论\n已确认继续。'
    } else if (prompt.includes('等待用户')) {
      responseText = '[@我](mention://user) 请确认是否继续？'
    } else if (
      prompt.includes('自你上次发言以来的成员摘要') ||
      prompt.includes('停止辩论并输出结构化总结')
    ) {
      responseText =
        '## 结论\n团队测试完成。\n\n## 关键依据\n成员确认方案可行。\n\n## 分歧与未决问题\n无。\n\n## 建议下一步\n进入实现。'
    } else if (memberMatch) {
      responseText = `[@${memberMatch[1]}](mention://agent/${memberMatch[2]}) 请评估方案。`
    } else {
      responseText = '## 结论\n团队测试完成。'
    }
  } else {
    responseText = '成员结论：方案可行。'
  }
}

const sessionId =
  args[args.findIndex((arg) => arg === '--session-id') + 1] || 'fake-session'
const lines = [
  { type: 'system', subtype: 'init', session_id: sessionId },
  {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: responseText },
    },
  },
  ...(isTeamRun
    ? []
    : [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'fake-tool-1',
                name: 'Write',
                input: { file_path: artifactPath },
              },
            ],
          },
        },
      ]),
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: responseText,
    session_id: sessionId,
    usage: { input_tokens: 12, output_tokens: 8 },
    total_cost_usd: 0,
  },
]
const delay = prompt.toLowerCase().includes('slow') ? 1500 : 0
setTimeout(() => {
  for (const line of lines) process.stdout.write(`${JSON.stringify(line)}\n`)
  process.exit(0)
}, delay)
