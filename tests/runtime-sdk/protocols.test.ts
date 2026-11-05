import { describe, expect, it } from 'vitest'
import {
  createCodexState,
  createDshState,
  parseAcpModelCatalog,
  parseClaudeModelCatalog,
  parseCodexModelCatalog,
  parseCodexNotification,
  parseDshFrame,
  parseDshModelCatalog,
  parseKimiLine,
  parseOmpModelCatalog,
  parsePiLine,
  parsePiModelTable,
} from '@runtime-sdk'

describe('Pi JSON protocol', () => {
  it('maps text, tool and usage events', () => {
    const delta = parsePiLine(
      JSON.stringify({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', delta: '你好' },
      }),
    )
    expect(delta.events).toEqual([{ type: 'text_delta', payload: { text: '你好' } }])

    const tool = parsePiLine(
      JSON.stringify({
        type: 'tool_execution_start',
        toolCallId: 'call-1',
        toolName: 'read',
        args: { path: 'README.md' },
      }),
    )
    expect(tool.events[0]).toMatchObject({
      type: 'tool_started',
      payload: { id: 'call-1', name: 'read', input: { path: 'README.md' } },
    })

    const ended = parsePiLine(
      JSON.stringify({
        type: 'tool_execution_end',
        toolCallId: 'call-1',
        toolName: 'read',
        result: 'done',
      }),
    )
    expect(ended.events[0].type).toBe('tool_finished')

    const turn = parsePiLine(
      JSON.stringify({
        type: 'turn_end',
        message: {
          role: 'assistant',
          usage: { input: 12, output: 34 },
          stopReason: 'end',
        },
      }),
    )
    expect(turn.usage).toEqual({ input: 12, output: 34 })
  })

  it('surfaces provider errors from turn and run endings', () => {
    const turn = parsePiLine(
      JSON.stringify({
        type: 'turn_end',
        message: { role: 'assistant', stopReason: 'error', errorMessage: 'no api key' },
      }),
    )
    expect(turn.error).toBe('no api key')

    const error = parsePiLine(JSON.stringify({ type: 'error', message: 'boom' }))
    expect(error.error).toBe('boom')
  })

  it('ignores non-JSON lines', () => {
    expect(parsePiLine('not json')).toEqual({ events: [] })
  })
})

describe('Codex app-server protocol', () => {
  it('maps agent deltas, command tools and turn completion', () => {
    const state = createCodexState()
    state.threadId = 'thread-1'

    expect(
      parseCodexNotification(
        'item/agentMessage/delta',
        { threadId: 'thread-1', itemId: 'item-1', delta: 'hello' },
        state,
      ),
    ).toEqual([{ type: 'text_delta', payload: { text: 'hello', itemId: 'item-1' } }])

    expect(
      parseCodexNotification(
        'item/started',
        {
          threadId: 'thread-1',
          item: { id: 'call-1', type: 'commandExecution', command: 'ls' },
        },
        state,
      )[0],
    ).toMatchObject({
      type: 'tool_started',
      payload: { id: 'call-1', name: 'exec_command', input: { command: 'ls' } },
    })

    const completed = parseCodexNotification(
      'turn/completed',
      { threadId: 'thread-1', turn: { id: 't1', status: 'completed' } },
      state,
    )
    expect(completed[0].type).toBe('completed')
    expect(state.completed).toBe(true)
  })

  it('ignores notifications from other threads', () => {
    const state = createCodexState()
    state.threadId = 'mine'
    expect(
      parseCodexNotification(
        'item/agentMessage/delta',
        { threadId: 'other', itemId: 'x', delta: 'leak' },
        state,
      ),
    ).toEqual([])
  })

  it('reports failed turns', () => {
    const state = createCodexState()
    state.threadId = 'thread-1'
    const events = parseCodexNotification(
      'turn/completed',
      { threadId: 'thread-1', turn: { id: 't1', status: 'failed', error: { message: 'bad' } } },
      state,
    )
    expect(events[0]).toMatchObject({ type: 'failed', payload: { error: 'bad' } })
    expect(state.error).toBe('bad')
  })
})

