import { describe, expect, it } from 'vitest'
import {
  assertTeamTurnTransition,
  canTransitionTeamTurn,
} from '../../src/shared/team-state'
import {
  detectAba,
  evaluateLimits,
  isSimilarInvocation,
} from '../../src/main/services/team-protections'

describe('team turn state machine', () => {
  it('allows the documented happy path', () => {
    expect(canTransitionTeamTurn('dispatching', 'debating')).toBe(true)
    expect(canTransitionTeamTurn('debating', 'waiting_user')).toBe(true)
    expect(canTransitionTeamTurn('waiting_user', 'debating')).toBe(true)
    expect(canTransitionTeamTurn('debating', 'converging')).toBe(true)
    expect(canTransitionTeamTurn('converging', 'completed')).toBe(true)
  })

  it('rejects transitions out of terminal states', () => {
    expect(canTransitionTeamTurn('completed', 'debating')).toBe(false)
    expect(() => assertTeamTurnTransition('completed', 'debating')).toThrow(
      'TEAM_TURN_TRANSITION_INVALID',
    )
    expect(canTransitionTeamTurn('cancelled', 'converging')).toBe(false)
    expect(canTransitionTeamTurn('interrupted', 'dispatching')).toBe(false)
  })

  it('allows cancellation and failure from every non-terminal state', () => {
    for (const status of ['dispatching', 'debating', 'waiting_user', 'converging'] as const) {
      expect(canTransitionTeamTurn(status, 'failed')).toBe(true)
      expect(canTransitionTeamTurn(status, 'cancelled')).toBe(true)
      expect(canTransitionTeamTurn(status, 'interrupted')).toBe(true)
    }
  })
})

describe('team protections', () => {
  it('stops on the hop limit but not on leader cycles', () => {
    expect(
      evaluateLimits({ hops: 64, maxHops: 64, tokens: 0, tokenBudget: 0 }).action,
    ).toBe('stop')
    expect(
      evaluateLimits({ hops: 63, maxHops: 64, tokens: 0, tokenBudget: 0 }).action,
    ).toBe('continue')
  })

  it('warns at 80% of a token budget and stops at 100%', () => {
    expect(
      evaluateLimits({ hops: 1, maxHops: 64, tokens: 80, tokenBudget: 100 }).action,
    ).toBe('warn')
    expect(
      evaluateLimits({ hops: 1, maxHops: 64, tokens: 120, tokenBudget: 100 }).action,
    ).toBe('stop')
  })

  it('suppresses highly similar repeated invocations', () => {
    expect(isSimilarInvocation('请评估数据迁移风险', '请评估数据迁移风险')).toBe(true)
    expect(isSimilarInvocation('请评估数据迁移风险与回滚方案', '请评估数据迁移风险')).toBe(true)
    expect(isSimilarInvocation('评估数据迁移风险', '检查界面配色细节')).toBe(false)
  })

  it('detects three alternating A-B-A exchanges', () => {
    expect(
      detectAba([
        { from: 'a', to: 'b' },
        { from: 'b', to: 'a' },
        { from: 'a', to: 'b' },
      ]),
    ).toBe(true)
    expect(
      detectAba([
        { from: 'a', to: 'b' },
        { from: 'b', to: 'c' },
        { from: 'c', to: 'a' },
      ]),
    ).toBe(false)
  })
})
