import { execFileSync, spawn } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { shell } from 'electron'
import { watch, type FSWatcher } from 'chokidar'
import type { Artifact, ArtifactKind, EditorId, EditorOption } from '@shared/types'
import { IPC } from '@shared/ipc'
import type { Store } from '../db/store'
import { broadcast } from '../events'
import { getDataDir } from '../paths'

const IGNORED_SEGMENTS = new Set([
  '.git',
  'node_modules',
  'dist',
  'out',
  'build',
  '.next',
  'coverage',
  '.turbo',
])

interface EditorSpec {
  id: EditorId
  name: string
  /** `open -a` 使用的应用名；与菜单展示名分开，避免本地化影响启动。 */
  appName: string
  bundles: string[]
  always?: boolean
}

const EDITORS: EditorSpec[] = [
  {
    id: 'finder',
    name: '访达',
    appName: 'Finder',
    bundles: ['/System/Library/CoreServices/Finder.app'],
    always: true,
  },
  {
    id: 'cursor',
    name: 'Cursor',
    appName: 'Cursor',
    bundles: ['/Applications/Cursor.app', `${homedir()}/Applications/Cursor.app`],
  },
  {
    id: 'vscode',
    name: 'VS Code',
    appName: 'Visual Studio Code',
    bundles: [
      '/Applications/Visual Studio Code.app',
      `${homedir()}/Applications/Visual Studio Code.app`,
    ],
  },
  {
    id: 'zed',
    name: 'Zed',
    appName: 'Zed',
    bundles: ['/Applications/Zed.app', `${homedir()}/Applications/Zed.app`],
  },
  {
    id: 'sublimetext',
    name: 'Sublime Text',
    appName: 'Sublime Text',
    bundles: ['/Applications/Sublime Text.app', `${homedir()}/Applications/Sublime Text.app`],
  },
  {
    id: 'xcode',
    name: 'Xcode',
    appName: 'Xcode',
    bundles: ['/Applications/Xcode.app'],
  },
  {
    id: 'idea',
    name: 'IntelliJ IDEA',
    appName: 'IntelliJ IDEA',
    bundles: [
      '/Applications/IntelliJ IDEA.app',
      '/Applications/IntelliJ IDEA CE.app',
      `${homedir()}/Applications/IntelliJ IDEA.app`,
      `${homedir()}/Applications/IntelliJ IDEA CE.app`,
    ],
  },
  {
    id: 'goland',
    name: 'GoLand',
    appName: 'GoLand',
    bundles: ['/Applications/GoLand.app', `${homedir()}/Applications/GoLand.app`],
  },
  {
    id: 'rustrover',
    name: 'RustRover',
    appName: 'RustRover',
    bundles: ['/Applications/RustRover.app', `${homedir()}/Applications/RustRover.app`],
  },
  {
    id: 'sourcetree',
    name: 'Sourcetree',
    appName: 'Sourcetree',
    bundles: ['/Applications/Sourcetree.app', `${homedir()}/Applications/Sourcetree.app`],
  },
  {
    id: 'warp',
    name: 'Warp',
    appName: 'Warp',
    bundles: ['/Applications/Warp.app', `${homedir()}/Applications/Warp.app`],
  },
  {
    id: 'terminal',
    name: '终端',
    appName: 'Terminal',
    bundles: ['/System/Applications/Utilities/Terminal.app'],
    always: true,
  },
]

const ICON_CACHE = new Map<string, string | null>()

// 从 .app 读取真实图标：与参考实现一致，先读 CFBundleIconFile，
// 再用 sips 转成 64px PNG data URL。失败时返回 null，由界面回退。
function bundleIcon(bundle: string): string | null {
  if (ICON_CACHE.has(bundle)) return ICON_CACHE.get(bundle) ?? null
  let icon: string | null = null
  try {
    if (!existsSync(bundle)) {
      ICON_CACHE.set(bundle, null)
      return null
    }
    const resources = join(bundle, 'Contents', 'Resources')
    let iconFile: string | null = null
    try {
      const info = JSON.parse(
        execFileSync(
          'plutil',
          ['-convert', 'json', '-o', '-', join(bundle, 'Contents', 'Info.plist')],
          { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] },
        ),
      ) as { CFBundleIconFile?: unknown }
      if (typeof info.CFBundleIconFile === 'string' && info.CFBundleIconFile) {
        iconFile = info.CFBundleIconFile.endsWith('.icns')
          ? info.CFBundleIconFile
          : `${info.CFBundleIconFile}.icns`
      }
    } catch {
      // Info.plist 不可用时退回 Resources 中的第一个 .icns。
    }
    if (!iconFile) {
      iconFile = readdirSync(resources).find((entry) => entry.endsWith('.icns')) ?? null
    }
    if (!iconFile) {
      ICON_CACHE.set(bundle, null)
      return null
    }
    const workDir = mkdtempSync(join(tmpdir(), 'pizza-editor-icon-'))
    try {
      const out = join(workDir, 'icon.png')
      execFileSync(
        'sips',
        ['-s', 'format', 'png', '-Z', '64', join(resources, iconFile), '--out', out],
        { timeout: 3000, stdio: 'ignore' },
      )
      icon = `data:image/png;base64,${readFileSync(out).toString('base64')}`
    } finally {
      rmSync(workDir, { recursive: true, force: true })
    }
  } catch {
    icon = null
  }
  ICON_CACHE.set(bundle, icon)
  return icon
}

function isIgnored(path: string): boolean {
  const segments = path.split(sep)
  return segments.some((segment) => IGNORED_SEGMENTS.has(segment))
}

