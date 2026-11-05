import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openDatabase } from '../../src/main/db/database'
import { CapabilityStore } from '../../src/main/db/capability-store'
import { CapabilityResolver } from '../../src/main/services/capability-resolver'
import { McpService } from '../../src/main/services/mcp-service'
import type { SecretBox } from '../../src/main/services/secret-box'
import { SkillService } from '../../src/main/services/skill-service'
import type { EffectiveMcpServer, RuntimeConfig } from '../../src/shared/types'

const WORKSPACE = '11111111-1111-4111-8111-111111111111'
const RUNTIME = '22222222-2222-4222-8222-222222222222'
const AGENT = '33333333-3333-4333-8333-333333333333'
const TEAM = '44444444-4444-4444-8444-444444444444'
const MEMBER = '55555555-5555-4555-8555-555555555555'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

class PlainBox implements SecretBox {
  available() {
    return true
  }
  encrypt(value: string) {
    return value
  }
  decrypt(value: string) {
    return value
  }
}

function setup(localMcp: () => EffectiveMcpServer[] = () => []) {
  const root = mkdtempSync(join(tmpdir(), 'pizza-resolver-'))
  roots.push(root)
  const db = openDatabase(':memory:')
  const stamp = new Date().toISOString()
  db.prepare(
    'INSERT INTO workspace (id, name, root_path, is_default, created_at) VALUES (?, ?, ?, 1, ?)',
  ).run(WORKSPACE, 'W', root, stamp)
  db.prepare(
    `INSERT INTO runtime (id, name, adapter, protocol, transport, args_json, created_at)
     VALUES (?, 'R', 'claude-code', 'CLI', 'stdio', '[]', ?)`,
  ).run(RUNTIME, stamp)
  db.prepare(
    `INSERT INTO agent (id, name, runtime_id, prompt, created_at, updated_at)
     VALUES (?, 'Agent', ?, 'p', ?, ?)`,
  ).run(AGENT, RUNTIME, stamp, stamp)
  db.prepare(
    `INSERT INTO team (id, workspace_id, name, leader_agent_id, created_at, updated_at)
     VALUES (?, ?, 'T', ?, ?, ?)`,
  ).run(TEAM, WORKSPACE, AGENT, stamp, stamp)
  db.prepare(
    `INSERT INTO team_member (id, team_id, agent_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(MEMBER, TEAM, AGENT, stamp)

  const store = new CapabilityStore(db)
  const skills = new SkillService(store, { skillsDir: () => join(root, 'skills') })
  const mcp = new McpService(store, new PlainBox(), {
    connect: async () => ({ tools: [], close: async () => undefined }),
  })
  const resolver = new CapabilityResolver(store, skills, mcp, localMcp)
  return { root, db, store, skills, mcp, resolver }
}

async function importSkill(
  root: string,
  skills: SkillService,
  name: string,
): Promise<string> {
  const dir = join(root, `src-${name}`)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: ${name}\n---\n`,
  )
  const skill = await skills.import({
    workspaceId: WORKSPACE,
    sourceType: 'local',
    sourcePath: dir,
  })
  return skill.id
}

const claude: RuntimeConfig = {
  id: RUNTIME,
  name: 'R',
  adapter: 'claude-code',
  protocol: 'CLI',
  transport: 'stdio',
  args: [],
  env: {},
  timeoutMs: 30_000,
  autoReconnect: false,
  status: 'online',
  capabilities: { mcp: true, skills: true },
  createdAt: new Date().toISOString(),
}

const acp: RuntimeConfig = { ...claude, adapter: 'acp', protocol: 'ACP', capabilities: {} }

