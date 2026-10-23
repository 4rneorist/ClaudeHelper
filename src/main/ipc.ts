import {
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import {
  IPC,
  type AppInfo,
  type ClaudeStatus,
  type ConfirmOptions,
  type ContextMenuChoice,
  type ShellProfile,
  type StartSessionResult
} from '../shared/ipc'
import {
  buildCommand,
  buildEnv,
  findClaude,
  isFile,
  knownSessionArgs,
  launchArgs,
  type PtyCommand,
  type ResolveDeps
} from './claudeResolver'
import { claudeConfigDir, listPastSessions, transcriptPath } from './claudeSessions'
import type { SessionManager } from './sessionManager'
import type { SettingsStore } from './settingsStore'
import { detectShells } from './shells'
import type { UiStateStore } from './uiState'
import {
  checkStartRequest,
  isAbsoluteFolderPath,
  isDimension,
  isDirectory,
  isSafeExternalUrl
} from './validation'

export interface IpcContext {
  getWindow(): BrowserWindow | null
  sessions: SessionManager
  settings: SettingsStore
  /** Environment used to find and launch claude (process.env, possibly merged with the login shell's). */
  getEnv(): NodeJS.ProcessEnv
  homedir: string
  appInfo: AppInfo
  uiState: UiStateStore
  /** A process started (claude or shell); lets main begin watching Claude Code's registry. */
  onSessionStarted(): void
}

export function registerIpc(ctx: IpcContext): void {
  // Only our own window may drive sessions.
  const trusted = (e: IpcMainEvent | IpcMainInvokeEvent): boolean =>
    e.sender === ctx.getWindow()?.webContents

  const handle = <A extends unknown[], R>(
    channel: string,
    fn: (...args: A) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, (e, ...args) => {
      if (!trusted(e)) throw new Error('Untrusted sender')
      return fn(...(args as A))
    })
  }
  const on = <A extends unknown[]>(channel: string, fn: (...args: A) => void): void => {
    ipcMain.on(channel, (e, ...args) => {
      if (trusted(e)) fn(...(args as A))
    })
  }

  const resolveDeps = (): ResolveDeps => ({
    platform: process.platform,
    env: ctx.getEnv(),
    homedir: ctx.homedir,
    isFile
  })
  const configDir = (): string => claudeConfigDir(ctx.getEnv(), ctx.homedir)
  const explicitClaudePath = (): string | undefined =>
    ctx.settings.get().claudePath || process.env.CLAUDE_HELPER_CLAUDE_PATH || undefined

  handle(IPC.appInfo, () => ctx.appInfo)

  handle(IPC.claudeStatus, (): ClaudeStatus => {
    const explicit = explicitClaudePath()
    const found = findClaude(explicit, resolveDeps())
    return { found: found !== null, path: found ?? explicit ?? null, explicit: !!explicit }
  })

  handle(IPC.sessionStart, (input: unknown): StartSessionResult => {
    const check = checkStartRequest(input)
    if (!check.ok) return check
    const { req } = check
    const { spec } = req

    let command: PtyCommand
    if (spec.kind === 'claude') {
      const claude = findClaude(explicitClaudePath(), resolveDeps())
      if (!claude) {
        return {
          ok: false,
          code: 'CLAUDE_NOT_FOUND',
          error: 'Could not find the claude executable'
        }
      }
      const knownId = spec.resumeId ?? spec.sessionId
      const args = knownId
        ? knownSessionArgs(knownId, isFile(transcriptPath(configDir(), req.cwd, knownId)))
        : launchArgs(spec.mode)
      command = buildCommand(claude, args, process.platform, ctx.getEnv())
    } else {
      const shell = detectShells(resolveDeps()).find((s) => s.id === spec.shellId)
      if (!shell) {
        return { ok: false, code: 'SHELL_NOT_FOUND', error: `Shell not available: ${spec.shellId}` }
      }
      command = buildCommand(shell.file, shell.args, process.platform, ctx.getEnv())
    }
    try {
      const { id, pid } = ctx.sessions.start({
        file: command.file,
        args: command.args,
        cwd: req.cwd,
        env: buildEnv(ctx.getEnv()),
        cols: req.cols,
        rows: req.rows,
        useConptyDll: process.platform === 'win32' && ctx.settings.get().experimentalConptyDll
      })
      ctx.settings.addRecent(req.cwd)
      ctx.onSessionStarted()
      return {
        ok: true,
        session: { id, pid, cwd: req.cwd, spec, command: command.display }
      }
    } catch (err) {
      return {
        ok: false,
        code: 'SPAWN_FAILED',
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  on(IPC.sessionWrite, (id: unknown, data: unknown, binary: unknown) => {
    if (typeof id !== 'string' || typeof data !== 'string') return
    // xterm's onBinary hands over raw bytes as a latin1 string (legacy mouse reports).
    ctx.sessions.write(id, binary === true ? Buffer.from(data, 'latin1') : data)
  })

  on(IPC.sessionResize, (id: unknown, cols: unknown, rows: unknown) => {
    if (typeof id === 'string' && isDimension(cols) && isDimension(rows)) {
      ctx.sessions.resize(id, cols, rows)
    }
  })

  handle(IPC.sessionKill, (id: unknown) => {
    if (typeof id === 'string') ctx.sessions.kill(id)
  })

  handle(IPC.shellsList, (): ShellProfile[] =>
    detectShells(resolveDeps()).map(({ id, label }) => ({ id, label }))
  )

  handle(IPC.uiLoad, () => (ctx.settings.get().restoreSession ? ctx.uiState.load() : null))
  handle(IPC.uiSave, (state: unknown) => ctx.uiState.save(state))

  handle(IPC.pastSessions, (cwd: unknown, limit: unknown) => {
    if (!isAbsoluteFolderPath(cwd)) return []
    return listPastSessions(cwd, {
      configDir: configDir(),
      limit: typeof limit === 'number' && limit >= 1 && limit <= 50 ? Math.floor(limit) : 5,
      platform: process.platform
    })
  })

  handle(IPC.settingsGet, () => ctx.settings.get())
  handle(IPC.settingsUpdate, (patch: unknown) => ctx.settings.update(patch))
  handle(IPC.recentRemove, (folder: unknown) =>
    typeof folder === 'string' ? ctx.settings.removeRecent(folder) : ctx.settings.get()
  )
  handle(IPC.folderColorSet, (folder: unknown, color: unknown) =>
    isAbsoluteFolderPath(folder) && (color === null || typeof color === 'string')
      ? ctx.settings.setFolderColor(folder, color)
      : ctx.settings.get()
  )

  handle(IPC.pickFolder, async () => {
    const win = ctx.getWindow()
    const opts = { title: 'Open folder in Claude', properties: ['openDirectory' as const] }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.pickExecutable, async () => {
    const win = ctx.getWindow()
    const opts = {
      title: 'Choose the claude executable',
      properties: ['openFile' as const],
      filters:
        process.platform === 'win32'
          ? [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }]
          : undefined
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  handle(IPC.confirm, async (input: unknown) => {
    const opts = input as ConfirmOptions
    if (!opts || typeof opts.message !== 'string' || typeof opts.okLabel !== 'string') return false
    const win = ctx.getWindow()
    const box = {
      type: 'question' as const,
      message: opts.message,
      detail: typeof opts.detail === 'string' ? opts.detail : undefined,
      buttons: [opts.okLabel, 'Cancel'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    }
    const { response } = win
      ? await dialog.showMessageBox(win, box)
      : await dialog.showMessageBox(box)
    return response === 0
  })

  handle(IPC.contextMenu, (hasSelection: unknown) => {
    const win = ctx.getWindow()
    return new Promise<ContextMenuChoice>((resolve) => {
      let choice: ContextMenuChoice = null
      const menu = Menu.buildFromTemplate([
        { label: 'Copy', enabled: hasSelection === true, click: () => (choice = 'copy') },
        { label: 'Paste', click: () => (choice = 'paste') },
        { type: 'separator' },
        { label: 'Select All', click: () => (choice = 'selectAll') }
      ])
      // `callback` fires after the menu closes, and after any click handler has run.
      menu.popup({ window: win ?? undefined, callback: () => resolve(choice) })
    })
  })

  handle(IPC.clipboardRead, async () => {
    const [text, hasImage] = await Promise.all([clipboard.readText(), clipboard.has('image/png')])
    return { text, hasImage }
  })
  on(IPC.clipboardWrite, (text: unknown) => {
    if (typeof text === 'string') void clipboard.writeText(text)
  })

  on(IPC.openExternal, (url: unknown) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  // Folders only: openPath on a file would run it.
  on(IPC.openFolder, (folder: unknown) => {
    if (isAbsoluteFolderPath(folder) && isDirectory(folder)) void shell.openPath(folder)
  })
}