describe('DSH protocol', () => {
  it('maps session, text, tools, usage and result frames', () => {
    const state = createDshState()
    expect(
      parseDshFrame(JSON.stringify({ v: 1, type: 'session', session_id: 'dsh-1' }), state),
    ).toMatchObject([{ type: 'status', payload: { sessionId: 'dsh-1' } }])
    expect(state.sessionId).toBe('dsh-1')

    expect(
      parseDshFrame(JSON.stringify({ v: 1, type: 'text', content: 'hi' }), state),
    ).toEqual([{ type: 'text_delta', payload: { text: 'hi' } }])

    expect(
      parseDshFrame(
        JSON.stringify({
          v: 1,
          type: 'tool_call',
          call_id: 'c1',
          name: 'bash',
          arguments: '{"command":"ls"}',
        }),
        state,
      )[0],
    ).toMatchObject({
      type: 'tool_started',
      payload: { id: 'c1', name: 'bash', input: { command: 'ls' } },
    })

    parseDshFrame(
      JSON.stringify({ v: 1, type: 'usage', input_tokens: 3, output_tokens: 4 }),
      state,
    )
    expect(state.usage).toEqual({ input: 3, output: 4 })

    const done = parseDshFrame(
      JSON.stringify({
        v: 1,
        type: 'result',
        status: 'completed',
        output: 'ok',
        session_id: 'dsh-1',
      }),
      state,
    )
    expect(done[0].type).toBe('completed')
    expect(state.result?.output).toBe('ok')
  })

  it('rejects unsupported protocol versions', () => {
    const state = createDshState()
    expect(parseDshFrame(JSON.stringify({ v: 9, type: 'text', content: 'x' }), state)).toEqual([])
    expect(state.protocolError).toContain('9')
  })
})

describe('model catalogs', () => {
  it('parses Claude list_models control responses', () => {
    const output = JSON.stringify({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: 'pizza-list-models',
        response: {
          models: [
            {
              value: 'default',
              resolvedModel: 'claude-opus-5',
              displayName: 'Opus 5',
            },
            {
              value: 'sonnet',
              resolvedModel: 'claude-sonnet-5',
              displayName: 'Sonnet 5',
              supportsEffort: true,
              supportedEffortLevels: ['low', 'high', 'max'],
            },
            {
              value: 'legacy',
              resolvedModel: 'claude-3',
              displayName: 'Legacy',
              disabled: true,
            },
          ],
        },
      },
    })
    const catalog = parseClaudeModelCatalog(output)
    expect(catalog.models.map((model) => model.id)).toEqual([
      'claude-opus-5',
      'claude-sonnet-5',
    ])
    expect(catalog.models[0].default).toBe(true)
    expect(catalog.models[1].thinkingLevels).toEqual(['low', 'high', 'max'])
  })

  it('parses ACP model config options and legacy catalogs', () => {
    const catalog = parseAcpModelCatalog({
      sessionId: 's1',
      configOptions: [
        {
          id: 'model',
          category: 'model',
          type: 'select',
          currentValue: '["provider-a","model-a"]',
          options: [
            {
              group: 'provider-a',
              name: 'Provider A',
              options: [
                { value: '["provider-a","model-a"]', name: 'Model A' },
                { value: '["provider-a","model-b"]', name: 'Model B' },
              ],
            },
          ],
        },
        {
          id: 'reasoning_effort',
          category: 'thought_level',
          type: 'select',
          currentValue: 'high',
          options: [
            { value: 'off', name: 'Off' },
            { value: 'high', name: 'High' },
          ],
        },
      ],
    })
    expect(catalog.models.map((model) => model.provider)).toEqual([
      'provider-a',
      'provider-a',
    ])
    expect(catalog.models[0]).toMatchObject({
      id: '["provider-a","model-a"]',
      label: 'Model A',
      default: true,
    })
    expect(catalog.thinkingLevels).toEqual(['off', 'high'])
    expect(catalog.defaultThinkingLevel).toBe('high')

    const legacy = parseAcpModelCatalog({
      sessionId: 's2',
      models: {
        currentModelId: 'sonnet',
        availableModels: [
          { modelId: 'sonnet', name: 'Sonnet' },
          { modelId: 'opus', name: 'Opus' },
        ],
      },
    })
    expect(legacy.models.map((model) => model.id)).toEqual(['sonnet', 'opus'])
    expect(legacy.models[0].default).toBe(true)
  })

  it('parses Pi tables and OMP JSON catalogs', () => {
    const pi = parsePiModelTable(`provider             model                       context  max-out  thinking  images
anthropic            claude-sonnet-5             1M       128K     yes       yes
openai               gpt-6                       400K     128K     no        yes
Warning: No models match pattern "x/y"`)
    expect(pi.models.map((model) => model.id)).toEqual([
      'anthropic/claude-sonnet-5',
      'openai/gpt-6',
    ])
    expect(pi.models[0].thinkingLevels?.length).toBeGreaterThan(0)
    expect(pi.models[1].thinkingLevels).toBeUndefined()

    const omp = parseOmpModelCatalog(
      JSON.stringify({
        models: [
          {
            provider: 'cc-switch',
            id: 'deepseek-flash',
            selector: 'cc-switch/deepseek-flash',
            name: 'DeepSeek Flash',
            thinking: ['low', 'high', 'max'],
          },
        ],
      }),
    )
    expect(omp.models[0]).toMatchObject({
      id: 'cc-switch/deepseek-flash',
      label: 'DeepSeek Flash',
      thinkingLevels: ['low', 'high', 'max'],
    })
  })

  it('parses Codex debug models output', () => {
    const catalog = parseCodexModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-6-astra',
            display_name: 'GPT-6-Astra',
            default_reasoning_level: 'low',
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'high' },
              { effort: 'max' },
            ],
            visibility: 'list',
          },
          {
            slug: 'hidden-model',
            display_name: 'Hidden',
            visibility: 'hidden',
          },
        ],
      }),
    )
    expect(catalog.models).toHaveLength(1)
    expect(catalog.models[0]).toMatchObject({
      id: 'gpt-6-astra',
      label: 'GPT-6-Astra',
      thinkingLevels: ['low', 'high', 'max'],
      defaultThinkingLevel: 'low',
    })
  })

  it('parses DSH models frames and qualifies bare ids', () => {
    const catalog = parseDshModelCatalog(
      JSON.stringify({
        v: 1,
        type: 'models',
        models: [
          {
            id: 'deepseek-v4-pro',
            label: 'DeepSeek V4 Pro',
            provider: 'deepseek-official',
            thinking: { supported_levels: ['off', 'low', 'high'], default_level: 'high' },
          },
        ],
      }),
    )
    expect(catalog.models[0]).toMatchObject({
      id: 'deepseek-official/deepseek-v4-pro',
      thinkingLevels: ['off', 'low', 'high'],
      defaultThinkingLevel: 'high',
    })
  })
})