describe('capability resolver', () => {
  it('lets a more specific scope override a workspace binding', async () => {
    const { root, db, skills, resolver } = setup()
    const a = await importSkill(root, skills, 'alpha')
    const b = await importSkill(root, skills, 'beta')
    skills.setBinding({ skillId: a, scopeType: 'workspace', scopeId: WORKSPACE })
    skills.setBinding({ skillId: b, scopeType: 'workspace', scopeId: WORKSPACE })
    skills.setBinding({
      skillId: a,
      scopeType: 'agent',
      scopeId: AGENT,
      enabled: false,
    })

    let preview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      runtime: claude,
    })
    expect(preview.skills.map((skill) => skill.name)).toEqual(
      expect.arrayContaining(['beta', 'pizza-collaboration']),
    )
    expect(preview.skills.some((skill) => skill.name === 'alpha')).toBe(false)

    skills.setBinding({
      skillId: a,
      scopeType: 'team_member',
      scopeId: MEMBER,
    })
    preview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      teamMemberId: MEMBER,
      runtime: claude,
    })
    expect(preview.skills.some((skill) => skill.name === 'alpha')).toBe(true)

    // 团队成员取消挂载后，必须覆盖工作区/智能体的继承。
    skills.setBinding({
      skillId: a,
      scopeType: 'team_member',
      scopeId: MEMBER,
      enabled: false,
    })
    const removed = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      teamMemberId: MEMBER,
      runtime: claude,
    })
    expect(removed.skills.some((skill) => skill.name === 'alpha')).toBe(false)
    db.close()
  })

  it('applies one-off disables and reports missing content', async () => {
    const { root, db, skills, resolver } = setup()
    const a = await importSkill(root, skills, 'alpha')
    skills.setBinding({ skillId: a, scopeType: 'workspace', scopeId: WORKSPACE })
    const preview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      disabledSkillIds: [a],
      runtime: claude,
    })
    expect(preview.skills.some((skill) => skill.name === 'alpha')).toBe(false)
    db.close()
  })

  it('injects stdio MCP everywhere and skips remote MCP for ACP without support', async () => {
    const { db, mcp, resolver } = setup()
    const stdio = mcp.create({
      workspaceId: WORKSPACE,
      name: 'local',
      transport: 'stdio',
      command: 'node',
    })
    const remote = mcp.create({
      workspaceId: WORKSPACE,
      name: 'remote',
      transport: 'http',
      url: 'https://example.com/mcp',
    })
    for (const server of [stdio, remote]) {
      mcp.setBinding({
        serverId: server.id,
        scopeType: 'workspace',
        scopeId: WORKSPACE,
        toolAllow: ['search'],
      })
    }

    const claudePreview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      runtime: claude,
    })
    expect(claudePreview.mcpServers.map((server) => server.name).sort()).toEqual([
      'local',
      'remote',
    ])
    expect(claudePreview.mcpServers[0].toolAllow).toEqual(['search'])

    const acpPreview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      runtime: acp,
    })
    expect(acpPreview.mcpServers.map((server) => server.name)).toEqual(['local'])
    expect(acpPreview.diagnostics.some((item) => item.message.includes('远程 MCP'))).toBe(true)
    db.close()
  })

  it('merges runtime local MCP config under explicit bindings', async () => {
    const local = [
      {
        id: 'runtime:local-only',
        name: 'local-only',
        transport: 'stdio' as const,
        command: 'node',
        args: [],
        url: null,
        timeoutMs: 20_000,
        env: {},
        headers: {},
        toolAllow: [],
        toolDeny: [],
        source: 'runtime' as const,
      },
      {
        id: 'runtime:shared',
        name: 'shared',
        transport: 'stdio' as const,
        command: 'old',
        args: [],
        url: null,
        timeoutMs: 20_000,
        env: {},
        headers: {},
        toolAllow: [],
        toolDeny: [],
        source: 'runtime' as const,
      },
    ]
    const { db, mcp, resolver } = setup(() => local)
    const bound = mcp.create({
      workspaceId: WORKSPACE,
      name: 'shared',
      transport: 'stdio',
      command: 'new',
    })
    mcp.setBinding({
      serverId: bound.id,
      scopeType: 'workspace',
      scopeId: WORKSPACE,
    })

    const preview = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      runtime: claude,
    })
    const shared = preview.mcpServers.find((server) => server.name === 'shared')
    expect(shared?.command).toBe('new')
    expect(shared?.source).toBe('workspace')
    expect(preview.mcpServers.find((server) => server.name === 'local-only')?.source).toBe(
      'runtime',
    )

    mcp.setBinding({
      serverId: bound.id,
      scopeType: 'workspace',
      scopeId: WORKSPACE,
      enabled: false,
    })
    const masked = await resolver.resolve({
      workspaceId: WORKSPACE,
      agentId: AGENT,
      runtime: claude,
    })
    expect(masked.mcpServers.some((server) => server.name === 'shared')).toBe(false)
    expect(masked.mcpServers.some((server) => server.name === 'local-only')).toBe(true)
    db.close()
  })

  it('enforces MCP tool allow and deny lists', () => {
    const server = {
      id: 'x',
      name: 'search',
      transport: 'stdio' as const,
      command: 'node',
      args: [],
      url: null,
      env: {},
      headers: {},
      timeoutMs: 20_000,
      toolAllow: ['read'],
      toolDeny: ['danger'],
      source: 'workspace' as const,
    }
    expect(CapabilityResolver.toolPolicy(server, 'read')).toEqual({
      allowed: true,
      source: 'mcp:search:allow',
    })
    expect(CapabilityResolver.toolPolicy(server, 'write')?.allowed).toBe(false)
    expect(CapabilityResolver.toolPolicy(server, 'danger')).toEqual({
      allowed: false,
      source: 'mcp:search:deny',
    })
  })
})
