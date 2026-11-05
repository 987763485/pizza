import { afterEach, describe, expect, it } from 'vitest'
import {
  JobCancelledError,
  QueueFullError,
  RuntimeSupervisor,
  type AdapterProfile,
  type RuntimeAdapter,
  type RuntimePromptRequest,
  type RuntimePromptResult,
  type RuntimeSession,
  type RuntimeSpec,
} from '@runtime-sdk'

const spec: RuntimeSpec = {
  kind: 'test',
  family: 'plain-cli',
  command: 'fake',
  args: [],
  env: {},
}

function profile(overrides: Partial<AdapterProfile> = {}): AdapterProfile {
  return {
    family: 'plain-cli',
    lifecycle: 'persistent',
    supportsResume: false,
    supportsMidturnDelivery: false,
    startupCostMs: 1,
    startupTimeoutMs: 5_000,
    maxSessionsPerProcess: 1,
    ...overrides,
  }
}

interface FakeOptions {
  profile?: Partial<AdapterProfile>
  openDelayMs?: number
  prompt?: (request: RuntimePromptRequest, session: FakeSession) => Promise<RuntimePromptResult>
}

class FakeSession implements RuntimeSession {
  closed = false
  cancelled = false
  constructor(
    readonly adapter: FakeAdapter,
    readonly id: number,
  ) {}

  async prompt(request: RuntimePromptRequest): Promise<RuntimePromptResult> {
    this.adapter.prompts.push(request.prompt)
    this.adapter.activePrompts += 1
    this.adapter.maxActivePrompts = Math.max(
      this.adapter.maxActivePrompts,
      this.adapter.activePrompts,
    )
    try {
      return await this.adapter.promptImpl(request, this)
    } finally {
      this.adapter.activePrompts -= 1
    }
  }

  cancel(): void {
    this.cancelled = true
  }

  close(): void {
    this.closed = true
    this.adapter.closedSessions.push(this)
  }

  alive(): boolean {
    return !this.closed
  }
}

class FakeAdapter implements RuntimeAdapter {
  readonly profile: AdapterProfile
  readonly sessions: FakeSession[] = []
  readonly closedSessions: FakeSession[] = []
  readonly prompts: string[] = []
  openSessions = 0
  activeOpens = 0
  maxActiveOpens = 0
  activePrompts = 0
  maxActivePrompts = 0
  promptImpl: (
    request: RuntimePromptRequest,
    session: FakeSession,
  ) => Promise<RuntimePromptResult>

  constructor(private readonly options: FakeOptions = {}) {
    this.profile = profile(options.profile)
    this.promptImpl =
      options.prompt ??
      (async () => ({
        text: 'ok',
        runtimeSessionId: null,
        tokensIn: 1,
        tokensOut: 2,
        cost: 0,
      }))
  }

  async test(): Promise<{ ok: boolean; steps: [] }> {
    return { ok: true, steps: [] }
  }

  async openSession(): Promise<RuntimeSession> {
    this.openSessions += 1
    this.activeOpens += 1
    this.maxActiveOpens = Math.max(this.maxActiveOpens, this.activeOpens)
    try {
      if (this.options.openDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, this.options.openDelayMs))
      }
      const session = new FakeSession(this, this.openSessions)
      this.sessions.push(session)
      return session
    } finally {
      this.activeOpens -= 1
    }
  }
}

