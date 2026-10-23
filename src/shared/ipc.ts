// Single contract between main, preload and renderer.

import type { UiState } from './uiState'
export type { UiState } from './uiState'

export type LaunchMode = 'new' | 'continue' | 'resume'
export const LAUNCH_MODES: readonly LaunchMode[] = ['new', 'continue', 'resume']

export type ThemeSetting = 'system' | 'dark' | 'light'
export const THEME_SETTINGS: readonly ThemeSetting[] = ['system', 'dark', 'light']

export interface Settings {
  /** Explicit path to the claude executable. Empty string = auto-detect. */
  claudePath: string
  fontSize: number
  theme: ThemeSetting
  /**
   * Windows only: use the ConPTY build bundled with node-pty (Windows Terminal's OpenConsole)
   * instead of the system's. node-pty marks it experimental, and it can crash the app on exit.
   */
  experimentalConptyDll: boolean
  /** Reopen the folders, tabs, splits and Claude conversations that were open at last exit. */
  restoreSession: boolean
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

export type ContextMenuChoice = 'copy' | 'paste' | 'selectAll' | null

/** A Claude session stopped and waits for you; main tells the OS if the window is in the background. */
export interface AttentionRequest {
  /** The terminal, so clicking the notification can bring it up. */
  key: string
  title: string
  body: string
}

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
  gitInfo: 'git:info'
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
  confirm(opts: ConfirmOptions): Promise<boolean>
  contextMenu(hasSelection: boolean): Promise<ContextMenuChoice>
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
}
