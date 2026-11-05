#!/usr/bin/env node
// ACP 夹具：暴露模型/思考强度配置项，并记录 session/set_config_option。
const readline = require('node:readline')

const rl = readline.createInterface({ input: process.stdin })
let model = 'model-a'
let thinking = 'low'

const modelValues = ['model-a', 'model-b']
const thinkingValues = ['low', 'high']

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function configOptions() {
  return [
    {
      id: 'model',
      name: 'Model',
      category: 'model',
      type: 'select',
      currentValue: model,
      options: modelValues.map((value) => ({ value, name: value.toUpperCase() })),
    },
    {
      id: 'reasoning_effort',
      name: 'Reasoning',
      category: 'thought_level',
      type: 'select',
      currentValue: thinking,
      options: thinkingValues.map((value) => ({ value, name: value })),
    },
  ]
}

rl.on('line', (line) => {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }

  if (message.method === 'initialize') {
    write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1 } })
    return
  }

  if (message.method === 'session/new') {
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: { sessionId: 'fake-config', configOptions: configOptions() },
    })
    return
  }

  if (message.method === 'session/set_config_option') {
    const { configId, value } = message.params ?? {}
    if (configId === 'model') model = value
    if (configId === 'reasoning_effort') thinking = value
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: { configOptions: configOptions() },
    })
    return
  }

  if (message.method === 'session/prompt') {
    write({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'fake-config',
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: { type: 'text', text: `model:${model} thinking:${thinking}` },
        },
      },
    })
    write({
      jsonrpc: '2.0',
      id: message.id,
      result: { stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } },
    })
    return
  }

  if (message.method === 'session/cancel') return

  if (message.id !== undefined) {
    write({
      jsonrpc: '2.0',
      id: message.id,
      error: { code: -32601, message: 'method not found' },
    })
  }
})
