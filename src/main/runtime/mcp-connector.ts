import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { EffectiveMcpServer, McpToolInfo } from '@shared/types'
import type { McpConnection, McpConnector } from '../services/mcp-service'
import { normalizeTools } from '../services/mcp-service'

function envRecord(env: Record<string, string>): Record<string, string> {
  // 只传递 SDK 的安全白名单（PATH、HOME 等）与用户显式声明的变量，
  // 避免把 provider API Key 等应用环境整体暴露给第三方 MCP 进程。
  return { ...getDefaultEnvironment(), ...env }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} 超时`)), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

/** 官方 TypeScript SDK 连接器；stdio、SSE、Streamable HTTP 共用同一发现流程。 */
export class SdkMcpConnector implements McpConnector {
  async connect(server: EffectiveMcpServer, timeoutMs: number): Promise<McpConnection> {
    if (server.transport === 'stdio' && !server.command) {
      throw new Error('stdio MCP 缺少启动命令')
    }
    if (server.transport !== 'stdio' && !server.url) {
      throw new Error(`${server.transport} MCP 缺少 URL`)
    }

    const client = new Client({ name: 'pizza', version: '1.0.0' })
    const transport =
      server.transport === 'stdio'
        ? new StdioClientTransport({
            command: server.command as string,
            args: server.args,
            env: envRecord(server.env),
            stderr: 'pipe',
          })
        : server.transport === 'sse'
          ? new SSEClientTransport(new URL(server.url as string), {
              requestInit: { headers: server.headers },
            })
          : new StreamableHTTPClientTransport(new URL(server.url as string), {
              requestInit: { headers: server.headers },
            })

    try {
      await withTimeout(client.connect(transport), timeoutMs, 'MCP 连接')
      const result = await withTimeout(client.listTools(undefined, { timeout: timeoutMs }), timeoutMs, 'MCP 工具发现')
      const tools: McpToolInfo[] = normalizeTools(result.tools)
      return {
        tools,
        close: async () => {
          await client.close()
        },
      }
    } catch (error) {
      await client.close().catch(() => undefined)
      throw error
    }
  }
}
