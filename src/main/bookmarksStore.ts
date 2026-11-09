import type { MenuItemConstructorOptions } from 'electron'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import {
  BOOKMARK_ID,
  MAX_BOOKMARK_DEPTH,
  MAX_BOOKMARK_TITLE,
  MAX_BOOKMARKS,
  MAX_PROMPT_LENGTH,
  titleFromText,
  type BookmarkNode
} from '../shared/bookmarks'
import { isHotkey } from '../shared/hotkeys'

/**
 * Keeps only valid bookmarks from untrusted input (the file or an IPC payload): known types,
 * unique ids, a title for folders, some text for prompts, and limits on size and depth.
 */
export function sanitizeBookmarks(input: unknown): BookmarkNode[] {
  const seen = new Set<string>()
  // A hotkey pastes one prompt: the first that has it keeps it.
  const hotkeys = new Set<string>()
  let left = MAX_BOOKMARKS
  const walk = (items: unknown, depth: number): BookmarkNode[] => {
    if (!Array.isArray(items) || depth > MAX_BOOKMARK_DEPTH) return []
    const out: BookmarkNode[] = []
    for (const item of items) {
      if (left <= 0) break
      if (!item || typeof item !== 'object') continue
      const raw = item as Record<string, unknown>
      if (typeof raw.id !== 'string' || !BOOKMARK_ID.test(raw.id) || seen.has(raw.id)) continue
      const title =
        typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_BOOKMARK_TITLE) : ''
      if (raw.type === 'folder' && title) {
        seen.add(raw.id)
        left--
        out.push({
          type: 'folder',
          id: raw.id,
          title,
          ...(raw.collapsed === true ? { collapsed: true } : {}),
          children: walk(raw.children, depth + 1)
        })
      } else if (raw.type === 'prompt' && typeof raw.text === 'string' && raw.text.trim()) {
        if (raw.text.length > MAX_PROMPT_LENGTH) continue
        seen.add(raw.id)
        left--
        const hotkey = isHotkey(raw.hotkey) && !hotkeys.has(raw.hotkey) ? raw.hotkey : null
        if (hotkey) hotkeys.add(hotkey)
        out.push({
          type: 'prompt',
          id: raw.id,
          title: title || titleFromText(raw.text),
          text: raw.text,
          ...(hotkey ? { hotkey } : {})
        })
      }
    }
    return out
  }
  return walk(input, 1)
}

const MENU_LABEL = 60

/** A title for a menu: short, and with & kept literal (it would mark a mnemonic on Windows). */
function menuLabel(title: string): string {
  const short = title.length > MENU_LABEL ? `${title.slice(0, MENU_LABEL - 1)}…` : title
  return short.replace(/&/g, '&&')
}

/** Keys Electron can show in a menu, by its names for them. */
const ACCELERATOR_KEY =
  /^([A-Z0-9]|F\d{1,2}|num\d|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right|Return|Escape|[-=[\]\\;',./`])$/

/**
 * A hotkey as a menu shows it (only shown: the terminal handles the keys). Null for a key
 * Electron has no name for, so a menu never gets one it can't read.
 */
export function menuAccelerator(
  hotkey: string | undefined,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (!hotkey || !isHotkey(hotkey)) return null
  const parts = hotkey.split('+')
  const key = parts.pop()!
  const mods = parts.map((m) => (m === 'Cmd' && platform !== 'darwin' ? 'Super' : m))
  const name =
    key === 'Enter' ? 'Return' : key === 'Esc' ? 'Escape' : key.replace(/^Num(\d)$/, 'num$1')
  return ACCELERATOR_KEY.test(name) ? [...mods, name].join('+') : null
}

/** The bookmarks as menu items: a folder is a submenu, a prompt calls `pick` with its id. */
export function bookmarkMenuItems(
  nodes: BookmarkNode[],
  pick: (id: string) => void
): MenuItemConstructorOptions[] {
  if (nodes.length === 0) return [{ label: 'Empty', enabled: false }]
  return nodes.map((n) => {
    if (n.type === 'folder') {
      return { label: menuLabel(n.title), submenu: bookmarkMenuItems(n.children, pick) }
    }
    const accelerator = menuAccelerator(n.hotkey)
    return {
      label: menuLabel(n.title),
      click: () => pick(n.id),
      ...(accelerator ? { accelerator, registerAccelerator: false } : {})
    }
  })
}

export class BookmarksStore {
  private items: BookmarkNode[]

  constructor(private readonly filePath: string) {
    this.items = this.load()
  }

  get(): BookmarkNode[] {
    return this.items
  }

  /** Replaces all bookmarks; returns what was kept. */
  save(input: unknown): BookmarkNode[] {
    this.items = sanitizeBookmarks(input)
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    // Write-then-rename so a crash mid-write can't leave a truncated file.
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify({ version: 1, items: this.items }, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
    return this.items
  }

  private load(): BookmarkNode[] {
    if (!existsSync(this.filePath)) return []
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as { items?: unknown } | null
      return sanitizeBookmarks(raw?.items)
    } catch {
      // Prompts may have been written by hand: keep a copy before the next save replaces it.
      try {
        copyFileSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`)
      } catch {
        // Nothing more to save.
      }
      return []
    }
  }
}
