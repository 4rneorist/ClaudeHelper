// Decides which keystrokes the app handles itself and which go to claude untouched.
// Pure so it can be unit-tested without a DOM.

export type KeyAction =
  | { type: 'pass' }
  | { type: 'block' }
  | { type: 'copy' }
  | { type: 'paste' }
  | { type: 'newline' }
  | { type: 'zoom'; delta: 1 | -1 | 0 }
  /** New claude terminal (sub-tab) in the current folder. */
  | { type: 'newTerminal' }
  /** New top-level tab showing the start screen. */
  | { type: 'newFolderTab' }
  | { type: 'closePane' }
  | { type: 'nextTab' }
  | { type: 'prevTab' }
  | { type: 'nextFolder' }
  | { type: 'prevFolder' }
  /** Jump to the next session that asks for your answer or finished unseen. */
  | { type: 'nextWaiting' }
  /** Search the terminal's scrollback. */
  | { type: 'search' }
  /** Scroll to your previous / next message to Claude. */
  | { type: 'prevPrompt' }
  | { type: 'nextPrompt' }
  /** Pick a region of the screen and paste it into Claude's prompt as an image. */
  | { type: 'snip' }

export interface KeyInfo {
  type: string
  key: string
  /** The physical key ("KeyC"), whatever the keyboard layout makes of it. */
  code?: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

const PASS: KeyAction = { type: 'pass' }

/** Ctrl+J: inserts a newline in claude's prompt in every terminal, no setup required. */
export const NEWLINE_SEQUENCE = '\n'

/** Claude reads images straight from the OS clipboard when it sees its paste-image key. */
export function imagePasteSequence(platform: string): string {
  return platform === 'win32' ? '\x1bv' /* Alt+V */ : '\x16' /* Ctrl+V */
}

/**
 * The key as the shortcuts name it: a lower-case letter, or the key's name. A non-Latin layout
 * (Ukrainian, Russian…) types another letter on the C key, so then the physical key decides.
 */
function shortcutKey(ev: KeyInfo): string {
  if (ev.key.length !== 1) return ev.key
  if (ev.key.charCodeAt(0) > 0x7e) {
    const letter = /^Key([A-Z])$/.exec(ev.code ?? '')
    if (letter) return letter[1].toLowerCase()
  }
  return ev.key.toLowerCase()
}

function classifyKeydown(ev: KeyInfo, platform: string, hasSelection: boolean): KeyAction {
  const mac = platform === 'darwin'
  const key = shortcutKey(ev)
  const onlyShift = ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey

  if (key === 'Enter' && onlyShift) return { type: 'newline' }

  if (key === 'Tab' && ev.ctrlKey && !ev.altKey && !ev.metaKey) {
    return { type: ev.shiftKey ? 'prevTab' : 'nextTab' }
  }
  if ((key === 'PageDown' || key === 'PageUp') && ev.ctrlKey && !ev.shiftKey && !ev.altKey) {
    return { type: key === 'PageDown' ? 'nextFolder' : 'prevFolder' }
  }

  if (mac) {
    if (!ev.metaKey || ev.ctrlKey || ev.altKey) return PASS
    if (key === 'c') return hasSelection ? { type: 'copy' } : { type: 'block' }
    if (key === 'v') return { type: 'paste' }
    if (key === 't') return { type: 'newTerminal' }
    if (key === 'n') return { type: 'newFolderTab' }
    if (key === 'w') return { type: 'closePane' }
    if (key === 'f') return { type: 'search' }
    if (key === 'j' && ev.shiftKey) return { type: 'nextWaiting' }
    if (key === 's' && ev.shiftKey) return { type: 'snip' }
    if (key === 'ArrowUp' && !ev.shiftKey) return { type: 'prevPrompt' }
    if (key === 'ArrowDown' && !ev.shiftKey) return { type: 'nextPrompt' }
    if (key === '=' || key === '+') return { type: 'zoom', delta: 1 }
    if (key === '-') return { type: 'zoom', delta: -1 }
    if (key === '0') return { type: 'zoom', delta: 0 }
    return PASS
  }

  if (key === 'Insert' && onlyShift) return { type: 'paste' }
  if (!ev.ctrlKey || ev.altKey || ev.metaKey) return PASS
  if (key === 'Insert' && !ev.shiftKey) return hasSelection ? { type: 'copy' } : PASS

  if (ev.shiftKey) {
    // Ctrl+Shift+letter is free in claude, so it hosts the app's own shortcuts.
    if (key === 'c') return hasSelection ? { type: 'copy' } : { type: 'block' }
    if (key === 'v') return { type: 'paste' }
    if (key === 't') return { type: 'newTerminal' }
    if (key === 'n') return { type: 'newFolderTab' }
    if (key === 'w') return { type: 'closePane' }
    if (key === 'j') return { type: 'nextWaiting' }
    if (key === 'f') return { type: 'search' }
    if (key === 's') return { type: 'snip' }
    return PASS // e.g. Ctrl+Shift+- is claude's undo
  }

  // Ctrl+C copies only when something is selected; otherwise it must reach claude (interrupt).
  if (key === 'c') return hasSelection ? { type: 'copy' } : PASS
  if (key === 'v') return { type: 'paste' }
  if (key === 'f') return { type: 'search' }
  if (key === 'ArrowUp') return { type: 'prevPrompt' }
  if (key === 'ArrowDown') return { type: 'nextPrompt' }
  if (key === '=' || key === '+') return { type: 'zoom', delta: 1 }
  if (key === '-') return { type: 'zoom', delta: -1 }
  if (key === '0') return { type: 'zoom', delta: 0 }
  return PASS
}

/**
 * xterm calls the custom handler for keydown, keypress and keyup. The action happens on keydown;
 * the matching keypress/keyup must be blocked too or xterm would still emit characters.
 */
export function classifyKey(ev: KeyInfo, platform: string, hasSelection: boolean): KeyAction {
  const action = classifyKeydown(ev, platform, hasSelection)
  if (ev.type === 'keydown' || action.type === 'pass') return action
  return { type: 'block' }
}
