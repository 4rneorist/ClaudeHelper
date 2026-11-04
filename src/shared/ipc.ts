// Single contract between main, preload and renderer.

import type { BookmarkNode } from './bookmarks'
import type { UiState } from './uiState'
export type { UiState } from './uiState'

export type LaunchMode = 'new' | 'continue' | 'resume'
export const LAUNCH_MODES: readonly LaunchMode[] = ['new', 'continue', 'resume']

export type ThemeSetting = 'system' | 'dark' | 'light'
export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'dark', 'light']

/** How a terminal's background picture covers it, as in Windows Terminal. */
export type PictureFit = 'fill' | 'fit' | 'stretch' | 'tile'
export const PICTURE_FITS: readonly PictureFit[] = ['fill', 'fit', 'stretch', 'tile']
/** The pictures a terminal can have behind it, by file extension. */
export const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] as const
export const PICTURE_FILE = /\.(png|jpe?g|gif|webp|bmp)$/i

export interface Settings {
  /** Explicit path to the claude executable. Empty string = auto-detect. */
  claudePath: string
  fontSize: number
  theme: ThemeSetting
  /** A picture behind every terminal's text, by its full path; '' = none. */
  terminalPicture: string
  /** How much of the picture shows, 5–100 (%): the rest is the theme's background over it. */
  terminalPictureStrength: number
  terminalPictureFit: PictureFit
  /**
   * Windows only: use the ConPTY build bundled with node-pty (Windows Terminal's OpenConsole)
   * instead of the system's. node-pty marks it experimental, and it can crash the app on exit.
   */
  experimentalConptyDll: boolean
  /** Reopen the folders, tabs, splits and Claude conversations that were open at last exit. */
  restoreSession: boolean
  /** Restored terminals start their process only when first shown, not all at once on start. */
  lazyRestore: boolean
  /** OS notification and a flashing taskbar button when a session needs you and the app is in the background. */
  notifyWhenWaiting: boolean
  /** A sound when a session finishes, and another when it asks for your answer. */
  soundOnAttention: boolean
  finishedSound: SoundName
  askingSound: SoundName
  /** 0–100. */
  soundVolume: number
  /** Remind again while a session keeps asking unseen, every this many minutes; 0 = never. */
  reminderMinutes: number
  /** Folders whose sessions make no sounds, toasts or notifications. */
  mutedFolders: string[]
  /** Folder tabs show the Jira ticket named in the git branch (MT-123), linking to it. */
  jiraEnabled: boolean
  /** The ticket's URL, with {key} where the key goes (or the key is appended); '' = none. */
  jiraUrl: string
  /** A Telegram message from your own bot when a session needs you, for when you are away. */
  telegramEnabled: boolean
  /** From @BotFather; '' = none. Encrypted in the settings file where the OS allows. */
  telegramBotToken: string
  /** Where the bot writes: your chat with it, a group (negative) or a @channel; '' = none. */
  telegramChatId: string
  /**
   * Only once you have been away from the computer this many minutes, or locked the screen;
   * 0 = whenever the app is in the background; TELEGRAM_ALWAYS = every time.
   */
  telegramAwayMinutes: number
  /**
   * Your chat with the bot can answer Claude's questions, send prompts, read a chat and open new
   * ones (only a private chat, from you).
   */
  telegramRemote: boolean
  /** The bookmarked prompts column is shown on the right. */
  bookmarksOpen: boolean
  recentFolders: string[]
  /** Folder tab background per folder path, as #rrggbb. */
  folderColors: Record<string, string>
  /** Folder tab title per folder path, when it isn't the folder's name. */
  folderTitles: Record<string, string>
}

/** The sounds the app can play, synthesized in the renderer (sounds.ts). */
export const SOUND_NAMES = ['chime', 'rise', 'bell', 'blip', 'knock'] as const
export type SoundName = (typeof SOUND_NAMES)[number]

/** The only color format a folder tab accepts; it ends up in a style attribute. */
export const HEX_COLOR = /^#[0-9a-f]{6}$/i

