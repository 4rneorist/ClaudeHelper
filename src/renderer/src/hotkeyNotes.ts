import { claudeKeyTaken, HOTKEY, isHotkey } from '../../shared/hotkeys'
import { classifyKey, type KeyAction, type KeyInfo } from './terminal/keybindings'

/** What a bookmark's hotkey takes over: the app's own shortcuts, and Claude's keys. */

const APP_SHORTCUTS: Partial<Record<KeyAction['type'], string>> = {
  paste: 'Paste',
  newline: 'New line',
  zoom: 'Zoom',
  newTerminal: 'New terminal',
  newFolderTab: 'New folder tab',
  closePane: 'Close the terminal',
  nextTab: 'Next tab',
  prevTab: 'Previous tab',
  nextFolder: 'Next folder',
  prevFolder: 'Previous folder',
  nextWaiting: 'Jump to the next waiting session',
  search: 'Search',
  prevPrompt: 'Jump to your previous prompt',
  nextPrompt: 'Jump to your next prompt',
  snip: 'Snip the screen'
}

/** event.key for a hotkey's key name, as the app's shortcuts read it. */
const KEYS: Record<string, string> = {
  Up: 'ArrowUp',
  Down: 'ArrowDown',
  Left: 'ArrowLeft',
  Right: 'ArrowRight',
  Esc: 'Escape',
  Space: ' '
}

/** The key press a hotkey stands for. */
export function pressOf(hotkey: string): KeyInfo | null {
  if (!isHotkey(hotkey)) return null
  const m = HOTKEY.exec(hotkey)!
  const name = m[5]
  const key = /^[A-Z]$/.test(name) ? name.toLowerCase() : (KEYS[name] ?? name)
  const code = /^[A-Z]$/.test(name)
    ? `Key${name}`
    : /^\d$/.test(name)
      ? `Digit${name}`
      : /^F\d+$/.test(name)
        ? name
        : undefined
  return {
    type: 'keydown',
    key,
    ...(code ? { code } : {}),
    ctrlKey: !!m[1],
    altKey: !!m[2],
    shiftKey: !!m[3],
    metaKey: !!m[4]
  }
}

/** Warnings for a hotkey: what it replaces. Copying with text selected keeps working. */
export function hotkeyNotes(hotkey: string, platform: string): string[] {
  const press = pressOf(hotkey)
  if (!press) return []
  const notes: string[] = []
  const plain = classifyKey(press, platform, false)
  const selected = classifyKey(press, platform, true)
  if (selected.type === 'copy')
    notes.push('With text selected it still copies; otherwise it pastes the prompt.')
  const shortcut = APP_SHORTCUTS[plain.type]
  if (shortcut) notes.push(`It replaces the app’s “${shortcut}” shortcut.`)
  const claude = claudeKeyTaken(hotkey)
  if (claude) notes.push(`In Claude tabs it replaces Claude’s ${claude}.`)
  return notes
}
