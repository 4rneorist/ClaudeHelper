import {
  BrowserWindow,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
  type MenuItemConstructorOptions
} from 'electron'
import path from 'path'
import {
  ATTENTION_EVENTS,
  IPC,
  PICTURE_EXTENSIONS,
  TELEGRAM_PRIVATE_CHAT,
  type AppInfo,
  type AttentionEvent,
  type AttentionRequest,
  type ClaudeStatus,
  type ClaudeTurnResult,
  type ConfirmOptions,
  type ContextMenuChoice,
  type ShellProfile,
  type StartSessionResult,
  type TelegramResult
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
import { bookmarkMenuItems, type BookmarksStore } from './bookmarksStore'
import {
  deleteHook,
  deleteItem,
  hooksFile,
  itemsDir,
  listHookFile,
  listItems,
  readItem,
  rootOf,
  saveHook,
  saveItem,
  type ConfigPlaces
} from './claudeConfig'
import {
  checkFolder,
  checkHookChange,
  checkHookEntry,
  checkItemRef,
  checkKeybindingsSave,
  checkMarketplaceRequest,
  checkMcpRemove,
  checkMcpSave,
  checkMemoryRef,
  checkPluginRequest,
  checkSaveItem,
  checkSaveMemory,
  checkSettingsPatch
} from './claudeConfigChecks'
import {
  claudeRunner,
  listMarketplaces,
  listPlugins,
  pluginDetails,
  runMarketplaceAction,
  runPluginAction
} from './claudePlugins'
import { globalConfigFile, listMcp, mcpStatus, removeMcp, saveMcp } from './claudeMcp'
import { authStatus, listExtras, logout, orgPolicies } from './claudeExtras'
import { listMemory, memoryPath, readMemory, saveMemory } from './claudeMemory'
import {
  keybindingsPath,
  patchSettings,
  readKeybindings,
  readSettingsFile,
  saveKeybindings
} from './claudeSettings'
import {
  HOOK_SCOPES,
  ITEM_KINDS,
  PLUGIN_ID,
  type ItemKind,
  type ConfigResult,
  type HookFile,
  type MarketplaceList,
  type McpList,
  type McpStatusList,
  type AuthResult,
  type ExtrasList,
  type OrgPolicies,
  CLAUDE_LOGIN_SHELL,
  type MemoryFile,
  type PluginActionResult,
  type PluginList,
  type SettingsFile
} from '../shared/claudeConfig'
import {
  claudeConfigDir,
  finishedTurn,
  listPastSessions,
  readLastTurn,
  transcriptPath
} from './claudeSessions'
import { notifyAttention } from './attention'
import { readPicture } from './pictures'
import { gitInfo } from './gitInfo'
import type { SessionManager } from './sessionManager'
import { showWaiting } from './taskbar'
import type { SettingsStore } from './settingsStore'
import { detectShells } from './shells'
import type { UiStateStore } from './uiState'
import { snipToClipboard } from './snip'
import {
  attentionMessage,
  findTelegramChat,
  getBotInfo,
  sendTelegram,
  shouldSendTelegram,
  TELEGRAM_TEST_TEXT,
  type Fetch
} from './telegram'
import { TelegramBot } from './telegramBot'
import { TelegramTopics } from './telegramTopics'
import { fileLinkAt, resolveFileLink, type FileLinkDeps } from './fileLinks'
import {
  checkContextMenuRequest,
  checkFileLinkRequest,
  checkQuestion,
  checkStartRequest,
  checkTelegramMessage,
  checkTopicRef,
  isAbsoluteFolderPath,
  isDimension,
  isDirectory,
  isLinkPath,
  isMessageId,
  isSafeExternalUrl,
  topicName
} from './validation'

export interface IpcContext {
  getWindow(): BrowserWindow | null
  sessions: SessionManager
  settings: SettingsStore
  bookmarks: BookmarksStore
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

  // Chromium's network stack, so a system proxy applies as in the browser.
  const telegramFetch: Fetch = (url, init) => net.fetch(url, init)
  // A topic per session in your chat with the bot, when it has Threaded Mode on.
  const topics = new TelegramTopics({
    fetch: telegramFetch,
    onTopic: (key, thread) => ctx.getWindow()?.webContents.send(IPC.telegramTopic, key, thread),
    log: (message) => console.warn(message)
  })
  // Remote control: what you write to the bot goes to the renderer, which owns the tabs.
  const bot = new TelegramBot({
    fetch: telegramFetch,
    onIncoming: (msg) => ctx.getWindow()?.webContents.send(IPC.telegramIncoming, msg),
    log: (message) => console.warn(message),
    topics
  })
  bot.sync(ctx.settings.get())

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
    } else if (spec.shellId === CLAUDE_LOGIN_SHELL) {
      // Logging in to Claude Code, in a terminal: it may ask for a code from the browser.
      const claude = findClaude(explicitClaudePath(), resolveDeps())
      if (!claude) {
        return { ok: false, code: 'CLAUDE_NOT_FOUND', error: 'Could not find the claude executable' }
      }
      command = buildCommand(claude, ['auth', 'login'], process.platform, ctx.getEnv())
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

  handle(IPC.bookmarksLoad, () => ctx.bookmarks.get())
  handle(IPC.bookmarksSave, (items: unknown) => ctx.bookmarks.save(items))

  handle(IPC.settingsGet, () => ctx.settings.get())
  handle(IPC.settingsUpdate, (patch: unknown) => {
    const settings = ctx.settings.update(patch)
    bot.sync(settings)
    return settings
  })
  handle(IPC.recentRemove, (folder: unknown) =>
    typeof folder === 'string' ? ctx.settings.removeRecent(folder) : ctx.settings.get()
  )
  handle(IPC.folderColorSet, (folder: unknown, color: unknown) =>
    isAbsoluteFolderPath(folder) && (color === null || typeof color === 'string')
      ? ctx.settings.setFolderColor(folder, color)
      : ctx.settings.get()
  )
  handle(IPC.folderTitleSet, (folder: unknown, title: unknown) =>
    isAbsoluteFolderPath(folder) && (title === null || typeof title === 'string')
      ? ctx.settings.setFolderTitle(folder, title)
      : ctx.settings.get()
  )
  handle(IPC.folderMutedSet, (folder: unknown, muted: unknown) =>
    isAbsoluteFolderPath(folder) && typeof muted === 'boolean'
      ? ctx.settings.setFolderMuted(folder, muted)
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

  handle(IPC.pickPicture, async () => {
    const win = ctx.getWindow()
    const opts = {
      title: 'Choose a picture for behind the terminals',
      properties: ['openFile' as const],
      filters: [{ name: 'Pictures', extensions: [...PICTURE_EXTENSIONS] }]
    }
    const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  // Only the picture saved in the settings: the renderer can't read other files through this.
  handle(IPC.readPicture, () => {
    const file = ctx.settings.get().terminalPicture
    return file ? readPicture(file) : null
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

  handle(IPC.contextMenu, async (input: unknown) => {
    const req = checkContextMenuRequest(input)
    const win = ctx.getWindow()
    const copied = req.hasSelection ? '' : await clipboard.readText()
    const bookmarks = ctx.bookmarks.get()
    return new Promise<ContextMenuChoice>((resolve) => {
      let choice: ContextMenuChoice = null
      const template: MenuItemConstructorOptions[] = [
        { label: 'Copy', enabled: req.hasSelection, click: () => (choice = 'copy') },
        { label: 'Paste', click: () => (choice = 'paste') },
        { type: 'separator' },
        { label: 'Select All', click: () => (choice = 'selectAll') },
        { type: 'separator' },
        {
          label: 'Paste from Bookmarks',
          enabled: bookmarks.length > 0,
          submenu: bookmarkMenuItems(bookmarks, (id) => (choice = { pasteBookmark: id }))
        },
        {
          // Like Send To: without a selection, what a fullscreen Claude copied.
          label: req.hasSelection ? 'Add Selection to Bookmarks…' : 'Add Copied Text to Bookmarks…',
          enabled: req.hasSelection || copied.trim().length > 0,
          click: () => (choice = 'bookmark')
        }
      ]
      if (req.targets.length > 0) {
        // Without a selection, what is on the clipboard goes: a fullscreen Claude copies the
        // text you drag over itself.
        template.push(
          { type: 'separator' },
          {
            label: req.hasSelection ? 'Send Selection To' : 'Send Copied Text To',
            enabled: req.hasSelection || copied.length > 0,
            submenu: req.targets.map((t) => ({
              label: t.label.replace(/&/g, '&&'), // & would mark a mnemonic on Windows
              click: () => (choice = { sendTo: t.key })
            }))
          }
        )
      }
      if (req.canSnip) {
        template.push(
          { type: 'separator' },
          {
            label: 'Snip Screen into This Prompt',
            accelerator: 'CmdOrCtrl+Shift+S',
            registerAccelerator: false, // the terminal handles the key; this only shows it
            click: () => (choice = 'snip')
          }
        )
      }
      const menu = Menu.buildFromTemplate(template)
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

  handle(IPC.snipCapture, async () => {
    const win = ctx.getWindow()
    return win ? snipToClipboard(win, process.platform) : 'cancelled'
  })

  on(IPC.openExternal, (url: unknown) => {
    if (isSafeExternalUrl(url)) void shell.openExternal(url)
  })

  // Folders only: openPath on a file would run it.
  on(IPC.openFolder, (folder: unknown) => {
    if (isAbsoluteFolderPath(folder) && isDirectory(folder)) void shell.openPath(folder)
  })

  const fileLinkDeps = (): FileLinkDeps => ({
    platform: process.platform,
    homedir: ctx.homedir,
    pathext: ctx.getEnv().PATHEXT ?? ''
  })
  handle(IPC.fileLinksResolve, (cwd: unknown, paths: unknown) => {
    const req = checkFileLinkRequest(cwd, paths)
    if (!req) return []
    return Promise.all(req.paths.map((p) => resolveFileLink(req.cwd, p, fileLinkDeps())))
  })
  // A program or script is only shown in its folder: opening it would run it. So is a file
  // without a program to open it.
  on(IPC.fileLinkOpen, async (file: unknown) => {
    if (!isLinkPath(file) || !path.isAbsolute(file)) return
    const link = await fileLinkAt(file, fileLinkDeps())
    if (!link) return
    if (link.kind === 'program' || (await shell.openPath(link.path))) {
      shell.showItemInFolder(link.path)
    }
  })

  on(IPC.attentionNotify, (req: unknown) => {
    const win = ctx.getWindow()
    const r = req as Record<string, unknown> | null
    if (!win || !r || typeof r.key !== 'string' || typeof r.title !== 'string') return
    if (typeof r.body !== 'string' || typeof r.source !== 'string') return
    if (typeof r.topic !== 'string' || !ATTENTION_EVENTS.includes(r.event as AttentionEvent)) return
    const call: AttentionRequest = {
      key: r.key.slice(0, 64),
      title: r.title.slice(0, 200),
      body: r.body.slice(0, 500),
      event: r.event as AttentionEvent,
      source: r.source.slice(0, 200),
      topic: r.topic.slice(0, 300)
    }
    const seen = r.seen === true
    const settings = ctx.settings.get()
    if (settings.notifyWhenWaiting && !seen) {
      notifyAttention(win, call, (key) => win.webContents.send(IPC.attentionFocus, key))
    }
    const moment = {
      focused: !win.isDestroyed() && win.isFocused(),
      seen,
      idleState: (seconds: number) => powerMonitor.getSystemIdleState(seconds)
    }
    // A chat driven from Telegram: remote control tells Telegram itself.
    if ((r.skipTelegram === true && bot.running) || !shouldSendTelegram(settings, moment)) return
    // The question's buttons only make sense while the bot listens for them.
    const question = bot.running ? checkQuestion(r.question) : null
    if (question) call.question = question
    const { telegramBotToken: token, telegramChatId: chatId } = settings
    const ref = checkTopicRef(r.telegramTopic) ?? undefined
    void (async () => {
      // In the session's topic, made now if it has none (with Threaded Mode on).
      const thread = await topics.threadFor(token, chatId, call.key, ref)
      const res = await sendTelegram(telegramFetch, token, chatId, attentionMessage(call, thread))
      if (!res.ok) {
        console.warn(`Telegram message not sent: ${res.error}`)
        return
      }
      if (res.threadGone && thread !== undefined) topics.gone(call.key, thread)
      // Replying to it, or pressing its buttons, then goes to this tab.
      if (bot.running) for (const id of res.messageIds ?? []) bot.remember(id, call.key)
    })()
  })

  handle(IPC.telegramSend, (msg: unknown) => {
    const checked = checkTelegramMessage(msg)
    return checked ? bot.send(checked) : { messageId: null }
  })
  on(IPC.telegramTopicRename, (thread: unknown, name: unknown) => {
    if (!isMessageId(thread) || typeof name !== 'string' || !topicName(name)) return
    const { telegramEnabled, telegramBotToken, telegramChatId } = ctx.settings.get()
    if (telegramEnabled)
      void topics.rename(telegramBotToken, telegramChatId, thread, topicName(name))
  })
  on(IPC.telegramEdit, (messageId: unknown, msg: unknown) => {
    if (!isMessageId(messageId)) return
    const checked = msg === null ? null : checkTelegramMessage(msg)
    if (checked || msg === null) void bot.edit(messageId, checked)
  })
  on(IPC.telegramAnswerButton, (callbackId: unknown, text: unknown) => {
    if (typeof callbackId !== 'string' || callbackId.length > 100) return
    void bot.answerButton(callbackId, typeof text === 'string' ? text : undefined)
  })
  // Claude's reply, for Telegram: read from the conversation's transcript, which holds all of it
  // (the screen shows only its end).
  handle(IPC.claudeTurn, async (key: unknown, since: unknown): Promise<ClaudeTurnResult> => {
    if (typeof key !== 'string' || typeof since !== 'number' || !Number.isFinite(since)) {
      return { kind: 'unknown' }
    }
    const conversation = await ctx.uiState.conversationOf(key)
    if (!conversation) return { kind: 'unknown' }
    const file = transcriptPath(configDir(), conversation.cwd, conversation.sessionId)
    return finishedTurn(() => readLastTurn(file), since)
  })

  // Settings tests with what is typed in, before it is saved.
  // Settings shows whether the bot has Threaded Mode on: asked of Telegram, nothing is sent.
  handle(IPC.telegramTopicsCheck, async (token: unknown): Promise<TelegramResult> => {
    if (typeof token !== 'string') return { ok: false, error: 'Invalid request' }
    const info = await getBotInfo(telegramFetch, token.trim())
    return info.ok ? { ok: true, topics: info.topics } : info
  })
  // It also says whether the bot has Threaded Mode on, so sessions get topics.
  handle(IPC.telegramTest, async (token: unknown, chatId: unknown): Promise<TelegramResult> => {
    if (typeof token !== 'string' || typeof chatId !== 'string') {
      return { ok: false, error: 'Invalid request' }
    }
    const res = await sendTelegram(telegramFetch, token.trim(), chatId.trim(), {
      text: TELEGRAM_TEST_TEXT
    })
    if (!res.ok || !TELEGRAM_PRIVATE_CHAT.test(chatId.trim())) return res
    const info = await getBotInfo(telegramFetch, token.trim())
    return info.ok ? { ...res, topics: info.topics } : res
  })
  handle(IPC.telegramFindChat, (token: unknown): Promise<TelegramResult> | TelegramResult => {
    if (typeof token !== 'string') return { ok: false, error: 'Invalid request' }
    // While remote control polls the bot, Telegram won't let anything else read its updates.
    const polled = bot.chatFor(token.trim())
    if (polled) return { ok: true, chatId: polled.id, chatName: polled.name }
    return findTelegramChat(telegramFetch, token.trim())
  })

  on(IPC.attentionSummary, (summary: unknown) => {
    const win = ctx.getWindow()
    const s = summary as Record<string, unknown> | null
    const count = (v: unknown): v is number =>
      typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1000
    if (win && s && count(s.asking) && count(s.finished) && count(s.working)) {
      showWaiting(win, { asking: s.asking, finished: s.finished, working: s.working })
    }
  })

  handle(IPC.gitInfo, (folder: unknown) =>
    isAbsoluteFolderPath(folder) ? gitInfo(folder, ctx.getEnv()) : null
  )

  // ---- the "Claude Code" window: skills, agents, hooks and plugins ----

  const places = (folder?: string): ConfigPlaces => ({ userDir: configDir(), folder })
  const INVALID: ConfigResult = { ok: false, error: 'Invalid request' }

  handle(IPC.claudeItemsList, async (kind: unknown, input: unknown) => {
    const folder = checkFolder(input)
    if (!(ITEM_KINDS as readonly unknown[]).includes(kind) || folder === null) return null
    const k = kind as ItemKind
    const projectRoot = rootOf('project', places(folder))
    const project = projectRoot ? await listItems(k, 'project', projectRoot, folder) : []
    return {
      items: [...project, ...(await listItems(k, 'user', configDir()))],
      userDir: itemsDir(k, configDir()),
      projectDir: projectRoot ? itemsDir(k, projectRoot) : null
    }
  })
  handle(IPC.claudeItemRead, (input: unknown) => {
    const ref = checkItemRef(input)
    const root = ref && rootOf(ref.scope, places(ref.folder))
    return ref && root ? readItem(ref.kind, root, ref.name) : null
  })
  handle(IPC.claudeItemSave, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const req = checkSaveItem(input)
    const root = req && rootOf(req.ref.scope, places(req.ref.folder))
    return req && root ? saveItem(req.ref, root, req.text, req.from) : INVALID
  })
  handle(IPC.claudeItemDelete, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const ref = checkItemRef(input)
    const root = ref && rootOf(ref.scope, places(ref.folder))
    return ref && root ? deleteItem(ref.kind, root, ref.name, (p) => shell.trashItem(p)) : INVALID
  })

  handle(IPC.claudeHooksList, (input: unknown): Promise<HookFile[]> | HookFile[] => {
    const folder = checkFolder(input)
    if (folder === null) return []
    const files = HOOK_SCOPES.flatMap((scope) => {
      const file = hooksFile(scope, places(folder))
      return file ? [listHookFile(scope, file)] : []
    })
    return Promise.all(files)
  })
  handle(IPC.claudeHookSave, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const change = checkHookChange(input)
    const file = change && hooksFile(change.scope, places(change.folder))
    if (!change || !file) return INVALID
    const { original } = change
    const from = original && hooksFile(original.scope, places(change.folder))
    if (original && !from) return INVALID
    return saveHook(file, change, original && from ? { file: from, entry: original } : undefined)
  })
  handle(IPC.claudeHookDelete, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const r = input as Record<string, unknown> | null
    const entry = checkHookEntry(r?.entry)
    const folder = checkFolder(r?.folder)
    const file = entry && folder !== null && hooksFile(entry.scope, places(folder))
    return entry && file ? deleteHook(file, entry) : INVALID
  })

  // Through Claude Code's own CLI, which knows the marketplaces.
  const claudeCli = (): ReturnType<typeof claudeRunner> | null => {
    const claude = findClaude(explicitClaudePath(), resolveDeps())
    return claude ? claudeRunner(claude, buildEnv(ctx.getEnv()), process.platform) : null
  }
  const NO_CLAUDE = 'Could not find the claude executable (see Settings)'
  handle(IPC.claudePluginsList, (input: unknown): PluginList | Promise<PluginList> => {
    const folder = checkFolder(input)
    const run = claudeCli()
    if (folder === null) return { ok: false, error: 'Invalid request' }
    // Asked in the folder, so its own plugins show as enabled or not.
    return run ? listPlugins(run, folder ?? ctx.homedir) : { ok: false, error: NO_CLAUDE }
  })
  handle(IPC.claudePluginDetails, (id: unknown, input: unknown): string | Promise<string> => {
    const folder = checkFolder(input)
    const run = claudeCli()
    if (typeof id !== 'string' || !PLUGIN_ID.test(id) || folder === null) return 'Invalid request'
    return run ? pluginDetails(run, id, folder ?? ctx.homedir) : NO_CLAUDE
  })
  handle(
    IPC.claudePluginAction,
    (input: unknown): PluginActionResult | Promise<PluginActionResult> => {
      const req = checkPluginRequest(input)
      const run = claudeCli()
      if (!req) return { ok: false, error: 'Invalid request' }
      if (!run) return { ok: false, error: NO_CLAUDE }
      // A project's plugins are changed from inside that project.
      return runPluginAction(run, req, req.folder ?? ctx.homedir)
    }
  )

  handle(IPC.claudeMarketplaces, (input: unknown): MarketplaceList | Promise<MarketplaceList> => {
    const folder = checkFolder(input)
    const run = claudeCli()
    if (folder === null) return { ok: false, error: 'Invalid request' }
    return run ? listMarketplaces(run, folder ?? ctx.homedir) : { ok: false, error: NO_CLAUDE }
  })
  handle(
    IPC.claudeMarketplaceAction,
    (input: unknown): PluginActionResult | Promise<PluginActionResult> => {
      const req = checkMarketplaceRequest(input)
      const run = claudeCli()
      if (!req) return { ok: false, error: 'Invalid request' }
      if (!run) return { ok: false, error: NO_CLAUDE }
      return runMarketplaceAction(run, req, req.folder ?? ctx.homedir)
    }
  )

  // Memory files: CLAUDE.md, rules, and Claude's own notes.
  handle(IPC.claudeMemoryList, (input: unknown): MemoryFile[] | Promise<MemoryFile[]> => {
    const folder = checkFolder(input)
    return folder === null ? [] : listMemory(places(folder))
  })
  handle(IPC.claudeMemoryRead, (input: unknown) => {
    const ref = checkMemoryRef(input)
    const file = ref && memoryPath(ref, places(ref.folder))
    return file ? readMemory(file) : null
  })
  handle(IPC.claudeMemorySave, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const req = checkSaveMemory(input)
    if (!req) return INVALID
    return saveMemory(req.ref, places(req.ref.folder), req.text, req.before, req.from)
  })
  handle(IPC.claudeMemoryDelete, async (input: unknown): Promise<ConfigResult> => {
    const ref = checkMemoryRef(input)
    const file = ref && memoryPath(ref, places(ref.folder))
    if (!file) return INVALID
    if ((await readMemory(file)) === null) return { ok: false, error: 'It is no longer there' }
    try {
      await shell.trashItem(file)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  // MCP servers: read from Claude Code's files, changed through `claude mcp`.
  const mcpFile = (): string => globalConfigFile(ctx.getEnv(), ctx.homedir)
  handle(IPC.claudeMcpList, (input: unknown): McpList | Promise<McpList> => {
    const folder = checkFolder(input)
    if (folder === null) {
      return {
        servers: [],
        files: { user: null, project: null, local: null },
        error: 'Invalid request'
      }
    }
    return listMcp(mcpFile(), folder, process.platform)
  })
  handle(IPC.claudeMcpSave, async (input: unknown): Promise<ConfigResult> => {
    const req = checkMcpSave(input)
    const run = claudeCli()
    if (!req) return INVALID
    if (!run) return { ok: false, error: NO_CLAUDE }
    const { original } = req
    const previous = original
      ? (await listMcp(mcpFile(), req.folder, process.platform)).servers.find(
          (s) => s.name === original.name && s.scope === original.scope
        )?.config
      : undefined
    if (original && !previous) return { ok: false, error: `"${original.name}" is no longer there` }
    return saveMcp(run, req.folder ?? ctx.homedir, req, previous)
  })
  handle(IPC.claudeMcpRemove, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const req = checkMcpRemove(input)
    const run = claudeCli()
    if (!req) return INVALID
    return run ? removeMcp(run, req.folder ?? ctx.homedir, req) : { ok: false, error: NO_CLAUDE }
  })
  // What comes from claude.ai and plugins; your account; your organization's rules.
  handle(IPC.claudeExtras, (input: unknown): ExtrasList | Promise<ExtrasList> => {
    const folder = checkFolder(input)
    if (folder === null) return { items: [], hooks: [], error: 'Invalid request' }
    return listExtras(claudeCli(), folder ?? ctx.homedir, configDir())
  })
  handle(IPC.claudeAuthStatus, (): AuthResult | Promise<AuthResult> => {
    const run = claudeCli()
    return run ? authStatus(run, ctx.homedir) : { ok: false, error: NO_CLAUDE }
  })
  handle(IPC.claudeLogout, (): AuthResult | Promise<AuthResult> => {
    const run = claudeCli()
    return run ? logout(run, ctx.homedir) : { ok: false, error: NO_CLAUDE }
  })
  handle(IPC.claudeOrgPolicies, (): Promise<OrgPolicies> => orgPolicies(configDir(), process.platform))

  // How each server is doing, claude.ai connectors and plugins' servers included (slow).
  handle(IPC.claudeMcpStatus, (input: unknown): McpStatusList | Promise<McpStatusList> => {
    const folder = checkFolder(input)
    const run = claudeCli()
    if (folder === null) return { ok: false, error: 'Invalid request' }
    return run ? mcpStatus(run, folder ?? ctx.homedir) : { ok: false, error: NO_CLAUDE }
  })

  // Permissions, model, output style, environment and status line, file by file.
  handle(IPC.claudeSettingsRead, (input: unknown): SettingsFile[] | Promise<SettingsFile[]> => {
    const folder = checkFolder(input)
    if (folder === null) return []
    return Promise.all(
      HOOK_SCOPES.flatMap((scope) => {
        const file = hooksFile(scope, places(folder))
        return file ? [readSettingsFile(scope, file)] : []
      })
    )
  })
  handle(IPC.claudeSettingsPatch, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const patch = checkSettingsPatch(input)
    const file = patch && hooksFile(patch.scope, places(patch.folder))
    return patch && file ? patchSettings(file, patch.set, patch.before) : INVALID
  })

  handle(IPC.claudeKeybindingsRead, () => readKeybindings(keybindingsPath(configDir())))
  handle(IPC.claudeKeybindingsSave, (input: unknown): ConfigResult | Promise<ConfigResult> => {
    const req = checkKeybindingsSave(input)
    return req ? saveKeybindings(keybindingsPath(configDir()), req.text, req.before) : INVALID
  })
}
