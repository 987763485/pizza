export interface LimitInput {
  hops: number
  maxHops: number
  tokens: number
  tokenBudget: number
}

export interface LimitDecision {
  action: 'continue' | 'warn' | 'stop'
  reasons: string[]
}

/**
 * 团队保护只使用确定性计数与阈值，不调用模型判断。
 * tokenBudget=0 表示不限；80% 提醒，100% 停止新调度。
 */
export function evaluateLimits(input: LimitInput): LimitDecision {
  const reasons: string[] = []
  let action: LimitDecision['action'] = 'continue'

  if (input.maxHops > 0 && input.hops >= input.maxHops) {
    reasons.push('hop_limit')
    action = 'stop'
  }
  if (input.tokenBudget > 0) {
    if (input.tokens >= input.tokenBudget) {
      reasons.push('token_budget_exhausted')
      action = 'stop'
    } else if (input.tokens >= input.tokenBudget * 0.8) {
      reasons.push('token_budget_warning')
      if (action === 'continue') action = 'warn'
    }
  }

  return { action, reasons }
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}

function bigrams(text: string): Set<string> {
  const result = new Set<string>()
  for (let i = 0; i < text.length - 1; i += 1) result.add(text.slice(i, i + 2))
  return result
}

/** 归一化后包含，或字符二元组 Jaccard ≥ 0.7，视为高度相似。 */
export function isSimilarInvocation(left: string, right: string): boolean {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return false
  if (a === b) return true
  const shorter = a.length < b.length ? a : b
  const longer = a.length < b.length ? b : a
  if (shorter.length >= 6 && longer.includes(shorter)) return true
  const setA = bigrams(a)
  const setB = bigrams(b)
  if (setA.size === 0 || setB.size === 0) return false
  let intersection = 0
  for (const item of setA) if (setB.has(item)) intersection += 1
  const union = setA.size + setB.size - intersection
  return union > 0 && intersection / union >= 0.7
}

export interface InteractionEdge {
  from: string
  to: string
}

/** A→B、B→A、A→B 连续出现时提示收敛，避免两名成员无新信息地互相唤醒。 */
export function detectAba(edges: InteractionEdge[]): boolean {
  const recent = edges.slice(-3)
  if (recent.length < 3) return false
  if (recent[0].from === recent[0].to) return false
  return (
    recent[0].from === recent[2].from &&
    recent[0].to === recent[2].to &&
    recent[1].from === recent[0].to &&
    recent[1].to === recent[0].from
  )
}
