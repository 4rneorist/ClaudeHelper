import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { bookmarkMenuItems, BookmarksStore, sanitizeBookmarks } from '../../src/main/bookmarksStore'
import { MAX_BOOKMARK_DEPTH, MAX_PROMPT_LENGTH } from '../../src/shared/bookmarks'

describe('sanitizeBookmarks', () => {
  it('keeps folders and prompts with their fields', () => {
    const input = [
      {
        type: 'folder',
        id: 'f1',
        title: ' Work ',
        collapsed: true,
        children: [{ type: 'prompt', id: 'p1', title: 'Review', text: 'Review this\n' }]
      },
      { type: 'prompt', id: 'p2', title: '', text: '  Explain it\nplease' }
    ]
    expect(sanitizeBookmarks(input)).toEqual([
      {
        type: 'folder',
        id: 'f1',
        title: 'Work',
        collapsed: true,
        children: [{ type: 'prompt', id: 'p1', title: 'Review', text: 'Review this\n' }]
      },
      // An untitled prompt is named after its first line; its text stays as it was.
      { type: 'prompt', id: 'p2', title: 'Explain it', text: '  Explain it\nplease' }
    ])
  })

  it('drops what is invalid: unknown types, bad or repeated ids, blank text or titles', () => {
    const input = [
      { type: 'link', id: 'a', title: 'x' },
      { type: 'prompt', id: 'has space', title: 'x', text: 'y' },
      { type: 'prompt', id: 'ok', title: 'x', text: 'y' },
      { type: 'prompt', id: 'ok', title: 'again', text: 'y' },
      { type: 'prompt', id: 'blank', title: 'x', text: '  \n ' },
      { type: 'prompt', id: 'long', title: 'x', text: 'y'.repeat(MAX_PROMPT_LENGTH + 1) },
      { type: 'folder', id: 'untitled', title: ' ', children: [] },
      { type: 'folder', id: 'nochildren', title: 'F' },
      null,
      'text'
    ]
    expect(sanitizeBookmarks(input).map((n) => n.id)).toEqual(['ok', 'nochildren'])
    expect(sanitizeBookmarks({ items: [] })).toEqual([])
  })

  it('cuts nesting deeper than allowed', () => {
    let nested: unknown[] = [{ type: 'prompt', id: 'deep', title: 'x', text: 'y' }]
    for (let i = MAX_BOOKMARK_DEPTH; i >= 1; i--) {
      nested = [{ type: 'folder', id: `f${i}`, title: `F${i}`, children: nested }]
    }
    const json = JSON.stringify(sanitizeBookmarks(nested))
    expect(json).toContain(`"f${MAX_BOOKMARK_DEPTH}"`)
    expect(json).not.toContain('"deep"')
  })
})

describe('BookmarksStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-helper-'))
    file = path.join(dir, 'nested', 'bookmarks.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('starts empty, and keeps what is saved across instances', () => {
    expect(new BookmarksStore(file).get()).toEqual([])
    const saved = new BookmarksStore(file).save([
      { type: 'prompt', id: 'p1', title: 'Hi', text: 'Hello' },
      { type: 'bogus' }
    ])
    expect(saved).toEqual([{ type: 'prompt', id: 'p1', title: 'Hi', text: 'Hello' }])
    expect(new BookmarksStore(file).get()).toEqual(saved)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ version: 1, items: saved })
  })

  it('keeps a copy of a file it cannot read before it is replaced', () => {
    new BookmarksStore(file).save([])
    writeFileSync(file, '{ hand edited, broken')
    const store = new BookmarksStore(file)
    expect(store.get()).toEqual([])
    const copies = readdirSync(path.dirname(file)).filter((f) => f.includes('.corrupt-'))
    expect(copies).toHaveLength(1)
    expect(readFileSync(path.join(path.dirname(file), copies[0]), 'utf8')).toBe(
      '{ hand edited, broken'
    )
    expect(existsSync(file)).toBe(true)
  })
})

describe('bookmarkMenuItems', () => {
  it('makes folders submenus and prompts items that pick their id', () => {
    const picked: string[] = []
    const items = bookmarkMenuItems(
      [
        {
          type: 'folder',
          id: 'f',
          title: 'Q&A',
          children: [{ type: 'prompt', id: 'p', title: 'x'.repeat(80), text: 'y' }]
        },
        { type: 'folder', id: 'e', title: 'Empty', children: [] }
      ],
      (id) => picked.push(id)
    )
    expect(items[0].label).toBe('Q&&A')
    const sub = items[0].submenu as { label: string; click(): void }[]
    expect(sub[0].label).toBe(`${'x'.repeat(59)}…`)
    sub[0].click()
    expect(picked).toEqual(['p'])
    expect(items[1].submenu).toEqual([{ label: 'Empty', enabled: false }])
  })
})
