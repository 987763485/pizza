import { describe, expect, it } from 'vitest'
import {
  agentInputSchema,
  runtimeInputSchema,
  sendMessageSchema,
  settingsUpdateSchema,
} from '../../src/shared/ipc'
import { RUNTIME_PRESETS } from '../../src/shared/types'

const workspaceId = '11111111-1111-4111-8111-111111111111'
const runtimeId = '22222222-2222-4222-8222-222222222222'
const sessionId = '33333333-3333-4333-8333-333333333333'

describe('IPC schemas', () => {
  it('rejects an empty message and invalid session id', () => {
    expect(() =>
      sendMessageSchema.parse({ sessionId: 'not-a-uuid', content: '   ' }),
    ).toThrow()
  })

  it('rejects a runtime without required fields', () => {
    expect(() =>
      runtimeInputSchema.parse({
        name: '',
        adapter: 'unknown',
        protocol: 'CLI',
        transport: 'stdio',
      }),
    ).toThrow()
  })

  it('accepts every built-in runtime adapter preset', () => {
    for (const preset of RUNTIME_PRESETS) {
      expect(() =>
        runtimeInputSchema.parse({
          name: preset.name,
          adapter: preset.adapter,
          protocol: preset.protocol,
          transport: preset.transport,
        }),
      ).not.toThrow()
    }
  })

  it('rejects an agent with an invalid context threshold', () => {
    expect(() =>
      agentInputSchema.parse({
        workspaceId,
        name: '助手',
        runtimeId,
        prompt: '工作',
        contextLimit: 1,
      }),
    ).toThrow()
  })

  it('accepts valid settings and rejects out-of-range concurrency', () => {
    expect(settingsUpdateSchema.parse({ maxConcurrency: 3 }).maxConcurrency).toBe(3)
    expect(() => settingsUpdateSchema.parse({ maxConcurrency: 99 })).toThrow()
  })

  it('validates the per-agent concurrency range independently', () => {
    const input = { name: '助手', runtimeId, prompt: '工作' }
    expect(agentInputSchema.parse({ ...input, maxConcurrency: 5 }).maxConcurrency).toBe(5)
    expect(() => agentInputSchema.parse({ ...input, maxConcurrency: 11 })).toThrow()
  })

  it('accepts a valid message with a typed attachment', () => {
    const parsed = sendMessageSchema.parse({
      sessionId,
      content: '读取附件',
      attachments: [
        { name: 'note.txt', mime: 'text/plain', data: new Uint8Array([1, 2, 3]) },
      ],
    })
    expect(parsed.attachments?.[0]?.name).toBe('note.txt')
  })
})
