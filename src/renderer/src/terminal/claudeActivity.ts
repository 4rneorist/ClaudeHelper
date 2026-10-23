// What Claude Code is doing, read from the window title it sets (OSC 0) and from its screen.
// While it works the title starts with a spinner glyph ("◐ Fix the login bug", "◑ …"), and with
// "✳" once it stops. Stopped can mean done, or asking you something (a permission prompt, a
// question, a plan to approve): those draw a list of choices on screen. Pure, for unit tests.

/** working, stopped and done (idle), or stopped and waiting for your choice (asking). */
export type ClaudeActivity = 'working' | 'idle' | 'asking'

/** Claude's idle marker. */
const IDLE = '✳'

/** Spinner frames: circle halves and quarters, and braille dots (older Claude versions). */
function isSpinner(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0
  return (code >= 0x25d0 && code <= 0x25d3) || (code >= 0x2801 && code <= 0x28ff)
}

/** Working or stopped; null when the title isn't one of Claude's (a shell, another program). */
export function activityFromTitle(title: string): 'working' | 'idle' | null {
  const [first] = [...title.trimStart()]
  if (!first) return null
  if (first === IDLE) return 'idle'
  return isSpinner(first) ? 'working' : null
}

/** How far up from the last line of text a prompt is looked for. */
const PROMPT_LINES = 25

/**
 * The screen down to its last line of text. After a clear, or before the screen fills, the text
 * sits at the top with empty rows below it.
 */
function content(screen: string[]): string[] {
  let end = screen.length
  while (end > 0 && !screen[end - 1].trim()) end--
  return screen.slice(0, end)
}

/**
 * A choice Claude waits for: the cursor (❯) on a numbered option, and the "Esc to cancel" hint
 * every such prompt shows. The plain input prompt is also "❯", but with neither.
 */
export function isAsking(screen: string[]): boolean {
  const bottom = content(screen).slice(-PROMPT_LINES)
  return (
    bottom.some((line) => /^\s*❯\s*\d+\.\s/.test(line)) &&
    bottom.some((line) => /\bEsc to cancel\b/i.test(line))
  )
}

/** A rule line of Claude's input box (or of a dialog). */
const RULE = /^\s*─{8,}/

/**
 * The last `count` lines worth previewing. Claude's screen ends with its input box and status
 * line, between rules (─────); those are cut off to show the conversation above. A question it
 * asks is shown as it is.
 */
export function previewOf(screen: string[], count: number): string[] {
  let lines = content(screen.map((line) => line.trimEnd()))
  if (!isAsking(lines)) {
    const bottom = lines.length - PROMPT_LINES
    const rules = lines.flatMap((line, i) => (i >= bottom && RULE.test(line) ? [i] : []))
    if (rules.length >= 2) lines = lines.slice(0, rules[rules.length - 2])
  }
  return lines.filter((line) => line.trim()).slice(-count)
}

/** The title without the activity glyph: Claude's name for the conversation. */
export function conversationTitle(title: string): string {
  return activityFromTitle(title) ? [...title.trimStart()].slice(1).join('').trim() : title.trim()
}
