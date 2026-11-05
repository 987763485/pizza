import { randomUUID } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { SdkMcpConnector } from '../../src/main/runtime/mcp-connector'
import type { EffectiveMcpServer } from '../../src/shared/types'

const fixture = join(process.cwd(), 'tests', 'fixtures', 'fake-mcp.cjs')
const servers: Server[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }
})

function base(overrides: Partial<EffectiveMcpServer>): EffectiveMcpServer {
  return {
    id: 'server',
    name: 'fake',
    transport: 'stdio',
    command: process.execPath,
    args: [],
    url: null,
    timeoutMs: 20_000,
    env: {},
    headers: {},
    toolAllow: [],
    toolDeny: [],
    source: 'workspace',
    ...overrides,
  }
}

describe('MCP SDK connector', () => {
  it('connects to a stdio server and lists tools', async () => {
    const connector = new SdkMcpConnector()
    const connection = await connector.connect(
      base({ command: process.execPath, args: [fixture] }),
      10_000,
    )
    try {
      expect(connection.tools).toEqual([
        {
          name: 'echo',
          description: '回显输入',
          inputSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
          },
        },
      ])
    } finally {
      await connection.close()
    }
  })

  it('connects to a Streamable HTTP server and lists tools', async () => {
    const mcp = new McpServer({ name: 'fake-http', version: '1.0.0' })
    mcp.registerTool(
      'search',
      { description: '搜索资料' },
      async () => ({ content: [{ type: 'text', text: 'ok' }] }),
    )
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    })
    await mcp.connect(transport)

    const http = createServer((request, response) => {
      void transport.handleRequest(request, response)
    })
    servers.push(http)
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
    const port = (http.address() as AddressInfo).port

    const connector = new SdkMcpConnector()
    const connection = await connector.connect(
      base({
        transport: 'http',
        command: null,
        url: `http://127.0.0.1:${port}/mcp`,
      }),
      10_000,
    )
    try {
      expect(connection.tools.map((tool) => tool.name)).toEqual(['search'])
    } finally {
      await connection.close()
      await mcp.close()
    }
  })
})
