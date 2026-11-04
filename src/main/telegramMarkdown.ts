import { phoneGrid, rowFields, type Row } from '../shared/screenTables'

// Claude writes markdown; Telegram shows a little HTML (b, i, s, code, pre, a, blockquote). Claude's
// reply becomes that, in blocks: a message shows 4096 characters at most, so a long reply is split
// between blocks into several messages. A table becomes a small grid when it fits a phone, and
// otherwise its rows one after another. No electron import: unit tested.

/** Telegram's limit on what a message shows (its text once the HTML is read). */
export const MAX_TEXT = 4096
/** What a message is filled to, leaving some room. */
const ROOM = 4000
/** A code block, quote or line longer than this is split, so a message can always hold it. */
const MAX_BLOCK = 3500
/** A reply longer than this many messages loses its start. */
export const MAX_PARTS = 5

export function escapeHtml(text: string): string {
  return text.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'))
}

/** What HTML shows: without its tags, its entities read. */
export function htmlText(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&(lt|gt|quot|amp);/g, (_, e: string) =>
      e === 'lt' ? '<' : e === 'gt' ? '>' : e === 'quot' ? '"' : '&'
    )
}

/** A piece of a message, and how many characters it shows. */
export interface HtmlBlock {
  html: string
  length: number
}

function block(html: string): HtmlBlock {
  return { html, length: htmlText(html).length }
}

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w+#.-]*)/
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)[\s#]*$/
const RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/
const BULLET = /^(\s*)[-*+]\s+/
const QUOTE = /^\s*>\s?/
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)"<>]+)\)/g

