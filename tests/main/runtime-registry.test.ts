import { describe, expect, it } from 'vitest'
import type { RuntimeAdapterId, RuntimeConfig } from '../../src/shared/types'
import {
  getRuntimeAdapter,
  runtimeFamily,
  toRuntimeSpec,
} from '../../src/main/runtime/registry'

function config(
  adapter: RuntimeAdapterId,
  overrides: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    id: `runtime-${adapter}`,
    name: adapter,
    adapter,
    protocol: adapter === 'acp' || adapter === 'hermes' ? 'ACP' : 'CLI',
    transport: 'stdio',
    command: adapter,
    args: [],
    env: {},
    timeoutMs: 30_000,
    autoReconnect: true,
    status: 'draft',
    capabilities: {},
    createdAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('runtime protocol-family registry', () => {
  it('resolves every built-in runtime to an adapter without throwing', () => {
    const adapters: RuntimeAdapterId[] = [
      'claude-code',
      'acp',
      'codex',
      'pi',
      'omp',
      'dsh',
      'hermes',
      'opencode',
      'qoder-cn',
      'gemini',
      'kimi',
      'custom',
    ]
    for (const adapter of adapters) {
      const resolved = getRuntimeAdapter(config(adapter))
      expect(resolved.profile.family).toBeTruthy()
    }
  })

  it('maps runtime identities to the intended protocol family', () => {
    expect(runtimeFamily(config('claude-code'))).toBe('claude-cli')
    expect(runtimeFamily(config('acp'))).toBe('acp')
    expect(runtimeFamily(config('hermes'))).toBe('acp')
    expect(runtimeFamily(config('opencode'))).toBe('acp')
    expect(runtimeFamily(config('gemini'))).toBe('acp')
    expect(runtimeFamily(config('qoder-cn'))).toBe('claude-cli')
    expect(runtimeFamily(config('kimi'))).toBe('kimi')
    expect(runtimeFamily(config('pi'))).toBe('pi-json')
    expect(runtimeFamily(config('omp'))).toBe('pi-json')
    expect(runtimeFamily(config('codex'))).toBe('codex-app-server')
    // 官方 DSH 的 acp profile 走 ACP；自定义 JSONL profile 才走原生协议族。
    expect(runtimeFamily(config('dsh', { protocol: 'ACP' }))).toBe('acp')
    expect(runtimeFamily(config('dsh', { protocol: 'CLI' }))).toBe('dsh')
    expect(runtimeFamily(config('custom'))).toBe('plain-cli')
    expect(runtimeFamily(config('custom', { protocol: 'ACP' }))).toBe('acp')
  })

  it('carries command, args, env and session directory into the spec', () => {
    const spec = toRuntimeSpec(
      config('pi', {
        command: '/usr/local/bin/pi',
        args: ['--verbose'],
        env: { TOKEN: 'x' },
        cwd: '/tmp/work',
      }),
      '/tmp/sessions',
    )
    expect(spec).toMatchObject({
      kind: 'pi',
      family: 'pi-json',
      command: '/usr/local/bin/pi',
      args: ['--verbose'],
      env: { TOKEN: 'x' },
      cwd: '/tmp/work',
      sessionDir: '/tmp/sessions',
    })
  })
})
