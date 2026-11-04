import { describe, expect, it } from 'vitest'
import {
  MAX_BOOKMARK_DEPTH,
  titleFromText,
  type BookmarkFolder,
  type BookmarkNode
} from '../../src/shared/bookmarks'
import {
  applyDraft,
  countPrompts,
  draftFor,
  findNode,
  folderChoices,
  insertNode,
  moveNode,
  newBookmarkId,
  parentOf,
  removeNode
} from '../../src/renderer/src/bookmarks'

const prompt = (id: string, text = `text ${id}`): BookmarkNode => ({
  type: 'prompt',
  id,
  title: id,
  text
})
const folder = (id: string, children: BookmarkNode[] = []): BookmarkFolder => ({
  type: 'folder',
  id,
  title: id.toUpperCase(),
  children
})

// work › reviews › (review) ; work › (fix) ; (hello) at the top level
const tree = (): BookmarkNode[] => [
  folder('work', [folder('reviews', [prompt('review')]), prompt('fix')]),
  prompt('hello')
]

describe('titleFromText', () => {
  it('takes the first non-empty line, cut short', () => {
    expect(titleFromText('\n  Review this PR  \nfor bugs')).toBe('Review this PR')
    expect(titleFromText('x'.repeat(80))).toBe(`${'x'.repeat(59)}…`)
    expect(titleFromText('   \n ')).toBe('')
  })
})

describe('bookmark tree', () => {
  it('finds nodes and their folders at any depth', () => {
    const t = tree()
    expect(findNode(t, 'review')?.title).toBe('review')
    expect(parentOf(t, 'review')).toBe('reviews')
    expect(parentOf(t, 'hello')).toBeNull()
    expect(parentOf(t, 'nope')).toBeUndefined()
  })

  it('adds at the top level, in a folder or in a subfolder', () => {
    let t = insertNode(tree(), null, prompt('top'))
    t = insertNode(t, 'reviews', prompt('deep'))
    t = insertNode(t, 'work', folder('new'))
    expect(t.map((n) => n.id)).toEqual(['work', 'hello', 'top'])
    expect(parentOf(t, 'deep')).toBe('reviews')
    expect(parentOf(t, 'new')).toBe('work')
    // A folder that has gone: the top level instead.
    expect(parentOf(insertNode(t, 'gone', prompt('lost')), 'lost')).toBeNull()
  })

  it('removes a folder with everything in it, without touching the original', () => {
    const t = tree()
    const after = removeNode(t, 'reviews')
    expect(findNode(after, 'review')).toBeNull()
    expect(findNode(t, 'review')).not.toBeNull()
    expect(countPrompts(t[0])).toBe(2)
  })

  it("moves into another folder, but not a folder into itself or what's inside it", () => {
    const t = tree()
    expect(parentOf(moveNode(t, 'hello', 'reviews'), 'hello')).toBe('reviews')
    expect(parentOf(moveNode(t, 'review', null), 'review')).toBeNull()
    expect(moveNode(t, 'work', 'reviews')).toBe(t)
    expect(moveNode(t, 'work', 'work')).toBe(t)
  })

  it('offers folders as paths, leaving out the moved folder and what is too deep', () => {
    const t = tree()
    expect(folderChoices(t)).toEqual([
      { id: null, label: 'Top level' },
      { id: 'work', label: 'WORK' },
      { id: 'reviews', label: 'WORK › REVIEWS' }
    ])
    expect(folderChoices(t, findNode(t, 'work')!).map((c) => c.id)).toEqual([null])

    // A chain as deep as allowed: its deepest folder takes nothing more.
    let chain: BookmarkNode[] = []
    for (let i = MAX_BOOKMARK_DEPTH; i >= 1; i--) chain = [folder(`f${i}`, chain)]
    const ids = folderChoices(chain).map((c) => c.id)
    expect(ids).toContain(`f${MAX_BOOKMARK_DEPTH - 1}`)
    expect(ids).not.toContain(`f${MAX_BOOKMARK_DEPTH}`)
    // A folder two levels high fits one level higher up than a prompt.
    const twoHigh = folder('two', [prompt('inside')])
    const fits = folderChoices([...chain, twoHigh], twoHigh).map((c) => c.id)
    expect(fits).toContain(`f${MAX_BOOKMARK_DEPTH - 2}`)
    expect(fits).not.toContain(`f${MAX_BOOKMARK_DEPTH - 1}`)
  })

  it('adds a draft, naming a prompt after its first line when untitled', () => {
    const t = applyDraft(tree(), {
      type: 'prompt',
      parent: 'work',
      title: '  ',
      text: 'Explain this code\nstep by step'
    })
    const added = (findNode(t, 'work') as BookmarkFolder).children.at(-1)!
    expect(added).toMatchObject({ type: 'prompt', title: 'Explain this code' })
    const withFolder = applyDraft(t, { type: 'folder', parent: null, title: ' Ideas ' })
    expect(withFolder.at(-1)).toMatchObject({ type: 'folder', title: 'Ideas', children: [] })
  })

  it('applies an edit, moving it when its folder changed', () => {
    const t = tree()
    const draft = draftFor(t, findNode(t, 'fix')!)
    expect(draft).toEqual({
      type: 'prompt',
      id: 'fix',
      parent: 'work',
      title: 'fix',
      text: 'text fix'
    })
    const edited = applyDraft(t, {
      type: 'prompt',
      id: 'fix',
      parent: 'reviews',
      title: 'Fix it',
      text: 'new'
    })
    expect(findNode(edited, 'fix')).toEqual({
      type: 'prompt',
      id: 'fix',
      title: 'Fix it',
      text: 'new'
    })
    expect(parentOf(edited, 'fix')).toBe('reviews')
    // Renaming a folder keeps what is in it.
    const renamed = applyDraft(t, { ...draftFor(t, findNode(t, 'work')!), title: 'Job' })
    expect(findNode(renamed, 'work')).toMatchObject({ title: 'Job' })
    expect(countPrompts(findNode(renamed, 'work')!)).toBe(2)
  })

  it('makes ids that are new each time', () => {
    const ids = new Set(Array.from({ length: 100 }, newBookmarkId))
    expect(ids.size).toBe(100)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,40}$/)
  })
})
