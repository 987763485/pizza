import type { TeamTurnStatus } from './types'

const TERMINAL = new Set<TeamTurnStatus>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
])

const TRANSITIONS: Record<TeamTurnStatus, TeamTurnStatus[]> = {
  dispatching: ['debating', 'waiting_user', 'converging', 'failed', 'cancelled', 'interrupted'],
  debating: [
    'dispatching',
    'waiting_user',
    'converging',
    'completed',
    'failed',
    'cancelled',
    'interrupted',
  ],
  waiting_user: ['debating', 'converging', 'completed', 'failed', 'cancelled', 'interrupted'],
  converging: ['completed', 'failed', 'cancelled', 'interrupted'],
  completed: [],
  failed: [],
  cancelled: [],
  interrupted: [],
}

/** 团队回合的非法状态转换必须被拒绝，避免并发回调把终态改回运行中。 */
export function canTransitionTeamTurn(from: TeamTurnStatus, to: TeamTurnStatus): boolean {
  if (from === to) return true
  if (TERMINAL.has(from)) return false
  return TRANSITIONS[from].includes(to)
}

export function assertTeamTurnTransition(from: TeamTurnStatus, to: TeamTurnStatus): void {
  if (!canTransitionTeamTurn(from, to)) {
    throw new Error(`TEAM_TURN_TRANSITION_INVALID:${from}->${to}`)
  }
}