describe('Kimi Code protocol', () => {
  it('reads assistant text and text content parts', () => {
    expect(
      parseKimiLine(JSON.stringify({ role: 'assistant', content: '你好' }))?.text,
    ).toBe('你好')
    expect(
      parseKimiLine(
        JSON.stringify({
          role: 'assistant',
          content: [
            { type: 'think', think: 'hidden' },
            { type: 'text', text: '结果' },
          ],
        }),
      )?.text,
    ).toBe('结果')
  })

  it('maps tool calls and tool results', () => {
    const call = parseKimiLine(
      JSON.stringify({
        role: 'assistant',
        content: '查询目录',
        tool_calls: [
          {
            type: 'function',
            id: 'tc_1',
            function: { name: 'Shell', arguments: '{"command":"ls"}' },
          },
        ],
      }),
    )
    expect(call?.toolCalls).toEqual([
      { id: 'tc_1', name: 'Shell', input: { command: 'ls' } },
    ])

    const result = parseKimiLine(
      JSON.stringify({ role: 'tool', tool_call_id: 'tc_1', content: 'a.ts\nb.ts' }),
    )
    expect(result?.toolResults[0]).toEqual({
      callId: 'tc_1',
      output: 'a.ts\nb.ts',
      isError: false,
    })
  })

  it('uses the resume hint as the completion signal', () => {
    const parsed = parseKimiLine(
      JSON.stringify({
        role: 'meta',
        type: 'session.resume_hint',
        session_id: 'session_123',
      }),
    )
    expect(parsed).toMatchObject({ completed: true, sessionId: 'session_123' })
    expect(parseKimiLine('not json')).toBeNull()
  })
})