function canonical(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function imageMime(ext: string): string | null {
  switch (ext) {
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.gif':
      return 'image/gif'
    case '.webp':
      return 'image/webp'
    case '.svg':
      return 'image/svg+xml'
    default:
      return null
  }
}

export class ArtifactService {
  private readonly watchers = new Map<string, FSWatcher>()

  constructor(private readonly store: Store) {}

  start(input: {
    sessionId: string
    runId: string
    agentId: string
    workspacePath: string
  }): void {
    this.stop(input.runId)
    const watcher = watch(input.workspacePath, {
      ignoreInitial: true,
      persistent: true,
      ignored: (path) => isIgnored(path),
    })
    const record = (path: string, kind: ArtifactKind) => {
      if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return
      if (isIgnored(path)) return
      const artifact = this.store.upsertArtifact(
        input.sessionId,
        input.runId,
        input.agentId,
        canonical(path),
        kind,
      )
      broadcast(IPC.eventArtifact, artifact)
    }
    watcher.on('add', (path) => record(path, 'added'))
    watcher.on('change', (path) => record(path, 'modified'))
    this.watchers.set(input.runId, watcher)
  }

  stop(runId: string): void {
    const watcher = this.watchers.get(runId)
    if (watcher) {
      void watcher.close()
      this.watchers.delete(runId)
    }
  }

  recordFile(input: {
    sessionId: string
    runId: string
    agentId: string
    path: string
  }): Artifact | null {
    if (!statSync(input.path, { throwIfNoEntry: false })?.isFile()) return null
    const artifact = this.store.upsertArtifact(
      input.sessionId,
      input.runId,
      input.agentId,
      canonical(input.path),
      'added',
    )
    broadcast(IPC.eventArtifact, artifact)
    return artifact
  }

  scanArtifactsFolder(input: {
    sessionId: string
    runId: string
    agentId: string
    workspacePath: string
  }): void {
    const root = join(input.workspacePath, '.pizza', 'artifacts')
    const visit = (dir: string) => {
      let entries: string[] = []
      try {
        entries = readdirSync(dir)
      } catch {
        return
      }
      for (const entry of entries) {
        const path = join(dir, entry)
        const stat = statSync(path, { throwIfNoEntry: false })
        if (stat?.isDirectory()) {
          visit(path)
        } else if (stat?.isFile()) {
          const artifact = this.store.upsertArtifact(
            input.sessionId,
            input.runId,
            input.agentId,
            canonical(path),
            'info',
          )
          broadcast(IPC.eventArtifact, artifact)
        }
      }
    }
    visit(root)
  }

  list(sessionId: string): Artifact[] {
    return this.store.listArtifacts(sessionId)
  }

  read(path: string): { path: string; content: string; kind: 'text' | 'image' } {
    const absolute = this.allowedPath(path)
    const stat = statSync(absolute, { throwIfNoEntry: false })
    if (!stat?.isFile()) throw new Error('ARTIFACT_NOT_FOUND')
    const mime = imageMime(extname(absolute).toLowerCase())
    if (mime) {
      const buffer = readFileSync(absolute)
      return {
        path: absolute,
        content: `data:${mime};base64,${buffer.toString('base64')}`,
        kind: 'image',
      }
    }
    if (stat.size > 2 * 1024 * 1024) throw new Error('ARTIFACT_TOO_LARGE')
    return { path: absolute, content: readFileSync(absolute, 'utf8'), kind: 'text' }
  }

  reveal(path: string): void {
    const absolute = this.allowedPath(path)
    shell.showItemInFolder(absolute)
  }

  editors(): EditorOption[] {
    // Windows / Linux 使用系统默认程序；macOS 只列出已安装的应用。
    if (process.platform !== 'darwin') {
      return [{ id: 'system', name: 'System default', icon: null }]
    }
    return EDITORS.flatMap((editor) => {
      const bundle = editor.bundles.find((candidate) => existsSync(candidate))
      if (!bundle && !editor.always) return []
      return [{ id: editor.id, name: editor.name, icon: bundle ? bundleIcon(bundle) : null }]
    })
  }

  async openWorkspace(workspacePath: string, editor: EditorId): Promise<void> {
    const absolute = this.allowedPath(workspacePath)
    if (process.platform !== 'darwin') {
      const error = await shell.openPath(absolute)
      if (error) throw new Error('EDITOR_NOT_AVAILABLE')
      return
    }
    const spec = EDITORS.find((candidate) => candidate.id === editor)
    const args = spec?.id === 'finder' ? [absolute] : ['-a', spec?.appName ?? editor, absolute]

    return new Promise((resolvePromise, reject) => {
      const child = spawn('open', args, { detached: true, stdio: 'ignore' })
      child.once('error', reject)
      child.once('close', (code) => {
        child.unref()
        if (code === 0) resolvePromise()
        else reject(new Error('EDITOR_NOT_AVAILABLE'))
      })
    })
  }

  private allowedPath(path: string): string {
    const absolute = canonical(path)
    const roots = [
      getDataDir(),
      ...this.store.listWorkspaces().map((workspace) => workspace.rootPath),
    ].map((root) => canonical(root))

    const allowed = roots.some(
      (root) => absolute === root || absolute.startsWith(`${root}${sep}`),
    )
    if (!allowed) throw new Error('PATH_NOT_ALLOWED')
    return absolute
  }

  relativePath(sessionWorkspace: string, path: string): string {
    return relative(canonical(sessionWorkspace), canonical(path)) || basename(path)
  }
}
