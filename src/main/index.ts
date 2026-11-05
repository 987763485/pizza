import {
  app,
  BrowserWindow,
  nativeImage,
  nativeTheme,
  Notification,
  shell,
  Tray,
  Menu,
  ipcMain,
} from 'electron'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { openDatabase, type PizzaDatabase } from './db/database'
import { applyPendingReset, resetMarkerPath } from './reset'
import { CapabilityStore } from './db/capability-store'
import { Store } from './db/store'
import { broadcast } from './events'
import { registerIpc } from './ipc/register'
import { createRuntimeSupervisor } from './runtime/registry'
import {
  appInfo,
  getDataDir,
  getDbPath,
  getRuntimeDir,
  getSkillsDir,
  setDataDir,
} from './paths'
import { ensureExecutablePath } from './paths-env'
import { AgentService } from './services/agent-service'
import { AgentRunExecutor } from './services/agent-run-executor'
import { ApprovalService } from './services/approval-service'
import { ArtifactService } from './services/artifact-service'
import { AttachmentService } from './services/attachment-service'
import { CapabilityResolver } from './services/capability-resolver'
import { DataDirService } from './services/data-dir-service'
import { McpService } from './services/mcp-service'
import { NotificationService } from './services/notification-service'
import { OnboardingService } from './services/onboarding-service'
import { RunService } from './services/run-service'
import { RuntimeService } from './services/runtime-service'
import { SafeStorageSecretBox } from './services/secret-box'
import { SessionService } from './services/session-service'
import { SettingsService } from './services/settings-service'
import { SkillService } from './services/skill-service'
import { TeamService } from './services/team-service'
import { TeamOrchestrator } from './services/team-orchestrator'
import { WorkspaceService } from './services/workspace-service'
import { SdkMcpConnector } from './runtime/mcp-connector'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let database: PizzaDatabase | null = null
let runService: RunService | null = null
let runtimeService: RuntimeService | null = null
let teamOrchestrator: TeamOrchestrator | null = null
let settingsService: SettingsService | null = null

function createWindow(initialTheme: 'light' | 'dark', language: string): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Pizza',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: initialTheme === 'dark' ? '#1c1c1e' : '#fbfbfb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // 首屏渲染前就能拿到主题和语言，避免先闪一下默认主题。
      additionalArguments: [
        `--pizza-theme=${initialTheme}`,
        `--pizza-language=${language}`,
      ],
    },
  })

  mainWindow.once('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const current = mainWindow?.webContents.getURL()
    if (current && url !== current) event.preventDefault()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function focusSession(sessionId: string, messageId: string | null): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
  broadcast(IPC.eventNotificationOpen, { sessionId, messageId })
}

function createTray(): void {
  try {
    // macOS 使用标题栏菜单项；Windows/Linux 需要真实图标，否则托盘不可见。
    const iconPath = app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'resources', 'icon.png')
    const image =
      process.platform === 'darwin'
        ? nativeImage.createEmpty()
        : nativeImage.createFromPath(iconPath)
    tray = new Tray(image)
    tray.setToolTip('Pizza')
    if (process.platform === 'darwin') tray.setTitle('Pizza')
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '打开 Pizza', click: () => focusSession('', null) },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    )
  } catch {
    // 托盘不可用时不影响主窗口与通知。
    tray = null
  }
}

// 必须在创建运行时服务与首次探测前补全 PATH；Finder 启动的 GUI 应用
// 不会继承终端里的 Homebrew / nvm / bun 等目录。
ensureExecutablePath()