/** A Telegram bot token as @BotFather gives it; it goes into the Bot API's URL path. */
export const TELEGRAM_BOT_TOKEN = /^\d{5,15}:[A-Za-z0-9_-]{30,60}$/
/** `telegramAwayMinutes` for a message every time, even with the app in front of you. */
export const TELEGRAM_ALWAYS = -1
/** A chat's numeric id (a group's is negative) or a public channel's @username. */
export const TELEGRAM_CHAT_ID = /^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/
/** Remote control needs your own private chat with the bot: its id is your (positive) user id. */
export const TELEGRAM_PRIVATE_CHAT = /^\d{1,20}$/

export type TerminalKind = 'claude' | 'shell'

/** What a terminal runs: claude in some launch mode, or one of the detected shells. */
export type TerminalSpec =
  | {
      kind: 'claude'
      mode: LaunchMode
      /** Resume this exact conversation (implies mode 'resume'). */
      resumeId?: string
      /** Start the new conversation under this id (mode 'new'), so it can be resumed later. */
      sessionId?: string
    }
  | { kind: 'shell'; shellId: string }

export interface StartSessionRequest {
  cwd: string
  spec: TerminalSpec
  cols: number
  rows: number
}

export interface SessionInfo {
  id: string
  cwd: string
  spec: TerminalSpec
  pid: number
  /** Human-readable command line, for the status bar. */
  command: string
}

export type StartSessionErrorCode =
  'CLAUDE_NOT_FOUND' | 'SHELL_NOT_FOUND' | 'INVALID_CWD' | 'INVALID_REQUEST' | 'SPAWN_FAILED'

export interface ShellProfile {
  id: string
  label: string
}

/** A previous claude conversation in a folder, as stored by Claude Code. */
export interface PastSession {
  id: string
  title: string
  firstPrompt: string | null
  /** Last write to the transcript, epoch ms. */
  lastActive: number
}

export type StartSessionResult =
  { ok: true; session: SessionInfo } | { ok: false; code: StartSessionErrorCode; error: string }

export interface ClaudeStatus {
  found: boolean
  path: string | null
  /** True when the path came from settings or CLAUDE_HELPER_CLAUDE_PATH rather than auto-detection. */
  explicit: boolean
}

export interface ClipboardContent {
  text: string
  hasImage: boolean
}

export interface AppInfo {
  platform: string
  /** Windows build number (e.g. 26200), 0 elsewhere. Used by xterm.js ConPTY heuristics. */
  windowsBuild: number
  version: string
  /** Set by the e2e harness: renderer avoids WebGL so terminal text is readable from the DOM. */
  e2e: boolean
}

/** Another session the terminal's text can be sent to. */
export interface SendTarget {
  /** Its terminal key. */
  key: string
  /** "Claude 2 · my project". */
  label: string
}

/** What the right-click menu of a terminal offers. */
export interface ContextMenuRequest {
  hasSelection: boolean
  /** A running Claude: a screen snip can go into its prompt. */
  canSnip: boolean
  targets: SendTarget[]
}

/** `bookmark`: bookmark the selection (or copied text); `pasteBookmark`: that prompt's id. */
export type ContextMenuChoice =
  | 'copy'
  | 'paste'
  | 'selectAll'
  | 'snip'
  | 'bookmark'
  | { sendTo: string }
  | { pasteBookmark: string }
  | null

/** How a screen snip ended; 'unavailable' when the system has no tool for it. */
export type SnipResult = 'captured' | 'cancelled' | 'unavailable'

/** A path in terminal output that exists, so Ctrl+click can open it. */
export interface FileLink {
  /** Absolute. */
  path: string
  /** A program or script is only shown in its folder: opening it would run it. */
  kind: 'file' | 'folder' | 'program'
}

/** Claude finished, asks for your answer, or still waits for it (a reminder). */
export type AttentionEvent = 'finished' | 'asking' | 'reminder'
export const ATTENTION_EVENTS: readonly AttentionEvent[] = ['finished', 'asking', 'reminder']

