import type { ClaudeQuestion } from '../../../shared/ipc'

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

/** An option of a question: "❯ 1. Yes" with the cursor on it, or "  2. No". */
const OPTION = /^\s*(?:❯\s*)?(\d{1,2})\.\s+(.*\S)\s*$/
/** How far above its options the text of a question is looked for. */
const QUESTION_LINES = 30
/** The tick box in front of an option of a question that takes several answers: "[ ] Apple". */
const TICK = /^(\[[ x✓✔]\]|[☐☑☒◯◉])\s/u
const TICKED = /^(\[[x✓✔]\]|[☑☒◉])\s/u
/** The option of a question that takes your own words. */
const FREE_TEXT = /^type something\.?$/i

/**
 * The last screen of Claude's question form, once every question has its answer: "Ready to submit
 * your answers?", with Submit as option 1.
 */
export function isSubmitScreen(screen: string[]): boolean {
  return screen.some((line) => /^\s*(?:❯\s*)?1\.\s+Submit answers\b/.test(line))
}

/** The option's text without its tick box. */
export function withoutTickBox(label: string): string {
  return label.replace(TICK, '')
}

/** The option has a tick box: its question takes several answers. */
export function hasTickBox(label: string): boolean {
  return TICK.test(label)
}

export function isTicked(label: string): boolean {
  return TICKED.test(label)
}

/** A question as read off the screen; `cursor` is the option the ❯ is on. */
export type ScreenQuestion = ClaudeQuestion & { cursor: number }

/**
 * The choice Claude waits for, with what its dialog shows above the options (the tool call and
 * its command or diff, the question) as `text`; null when it isn't asking.
 */
export function questionOf(screen: string[]): ScreenQuestion | null {
  const lines = content(screen.map((line) => line.trimEnd()))
  if (!isAsking(lines)) return null
  // Up from the last option, each one before it down to 1: numbered lines further up (a diff,
  // Claude's own list) are left alone.
  const bottom = Math.max(0, lines.length - PROMPT_LINES)
  const last = lines.findLastIndex((line, i) => i >= bottom && OPTION.test(line))
  if (last < 0) return null
  const options: { n: number; label: string; row: number }[] = []
  let want = Number(OPTION.exec(lines[last])![1])
  for (let i = last; i >= 0 && want >= 1 && last - i <= PROMPT_LINES; i--) {
    const m = OPTION.exec(lines[i])
    if (m && Number(m[1]) === want) {
      options.unshift({ n: want, label: m[2], row: i })
      want--
    }
  }
  if (want !== 0) return null
  const first = options[0].row
  // The dialog starts below a rule; without one, a screenful above the options at most.
  let top = Math.max(0, first - QUESTION_LINES)
  const rule = lines.slice(top, first).findLastIndex((line) => RULE.test(line))
  if (rule >= 0) top += rule + 1
  const shown = lines
    .slice(top, last + 1)
    .filter((line) => line.trim() && !RULE.test(line))
    .map((line) => line.replace(/^(\s*)❯/, '$1 '))
  const text = dedent(shown).join('\n')
  const cursor = options.find((o) => /^\s*❯/.test(lines[o.row]))?.n ?? 1
  return {
    id: hashOf(text),
    text,
    options: options.map(({ n, label }) => ({ n, label })),
    multi: options.some((o) => TICK.test(o.label)),
    freeText: options.find((o) => FREE_TEXT.test(o.label.replace(TICK, '')))?.n ?? null,
    cursor
  }
}

/** The lines without the indentation they all share. */
function dedent(lines: string[]): string[] {
  const indent = Math.min(...lines.map((line) => line.length - line.trimStart().length))
  return Number.isFinite(indent) ? lines.map((line) => line.slice(indent)) : lines
}

/** A short id that changes with the text (FNV-1a). */
function hashOf(text: string): string {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

/** One of your messages starts here: "❯ text" (older versions: "> text"), from the first column. */
const PROMPT = /^[❯>] \S/
/** A choice in a question Claude asks ("❯ 1. Yes"), not a message. */
const CHOICE = /^❯\s*\d+\.\s/

/**
 * The rows where your messages to Claude start. The input box at the bottom also starts with "❯",
 * but right under a rule (─────), so it doesn't count; nor do the choices of a question.
 */
export function promptRows(lines: string[]): number[] {
  return lines.flatMap((line, i) =>
    PROMPT.test(line) && !CHOICE.test(line) && !(i > 0 && RULE.test(lines[i - 1])) ? [i] : []
  )
}

/**
 * Where to scroll for the previous (-1) or next (1) message, given the prompt rows and the view:
 * the buffer row at its top, whether it is scrolled to the bottom, and the screen's height.
 * At the bottom, the last message comes first even when it is on screen. null: no further one.
 */
export function promptTarget(
  rows: number[],
  view: { top: number; bottom: boolean; screen: number },
  dir: 1 | -1
): number | null {
  if (dir > 0) return rows.find((r) => r > view.top) ?? null
  const limit = view.bottom ? view.top + view.screen : view.top
  return rows.findLast((r) => r < limit && r !== view.top) ?? null
}

/**
 * Claude's transcript view (Ctrl+O). In the fullscreen renderer it is where `[` writes the whole
 * conversation into the terminal's own scrollback, so it can be searched and scrolled.
 */
export function isTranscriptView(screen: string[]): boolean {
  return screen.some((line) => /\bShowing detailed transcript\b/.test(line))
}

/** The title without the activity glyph: Claude's name for the conversation. */
export function conversationTitle(title: string): string {
  return activityFromTitle(title) ? [...title.trimStart()].slice(1).join('').trim() : title.trim()
}