app.whenReady().then(() => {
  try {
    // 数据目录必须在打开数据库前解析；上次确认的迁移在这里执行。
    const dataDirs = new DataDirService(
      app.getPath('userData'),
      process.env.PIZZA_DATA_DIR,
      join(homedir(), '.pizza'),
    )
    const applied = dataDirs.applyPending()
    setDataDir(applied.current)
    // 初始化请求在下次启动、打开数据库前执行，避免删除仍被占用的数据库文件。
    applyPendingReset(app.getPath('userData'), getDataDir())
    // 上次异常退出可能留下含明文的运行临时目录；启动时统一清理。
    rmSync(getRuntimeDir(), { recursive: true, force: true })
    mkdirSync(getRuntimeDir(), { recursive: true, mode: 0o700 })

    database = openDatabase(getDbPath())
    const store = new Store(database)
    const capabilityStore = new CapabilityStore(database)
    const settings = new SettingsService(store, () => dataDirs.status())
    settingsService = settings
    const workspaces = new WorkspaceService(store, settings)
    const runtimes = new RuntimeService(store, settings)
    runtimeService = runtimes
    const agents = new AgentService(store, runtimes)
    const teams = new TeamService(store)
    const sessions = new SessionService(store)
    const artifacts = new ArtifactService(store)
    const attachments = new AttachmentService()

    const skills = new SkillService(capabilityStore, {
      skillsDir: () => getSkillsDir(),
    })
    const mcp = new McpService(
      capabilityStore,
      new SafeStorageSecretBox(),
      new SdkMcpConnector(),
    )
    const resolver = new CapabilityResolver(capabilityStore, skills, mcp)
    const approvals = new ApprovalService(capabilityStore, (request) =>
      broadcast(IPC.eventApproval, request),
    )
    const notifier = {
      show: (notification: { title: string; body: string }, onClick: () => void) => {
        if (!Notification.isSupported()) return false
        const native = new Notification({
          title: notification.title,
          body: notification.body,
        })
        native.on('click', onClick)
        native.show()
        return true
      },
    }
    const notifications = new NotificationService(
      capabilityStore,
      store,
      () => settings.get(),
      notifier,
      (notification) => broadcast(IPC.eventNotification, notification),
      (sessionId, messageId) => {
        if (sessionId) focusSession(sessionId, messageId)
      },
    )
    const onboarding = new OnboardingService(settings)

    // 全局唯一的运行时资源层：会话 Actor 负责单飞与复用，
    // Supervisor 负责 warm 上限、启动信号量、turn 并发与空闲 LRU。
    const supervisor = createRuntimeSupervisor()
    const executor = new AgentRunExecutor(store, runtimes, artifacts, supervisor, {
      resolve: (input) => resolver.resolve(input),
      runtimeRoot: getRuntimeDir(),
      approvals,
      onAssistantCompleted: (sessionId, messageId) => {
        notifications.handleMessage(sessionId, messageId)
      },
    })
    const runs = new RunService(store, sessions, runtimes, attachments, executor)
    runService = runs
    const orchestrator = new TeamOrchestrator({
      store,
      teams,
      executor,
      runtimeFor: (agent) => runtimes.getForRun(agent.runtimeId),
      saveAttachment: (input) => attachments.save(input),
      artifacts,
      globalMaxConcurrency: settings.get().maxConcurrency,
      language: () => settings.get().language,
      onTurnEvent: (event) => broadcast(IPC.eventTeamTurn, event),
      onSessionUpdated: (sessionId) => {
        const summary = store.getSessionSummary(sessionId)
        if (summary) broadcast(IPC.eventSession, summary)
      },
      onAssistantCompleted: (sessionId, messageId) => {
        notifications.handleMessage(sessionId, messageId)
      },
    })
    teamOrchestrator = orchestrator

    workspaces.ensureDefault()
    runs.recoverInterrupted()

    registerIpc({
      workspaces,
      runtimes,
      agents,
      teams,
      teamOrchestrator: orchestrator,
      sessions,
      runs,
      artifacts,
      settings,
      skills,
      mcp,
      capabilities: resolver,
      approvals,
      notifications,
      onboarding,
      dataDirs,
      onSettingsChanged: (next) => broadcast(IPC.eventSettings, next),
      onRestart: () => {
        app.relaunch()
        app.exit(0)
      },
      onResetApp: async () => {
        try {
          await mainWindow?.webContents.session.clearStorageData()
        } catch {
          // 清除 Web 存储失败不阻塞数据清理；数据库与会话状态仍会被移除。
        }
        writeFileSync(resetMarkerPath(app.getPath('userData')), new Date().toISOString())
        app.relaunch()
        app.exit(0)
      },
    })

    const initial = settings.get()
    const theme =
      initial.theme === 'system'
        ? nativeTheme.shouldUseDarkColors
          ? 'dark'
          : 'light'
        : initial.theme
    createWindow(theme, initial.language)
    createTray()
    nativeTheme.on('updated', () => {
      if (settings.get().theme !== 'system') return
      mainWindow?.webContents.send(IPC.eventSettings, settings.get())
    })
  } catch (error) {
    // 数据目录不可用时仍打开一个可解释的错误窗口，而不是直接退出。
    console.error('Pizza 启动失败', error)
    ipcMain.handle(IPC.appInfo, () => appInfo())
    createWindow(nativeTheme.shouldUseDarkColors ? 'dark' : 'light', 'zh-CN')
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && settingsService) {
      const current = settingsService.get()
      const theme =
        current.theme === 'system'
          ? nativeTheme.shouldUseDarkColors
            ? 'dark'
            : 'light'
          : current.theme
      createWindow(theme, current.language)
    }
  })
})

app.on('before-quit', () => {
  runService?.shutdown()
  runService = null
  teamOrchestrator?.shutdown()
  teamOrchestrator = null
  runtimeService?.dispose()
  runtimeService = null
  tray?.destroy()
  tray = null
  database?.close()
  database = null
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
