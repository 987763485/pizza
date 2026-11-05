import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CapabilityStore } from '../../src/main/db/capability-store'
import type { McpConnection, McpConnector } from '../../src/main/services/mcp-service'
import { McpService, normalizeTools } from '../../src/main/services/mcp-service'
import type { SecretBox } from '../../src/main/services/secret-box'
import type { EffectiveMcpServer, McpToolInfo } from '../../src/shared/types'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class FakeSecretBox implements SecretBox {
  available() {
    return true
  }
  encrypt(value: string) {
    return `enc:${Buffer.from(value).toString('base64')}`
  }
  decrypt(value: string) {
    return Buffer.from(value.slice(4), 'base64').toString('utf8')
  }
}

class FakeConnector implements McpConnector {
  calls: EffectiveMcpServer[] = []
  fail = false
  tools: McpToolInfo[] = [
    { name: 'search', description: '搜索', inputSchema: { type: 'object' } },
  ]
  async connect(server: EffectiveMcpServer): Promise<McpConnection> {
    this.calls.push(server)
    if (this.fail) throw new Error('连接被拒绝')
    return { tools: this.tools, close: async () => undefined }
  }
}

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'pizza-mcp-'))
  roots.push(root)
  const db = openDatabase(':memory:')
  db.prepare(
    'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run('11111111-1111-4111-8111-111111111111', 'W', root, new Date().toISOString())
  const store = new CapabilityStore(db)
  const connector = new FakeConnector()
  const service = new McpService(store, new FakeSecretBox(), connector)
  return {
    db,
    store,
    connector,
    service,
    workspaceId: '11111111-1111-4111-8111-111111111111',
  }
}

describe('mcp service', () => {
  it('encrypts secrets and never exposes them through the read model', async () => {
    const { db, store, service, workspaceId } = setup()
    const server = service.create({
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: { API_KEY: 'super-secret' },
    })
    expect(server.hasEnv).toBe(true)
    expect(JSON.stringify(server)).not.toContain('super-secret')
    const secrets = store.getMcpSecrets(server.id)
    expect(secrets.envEncrypted).toContain('enc:')
    expect(secrets.envEncrypted).not.toContain('super-secret')
    expect((await service.launchConfig(server.id)).env.API_KEY).toBe('super-secret')
    const audit = JSON.stringify(store.listAudit(workspaceId))
    expect(audit).toContain('mcp.create')
    expect(audit).toContain('mcp.read')
    expect(audit).not.toContain('super-secret')
    db.close()
  })

  it('tests a connection, stores tools and reports failures', async () => {
    const { db, connector, service, workspaceId } = setup()
    const server = service.create({
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
    })
    const ok = await service.test(server.id)
    expect(ok.ok).toBe(true)
    expect(ok.tools.map((tool) => tool.name)).toEqual(['search'])
    expect(service.list(workspaceId)[0]).toMatchObject({ status: 'connected' })

    connector.fail = true
    const failed = await service.test(server.id)
    expect(failed.ok).toBe(false)
    expect(failed.error).toContain('连接被拒绝')
    expect(service.list(workspaceId)[0]).toMatchObject({ status: 'failed', tools: [] })
    db.close()
  })

  it('replaces secrets on edit and clears them when omitted', async () => {
    const { db, store, service, workspaceId } = setup()
    const server = service.create({
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
      env: { TOKEN: 'one' },
    })
    service.update(server.id, {
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
      env: { TOKEN: 'two' },
    })
    expect((await service.launchConfig(server.id)).env.TOKEN).toBe('two')

    // 整体替换语义：不提供敏感字段即清空，避免旧密钥发送到新端点。
    service.update(server.id, {
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
    })
    expect(store.getMcpSecrets(server.id).envEncrypted).toBeNull()
    expect((await service.launchConfig(server.id)).env.TOKEN).toBeUndefined()

    // 启停是独立操作，不能清空凭据。
    service.update(server.id, {
      workspaceId,
      name: 'search',
      transport: 'stdio',
      command: 'node',
      env: { TOKEN: 'three' },
    })
    service.setEnabled(server.id, false)
    expect(store.getMcpSecrets(server.id).envEncrypted).toContain('enc:')
    db.close()
  })

  it('validates transport configuration and blocks deleting a bound server', async () => {
    const { db, service, workspaceId } = setup()
    expect(() =>
      service.create({ workspaceId, name: 'bad', transport: 'stdio' }),
    ).toThrow(/启动命令/)
    expect(() =>
      service.create({ workspaceId, name: 'bad', transport: 'http', url: 'ftp://x' }),
    ).toThrow(/http/)

    const server = service.create({
      workspaceId,
      name: 'ok',
      transport: 'http',
      url: 'https://example.com/mcp',
    })
    service.setBinding({
      serverId: server.id,
      scopeType: 'workspace',
      scopeId: workspaceId,
      toolAllow: ['search'],
    })
    expect(() => service.remove(server.id)).toThrow(/MCP_IN_USE/)
    db.close()
  })

  it('normalizes SDK tool results', () => {
    expect(normalizeTools([{ name: 'a' }, { description: 'missing name' }])).toEqual([
      { name: 'a', description: '', inputSchema: { type: 'object' } },
    ])
  })
})
