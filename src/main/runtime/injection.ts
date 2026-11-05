import { createServer, type Server, type Socket } from 'node:net'
import { chmodSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type {
  Agent,
  CapabilityPreview,
  EffectiveMcpServer,
  RuntimeConfig,
  Session,
} from '@shared/types'
import type { ApprovalService } from '../services/approval-service'
import { CapabilityResolver } from '../services/capability-resolver'
import {
  cleanupMaterialized,
  materializeSkills,
  type MaterializedSkills,
} from '../services/skill-materializer'
import type { RuntimeCapabilityInjection } from './types'

/**
 * Claude Code 的 PreToolUse hook 脚本。
 *
 * 脚本在运行时生成到本次运行的临时目录，避免打包时遗漏静态资源；
 * 任何连接失败、超时或非法响应都输出 deny，保证审批边界失败关闭。
 */
export const CLAUDE_APPROVAL_HOOK_SOURCE = `#!/usr/bin/env node
'use strict'
const net = require('node:net')
const socketPath = process.argv[2]
const runId = process.argv[3] || ''
const TIMEOUT_MS = 125000

function respond(decision) {
  const allow = decision === 'allow_once' || decision === 'always_allow'
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: allow ? 'allow' : 'deny',
      permissionDecisionReason: allow ? 'Pizza 已批准本次工具调用' : 'Pizza 审批未通过',
    },
  }) + '\\n')
  process.exit(0)
}

let raw = ''
process.stdin.on('data', (chunk) => { raw += chunk })
process.stdin.on('end', () => {
  let payload
  try {
    const input = JSON.parse(raw || '{}')
    payload = {
      runId,
      toolName: String(input.tool_name || input.toolName || ''),
      toolInput: input.tool_input || input.toolInput || {},
      claudeSessionId: input.session_id || '',
    }
  } catch {
    respond('deny')
    return
  }
  if (!socketPath || !payload.toolName) {
    respond('deny')
    return
  }
  const socket = net.connect(socketPath)
  let buffer = ''
  let settled = false
  const finish = (decision) => {
    if (settled) return
    settled = true
    socket.destroy()
    respond(decision)
  }
  const timer = setTimeout(() => finish('deny'), TIMEOUT_MS)
  socket.on('connect', () => socket.write(JSON.stringify(payload) + '\\n'))
  socket.on('data', (chunk) => {
    buffer += chunk
    const index = buffer.indexOf('\\n')
    if (index < 0) return
    clearTimeout(timer)
    try {
      finish(JSON.parse(buffer.slice(0, index)).decision || 'deny')
    } catch {
      finish('deny')
    }
  })
  socket.on('error', () => {
    clearTimeout(timer)
    finish('deny')
  })
})
`

export interface PreparedCapabilities {
  injection: RuntimeCapabilityInjection
  materialized: MaterializedSkills | null
  preview: CapabilityPreview
  cleanup: () => void
}

interface PreparedOptions {
  runtimeRoot: string
  runId: string
  session: Session
  agent: Agent
  runtime: RuntimeConfig
  preview: CapabilityPreview
  approvals?: ApprovalService
}

function writeMcpConfig(runDir: string, servers: EffectiveMcpServer[]): string | null {
  if (servers.length === 0) return null
  const mcpServers = Object.fromEntries(
    servers.map((server) => {
      if (server.transport === 'stdio') {
        return [
          server.name,
          {
            type: 'stdio',
            command: server.command,
            args: server.args,
            env: server.env,
          },
        ]
      }
      return [
        server.name,
        {
          type: server.transport,
          url: server.url,
          headers: server.headers,
        },
      ]
    }),
  )
  const path = join(runDir, 'mcp-config.json')
  writeFileSync(path, `${JSON.stringify({ mcpServers }, null, 2)}\n`, 'utf8')
  // 文件包含 MCP 密钥，只允许当前用户读取。
  chmodSync(path, 0o600)
  return path
}

async function startApprovalBridge(options: {
  runDir: string
  socketPath: string
  runId: string
  session: Session
  agent: Agent
  preview: CapabilityPreview
  approvals: ApprovalService
}): Promise<{ server: Server; sockets: Set<Socket> }> {
  const sockets = new Set<Socket>()
  const server = createServer((socket) => {
    sockets.add(socket)
    socket.on('close', () => sockets.delete(socket))
    let buffer = ''
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8')
      const index = buffer.indexOf('\n')
      if (index < 0) return
      const line = buffer.slice(0, index)
      void (async () => {
        let decision = 'deny'
        try {
          const payload = JSON.parse(line) as {
            toolName?: string
            toolInput?: Record<string, unknown>
          }
          const toolName = String(payload.toolName ?? '')
          const mcpName = toolName.startsWith('mcp__')
            ? toolName.split('__')[1]
            : null
          const server = mcpName
            ? options.preview.mcpServers.find((item) => item.name === mcpName)
            : undefined
          const policy = server
            ? CapabilityResolver.toolPolicy(server, toolName.split('__').slice(2).join('__'))
            : null
          decision = await options.approvals.request({
            workspaceId: options.session.workspaceId,
            runId: options.runId,
            sessionId: options.session.id,
            agentId: options.agent.id,
            agentName: options.agent.name,
            toolName,
            toolInput: payload.toolInput ?? {},
            toolPolicy: policy,
          })
        } catch {
          decision = 'deny'
        }
        socket.write(`${JSON.stringify({ decision })}\n`)
        socket.end()
      })()
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(options.socketPath, () => resolve())
  })
  if (process.platform !== 'win32') chmodSync(options.socketPath, 0o600)
  return { server, sockets }
}

/**
 * Unix socket 路径有约 104 字节上限，临时数据目录放在 /var/folders 下很容易超限。
 * 这里使用系统临时目录里的短路径，并在运行结束后删除。
 */
export function approvalSocketPath(runId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\pizza-approval-${runId}`
  }
  return join(tmpdir(), `pz-approval-${runId.slice(0, 8)}-${process.pid}.sock`)
}

function buildClaudeSettings(runDir: string, socketPath: string, runId: string): string {
  const hookScript = join(runDir, 'approval-hook.cjs')
  writeFileSync(hookScript, CLAUDE_APPROVAL_HOOK_SOURCE, 'utf8')
  const settings = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `node "${hookScript}" "${socketPath}" "${runId}"`,
            },
          ],
        },
      ],
    },
  }
  const path = join(runDir, 'claude-settings.json')
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
  chmodSync(path, 0o600)
  return path
}

/**
 * 为一次运行准备 Skill、MCP 与审批注入。
 *
 * 返回的 cleanup 必须在该运行的 finally 中调用，删除物化目录并关闭 socket。
 */
export async function prepareRuntimeCapabilities(
  options: PreparedOptions,
): Promise<PreparedCapabilities> {
  const materialized = materializeSkills(
    options.runtimeRoot,
    options.runId,
    options.preview.skills,
  )
  const runDir = materialized.runDir
  mkdirSync(runDir, { recursive: true, mode: 0o700 })
  chmodSync(runDir, 0o700)

  let server: Server | null = null
  let sockets = new Set<Socket>()
  let socketPath: string | null = null
  const cleanup = () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    server?.close()
    if (socketPath && process.platform !== 'win32') {
      rmSync(socketPath, { force: true })
    }
    cleanupMaterialized(runDir)
  }

  const injection: RuntimeCapabilityInjection = {
    pluginDir: materialized.pluginDir,
  }

  try {
    if (options.preview.mcpServers.length > 0) {
      const path = writeMcpConfig(runDir, options.preview.mcpServers)
      if (path) injection.mcpConfigPath = path
      injection.acpMcpServers = options.preview.mcpServers.map((item) =>
        item.transport === 'stdio'
          ? {
              name: item.name,
              command: item.command ?? '',
              args: item.args,
              env: item.env,
            }
          : {
              name: item.name,
              type: item.transport,
              url: item.url ?? '',
              headers: item.headers,
            },
      )
    }

    if (options.approvals && options.runtime.adapter === 'claude-code') {
      socketPath = approvalSocketPath(options.runId)
      const bridge = await startApprovalBridge({
        runDir,
        socketPath,
        runId: options.runId,
        session: options.session,
        agent: options.agent,
        preview: options.preview,
        approvals: options.approvals,
      })
      server = bridge.server
      sockets = bridge.sockets
      injection.settingsPath = buildClaudeSettings(runDir, socketPath, options.runId)
    }

    injection.skillManifest = materialized.manifest || undefined

    return {
      injection,
      materialized,
      preview: options.preview,
      cleanup,
    }
  } catch (error) {
    // 准备阶段失败也必须删除已写入的临时凭据与物化文件。
    cleanup()
    throw error
  }
}
