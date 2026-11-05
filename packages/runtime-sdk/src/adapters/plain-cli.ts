import {
  collectStderr,
  spawnRuntime,
  stripAnsi,
  terminateProcessTree,
  waitForExit,
  waitForSpawn,
} from '../process'
import type {
  AdapterProfile,
  RuntimeAdapter,
  RuntimeModelCatalog,
  RuntimePromptRequest,
  RuntimePromptResult,
  RuntimeSession,
  RuntimeSpec,
  TestResult,
  TestStep,
} from '../types'

export const PLAIN_CLI_PROFILE: AdapterProfile = {
  family: 'plain-cli',
  lifecycle: 'per-turn',
  supportsResume: false,
  supportsMidturnDelivery: false,
  startupCostMs: 2_000,
  startupTimeoutMs: 20_000,
  maxSessionsPerProcess: 1,
}

/**
 * 通用 CLI 兜底适配器。
 *
 * 不做任何协议假设：把提示词写到 stdin，把 stdout 当作纯文本增量。
 * 适合没有结构化事件流、但可以一次性接收提示词并打印结果的命令行工具。
 * 需要结构化能力的运行时仍应选择对应的协议族。
 */
export class PlainCliAdapter implements RuntimeAdapter {
  readonly profile = PLAIN_CLI_PROFILE

  async test(spec: RuntimeSpec, signal: AbortSignal): Promise<TestResult> {
    const steps: TestStep[] = [
      { key: 'start', label: '启动进程', status: 'pending' },
      { key: 'version', label: '版本探测', status: 'pending' },
      { key: 'cleanup', label: '清理临时资源', status: 'pending' },
    ]
    const fail = (key: string, error: string): TestResult => {
      const index = steps.findIndex((step) => step.key === key)
      steps[index] = { ...steps[index], status: 'failed', detail: error }
      return { ok: false, steps, error }
    }
    if (!spec.command) return fail('start', '未配置启动命令')

    steps[0].status = 'running'
    const version = await this.runVersion(spec, signal)
    if (version.code !== 0 && !version.stdout.trim()) {
      return fail('start', stripAnsi(version.stderr).slice(-600) || '无法启动命令')
    }
    steps[0].status = 'ok'
    steps[1] = {
      ...steps[1],
      status: 'ok',
      detail:
        stripAnsi(`${version.stdout}\n${version.stderr}`).trim().split('\n')[0] ||
        '命令可用',
    }
    steps[2].status = 'ok'

    return {
      ok: true,
      steps,
      capabilities: {
        protocolVersion: 'plain-cli',
        streaming: true,
        appendInput: false,
        mcp: false,
        skills: false,
        thinking: false,
      },
    }
  }

  async listModels(): Promise<RuntimeModelCatalog> {
    // 纯文本 CLI 没有可查询的模型目录；界面回退到手动填写。
    return { models: [] }
  }

  async openSession(spec: RuntimeSpec): Promise<RuntimeSession> {
    let child: ReturnType<typeof spawnRuntime> | null = null

    return {
      prompt: async (request: RuntimePromptRequest): Promise<RuntimePromptResult> => {
        const proc = spawnRuntime(spec, { cwd: request.cwd })
        child = proc
        void waitForSpawn(proc).catch(() => undefined)

        const stderrTail = collectStderr(proc)
        let spawnError: string | null = null
        proc.once('error', (error) => {
          spawnError = error.message
        })
        let text = ''
        let cancelled = false

        const onData = (chunk: Buffer) => {
          const delta = stripAnsi(chunk.toString('utf8'))
          if (!delta) return
          text += delta
          request.onEvent({ type: 'text_delta', payload: { text: delta } })
        }
        proc.stdout.on('data', onData)

        const abort = () => {
          cancelled = true
          terminateProcessTree(proc, 1500)
        }
        request.signal.addEventListener('abort', abort, { once: true })

        const prefix = [request.systemPrompt, request.capabilities?.skillManifest ?? '']
          .filter(Boolean)
          .join('\n\n')
        proc.stdin.end(prefix ? `${prefix}\n\n${request.prompt}` : request.prompt)

        const code = await waitForExit(proc)
        proc.stdout.off('data', onData)
        request.signal.removeEventListener('abort', abort)
        child = null

        if (cancelled) {
          request.onEvent({ type: 'cancelled', payload: { reason: '用户停止' } })
          throw new Error('运行已取消')
        }
        if (spawnError || code !== 0) {
          const error =
            spawnError || stripAnsi(stderrTail()).slice(-1000) || `进程退出码 ${code}`
          request.onEvent({ type: 'failed', payload: { error } })
          throw new Error(error)
        }
        request.onEvent({ type: 'completed', payload: {} })
        return { text, runtimeSessionId: null, tokensIn: 0, tokensOut: 0, cost: 0 }
      },

      cancel: () => {
        if (child) terminateProcessTree(child, 1500)
      },

      close: () => {
        if (child) terminateProcessTree(child, 500)
        child = null
      },
    }
  }

  private async runVersion(
    spec: RuntimeSpec,
    signal: AbortSignal,
  ): Promise<{ code: number | null; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      let child: ReturnType<typeof spawnRuntime>
      try {
        child = spawnRuntime(spec, { args: ['--version'] })
      } catch (error) {
        resolve({
          code: null,
          stdout: '',
          stderr: error instanceof Error ? error.message : String(error),
        })
        return
      }
      let stdout = ''
      let stderr = ''
      let settled = false
      const finish = (code: number | null) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        resolve({ code, stdout, stderr })
      }
      const timer = setTimeout(() => {
        terminateProcessTree(child, 1000)
        finish(null)
      }, 10_000)
      timer.unref?.()
      const abort = () => {
        terminateProcessTree(child, 1000)
        finish(null)
      }
      signal.addEventListener('abort', abort, { once: true })
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8')
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString('utf8')
      })
      child.once('error', (error) => {
        stderr += error.message
        finish(null)
      })
      child.once('close', (code) => finish(code))
    })
  }
}
