#!/usr/bin/env node
// 最小 MCP stdio 服务：完成 initialize 与 tools/list，用于连接测试。
const readline = require('node:readline')

const rl = readline.createInterface({ input: process.stdin })

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined) return

  if (message.method === 'initialize') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-mcp', version: '1.0.0' },
      },
    })
    return
  }

  if (message.method === 'tools/list') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [
          {
            name: 'echo',
            description: '回显输入',
            inputSchema: { type: 'object', properties: { text: { type: 'string' } } },
          },
        ],
      },
    })
    return
  }

  write({
    jsonrpc: '2.0',
    id: message.id,
    error: { code: -32601, message: `Unsupported method: ${message.method}` },
  })
})
