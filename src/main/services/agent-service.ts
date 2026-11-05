import { randomUUID } from 'node:crypto'
import type { Agent, AgentInput, AgentTestResult } from '@shared/types'
import { DEFAULT_AGENT_PROMPT } from '@shared/agent-defaults'
import { makeAvatar } from '../avatar'
import type { Store } from '../db/store'
import { getRuntimeAdapter, toRuntimeSpec } from '../runtime/registry'
import type { RuntimeService } from './runtime-service'

function assertPromptForMode(input: AgentInput): void {
  if ((input.instructionMode ?? 'self') === 'self' && !input.prompt.trim()) {
    throw new Error('AGENT_PROMPT_REQUIRED')
  }
}

function normalize(input: AgentInput): AgentInput {
  return {
    ...input,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    avatar: input.avatar || makeAvatar(input.name.trim()),
    prompt: input.prompt.trim(),
    instructionMode: input.instructionMode ?? 'self',
    thinkingLevel: input.thinkingLevel ?? 'medium',
    contextLimit: input.contextLimit ?? 200_000,
    model: input.model?.trim() || null,
    maxConcurrency: Math.min(10, Math.max(1, Math.trunc(input.maxConcurrency ?? 3))),
  }
}

export class AgentService {
  constructor(
    private readonly store: Store,
    private readonly runtimeService: RuntimeService,
  ) {}

  list(): Agent[] {
    return this.store.listAgents()
  }

  get(id: string): Agent | null {
    return this.store.getAgent(id)
  }

  create(input: AgentInput): Agent {
    const runtime = this.store.getRuntime(input.runtimeId)
    if (!runtime) throw new Error('RUNTIME_NOT_FOUND')
    if (runtime.status !== 'online') throw new Error('RUNTIME_NOT_READY')
    assertPromptForMode(input)
    return this.store.createAgent(normalize(input))
  }

  update(id: string, input: AgentInput): Agent {
    const existing = this.store.getAgent(id)
    if (!existing) throw new Error('AGENT_NOT_FOUND')
    const runtime = this.store.getRuntime(input.runtimeId)
    if (!runtime) throw new Error('RUNTIME_NOT_FOUND')
    if (runtime.status !== 'online') throw new Error('RUNTIME_NOT_READY')
    assertPromptForMode(input)
    return this.store.updateAgent(id, normalize(input))
  }

  duplicate(id: string): Agent {
    return this.store.duplicateAgent(id)
  }

  archive(id: string, archived: boolean): Agent {
    return this.store.archiveAgent(id, archived)
  }

  remove(id: string): void {
    if (this.store.countActiveSessionsForAgent(id) > 0) {
      throw new Error('AGENT_IN_USE')
    }
    this.store.deleteAgent(id)
  }

  async test(id: string): Promise<AgentTestResult> {
    const agent = this.store.getAgent(id)
    if (!agent) throw new Error('AGENT_NOT_FOUND')
    const runtime = this.runtimeService.getForRun(agent.runtimeId)
    if (runtime.status !== 'online') throw new Error('RUNTIME_OFFLINE')
    const workspace =
      this.store.listWorkspaces().find((item) => item.isDefault) ??
      this.store.listWorkspaces()[0]
    if (!workspace) throw new Error('WORKSPACE_NOT_FOUND')

    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 90_000)
    let text = ''
    try {
      const adapter = getRuntimeAdapter(runtime)
      const session = await adapter.openSession(toRuntimeSpec(runtime))
      const result = await session.prompt({
        prompt: '请用一句话确认你已经准备好接收任务，不要使用工具。',
        systemPrompt: agent.prompt || DEFAULT_AGENT_PROMPT,
        sessionId: randomUUID(),
        runtimeSessionId: null,
        cwd: workspace.rootPath,
        model: agent.model,
        thinkingLevel: agent.thinkingLevel,
        attachmentPaths: [],
        signal: controller.signal,
        onEvent: (event) => {
          if (event.type === 'text_delta') text += String(event.payload.text ?? '')
        },
      })
      session.close()
      return {
        ok: true,
        text: text || result.text,
        runtimeName: runtime.name,
        durationMs: Date.now() - started,
      }
    } catch (error) {
      return {
        ok: false,
        text,
        runtimeName: runtime.name,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
    } finally {
      clearTimeout(timer)
    }
  }
}
