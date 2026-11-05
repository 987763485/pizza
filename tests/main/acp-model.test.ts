import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { RuntimeConfig } from '../../src/shared/types'
import { AcpStdioAdapter } from '../../src/main/runtime/acp-stdio'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'fake-acp-config.cjs')

function config(): RuntimeConfig {
  return {
    id: 'runtime-acp-config',
    name: 'Fake ACP config',
    adapter: 'acp',
    protocol: 'ACP',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: {},
    timeoutMs: 30_000,
    autoReconnect: false,
    status: 'online',
    capabilities: {},
    createdAt: new Date().toISOString(),
  }
}

describe('ACP model configuration', () => {
  it('discovers config options and applies model + thinking before prompting', async () => {
    const adapter = new AcpStdioAdapter()
    const catalog = await adapter.listModels(config(), new AbortController().signal)
    expect(catalog.models.map((model) => model.id)).toEqual(['model-a', 'model-b'])
    expect(catalog.models[0]).toMatchObject({ label: 'MODEL-A', default: true })
    expect(catalog.thinkingLevels).toEqual(['low', 'high'])
    expect(catalog.defaultThinkingLevel).toBe('low')

    const session = await adapter.openSession(config())
    const result = await session.prompt({
      prompt: 'hello',
      systemPrompt: '',
      sessionId: 'session',
      runtimeSessionId: null,
      cwd: process.cwd(),
      model: 'model-b',
      thinkingLevel: 'high',
      attachmentPaths: [],
      signal: new AbortController().signal,
      onEvent: () => undefined,
    })
    session.close()
    expect(result.text).toContain('model:model-b thinking:high')
  })
})
