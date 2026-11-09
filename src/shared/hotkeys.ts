// Hotkeys for bookmarked prompts, like "Ctrl+Shift+C". A hotkey is matched by the physical key
// (KeyboardEvent.code), so it works whatever the keyboard layout (English, Ukrainian, Russian…).

export interface KeyPress {
  key: string
  code?: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

/** Keys named by their code that aren't letters, digits or F-keys. */
const NAMED: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Tab: 'Tab',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right'
}

const KEY_NAMES = new Set([
  ...Object.values(NAMED),
  ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'.split(''),
  ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
  ...Array.from({ length: 10 }, (_, i) => `Num${i}`)
])

/** "Ctrl+Alt+Shift+Cmd+K", modifiers in this order; Cmd is the ⌘ / Windows key. */
export const HOTKEY = /^(Ctrl\+)?(Alt\+)?(Shift\+)?(Cmd\+)?([^+]+|\+)$/

export function isHotkey(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 40) return false
  const m = HOTKEY.exec(value)
  return !!m && KEY_NAMES.has(m[5])
}

/** The key's name from its code: "KeyC" is C whatever letter the layout types there. */
function keyName(press: KeyPress): string | null {
  const code = press.code ?? ''
  let m = /^Key([A-Z])$/.exec(code)
  if (m) return m[1]
  m = /^Digit([0-9])$/.exec(code)
  if (m) return m[1]
  m = /^Numpad([0-9])$/.exec(code)
  if (m) return `Num${m[1]}`
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  if (NAMED[code]) return NAMED[code]
  // No code (rare): a plain Latin letter or digit from the key itself.
  if (!code && /^[a-z0-9]$/i.test(press.key)) return press.key.toUpperCase()
  return null
}

/** The hotkey a key press makes; null for a modifier on its own or a key it can't name. */
export function hotkeyOf(press: KeyPress): string | null {
  const name = keyName(press)
  if (!name) return null
  return [
    press.ctrlKey && 'Ctrl',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    press.metaKey && 'Cmd',
    name
  ]
    .filter(Boolean)
    .join('+')
}

/** As it is shown: on macOS Cmd and Alt by their keys' names. */
export function showHotkey(hotkey: string, platform: string): string {
  if (platform !== 'darwin') return hotkey.replace(/(^|\+)Cmd(?=\+)/, '$1Win')
  return hotkey.replace(/(^|\+)Alt(?=\+)/, '$1Option')
}

/** The modifiers held so far, while a hotkey is being recorded ("Ctrl+Shift+…"). */
export function partialHotkey(press: Omit<KeyPress, 'key' | 'code'>): string {
  const mods = [
    press.ctrlKey && 'Ctrl',
    press.altKey && 'Alt',
    press.shiftKey && 'Shift',
    press.metaKey && 'Cmd'
  ].filter(Boolean)
  return mods.length ? `${mods.join('+')}+…` : ''
}

/**
 * Why a key can't be a hotkey: without Ctrl, Alt or Cmd it would stop being typed (F-keys
 * aside), and Claude can't do without Ctrl+C, Ctrl+V or Ctrl+D.
 */
export function hotkeyProblem(hotkey: string, platform: string): string | null {
  if (!isHotkey(hotkey)) return 'Not a key this app knows'
  const m = HOTKEY.exec(hotkey)!
  const [ctrl, alt, shift, cmd, key] = [m[1], m[2], m[3], m[4], m[5]]
  if (!ctrl && !alt && !cmd && !/^F\d+$/.test(key)) {
    return 'Add Ctrl or Alt (or use an F-key): otherwise the key couldn’t be typed'
  }
  const essential =
    platform === 'darwin'
      ? cmd && !ctrl && !alt && !shift && (key === 'C' || key === 'V')
      : ctrl && !alt && !shift && !cmd && (key === 'C' || key === 'V' || key === 'D')
  if (essential) return `${hotkey} can’t be used: copying, pasting and Claude need it`
  return null
}

/** Claude Code's own default keys a hotkey would take over in Claude tabs (Alt is its "meta"). */
const CLAUDE_KEYS: Record<string, string> = {
  'Ctrl+B': 'send a task to the background',
  'Ctrl+E': 'show everything in the transcript',
  'Ctrl+G': 'open the prompt in your editor',
  'Ctrl+J': 'a new line',
  'Ctrl+L': 'redraw the screen',
  'Ctrl+O': 'the transcript',
  'Ctrl+R': 'history search',
  'Ctrl+S': 'stash the prompt',
  'Ctrl+T': 'the to-do list',
  'Ctrl+X': 'its Ctrl+X shortcuts',
  'Alt+P': 'the model picker',
  'Alt+O': 'fast mode',
  'Alt+T': 'extended thinking',
  'Alt+V': 'pasting an image',
  'Shift+Tab': 'the permission mode'
}

/** What a hotkey takes over in Claude, if anything. */
export function claudeKeyTaken(hotkey: string): string | null {
  return CLAUDE_KEYS[hotkey] ?? null
}
