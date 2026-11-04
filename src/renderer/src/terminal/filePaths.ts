/** A file path in a line of terminal text: where it is written, and the path to open. */
export interface PathMatch {
  /** Where the link starts and ends in the line, a line number after the path included. */
  start: number
  end: number
  /** The path without the line number. */
  path: string
}

/** Runs of text a path can be part of: spaces, quotes and shell operators end one. */
const TOKEN = /[^\s"'`<>|]+/g
/** In quotes a path may contain spaces. */
const QUOTED = /(["'`])([^"'`\r\n]*\s[^"'`\r\n]*)\1/g
/** "file.ts:12", "file.ts:12:5" or "file.cs(12,5)": where in the file, after its path. */
const LINE_SUFFIX = /(?::\d+){1,2}$|\(\d+(?:,\d+)?\)$/
/** Claude's tool lines, "Update(src/x.ts)": the tool's name before the path. */
const TOOL_PREFIX = /^[A-Za-z]+\(/
const LEADING = /^[([{<@]+/
const TRAILING = '.,;:!?\'"'
const OPENER: Record<string, string> = { ')': '(', ']': '[', '}': '{', '>': '<' }
const MAX_PATH = 1024

function looksLikePath(p: string): boolean {
  if (p.length > MAX_PATH || !/[A-Za-z0-9]/.test(p)) return false
  if (/^[A-Za-z]:[\\/]/.test(p) || /^(?:~|\.{1,2})[\\/]/.test(p)) return true
  // Network paths are left out: checking one that is offline can take half a minute.
  if (/^[\\/]{2}/.test(p)) return false
  if (/[\\/]/.test(p)) return /[A-Za-z]/.test(p)
  // A bare file name: "README.md", "package.json".
  return /^[\w@+-][\w.@+-]*\.[A-Za-z][A-Za-z0-9]{0,9}$/.test(p)
}

const count = (text: string, c: string): number => text.split(c).length - 1

/** Drops sentence punctuation after a path, and closing brackets it didn't open. */
function trimEnd(text: string): string {
  for (;;) {
    const last = text.at(-1)
    if (!last) return text
    const open = OPENER[last]
    if (!TRAILING.includes(last) && !(open && count(text, open) < count(text, last))) return text
    text = text.slice(0, -1)
  }
}

/**
 * Text in a terminal line that looks like a file or folder path: absolute, relative to the
 * terminal's folder, or under ~. URLs are left to the web links. Whether a path exists is not
 * known here; main checks that before it becomes a link.
 */
export function findPaths(line: string): PathMatch[] {
  const found: PathMatch[] = []
  const quotes = new RegExp(QUOTED)
  for (let m = quotes.exec(line); m; m = quotes.exec(line)) {
    if (looksLikePath(m[2]) && !m[2].includes('://')) {
      const start = m.index + 1
      found.push({ start, end: start + m[2].length, path: m[2] })
    } else {
      // An apostrophe ("Claude's") is no opening quote: look again from the next character.
      quotes.lastIndex = m.index + 1
    }
  }
  const quoted = [...found]
  const inQuotes = (i: number): boolean => quoted.some((q) => i >= q.start - 1 && i <= q.end)

  for (const m of line.matchAll(TOKEN)) {
    if (m[0].includes('://') || inQuotes(m.index)) continue
    let start = m.index
    let text = m[0]
    const skip = (n: number): void => {
      start += n
      text = text.slice(n)
    }
    // VAR=path, --option=path
    skip(text.lastIndexOf('=') + 1)
    skip(TOOL_PREFIX.exec(text)?.[0].length ?? 0)
    skip(LEADING.exec(text)?.[0].length ?? 0)
    text = trimEnd(text)
    const suffix = LINE_SUFFIX.exec(text)
    const path = suffix ? text.slice(0, suffix.index) : text
    if (looksLikePath(path)) found.push({ start, end: start + text.length, path })
  }
  return found.sort((a, b) => a.start - b.start)
}