/** A Claude session stopped and waits for you; main tells the OS if the window is in the background. */
export interface AttentionRequest {
  /** The terminal, so clicking the notification can bring it up. */
  key: string
  title: string
  body: string
  /**
   * What happened, where ("my project › Claude 2") and the conversation's title, or '': Telegram
   * words its own message from them.
   */
  event: AttentionEvent
  source: string
  topic: string
  /**
   * It came from the pane you had focused: no OS notification, but you may have walked away
   * (Telegram's "away" mode).
   */
  seen?: boolean
  /** The choice Claude waits for, so Telegram can offer it as buttons (with remote control on). */
  question?: ClaudeQuestion
  /**
   * The chat is driven from Telegram, so remote control tells Telegram itself (Claude's whole
   * reply, its questions): no message of its own about this call.
   */
  skipTelegram?: boolean
  /** The session's topic in Telegram (a thread of your chat), for when the bot has topics. */
  telegramTopic?: TopicRef
}

/**
 * Claude's last turn in a chat's conversation, from its transcript: `turn` with the text Claude
 * wrote in it (markdown); `earlier` when that turn started before `since` (the prompt it was
 * asked for is still queued); `unknown` when there is no transcript to read.
 */
export type ClaudeTurnResult =
  { kind: 'turn'; text: string } | { kind: 'earlier' } | { kind: 'unknown' }

/** A choice Claude waits for, as read from its screen. */
export interface ClaudeQuestion {
  /** Changes with the question, so an answer meant for an earlier one is turned down. */
  id: string
  /** What the dialog shows above its options: the tool call, its command or diff, the question. */
  text: string
  options: { n: number; label: string }[]
  /** Several options can be ticked: that is answered on the computer. */
  multi: boolean
  /** The option that takes your own words ("Type something."), if there is one. */
  freeText: number | null
}

/** A button under a bot message; `data` comes back when it is pressed (at most 64 bytes). */
export interface TelegramButton {
  label: string
  data: string
}

export interface TelegramMessage {
  text: string
  /** Shown monospace below the text (a screen, a question); its start is cut when too long. */
  pre?: string
  /**
   * Shown formatted below the text instead (Claude's reply): split over several messages when
   * long, with its start cut when even those can't hold it. Buttons go under the last one.
   */
  markdown?: string
  /** Rows of buttons. */
  buttons?: TelegramButton[][]
  /** The message this one answers. */
  replyTo?: number
  /** Opens Telegram's reply box on this message (for a name it asks for). No buttons then. */
  forceReply?: boolean
  /** The topic it goes in (a thread of your chat with the bot); none: the main chat. */
  thread?: number
}

/**
 * Telegram's topic colours (a bot can only pick one of these). With Threaded Mode on for the bot
 * in @BotFather, each Claude session has a topic in your chat with it.
 */
export const TOPIC_COLORS = [0x6fb9f0, 0xffd67e, 0xcb86db, 0x8eee98, 0xff93b2, 0xfb6f5f] as const

/** A session's topic: its name and colour, and its thread once it has one. */
export interface TopicRef {
  name: string
  color: number
  thread?: number
}

/** A bot message about a tab: replies to it, and its buttons, then belong to that tab. */
export interface TelegramOutgoing extends TelegramMessage {
  key?: string
  /** It goes in the tab's topic, made now if it has none yet (when the bot has topics). */
  topic?: TopicRef
}

/** A bot message sent: its id (the last, for a long one; null if not sent) and its topic, if any. */
export interface TelegramSent {
  messageId: number | null
  thread?: number
}

/**
 * What you sent the bot from your own chat. `key`: the tab of the bot message you replied to (or
 * whose button you pressed), when that message was about one. `thread`: the topic it was written
 * in, if not the main chat.
 */
export type TelegramIncoming =
  | {
      kind: 'command'
      command: string
      args: string
      messageId: number
      replyTo?: number
      key?: string
      thread?: number
    }
  | {
      kind: 'text'
      text: string
      messageId: number
      replyTo?: number
      key?: string
      thread?: number
    }
  | {
      kind: 'button'
      data: string
      messageId: number
      callbackId: string
      key?: string
      thread?: number
    }

