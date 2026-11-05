#!/usr/bin/env node
// 最小 ACP 运行时夹具：创建会话、回显 MCP 数量，并请求一次工具审批。
const readline = require('node:readline')

const rl = readline.createInterface({ input: process.stdin })
let nextClientRequestId = 900
let mcpCount = 0
let mcpShape = '[]'
const pending = new Map()

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function update(text) {
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId: 'fake-acp',
      update: {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text },
      },
    },
  })
}

rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.id !== undefined && !message.method) {
    const handler = pending.get(message.id)
    if (handler) {
      pending.delete(message.id)
      handler(message.result)
    }
    return
  }

  if (message.method === 'initialize') {
    write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })
    return
  }

  if (message.method === 'session/new') {
    mcpCount = Array.isArray(message.params?.mcpServers)
      ? message.params.mcpServers.length
      : 0
    mcpShape = JSON.stringify(message.params?.mcpServers ?? [])
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-acp', mcpCount },
    })
    return
  }

  if (message.method === 'session/prompt') {
    const promptText = message.params?.prompt?.[0]?.text ?? ''
    update(
      `准备调用工具 mcp-count:${mcpCount} mcp-shape:${Buffer.from(mcpShape).toString('base64')} skill-context:${
        promptText.includes('本次运行可用的 Skill') ? 'yes' : 'no'
      }\n`,
    )
    const requestId = nextClientRequestId++
    pending.set(requestId, (result) => {
      const outcome = result?.outcome
      const decided =
        outcome?.outcome === 'selected' ? outcome.optionId : 'cancelled'
      update(`decision:${decided}\n`)
      write({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          stopReason: 'end_turn',
          usage: { inputTokens: 5, outputTokens: 3 },
        },
      })
    })
    write({
      jsonrpc: '2.0',
      id: requestId,
      method: 'session/request_permission',
      params: {
        sessionId: 'fake-acp',
        toolCall: {
          title: 'Bash',
          kind: 'execute',
          rawInput: { command: 'echo test', token: 'secret-token' },
        },
        // 故意把 always 放在最前，验证「允许一次」不会误选永久授权。
        options: [
          { optionId: 'always', name: '总是允许', kind: 'allow_always' },
          { optionId: 'once', name: '允许一次', kind: 'allow_once' },
          { optionId: 'reject', name: '拒绝', kind: 'reject_once' },
        ],
      },
    })
    return
  }

  if (message.method === 'session/cancel') {
    write({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fake-acp',
        update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: '已取消' } },
      },
    })
  }
})
