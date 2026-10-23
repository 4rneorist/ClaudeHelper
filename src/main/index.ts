import { app, BrowserWindow, dialog, Menu, shell } from 'electron'
import { homedir, release } from 'os'
import { join } from 'path'
import { spawn } from 'node-pty'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC, type AppInfo } from '../shared/ipc'
import { loadLoginShellEnv } from './claudeResolver'
import { claudeConfigDir } from './claudeSessions'
import { registerIpc } from './ipc'
import { SessionManager } from './sessionManager'
import { SettingsStore } from './settingsStore'
import { watchRegistry } from './registryWatcher'
import { UiStateStore } from './uiState'
import { isSafeExternalUrl } from './validation'
import { loadWindowState, saveWindowState } from './windowState'

// Lets the e2e harness run against an isolated profile.
if (process.env.CLAUDE_HELPER_USER_DATA) {
  app.setPath('userData', process.env.CLAUDE_HELPER_USER_DATA)
}

let mainWindow: BrowserWindow | null = null
let stopping = false
let launchEnv: NodeJS.ProcessEnv = process.env
let settings: SettingsStore | null = null
let uiState: UiStateStore | null = null
const windowStateFile = (): string => join(app.getPath('userData'), 'window.json')

const sessions = new SessionManager(spawn, {
  onData: (id, data) => mainWindow?.webContents.send(IPC.sessionData, id, data),
  onExit: (id, exitCode) => mainWindow?.webContents.send(IPC.sessionExit, id, exitCode)
})

/**
 * Asks once, stops every session and waits for them to exit, then runs `next` (close or quit).
 * Returning before the processes are gone would let the app exit mid-teardown and crash.
 */
async function stopSessionsThen(next: () => void): Promise<void> {
  if (stopping) return
  const n = sessions.count
  const box = {
    type: 'question' as const,
    message: `Quit and stop ${n} running session${n === 1 ? '' : 's'}?`,
    buttons: ['Quit', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    detail: settings?.get().restoreSession
      ? 'Your folders and tabs reopen next time, and Claude conversations resume where they were.'
      : undefined
  }
  const choice = mainWindow
    ? dialog.showMessageBoxSync(mainWindow, box)
    : dialog.showMessageBoxSync(box)
  if (choice !== 0) return
  stopping = true
  mainWindow?.hide() // feels instant while the processes wind down
  // Record the latest layout, and which conversation each tab has open, while the processes
  // can still be asked.
  if (uiState && mainWindow) {
    const saved = uiState.nextSave(1000)
    mainWindow.webContents.send(IPC.uiFlushRequest)
    await saved
  }
  await uiState?.flush()
  await sessions.shutdown({ graceMs: process.platform === 'win32' ? 1200 : 0 })
  next()
}

function createWindow(): void {
  const saved = loadWindowState(windowStateFile())
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    ...saved?.bounds,
    minWidth: 480,
    minHeight: 320,
    show: false,
    title: 'ClaudeHelper',
    backgroundColor: '#161618',
    autoHideMenuBar: true,
    // macOS takes its icon from the app bundle (or the dock icon set below).
    ...(process.platform !== 'darwin' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  mainWindow = win

  // Size and position are saved as they change, not only on close.
  let boundsTimer: NodeJS.Timeout | undefined
  const persistBounds = (): void => {
    clearTimeout(boundsTimer)
    boundsTimer = setTimeout(() => {
      if (!win.isDestroyed() && !win.isMinimized()) saveWindowState(windowStateFile(), win)
    }, 500)
  }
  for (const event of ['resize', 'move', 'maximize', 'unmaximize'] as const) {
    win.on(event as 'resize', persistBounds)
  }

  win.on('ready-to-show', () => {
    if (saved?.maximized) win.maximize()
    win.show()
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The renderer never navigates; this also stops a dropped file from replacing the UI.
  const appUrl = is.dev && process.env['ELECTRON_RENDERER_URL']
  win.webContents.on('will-navigate', (e, url) => {
    if (!appUrl || !url.startsWith(appUrl)) e.preventDefault()
  })

  win.on('close', (e) => {
    if (!stopping) saveWindowState(windowStateFile(), win)
    if (sessions.count === 0) return
    // Stop the sessions first and close for real once they have exited.
    e.preventDefault()
    void stopSessionsThen(() => win.close())
  })
  win.on('closed', () => {
    mainWindow = null
    stopping = false
  })

  if (appUrl) void win.loadURL(appUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
}

/**
 * No default menu on Windows/Linux: its accelerators (Ctrl+R reload, Ctrl+W close…) would steal
 * keys that claude uses. macOS needs a minimal menu for Cmd+Q and standard window behavior.
 */
function setupMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null)
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { type: 'separator' }, { role: 'front' }]
      }
    ])
  )
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.claudehelper.app')
  // In development there is no app bundle yet, so show the icon in the dock directly.
  if (process.platform === 'darwin' && is.dev) app.dock?.setIcon(icon)
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  const shellEnv = await loadLoginShellEnv(process.platform, process.env, process.execPath)
  if (shellEnv) launchEnv = { ...process.env, ...shellEnv }

  const appInfo: AppInfo = {
    platform: process.platform,
    windowsBuild: process.platform === 'win32' ? Number(release().split('.')[2]) || 0 : 0,
    version: app.getVersion(),
    e2e: process.env.CLAUDE_HELPER_E2E === '1'
  }

  settings = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  uiState = new UiStateStore(join(app.getPath('userData'), 'ui-state.json'), () =>
    claudeConfigDir(launchEnv, homedir())
  )
  // A conversation opened, resumed or switched inside claude: save right away.
  const registry = watchRegistry(
    () => claudeConfigDir(launchEnv, homedir()),
    () => mainWindow?.webContents.send(IPC.uiFlushRequest)
  )
  registry.ensure()
  app.on('will-quit', () => registry.close())
  registerIpc({
    getWindow: () => mainWindow,
    sessions,
    settings,
    getEnv: () => launchEnv,
    homedir: homedir(),
    appInfo,
    uiState,
    onSessionStarted: () => registry.ensure()
  })

  setupMenu()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quitting without closing the window first (Cmd+Q on macOS, app.quit()) takes the same path.
app.on('before-quit', (e) => {
  if (sessions.count === 0) return
  e.preventDefault()
  void stopSessionsThen(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
