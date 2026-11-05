#!/usr/bin/env node
let buffer = ''

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function handle(message) {
  if (!message || message.id === undefined) return
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { protocolVersion: 1, agentCapabilities: {} },
    })
    return
  }
  if (message.method === 'session/new') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-acp-session' },
    })
    return
  }
  if (message.method === 'session/prompt') {
    send({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fake-acp-session',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: 'pong from fake ACP' },
        },
      },
    })
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: { stopReason: 'end_turn', usage: { inputTokens: 4, outputTokens: 2 } },
    })
    return
  }
  send({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `unknown method ${message.method}` },
  })
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index = buffer.indexOf('\n')
  while (index >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (line) {
      try {
        handle(JSON.parse(line))
      } catch {
        // 忽略非 JSON 行。
      }
    }
    index = buffer.indexOf('\n')
  }
})
