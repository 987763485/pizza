import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AcpStdioAdapter } from '../../src/main/runtime/acp-stdio'
import type {
  NormalizedRuntimeEvent,
  RuntimePermissionRequest,
} from '../../src/main/runtime/types'
import type { RuntimeConfig } from '../../src/shared/types'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'fake-acp.cjs')

function config(): RuntimeConfig {
  return {
    id: 'runtime-acp',
    name: 'Fake ACP',
    adapter: 'acp',
    protocol: 'ACP',
    transport: 'stdio',
    command: process.execPath,
    args: [fixture],
    env: {},
    timeoutMs: 30_000,
    autoReconnect: false,
    status: 'online',
    capabilities: { mcp: true },
    createdAt: new Date().toISOString(),
  }
}

async function run(
  requestPermission: (request: RuntimePermissionRequest) => Promise<string | null>,
  extraServers: Array<Record<string, unknown>> = [],
) {
  const adapter = new AcpStdioAdapter()
  const session = await adapter.openSession(config())
  const events: NormalizedRuntimeEvent[] = []
  const captured: RuntimePermissionRequest[] = []
  const result = await session.prompt({
    prompt: '请执行工具',
    systemPrompt: 'system',
    sessionId: 'session',
    runtimeSessionId: null,
    cwd: process.cwd(),
    attachmentPaths: [],
    signal: new AbortController().signal,
    onEvent: (event) => events.push(event),
    capabilities: {
      acpMcpServers: [
        { name: 'local', command: 'node', args: [], env: {} },
        ...(extraServers as Array<{ name: string; command: string; args: string[]; env: Record<string, string> }>),
      ],
      skillManifest: '本次运行可用的 Skill：writer',
    },
    requestPermission: async (request) => {
      captured.push(request)
      return requestPermission(request)
    },
  })
  session.close()
  return { result, events, captured }
}

describe('ACP permission integration', () => {
  it('forwards stdio MCP servers and returns the selected option', async () => {
    const { result, captured } = await run(async () => 'once')
    expect(result.text).toContain('mcp-count:1')
    expect(result.text).toContain('skill-context:yes')
    expect(result.text).toContain('decision:once')
    expect(captured).toHaveLength(1)
    expect(captured[0].toolName).toBe('Bash')
    expect(captured[0].toolInput).toMatchObject({ command: 'echo test' })
    expect(captured[0].options.map((option) => option.kind)).toEqual([
      'allow_always',
      'allow_once',
      'reject_once',
    ])
  })

  it('forwards remote MCP servers with url and headers', async () => {
    const { result } = await run(
      async () => 'once',
      [
        {
          name: 'remote',
          type: 'http',
          url: 'https://example.test/mcp',
          headers: { authorization: 'Bearer token' },
        },
      ],
    )
    expect(result.text).toContain('mcp-count:2')
    const shape = Buffer.from(result.text.match(/mcp-shape:(\S+)/)?.[1] ?? '', 'base64').toString()
    expect(JSON.parse(shape)).toEqual([
      { name: 'local', command: 'node', args: [], env: [] },
      {
        name: 'remote',
        type: 'http',
        url: 'https://example.test/mcp',
        headers: [{ name: 'authorization', value: 'Bearer token' }],
      },
    ])
  })

  it('returns cancelled when the approval is denied', async () => {
    const { result } = await run(async () => null)
    expect(result.text).toContain('decision:cancelled')
  })
})
