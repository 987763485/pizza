import { describe, expect, it, vi } from 'vitest'
import { JobCancelledError } from '@runtime-sdk'
import { AgentConcurrencyGate } from '../../src/main/services/agent-concurrency-gate'

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('AgentConcurrencyGate', () => {
  it('queues runs beyond the same agent limit and admits them in order', async () => {
    const gate = new AgentConcurrencyGate()
    const onQueued = vi.fn()

    const releaseFirst = await gate.acquire({ agentId: 'a', runId: 'r1', limit: 1 })
    let secondGranted = false
    const second = gate
      .acquire({ agentId: 'a', runId: 'r2', limit: 1, onQueued })
      .then((release) => {
        secondGranted = true
        return release
      })

    expect(onQueued).toHaveBeenCalledOnce()
    await tick()
    expect(secondGranted).toBe(false)

    releaseFirst()
    const releaseSecond = await second
    expect(secondGranted).toBe(true)
    releaseSecond()
  })

  it('does not block different agents and releases slots idempotently', async () => {
    const gate = new AgentConcurrencyGate()
    const releaseA = await gate.acquire({ agentId: 'a', runId: 'r1', limit: 1 })
    const releaseB = await gate.acquire({ agentId: 'b', runId: 'r2', limit: 1 })

    releaseA()
    releaseA()
    const releaseA2 = await gate.acquire({ agentId: 'a', runId: 'r3', limit: 1 })
    expect(releaseA2).toBeTypeOf('function')
    releaseA2()
    releaseB()
  })

  it('rejects a queued run when its signal aborts and frees the slot', async () => {
    const gate = new AgentConcurrencyGate()
    const controller = new AbortController()
    const releaseFirst = await gate.acquire({ agentId: 'a', runId: 'r1', limit: 1 })
    const queued = gate.acquire({
      agentId: 'a',
      runId: 'r2',
      limit: 1,
      signal: controller.signal,
    })

    controller.abort()
    await expect(queued).rejects.toBeInstanceOf(JobCancelledError)

    releaseFirst()
    const releaseNext = await gate.acquire({ agentId: 'a', runId: 'r3', limit: 1 })
    releaseNext()
  })
})
