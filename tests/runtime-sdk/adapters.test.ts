import { describe, expect, it } from 'vitest'
import { KimiAdapter, PiJsonAdapter, PlainCliAdapter, type RuntimeSpec } from '@runtime-sdk'
import { buildClaudePromptArgs } from '../../packages/runtime-sdk/src/adapters/claude-cli'

function spec(family: RuntimeSpec['family'], command: string): RuntimeSpec {
  return { kind: family, family, command, args: [], env: {} }
}

describe('adapter startup diagnostics', () => {
  it('reports a missing executable for Pi without hanging', async () => {
    const result = await new PiJsonAdapter().test(
      spec('pi-json', '/definitely/not/a/runtime'),
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.steps.some((step) => step.status === 'failed')).toBe(true)
  })

  it('reports a missing executable for the Kimi adapter', async () => {
    const result = await new KimiAdapter().test(
      spec('kimi', '/definitely/not/a/runtime'),
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('reports a missing executable for the generic CLI adapter', async () => {
    const result = await new PlainCliAdapter().test(
      spec('plain-cli', '/definitely/not/a/runtime'),
      new AbortController().signal,
    )
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('probes a working generic CLI', async () => {
    const result = await new PlainCliAdapter().test(
      spec('plain-cli', process.execPath),
      new AbortController().signal,
    )
    expect(result.ok).toBe(true)
    expect(result.capabilities?.protocolVersion).toBe('plain-cli')
  })

  it('uses Qoder-compatible flags for the shared Claude protocol', () => {
    const request = {
      prompt: 'hello',
      systemPrompt: '',
      sessionId: '11111111-1111-4111-8111-111111111111',
      runtimeSessionId: null,
      model: null,
      thinkingLevel: 'high',
      attachmentPaths: [],
    }
    const qoderArgs = buildClaudePromptArgs('qoder-cn', request)
    expect(qoderArgs).not.toContain('--verbose')
    expect(qoderArgs).toContain('--reasoning-effort')
    expect(qoderArgs).not.toContain('--effort')

    const claudeArgs = buildClaudePromptArgs('claude-code', request)
    expect(claudeArgs).toContain('--verbose')
    expect(claudeArgs).toContain('--effort')
  })
})
