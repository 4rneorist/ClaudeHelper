// Bookmarked prompts, in folders and subfolders. Main keeps them in bookmarks.json and validates
// what the renderer saves; the renderer edits the tree (bookmarks.ts) and shows it in a panel.

export interface BookmarkFolder {
  type: 'folder'
  id: string
  title: string
  /** Shown closed in the panel. */
  collapsed?: boolean
  children: BookmarkNode[]
}

export interface BookmarkPrompt {
  type: 'prompt'
  id: string
  title: string
  /** What goes into the prompt, as is. */
  text: string
  /** Keys that paste it into the terminal, like "Ctrl+Shift+C" (see hotkeys.ts). */
  hotkey?: string
}

export type BookmarkNode = BookmarkFolder | BookmarkPrompt

export const BOOKMARK_ID = /^[A-Za-z0-9_-]{1,40}$/
/** Levels of nesting, root-level items being the first. */
export const MAX_BOOKMARK_DEPTH = 8
export const MAX_BOOKMARKS = 2000
export const MAX_BOOKMARK_TITLE = 100
export const MAX_PROMPT_LENGTH = 50_000

const TITLE_FROM_TEXT = 60

/** A prompt's title when none is given: its first line, cut short. */
export function titleFromText(text: string): string {
  const lines = text.split('\n').map((l) => l.trim())
  const line = lines.find(Boolean) ?? ''
  return line.length > TITLE_FROM_TEXT ? `${line.slice(0, TITLE_FROM_TEXT - 1)}…` : line
}
