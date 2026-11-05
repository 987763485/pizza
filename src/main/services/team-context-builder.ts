import type { Agent, AgentInstructionMode, Message, TeamDetail } from '@shared/types'

export interface TeamContextInput {
  team: TeamDetail
  participantAgents: Agent[]
  agent: Agent
  effectivePrompt: string
  messages: Message[]
  task: string
  callerAgentName: string | null
  workspacePath: string
  /** 'self' 表示指挥者再次发言，需要注入自上次发言以来的成员摘要。 */
  leaderUpdate: 'self' | null
  previousSerialResult?: string | null
  /** 编排器提供的参与者运行状态，用于避免指挥者重复派发。 */
  participantStatus?: Record<string, 'running' | 'queued'>
  /** 当前运行的指令来源；leader 表示角色由指挥者本轮动态下发。 */
  instructionMode?: AgentInstructionMode
  /** 模式二成员本轮收到的角色指令，通常是指挥者的分派消息。 */
  dispatchInstruction?: string | null
}

export interface TeamRunContext {
  systemPrompt: string
  prompt: string
}

function senderLabel(message: Message, agents: Agent[]): string {
  if (message.senderType === 'user') return '用户'
  if (message.senderType === 'system') return '系统'
  const agent = agents.find((item) => item.id === message.senderAgentId)
  return agent?.name ?? '智能体'
}

