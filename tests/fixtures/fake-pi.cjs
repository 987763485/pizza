#!/usr/bin/env node
// 确定性 Pi 协议替身：版本探测、模型目录与一次 JSON 事件回合。
const args = process.argv.slice(2)

if (args.includes('--version')) {
  console.log('fake-pi 1.0.0')
  process.exit(0)
}

if (args.includes('--list-models')) {
  console.log('provider             model                       context  max-out  thinking  images')
  console.log('fake-provider        fake-sonnet                 200K     64K      yes       no')
  console.log('fake-provider        fake-opus                   200K     64K      yes       no')
  process.exit(0)
}

if (args.includes('-p') && args.includes('--mode') && args.includes('json')) {
  let input = ''
  process.stdin.on('data', (chunk) => {
    input += chunk
  })
  process.stdin.on('end', () => {
    const events = [
      { type: 'agent_start' },
      { type: 'turn_start' },
      {
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: 'pong' },
      },
      {
        type: 'turn_end',
        message: {
          role: 'assistant',
          usage: { input: 2, output: 1 },
          stopReason: 'end',
        },
      },
      {
        type: 'agent_end',
        messages: [
          { role: 'assistant', usage: { input: 2, output: 1 }, stopReason: 'end' },
        ],
      },
      { type: 'agent_settled', aborted: false },
    ]
    for (const event of events) console.log(JSON.stringify(event))
    process.exit(0)
  })
  return
}

console.error(`fake-pi: unsupported args: ${args.join(' ')}`)
process.exit(1)
