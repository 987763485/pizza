import { describe, expect, it } from 'vitest'
import { parseClaudeLine } from '../../src/main/runtime/claude-cli'
import { parseAcpUpdate } from '../../src/main/runtime/acp-stdio'

describe('Claude CLI stream parser', () => {
  it('extracts session id, partial text and usage', () => {
    const init = parseClaudeLine(
      JSON.stringify({
        type: 'system',
        subtype: 'init',
        session_id: 'session-1',
      }),
    )
    expect(init.sessionId).toBe('session-1')
    expect(init.events[0].type).toBe('status')

    const delta = parseClaudeLine(
      JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '你好' },
        },
      }),
    )
    expect(delta.events).toEqual([
      { type: 'text_delta', payload: { text: '你好' } },
    ])

    const result = parseClaudeLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: '你好，我是 Pizza。',
        session_id: 'session-1',
        usage: { input_tokens: 12, output_tokens: 34 },
        total_cost_usd: 0.01,
      }),
    )
    expect(result.resultText).toBe('你好，我是 Pizza。')
    expect(result.usage).toEqual({ input: 12, output: 34, cost: 0.01 })
    expect(result.events.some((event) => event.type === 'completed')).toBe(true)
  })

  it('marks error results as failed', () => {
    const parsed = parseClaudeLine(
      JSON.stringify({
        type: 'result',
        subtype: 'error',
        is_error: true,
        result: 'not logged in',
      }),
    )
    expect(parsed.error).toBe('not logged in')
    expect(parsed.events.some((event) => event.type === 'failed')).toBe(true)
  })
})

describe('ACP update parser', () => {
  it('maps agent message chunks to text deltas', () => {
    expect(
      parseAcpUpdate({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'hello' },
      }),
    ).toEqual([{ type: 'text_delta', payload: { text: 'hello' } }])
  })

  it('maps tool calls and updates', () => {
    const started = parseAcpUpdate({
      sessionUpdate: 'tool_call',
      toolCallId: 'tool-1',
      title: 'Read file',
      kind: 'read',
      rawInput: { path: 'README.md' },
    })
    expect(started[0].type).toBe('tool_started')
    expect(started[0].payload.name).toBe('Read file')

    const finished = parseAcpUpdate({
      sessionUpdate: 'tool_call_update',
      toolCallId: 'tool-1',
      status: 'completed',
    })
    expect(finished[0].type).toBe('tool_finished')
  })
})