/** A Telegram call from Settings; finding the chat also gives its id and name. */
export type TelegramResult =
  | {
      ok: true
      chatId?: string
      chatName?: string
      /** The message sent; the last of them when it took several. */
      messageId?: number
      messageIds?: number[]
      /** Telegram no longer knows the topic it was meant for: it went to the main chat. */
      threadGone?: boolean
      /** The bot has Threaded Mode on, so sessions get topics (from the test message). */
      topics?: boolean
    }
  | { ok: false; error: string }

/** How many sessions ask for your answer, finished unseen, or work (muted ones left out). */
export interface WaitingSummary {
  asking: number
  finished: number
  working: number
}

/** A folder's git state: its branch (or short commit when detached) and uncommitted changes. */
export interface GitInfo {
  branch: string
  /** null when git itself couldn't be run. */
  dirty: boolean | null
}

export interface ConfirmOptions {
  message: string
  detail?: string
  okLabel: string
}

export const IPC = {
  sessionStart: 'session:start',
  sessionWrite: 'session:write',
  sessionResize: 'session:resize',
  sessionKill: 'session:kill',
  sessionData: 'session:data',
  sessionExit: 'session:exit',
  settingsGet: 'settings:get',
  settingsUpdate: 'settings:update',
  recentRemove: 'recent:remove',
  folderColorSet: 'folder:setColor',
  folderTitleSet: 'folder:setTitle',
  folderMutedSet: 'folder:setMuted',
  openFolder: 'app:openFolder',
  claudeStatus: 'claude:status',
  pickFolder: 'dialog:pickFolder',
  pickExecutable: 'dialog:pickExecutable',
  pickPicture: 'dialog:pickPicture',
  readPicture: 'picture:read',
  confirm: 'dialog:confirm',
  contextMenu: 'menu:terminalContext',
  clipboardRead: 'clipboard:read',
  clipboardWrite: 'clipboard:write',
  openExternal: 'app:openExternal',
  appInfo: 'app:info',
  shellsList: 'shells:list',
  pastSessions: 'sessions:past',
  uiLoad: 'ui:load',
  uiSave: 'ui:save',
  uiFlushRequest: 'ui:flushRequest',
  attentionNotify: 'attention:notify',
  attentionSummary: 'attention:summary',
  attentionFocus: 'attention:focus',
  gitInfo: 'git:info',
  snipCapture: 'snip:capture',
  fileLinksResolve: 'files:resolveLinks',
  fileLinkOpen: 'files:openLink',
  telegramTest: 'telegram:test',
  telegramFindChat: 'telegram:findChat',
  telegramIncoming: 'telegram:incoming',
  telegramSend: 'telegram:send',
  telegramEdit: 'telegram:edit',
  telegramAnswerButton: 'telegram:answerButton',
  telegramTopic: 'telegram:topic',
  telegramTopicsCheck: 'telegram:topicsCheck',
  telegramTopicRename: 'telegram:topicRename',
  claudeTurn: 'claude:turn',
  bookmarksLoad: 'bookmarks:load',
  bookmarksSave: 'bookmarks:save'
} as const

