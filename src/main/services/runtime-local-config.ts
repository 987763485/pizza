import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { EffectiveMcpServer, RuntimeConfig } from '@shared/types'

export type LocalMcpProvider = (
  runtime: RuntimeConfig,
) => EffectiveMcpServer[] | Promise<EffectiveMcpServer[]>

interface ClaudeMcpEntry {
  type?: string
  command?: string
  args?: unknown
  url?: string
  env?: unknown
  headers?: unknown
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => typeof item === 'string')
      .map(([key, item]) => [key, item as string]),
  )
}

function claudeConfigPath(): string {
  const dir = process.env.CLAUDE_CONFIG_DIR || homedir()
  return join(dir, '.claude.json')
}

/**
 * 读取 Claude Code 的本地 MCP 配置，作为最底层的合并来源。
 *
 * 只读取 `mcpServers`，不执行任何配置中的命令；文件缺失或格式错误时
 * 返回空列表，不阻塞运行。
 */
export function discoverRuntimeMcpServers(
  runtime: RuntimeConfig,
): EffectiveMcpServer[] {
  if (runtime.adapter !== 'claude-code') return []
  try {
    const parsed = JSON.parse(readFileSync(claudeConfigPath(), 'utf8')) as {
      mcpServers?: Record<string, ClaudeMcpEntry>
    }
    const servers = parsed.mcpServers ?? {}
    return Object.entries(servers).flatMap(([name, entry]) => {
      if (!entry || typeof entry !== 'object') return []
      const transport =
        entry.type === 'sse' || entry.type === 'http'
          ? entry.type
          : entry.url
            ? 'http'
            : 'stdio'
      if (transport === 'stdio' && !entry.command) return []
      if (transport !== 'stdio' && !entry.url) return []
      return [
        {
          id: `runtime:${name}`,
          name,
          transport,
          command: entry.command ?? null,
          args: Array.isArray(entry.args) ? entry.args.map(String) : [],
          url: entry.url ?? null,
          timeoutMs: 20_000,
          env: stringRecord(entry.env),
          headers: stringRecord(entry.headers),
          toolAllow: [],
          toolDeny: [],
          source: 'runtime' as const,
        },
      ]
    })
  } catch {
    return []
  }
}
