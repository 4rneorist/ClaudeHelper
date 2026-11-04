import { describe, expect, it } from 'vitest'
import {
  htmlText,
  inlineHtml,
  markdownBlocks,
  markdownParts,
  MAX_PARTS,
  MAX_TEXT
} from '../../src/main/telegramMarkdown'

const html = (md: string): string =>
  markdownBlocks(md)
    .map((b) => b.html)
    .join('\n')

describe('inlineHtml', () => {
  it('formats code, bold, italic, struck text and links, with the rest escaped', () => {
    expect(
      inlineHtml('Run `a<b>` then **build** *now*, ~~not~~ [docs](https://x.dev/a?b=1&c=2)')
    ).toBe(
      'Run <code>a&lt;b&gt;</code> then <b>build</b> <i>now</i>, <s>not</s> <a href="https://x.dev/a?b=1&amp;c=2">docs</a>'
    )
  })

  it("leaves what isn't formatting alone", () => {
    expect(inlineHtml('2 * 3 * 4 and snake_case_name and `**not bold**`')).toBe(
      '2 * 3 * 4 and snake_case_name and <code>**not bold**</code>'
    )
    expect(inlineHtml('[local](src/a.ts) & <tag>')).toBe('[local](src/a.ts) &amp; &lt;tag&gt;')
  })
})

describe('markdownBlocks', () => {
  it('turns headings bold, bullets into dots and rules short', () => {
    expect(html('## The **plan**\n- one\n  * two\n---\n1. three')).toBe(
      '<b>The plan</b>\n• one\n  • two\n──────────\n1. three'
    )
  })

  it('shows code blocks monospace, with their language', () => {
    expect(html('Look:\n```ts\nconst a = 1 < 2\n```\nDone')).toBe(
      'Look:\n<pre><code class="language-ts">const a = 1 &lt; 2</code></pre>\nDone'
    )
    expect(html('```\nplain\n```')).toBe('<pre>plain</pre>')
  })

  it('keeps one blank line between paragraphs', () => {
    expect(html('a\n\n\n\nb\n\n')).toBe('a\n\nb')
  })

  it('shows a table that fits a phone as a grid', () => {
    expect(html('| File | Lines |\n|---|--:|\n| `a.ts` | +3 |\n| b.ts | +10 |')).toBe(
      '<pre>File │ Lines\n─────┼──────\na.ts │ +3\nb.ts │ +10</pre>'
    )
  })

  it('shows a wide table a row after another, a field a line', () => {
    const long = 'A long description of what changed in this repository today'
    expect(html(`| Repo | Changes |\n| --- | --- |\n| api | ${long} |\n| web | **none** |`)).toBe(
      `<b>Repo:</b> api\n<b>Changes:</b> ${long}\n\n<b>Repo:</b> web\n<b>Changes:</b> <b>none</b>`
    )
  })

  it('quotes', () => {
    expect(html('> note\n> **this**\nafter')).toBe(
      '<blockquote>note\n<b>this</b></blockquote>\nafter'
    )
  })
})

describe('markdownParts', () => {
  it('puts a short reply under its heading, after a blank line', () => {
    expect(markdownParts('✅ IDLE', 'All **done**.')).toEqual(['✅ IDLE\n\nAll <b>done</b>.'])
  })

  it('splits a long reply between lines, each message within the limit', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `Line ${i} ${'x'.repeat(40)}`)
    const parts = markdownParts('head', lines.join('\n'))
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(htmlText(part).length).toBeLessThanOrEqual(MAX_TEXT)
    expect(parts.map(htmlText).join('\n')).toBe(`head\n\n${lines.join('\n')}`)
  })

  it('splits a long code block into several, each one closed', () => {
    const code = Array.from({ length: 1000 }, (_, i) => `line ${i}`).join('\n')
    const parts = markdownParts('', '```\n' + code + '\n```')
    expect(parts.length).toBeGreaterThan(1)
    for (const part of parts) expect(part).toMatch(/^<pre>[\s\S]*<\/pre>$/)
  })

  it('leaves the start out of a reply too long for a few messages', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `Line ${i} ${'y'.repeat(40)}`)
    const parts = markdownParts('head', lines.join('\n'))
    expect(parts).toHaveLength(MAX_PARTS)
    expect(parts[0]).toMatch(/^head\n\n<i>… the start is left out/)
    expect(parts[parts.length - 1]).toMatch(/Line 1999 y+$/)
    for (const part of parts) expect(htmlText(part).length).toBeLessThanOrEqual(MAX_TEXT)
  })
})