/** Inline markdown as Telegram HTML: `code`, **bold**, *italic*, ~~struck~~ and [links](…). */
export function inlineHtml(text: string): string {
  const codes: string[] = []
  // Code first: what it holds stays as it is. Meanwhile a private-use character marks its place.
  let s = text.replace(/`([^`\n]+)`/g, (_, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `${codes.length - 1}`
  })
  s = escapeHtml(s)
    .replace(LINK, '<a href="$2">$1</a>')
    .replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>')
    .replace(/__(?=\S)(.+?)(?<=\S)__/g, '<b>$1</b>')
    .replace(/(^|[^\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])/g, '$1<i>$2</i>')
    .replace(/~~(?=\S)(.+?)(?<=\S)~~/g, '<s>$1</s>')
  return s.replace(/(\d+)/g, (_, i: string) => codes[Number(i)])
}

/** Inline markdown without its marks: for a grid's cells, whose widths have to be right. */
function plainInline(text: string): string {
  return text
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(LINK, '$1')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
}

/** Lines in monospace, in blocks small enough for a message. */
function preBlocks(lines: string[], language = ''): HtmlBlock[] {
  const open = language ? `<pre><code class="language-${language}">` : '<pre>'
  const close = language ? '</code></pre>' : '</pre>'
  const blocks: HtmlBlock[] = []
  let chunk: string[] = []
  let size = 0
  const flush = (): void => {
    if (chunk.length) blocks.push(block(`${open}${escapeHtml(chunk.join('\n'))}${close}`))
    chunk = []
    size = 0
  }
  for (const raw of lines) {
    const line = raw.slice(0, MAX_BLOCK)
    if (size + line.length + 1 > MAX_BLOCK) flush()
    chunk.push(line)
    size += line.length + 1
  }
  flush()
  return blocks.length ? blocks : [block(`${open} ${close}`)]
}

/** A markdown table's cells: "| a | b |". */
function cellsOf(line: string): Row {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  return s.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, '|'))
}

function tableBlocks(header: Row, rows: Row[]): HtmlBlock[] {
  const plain = (r: Row): Row => r.map(plainInline)
  const grid = phoneGrid(plain(header), rows.map(plain))
  if (grid) return preBlocks(grid)
  return rowFields(header, rows).map((fields, n) =>
    block(
      (n ? '\n' : '') +
        fields
          .map((f) =>
            f.name
              ? `<b>${escapeHtml(plainInline(f.name))}:</b> ${inlineHtml(f.value)}`
              : inlineHtml(f.value)
          )
          .join('\n')
    )
  )
}

/** A line of text: a heading, a rule, a list item or a paragraph's line. */
function lineBlocks(line: string): HtmlBlock[] {
  const heading = HEADING.exec(line)
  if (heading) return [block(`<b>${escapeHtml(plainInline(heading[1]))}</b>`)]
  if (RULE.test(line)) return [block('──────────')]
  const text = line.replace(BULLET, '$1• ')
  if (text.length <= MAX_BLOCK) return [block(inlineHtml(text))]
  // A very long line: split between words.
  const blocks: HtmlBlock[] = []
  let rest = text
  while (rest) {
    let end = rest.length <= MAX_BLOCK ? rest.length : rest.lastIndexOf(' ', MAX_BLOCK)
    if (end <= 0) end = MAX_BLOCK
    blocks.push(block(inlineHtml(rest.slice(0, end))))
    rest = rest.slice(end).trimStart()
  }
  return blocks
}

/** Markdown as Telegram HTML, in blocks that go one per line. */
export function markdownBlocks(markdown: string): HtmlBlock[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const blocks: HtmlBlock[] = []
  for (let i = 0; i < lines.length;) {
    const line = lines[i]
    const fence = FENCE.exec(line)
    if (fence) {
      const closing = new RegExp(
        `^\\s*${fence[1][0] === '`' ? '`' : '~'}{${fence[1].length},}\\s*$`
      )
      let end = i + 1
      while (end < lines.length && !closing.test(lines[end])) end++
      blocks.push(...preBlocks(lines.slice(i + 1, end), fence[2].replace(/[^\w+#-]/g, '')))
      i = end + 1
      continue
    }
    const next = lines[i + 1]
    if (line.includes('|') && next?.includes('|') && TABLE_RULE.test(next)) {
      let end = i + 2
      while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end++
      blocks.push(...tableBlocks(cellsOf(line), lines.slice(i + 2, end).map(cellsOf)))
      i = end
      continue
    }
    if (QUOTE.test(line)) {
      let end = i
      while (end < lines.length && QUOTE.test(lines[end])) end++
      const quoted = lines.slice(i, end).map((l) => inlineHtml(l.replace(QUOTE, '')))
      for (const chunk of chunks(quoted)) blocks.push(block(`<blockquote>${chunk}</blockquote>`))
      i = end
      continue
    }
    // One blank line between paragraphs is enough.
    if (!line.trim()) {
      if (blocks.length && blocks[blocks.length - 1].length) blocks.push(block(''))
    } else blocks.push(...lineBlocks(line))
    i++
  }
  while (blocks.length && !blocks[blocks.length - 1].length) blocks.pop()
  return blocks
}

/** HTML lines joined, a chunk at most MAX_BLOCK characters long. */
function chunks(lines: string[]): string[] {
  const out: string[] = []
  let chunk: string[] = []
  let size = 0
  for (const line of lines) {
    const length = htmlText(line).length + 1
    if (chunk.length && size + length > MAX_BLOCK) {
      out.push(chunk.join('\n'))
      chunk = []
      size = 0
    }
    chunk.push(line)
    size += length
  }
  if (chunk.length) out.push(chunk.join('\n'))
  return out
}

/** The blocks after `head` (HTML), filling one message after another. */
function pack(head: string, blocks: HtmlBlock[]): string[] {
  const parts: string[] = []
  let html = head
  let length = htmlText(head).length
  // A blank line between the head and the reply; a line break between blocks.
  let gap = head ? '\n\n' : ''
  for (const b of blocks) {
    if (html && length + gap.length + b.length > ROOM) {
      parts.push(html)
      html = ''
      length = 0
      gap = ''
    }
    if (!html && !b.length) continue
    html += gap + b.html
    length += gap.length + b.length
    gap = '\n'
  }
  if (htmlText(html).trim()) parts.push(html)
  return parts
}

/**
 * The messages for `head` (HTML) and the markdown below it: as few as can hold them, at most
 * MAX_PARTS. When even those can't, the start is left out (the end is Claude's conclusion).
 */
export function markdownParts(head: string, markdown: string): string[] {
  let blocks = markdownBlocks(markdown)
  let parts = pack(head, blocks)
  if (parts.length <= MAX_PARTS) return parts
  // Drop from the start until it fits, about right at once, then one at a time.
  const budget = ROOM * MAX_PARTS * 0.9
  let total = blocks.reduce((sum, b) => sum + b.length + 1, 0)
  while (blocks.length > 1 && total > budget) total -= blocks.shift()!.length + 1
  for (;;) {
    parts = pack(head, [block('<i>… the start is left out: it is on the computer</i>'), ...blocks])
    if (parts.length <= MAX_PARTS || blocks.length <= 1) return parts.slice(0, MAX_PARTS)
    blocks = blocks.slice(1)
  }
}
