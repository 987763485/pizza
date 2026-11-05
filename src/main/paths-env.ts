import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

function versionBins(root: string, suffix: string[]): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }))
      .flatMap((name) => suffix.map((part) => join(root, name, part)))
  } catch {
    return []
  }
}

/**
 * macOS 从 Finder / Dock 启动的图形应用只继承一个很小的 PATH，
 * 看不到 Homebrew、nvm、bun、pnpm 等目录里的 CLI。
 * 这里补上常见安装位置，让运行时探测与运行时进程都能找到命令。
 */
export function collectExecutableDirs(
  home = homedir(),
  platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const candidates: string[] = []

  if (platform === 'win32') {
    const appData = env.APPDATA ?? join(home, 'AppData', 'Roaming')
    const localAppData = env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
    candidates.push(
      join(appData, 'npm'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, 'scoop', 'shims'),
      join(localAppData, 'Microsoft', 'WinGet', 'Links'),
      join(home, '.opencode', 'bin'),
      join(home, '.qoder-cn', 'entry'),
      join(home, '.qoder', 'entry'),
      join(home, '.kimi-code', 'bin'),
      join(home, '.kimi', 'bin'),
    )
  } else {
    candidates.push(
      join(home, '.local', 'bin'),
      join(home, '.bun', 'bin'),
      join(home, '.volta', 'bin'),
      join(home, '.asdf', 'shims'),
      join(home, '.npm-global', 'bin'),
      join(home, '.local', 'share', 'pnpm'),
      // 这些运行时使用独立安装器，不一定会写入 npm 全局目录。
      join(home, '.opencode', 'bin'),
      join(home, '.qoder-cn', 'entry'),
      join(home, '.qoder', 'entry'),
      join(home, '.kimi-code', 'bin'),
      join(home, '.kimi', 'bin'),
      '/usr/local/bin',
      '/usr/local/sbin',
    )
    if (platform === 'darwin') {
      candidates.push(
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/opt/local/bin',
        join(home, 'Library', 'pnpm'),
        join(home, '.claude', 'local'),
      )
    } else {
      candidates.push('/snap/bin')
    }
  }

  candidates.push(
    ...versionBins(join(home, '.nvm', 'versions', 'node'), ['bin']),
    ...versionBins(
      join(home, 'Library', 'Application Support', 'fnm', 'node-versions'),
      [join('installation', 'bin')],
    ),
    ...versionBins(
      join(home, '.local', 'share', 'fnm', 'node-versions'),
      [join('installation', 'bin')],
    ),
    ...versionBins(join(home, '.local', 'share', 'mise', 'installs', 'node'), ['bin']),
    ...versionBins(join(home, '.asdf', 'installs', 'nodejs'), ['bin']),
  )

  const seen = new Set<string>()
  return candidates.filter((dir) => {
    if (!dir || !exists(dir)) return false
    const key = platform === 'win32' ? dir.toLowerCase() : dir
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function ensureExecutablePath(
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
  platform = process.platform,
): void {
  const current = (env.PATH ?? '').split(delimiter).filter(Boolean)
  const extra = collectExecutableDirs(home, platform, env)
  const seen = new Set<string>()
  env.PATH = [...extra, ...current]
    .filter((dir) => {
      const key = platform === 'win32' ? dir.toLowerCase() : dir
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .join(delimiter)
}