/** The API the preload script exposes as `window.api`. */
export interface ClaudeHelperApi {
  appInfo(): Promise<AppInfo>
  startSession(req: StartSessionRequest): Promise<StartSessionResult>
  write(id: string, data: string, binary?: boolean): void
  resize(id: string, cols: number, rows: number): void
  kill(id: string): Promise<void>
  onData(listener: (id: string, data: string) => void): () => void
  onExit(listener: (id: string, exitCode: number) => void): () => void
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  removeRecent(folder: string): Promise<Settings>
  /** Sets a folder's tab color (#rrggbb), or clears it with null. */
  setFolderColor(folder: string, color: string | null): Promise<Settings>
  /** Sets a folder's tab title; null or blank goes back to the folder's name. */
  setFolderTitle(folder: string, title: string | null): Promise<Settings>
  /** Mutes a folder's sessions (no sounds, toasts or notifications), or unmutes them. */
  setFolderMuted(folder: string, muted: boolean): Promise<Settings>
  /** Opens the folder in the OS file manager (File Explorer, Finder, …). */
  openFolder(folder: string): void
  claudeStatus(): Promise<ClaudeStatus>
  pickFolder(): Promise<string | null>
  pickExecutable(): Promise<string | null>
  /** A picture file, for behind the terminals. */
  pickPicture(): Promise<string | null>
  /**
   * The saved background picture's type and bytes (only that one can be read); null when there is
   * none, or it is missing, too big or not a picture.
   */
  readPicture(): Promise<{ type: string; data: Uint8Array } | null>
  confirm(opts: ConfirmOptions): Promise<boolean>
  contextMenu(req: ContextMenuRequest): Promise<ContextMenuChoice>
  readClipboard(): Promise<ClipboardContent>
  writeClipboard(text: string): void
  openExternal(url: string): void
  getPathForFile(file: File): string
  listShells(): Promise<ShellProfile[]>
  listPastSessions(cwd: string, limit: number): Promise<PastSession[]>
  /** The UI saved at last exit (already validated), or null. */
  loadUiState(): Promise<UiState | null>
  /**
   * Persists the UI and returns each Claude terminal's current conversation id, as Claude Code
   * reports it (it changes after /clear or /resume inside claude).
   */
  saveUiState(state: UiState): Promise<Record<string, string>>
  /** Main asks for an immediate save (before quitting). */
  onUiFlushRequest(listener: () => void): () => void
  /** Flashes the taskbar button and shows an OS notification, unless the window has the focus. */
  notifyAttention(req: AttentionRequest): void
  /** What the sessions are doing, for the taskbar button and the dock / launcher badge. */
  setAttentionSummary(summary: WaitingSummary): void
  /** The user clicked a notification: bring up this terminal. */
  onAttentionFocus(listener: (key: string) => void): () => void
  /** The folder's git branch and whether it has uncommitted changes; null outside a repository. */
  gitInfo(folder: string): Promise<GitInfo | null>
  /**
   * Lets you pick a region of the screen with the system's own tool (the app steps aside
   * meanwhile); 'captured' when the image is on the clipboard.
   */
  snip(): Promise<SnipResult>
  /**
   * Which of these paths from a terminal line exist, relative to the terminal's folder `cwd`,
   * absolute or under ~: each one's link, or null.
   */
  resolveFileLinks(cwd: string, paths: string[]): Promise<(FileLink | null)[]>
  /** Opens a file or folder with its default program; a program is only shown in its folder. */
  openFileLink(path: string): void
  /** Sends a test message with these (maybe unsaved) Telegram settings. */
  testTelegram(token: string, chatId: string): Promise<TelegramResult>
  /** The chat that last wrote to the bot (after you press Start in it), for its id. */
  findTelegramChat(token: string): Promise<TelegramResult>
  /** What you send the bot from your chat, with remote control on. */
  onTelegramIncoming(listener: (msg: TelegramIncoming) => void): () => void
  /** Sends a bot message to your chat: where it went, or a null id when it couldn't be sent. */
  sendTelegram(msg: TelegramOutgoing): Promise<TelegramSent>
  /** Changes a bot message's text and buttons; null only takes its buttons away. */
  editTelegram(messageId: number, msg: TelegramMessage | null): void
  /** Ends a button press's spinner in Telegram, with a short popup text if given. */
  answerTelegramButton(callbackId: string, text?: string): void
  /**
   * A tab got its Telegram topic (`thread`), or lost it (null: Telegram no longer knows it, so it
   * gets a new one next time).
   */
  onTelegramTopic(listener: (key: string, thread: number | null) => void): () => void
  /** Renames a session's topic, after its tab or folder was renamed. */
  renameTelegramTopic(thread: number, name: string): void
  /** Whether this (maybe unsaved) bot has Threaded Mode on, as `topics`; nothing is sent. */
  checkTelegramTopics(token: string): Promise<TelegramResult>
  /**
   * What Claude wrote in the last turn of this Claude tab's conversation, once that turn has
   * ended; `since` (epoch ms, 0 for any): the turn for a prompt sent then, not an earlier one.
   */
  claudeTurn(key: string, since: number): Promise<ClaudeTurnResult>
  loadBookmarks(): Promise<BookmarkNode[]>
  /** Replaces all bookmarks; returns what was kept (invalid entries are dropped). */
  saveBookmarks(items: BookmarkNode[]): Promise<BookmarkNode[]>
}
