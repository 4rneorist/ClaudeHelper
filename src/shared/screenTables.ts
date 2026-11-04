// Claude Code draws a markdown table as a grid as wide as its terminal: ┌─┬─┐ above, the header,
// ├─┼─┤ under it and between rows, └─┴─┘ below. A cell's text wraps inside its column, so a row
// takes several lines. A phone wraps those long lines again and the grid falls apart, so for
// Telegram a table becomes a small grid when it fits a phone, and otherwise its rows one after
// another ("Header: value"). Rules as wide as the terminal are cut short. Pure, for unit tests.

/** About as many characters as a phone shows across a monospace block. */
const PHONE_COLUMNS = 36
/** What a rule as wide as the terminal becomes. */
const SHORT_RULE = '─'.repeat(20)

/**
 * A border of a table with two columns or more: ┌──┬──┐, ├──┼──┤ or └──┴──┘. A message that
 * starts with a table has Claude's bullet in front of its top border: "● ┌──┬──┐".
 */
const BORDER = /^\s*(?:[●⏺]\s*)?([┌├└])─*(?:[┬┼┴]─*)+[┐┤┘]$/
/** A line of a table's row: │ a │ b │. */
const ROW = /^\s*│(.*)│$/
/** A line that is nothing but a rule. */
const RULE = /^\s*[─━═]+$/

/** A table's row: its cells' text. */
export type Row = string[]

/** The text with its tables and rules made to fit a phone. */
export function readableText(text: string): string {
  return readableLines(text.split('\n')).join('\n')
}

/** The lines with their tables and rules made to fit a phone. */
export function readableLines(lines: string[]): string[] {
  const out: string[] = []
  let afterTable = false
  for (let i = 0; i < lines.length;) {
    const end = tableEnd(lines, i)
    if (end > i) {
      if (out.length && out[out.length - 1].trim()) out.push('')
      out.push(...tableLines(lines.slice(i, end)))
      afterTable = true
      i = end
      continue
    }
    const line = lines[i++]
    if (afterTable && line.trim()) out.push('')
    afterTable = false
    out.push(RULE.test(line) && line.trim().length > SHORT_RULE.length ? SHORT_RULE : line)
  }
  return out
}

/**
 * Where the table starting at `start` ends (its bottom border included); `start` when there is
 * none. Its top can be missing: a screen can start in the middle of a table.
 */
function tableEnd(lines: string[], start: number): number {
  let end = start
  let bordered = false
  while (end < lines.length) {
    const line = lines[end].trimEnd()
    const border = BORDER.exec(line)
    if (!border && !ROW.test(line)) break
    // A table starts with its top border, and ends with its bottom one.
    if (border?.[1] === '┌' && end > start) break
    end++
    if (border) {
      bordered = true
      if (border[1] === '└') break
    }
  }
  return bordered ? end : start
}

/** The table's rows, each with its cells' lines put together, and its header when it shows. */
function parseTable(lines: string[]): { header: Row | null; rows: Row[] } {
  // The lines between two borders make a row; the one between the top border and the next is
  // the header.
  const groups: { above: string; below: string; lines: Row[] }[] = []
  let above = ''
  let rowLines: Row[] = []
  for (const raw of lines) {
    const line = raw.trimEnd()
    const border = BORDER.exec(line)
    if (!border) {
      rowLines.push(
        ROW.exec(line)![1]
          .split('│')
          .map((cell) => cell.trim())
      )
      continue
    }
    if (rowLines.length) groups.push({ above, below: border[1], lines: rowLines })
    rowLines = []
    above = border[1]
  }
  if (rowLines.length) groups.push({ above, below: '', lines: rowLines })
  const rows = groups.map((g) => joinLines(g.lines))
  const top = groups[0]
  const header = top && top.above === '┌' && top.below === '├' ? rows.shift()! : null
  return { header, rows }
}

/** A row's lines as one: each cell's text, its lines joined with spaces. */
function joinLines(lines: Row[]): Row {
  const columns = Math.max(...lines.map((l) => l.length))
  return Array.from({ length: columns }, (_, c) =>
    lines
      .map((l) => l[c] ?? '')
      .filter(Boolean)
      .join(' ')
  )
}

function tableLines(lines: string[]): string[] {
  const parsed = parseTable(lines)
  const header = parsed.rows.length ? parsed.header : null
  const rows = parsed.rows.length ? parsed.rows : parsed.header ? [parsed.header] : []
  const grid = phoneGrid(header, rows)
  if (grid) return grid
  const blocks = rowFields(header, rows).map((fields) =>
    fields.map((f) => (f.name ? `${f.name}: ${f.value}` : f.value))
  )
  return blocks.flatMap((fields, n) => (n ? ['', ...fields] : fields))
}

/**
 * A table as a grid without its outer border, its header underlined, when that fits a phone;
 * null when it doesn't.
 */
export function phoneGrid(header: Row | null, rows: Row[]): string[] | null {
  const all = header ? [header, ...rows] : rows
  const columns = Math.max(0, ...all.map((r) => r.length))
  const widths = Array.from({ length: columns }, (_, c) =>
    Math.max(...all.map((r) => (r[c] ?? '').length))
  )
  if (widths.reduce((sum, w) => sum + w, 0) + 3 * (columns - 1) > PHONE_COLUMNS) return null
  const line = (r: Row): string =>
    widths
      .map((w, c) => (r[c] ?? '').padEnd(w))
      .join(' │ ')
      .trimEnd()
  if (!header) return rows.map(line)
  return [line(header), widths.map((w) => '─'.repeat(w)).join('─┼─'), ...rows.map(line)]
}

/**
 * A table too wide for a phone, a row after another: a field a line, named by its column when
 * the header shows; else the row's cells on one line, between │. Empty cells and rows are left
 * out.
 */
export function rowFields(header: Row | null, rows: Row[]): { name: string; value: string }[][] {
  const named = header && rows.every((r) => r.length === header.length) ? header : null
  return rows
    .map((r) =>
      named
        ? r.flatMap((cell, c) => (cell ? [{ name: named[c], value: cell }] : []))
        : [{ name: '', value: r.filter(Boolean).join(' │ ') }].filter((f) => f.value)
    )
    .filter((fields) => fields.length)
}
