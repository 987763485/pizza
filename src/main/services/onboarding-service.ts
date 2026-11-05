import { spawnSync } from 'node:child_process'
import type { RuntimeAdapterId, RuntimeDetection } from '@shared/types'
import type { SettingsService } from './settings-service'

interface DetectionPreset {
  adapter: RuntimeAdapterId
  name: string
  command: string
}

const PRESETS: DetectionPreset[] = [
  { adapter: 'claude-code', name: 'Claude Code', command: 'claude' },
  { adapter: 'codex', name: 'Codex', command: 'codex' },
  { adapter: 'pi', name: 'Pi', command: 'pi' },
  { adapter: 'omp', name: 'Oh My Pi', command: 'omp' },
  { adapter: 'dsh', name: 'DeepSeek Harness', command: 'dsh' },
  { adapter: 'hermes', name: 'Hermes', command: 'hermes' },
  { adapter: 'opencode', name: 'OpenCode', command: 'opencode' },
  { adapter: 'qoder-cn', name: 'Qoder CN', command: 'qoder-cn' },
  { adapter: 'gemini', name: 'Gemini CLI', command: 'gemini' },
  { adapter: 'kimi', name: 'Kimi Code', command: 'kimi' },
]

const LOGIN_HINT = /log ?in|login|unauthori[sz]ed|authentication|not signed in|api key/i

export type CommandRunner = (
  command: string,
  args: string[],
  timeoutMs: number,
) => { status: number | null; stdout: string; stderr: string }

const defaultRunner: CommandRunner = (command, args, timeoutMs) => {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: timeoutMs })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

/**
 * 首次启动的运行时探测。
 *
 * 只执行 `which`/`where` 和 `<command> --version`，不执行未知 shell 脚本；
 * 版本命令失败但路径存在时仍视为已安装，并把输出作为“需要登录/初始化”的提示。
 */
export class OnboardingService {
  constructor(
    private readonly settings: SettingsService,
    private readonly runner: CommandRunner = defaultRunner,
  ) {}

  status(): { completed: boolean; detections: RuntimeDetection[] } {
    return {
      completed: this.settings.get().onboardingCompleted,
      detections: this.detect(),
    }
  }

  detect(): RuntimeDetection[] {
    return PRESETS.map((preset) => this.detectOne(preset))
  }

  complete(): void {
    this.settings.update({ onboardingCompleted: true })
  }

  private detectOne(preset: DetectionPreset): RuntimeDetection {
    const locate = this.runner(
      process.platform === 'win32' ? 'where' : 'which',
      [preset.command],
      5_000,
    )
    const path = locate.status === 0 ? locate.stdout.split(/\r?\n/)[0]?.trim() || null : null
    if (!path) {
      return {
        adapter: preset.adapter,
        name: preset.name,
        command: preset.command,
        installed: false,
        version: null,
        needsLogin: false,
        path: null,
      }
    }

    const version = this.runner(preset.command, ['--version'], 5_000)
    const output = `${version.stdout}\n${version.stderr}`.trim()
    const firstLine = output.split(/\r?\n/)[0]?.trim() ?? ''
    return {
      adapter: preset.adapter,
      name: preset.name,
      command: preset.command,
      installed: true,
      version: firstLine.slice(0, 200) || null,
      needsLogin: version.status !== 0 || LOGIN_HINT.test(output),
      path,
    }
  }
}