function supervisorFor(
  adapter: FakeAdapter,
  options: ConstructorParameters<typeof RuntimeSupervisor>[1] = {},
): RuntimeSupervisor {
  return new RuntimeSupervisor(new Map([['plain-cli', adapter]]), {
    idleSweepMs: 10,
    ...options,
  })
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const supervisors: RuntimeSupervisor[] = []
afterEach(() => {
  for (const supervisor of supervisors.splice(0)) supervisor.dispose()
})

function make(adapter: FakeAdapter, options?: Parameters<typeof supervisorFor>[1]) {
  const supervisor = supervisorFor(adapter, options)
  supervisors.push(supervisor)
  return supervisor
}

describe('RuntimeSupervisor', () => {
  it('reuses one persistent session across turns', async () => {
    const adapter = new FakeAdapter()
    const supervisor = make(adapter)
    await supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    await supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    expect(adapter.openSessions).toBe(1)
    expect(adapter.prompts).toEqual(['first', 'second'])
  })

  it('opens a fresh session for per-turn adapters', async () => {
    const adapter = new FakeAdapter({ profile: { lifecycle: 'per-turn' } })
    const supervisor = make(adapter)
    await supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    await supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    expect(adapter.openSessions).toBe(2)
    expect(adapter.closedSessions).toHaveLength(2)
  })

  it('runs one turn at a time per session and preserves FIFO order', async () => {
    let releaseFirst: (() => void) | null = null
    const adapter = new FakeAdapter({
      prompt: async (req) => {
        if (req.prompt === 'first') {
          await new Promise<void>((resolve) => {
            releaseFirst = resolve
          })
        }
        return { text: req.prompt, runtimeSessionId: null, tokensIn: 0, tokensOut: 0, cost: 0 }
      },
    })
    const supervisor = make(adapter)
    const first = supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    const second = supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    await sleep(20)
    expect(adapter.maxActivePrompts).toBe(1)
    expect(adapter.prompts).toEqual(['first'])
    releaseFirst?.()
    await Promise.all([first, second])
    expect(adapter.prompts).toEqual(['first', 'second'])
  })

  it('rejects work beyond the per-session queue limit', async () => {
    const adapter = new FakeAdapter({
      prompt: async () => {
        await sleep(50)
        return { text: '', runtimeSessionId: null, tokensIn: 0, tokensOut: 0, cost: 0 }
      },
    })
    const supervisor = make(adapter, { maxQueuePerSession: 1 })
    const first = supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    const second = supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    await expect(
      supervisor.run('s1', spec, {
        id: '3',
        run: (session) => session.prompt(request('third')),
      }),
    ).rejects.toBeInstanceOf(QueueFullError)
    await Promise.all([first, second])
  })

  it('bounds simultaneous cold starts', async () => {
    const adapter = new FakeAdapter({ openDelayMs: 30 })
    const supervisor = make(adapter, { maxConcurrentStarts: 2, maxWarmSessions: 8 })
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((key) =>
        supervisor.run(key, spec, {
          id: key,
          run: (session) => session.prompt(request(key)),
        }),
      ),
    )
    expect(adapter.maxActiveOpens).toBeLessThanOrEqual(2)
    expect(adapter.openSessions).toBe(4)
  })

  it('bounds simultaneous turns globally', async () => {
    const adapter = new FakeAdapter({
      prompt: async () => {
        await sleep(20)
        return { text: '', runtimeSessionId: null, tokensIn: 0, tokensOut: 0, cost: 0 }
      },
    })
    const supervisor = make(adapter, {
      maxConcurrentTurns: 2,
      maxWarmSessions: 8,
      maxConcurrentStarts: 8,
    })
    await Promise.all(
      ['a', 'b', 'c', 'd'].map((key) =>
        supervisor.run(key, spec, {
          id: key,
          run: (session) => session.prompt(request(key)),
        }),
      ),
    )
    expect(adapter.maxActivePrompts).toBeLessThanOrEqual(2)
  })

  it('cancels a queued job without running it', async () => {
    const adapter = new FakeAdapter({
      prompt: async () => {
        await sleep(40)
        return { text: '', runtimeSessionId: null, tokensIn: 0, tokensOut: 0, cost: 0 }
      },
    })
    const supervisor = make(adapter)
    const first = supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    const queued = supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    await sleep(10)
    expect(supervisor.cancelJob('s1', '2')).toBe(true)
    await expect(queued).rejects.toBeInstanceOf(JobCancelledError)
    await first
    expect(adapter.prompts).toEqual(['first'])
  })

  it('evicts an idle persistent session and rebuilds it on demand', async () => {
    const adapter = new FakeAdapter()
    const supervisor = make(adapter, { idleTimeoutMs: 20, idleSweepMs: 5 })
    await supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    expect(adapter.openSessions).toBe(1)
    await sleep(80)
    expect(adapter.closedSessions).toHaveLength(1)
    expect(supervisor.snapshot().warm).toBe(0)

    await supervisor.run('s1', spec, {
      id: '2',
      run: (session) => session.prompt(request('second')),
    })
    expect(adapter.openSessions).toBe(2)
  })

  it('uses LRU eviction when the warm budget is full', async () => {
    const adapter = new FakeAdapter()
    const supervisor = make(adapter, { maxWarmSessions: 1 })
    await supervisor.run('a', spec, {
      id: 'a1',
      run: (session) => session.prompt(request('a1')),
    })
    await supervisor.run('b', spec, {
      id: 'b1',
      run: (session) => session.prompt(request('b1')),
    })
    expect(adapter.openSessions).toBe(2)
    expect(adapter.sessions[0].closed).toBe(true)
    expect(adapter.sessions[1].closed).toBe(false)
    expect(supervisor.snapshot().warm).toBe(1)
  })

  it('does not evict a leased session', async () => {
    const adapter = new FakeAdapter()
    const supervisor = make(adapter, { idleTimeoutMs: 20, idleSweepMs: 5 })
    await supervisor.run('s1', spec, {
      id: '1',
      run: (session) => session.prompt(request('first')),
    })
    supervisor.lease('s1', 5_000)
    await sleep(80)
    expect(adapter.closedSessions).toHaveLength(0)
    expect(supervisor.snapshot().warm).toBe(1)
  })
})

function request(prompt: string): RuntimePromptRequest {
  return {
    prompt,
    systemPrompt: '',
    sessionId: 'local',
    runtimeSessionId: null,
    cwd: process.cwd(),
    attachmentPaths: [],
    signal: new AbortController().signal,
    onEvent: () => undefined,
  }
}
