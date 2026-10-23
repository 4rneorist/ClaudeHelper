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
  recentFolders: string[]
}

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
  uiFlushRequest: 'ui:flushRequest'
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
}