function extractArtifactPaths(messages: Message[]): string[] {
  const paths = new Set<string>()
  for (const message of messages) {
    const matches = message.content.match(/[^\s，。；;]+\.pizza\/artifacts\/[^\s，。；;]+/g)
    for (const match of matches ?? []) paths.add(match)
    for (const line of message.content.split('\n')) {
      if (line.includes('产出物') && line.trim()) paths.add(line.trim().slice(0, 300))
    }
  }
  return Array.from(paths).slice(-8)
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…`
}

/**
 * 确定性结构化压缩：不调用模型，保留原始任务、最近消息与产出物路径，
 * 截断中间旧正文。原始消息始终保留在数据库中。
 */
export function compactTranscript(messages: Message[], maxChars = 12_000): string {
  const blocks = messages.map((message) => ({
    message,
    text: `[${message.senderType === 'user' ? '用户' : message.senderType === 'system' ? '系统' : '智能体'}] ${message.content}`,
  }))
  const total = blocks.reduce((sum, block) => sum + block.text.length, 0)
  if (total <= maxChars) return blocks.map((block) => block.text).join('\n\n')

  const kept = new Map<number, string>()
  const firstUser = blocks.findIndex((block) => block.message.senderType === 'user')
  if (firstUser >= 0) kept.set(firstUser, truncate(blocks[firstUser].text, 1200))

  let budget = Math.max(400, maxChars - 1200)
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (kept.has(index)) continue
    const text = truncate(blocks[index].text, 900)
    if (text.length > budget && kept.size > 0) break
    kept.set(index, text)
    budget -= text.length
  }

  const omitted = blocks.length - kept.size
  const ordered = Array.from(kept.entries())
    .sort(([left], [right]) => left - right)
    .map(([, text]) => text)
  const artifacts = extractArtifactPaths(messages)
  const artifactBlock = artifacts.length
    ? `\n\n[产出物路径]\n${artifacts.map((path) => `- ${path}`).join('\n')}`
    : ''
  return `[系统] 上下文已压缩，省略 ${omitted} 条旧消息的正文。\n\n${ordered.join(
    '\n\n',
  )}${artifactBlock}`
}

function leaderUpdateText(messages: Message[], agents: Agent[]): string | null {
  let lastLeaderIndex = -1
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (
      message.senderType === 'agent' &&
      message.senderAgentId === agents[0]?.id &&
      message.content.trim()
    ) {
      lastLeaderIndex = index
      break
    }
  }
  const after = messages.slice(lastLeaderIndex + 1)
  const summaries = after
    .filter((message) => message.senderType === 'agent' && message.content.trim())
    .map(
      (message) =>
        `- ${senderLabel(message, agents)}：${truncate(message.content, 800)}`,
    )
  return summaries.length ? summaries.join('\n') : null
}

export function buildTeamRunContext(input: TeamContextInput): TeamRunContext {
  const isLeader = input.agent.id === input.team.leaderAgentId
  const dynamicInstruction =
    !isLeader && (input.instructionMode ?? 'self') === 'leader'
  const memberRole = new Map(
    input.team.members.map((member) => [member.agentId, member.role]),
  )
  // 参与者像 Skill 一样登记能力：名称 + 能力描述 + 本次团队职责 + 运行状态。
  const participantStatus = input.participantStatus ?? {}
  const members = input.participantAgents
    .map((agent) => {
      const status =
        agent.id === input.agent.id
          ? '当前运行'
          : participantStatus[agent.id] === 'running'
            ? '运行中'
            : participantStatus[agent.id] === 'queued'
              ? '排队中'
              : '空闲'
      const lines = [
        `- ${agent.name}（${agent.id === input.team.leaderAgentId ? '指挥者' : '成员'}，id=${agent.id}）`,
        `  能力：${agent.description?.trim() || '未填写能力描述'}`,
      ]
      const role = memberRole.get(agent.id)?.trim()
      if (role) lines.push(`  团队职责：${role}`)
      lines.push(
        `  指令来源：${
          agent.id !== input.team.leaderAgentId && agent.instructionMode === 'leader'
            ? '指挥者动态下发'
            : '自带 Prompt'
        }`,
      )
      lines.push(`  状态：${status}`)
      return lines.join('\n')
    })
    .join('\n')

  const protocol = isLeader
    ? `协作协议：
- 你是团队唯一的调度中枢。根据任务与参与者能力目录，像选择 Skill 一样，在能力匹配时精确提及成员。
- 每次 @ 成员只下发一个单轮任务，写清目标、输入与完成标准；成员完成后会把结果交回你。
- 对「指令来源：指挥者动态下发」的成员，本轮 @ 必须写清角色、职责边界、输出格式与完成标准。
- 精确提及语法：[@名称](mention://agent/<id>)。
- 能力不匹配时不要强行派发，也不要要求成员互相直连；所有汇总与后续推进由你负责。
- 需要用户拍板时，使用 [@我](mention://user) 并提出一个具体问题。
- 纯文本 @ 不会触发任何成员；必须使用上面的链接语法。
- 输出 Markdown；不要输出未经验证的结论。`
    : `协作协议：
- 你只完成本次分派给你的单轮任务，并把结果交回指挥者；不要调度其他成员，也不要做跨成员直连。
- 不能代替成员作答，也不要假设其他成员已经完成工作。
- 需要用户拍板时，使用 [@我](mention://user) 并提出一个具体问题。
- 纯文本 @ 不会触发任何成员；必须使用上面的链接语法。
- 输出 Markdown；不要输出未经验证的结论。`

  const systemPrompt = `${
    dynamicInstruction
      ? '你的角色由调用者在本次运行中动态下发，没有预设角色 Prompt。'
      : input.effectivePrompt
  }

你正在团队「${input.team.name}」中作为${isLeader ? '指挥者' : '成员'}运行。
参与者能力目录（名称、能力描述、团队职责、指令来源与运行状态）：
${members}

${protocol}
${isLeader && input.team.orchestrationPrompt ? `\n团队编排规则：\n${input.team.orchestrationPrompt}` : ''}`

  const update =
    input.leaderUpdate === 'self'
      ? leaderUpdateText(input.messages, [input.agent, ...input.participantAgents])
      : null

  const prompt = `${
    dynamicInstruction && input.dispatchInstruction
      ? `本轮角色指令：\n${input.dispatchInstruction}\n\n`
      : ''
  }当前任务：
${input.task}

${input.callerAgentName ? `调用者：${input.callerAgentName}` : '调用者：用户'}
工作区：${input.workspacePath}

${update ? `自你上次发言以来的成员摘要：\n${update}\n` : ''}
${input.previousSerialResult ? `前一个成员的结果（串行扇出）：\n${input.previousSerialResult}\n` : ''}
会话上下文：
${compactTranscript(input.messages)}`

  return { systemPrompt, prompt }
}
