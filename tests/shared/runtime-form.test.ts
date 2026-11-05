import { describe, expect, it } from 'vitest'
import { EMPTY_RUNTIME_FORM, seedRuntimeForm } from '../../src/renderer/src/runtime-form'

describe('runtime form seeding', () => {
  it('prefills the detected adapter with its command and arguments', () => {
    const form = seedRuntimeForm('hermes', '/opt/homebrew/bin/hermes')
    expect(form).toMatchObject({
      name: 'Hermes',
      adapter: 'hermes',
      protocol: 'ACP',
      transport: 'stdio',
      command: '/opt/homebrew/bin/hermes',
      argsText: 'acp',
    })
  })

  it('falls back to the preset command when detection has no path', () => {
    expect(seedRuntimeForm('claude-code', null)).toMatchObject({
      adapter: 'claude-code',
      command: 'claude',
      argsText: '',
    })
  })

  it('seeds DSH with its ACP profile and Codex with app-server arguments', () => {
    expect(seedRuntimeForm('dsh', '/usr/local/bin/dsh')).toMatchObject({
      protocol: 'ACP',
      command: '/usr/local/bin/dsh',
      argsText: '--profile\nacp',
    })
    expect(seedRuntimeForm('codex', null)).toMatchObject({
      protocol: 'CLI',
      argsText: 'app-server\n--listen\nstdio://',
    })
  })

  it('ignores unknown adapters', () => {
    expect(seedRuntimeForm('unknown', '/tmp/x')).toEqual(EMPTY_RUNTIME_FORM)
  })
})
