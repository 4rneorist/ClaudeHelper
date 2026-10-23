// The persisted UI: which folders, tabs, splits and terminals were open, so the next start can
// reopen them. Written by the renderer through main; validated by main when read back.

import type { TerminalSpec } from './ipc'

/** Longest terminal name kept, whether typed in or read back. */
export const MAX_TITLE_LENGTH = 80

/** Neither of two joined folders gets less than this share of the window's width. */
export const MIN_JOIN_SIZE = 0.15

export type Dir = 'row' | 'column'

export type LayoutNode =
  | { type: 'leaf'; id: string }
  | { type: 'split'; dir: Dir; children: LayoutNode[]; sizes: number[] }

export interface SavedTerminal {
  /** Key used by layout leaves in this file (renamed on restore). */
  key: string
  cwd: string
  title: string
  /** Tab background as #rrggbb. */
  color?: string
  /** No sounds, toasts or notifications from it. */
  muted?: boolean
  spec: TerminalSpec
  /** Claude conversation to resume. */
  claudeSessionId?: string
  /** Runtime only: lets main ask Claude Code which conversation the process has open now. */
  pid?: number
  startedAt?: number
}

export interface SavedSubTab {
  layout: LayoutNode
  activePane: string
}

export interface SavedWorkspace {
  cwd: string
  claudeCount: number
  subTabs: SavedSubTab[]
  activeSubTab: number
  /** Shown side by side, on the right of the folder at this index. */
  joinedTo?: number
  /** The left folder's share of the width in that pair. */
  joinSize?: number
}

export interface UiState {
  version: 1
  workspaces: SavedWorkspace[]
  activeWorkspace: number
  terminals: SavedTerminal[]
}
