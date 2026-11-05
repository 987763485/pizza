import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeConfig } from '../../src/shared/types'
import { AcpStdioAdapter } from '../../src/main/runtime/acp-stdio'

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    id: 'acp-test',
    name: 'Fake ACP',
    adapter: 'acp',
    protocol: 'ACP',
    transport: 'stdio',
    command: process.execPath,
    args: [join(process.cwd(), 'tests', 'fixtures', 'fake-acp-server.cjs')],
    env: {},
    status: 'draft',
    capabilities: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('ACP stdio adapter', () => {
  it('runs the five-step connection test against a fake ACP server', async () => {
    const adapter = new AcpStdioAdapter()
    const result = await adapter.test(config(), new AbortController().signal)
    expect(result.ok).toBe(true)
    expect(result.steps.every((step) => step.status === 'ok')).toBe(true)
    expect(result.capabilities?.protocolVersion).toBe('1')
  })

  it('streams a prompt and returns the ACP session id', async () => {
    const adapter = new AcpStdioAdapter()
    const session = await adapter.openSession(config())
    const events: string[] = []
    const result = await session.prompt({
      prompt: 'hello',
      systemPrompt: '',
      sessionId: 'local-session',
      runtimeSessionId: null,
      cwd: process.cwd(),
      attachmentPaths: [],
      signal: new AbortController().signal,
      onEvent: (event) => events.push(event.type),
    })
    session.close()
    expect(result.text).toContain('pong from fake ACP')
    expect(result.runtimeSessionId).toBe('fake-acp-session')
    expect(events).toContain('text_delta')
    expect(events).toContain('completed')
  })

  it('reports a failed start step for a missing executable', async () => {
    const adapter = new AcpStdioAdapter()
    const result = await adapter.test(
      config({ command: '/definitely/not/a/runtime' }),
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    expect(result.steps.some((step) => step.status === 'failed')).toBe(true)
  })
})
