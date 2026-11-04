import {
  MAX_BOOKMARK_DEPTH,
  titleFromText,
  type BookmarkFolder,
  type BookmarkNode
} from '../../shared/bookmarks'

// The bookmark tree is edited here, immutably: every change returns a new tree, which the store
// saves through main. A parent of null is the root level.

/** A prompt or folder being added (no id) or edited in the bookmarks panel. */
export type BookmarkDraft = {
  id?: string
  parent: string | null
  title: string
} & ({ type: 'prompt'; text: string } | { type: 'folder' })

let counter = 0

export function newBookmarkId(): string {
  counter = (counter + 1) % 1296
  return `b${Date.now().toString(36)}${counter.toString(36).padStart(2, '0')}`
}

export function findNode(nodes: BookmarkNode[], id: string): BookmarkNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    if (n.type === 'folder') {
      const found = findNode(n.children, id)
      if (found) return found
    }
  }
  return null
}

/** The folder holding `id`: its id, null for the root level, undefined when there is no `id`. */
export function parentOf(
  nodes: BookmarkNode[],
  id: string,
  parent: string | null = null
): string | null | undefined {
  for (const n of nodes) {
    if (n.id === id) return parent
    if (n.type === 'folder') {
      const found = parentOf(n.children, id, n.id)
      if (found !== undefined) return found
    }
  }
  return undefined
}

/** Adds at the end of folder `parent` (the root level if there is no such folder). */
export function insertNode(
  nodes: BookmarkNode[],
  parent: string | null,
  node: BookmarkNode
): BookmarkNode[] {
  if (parent === null || !findNode(nodes, parent)) return [...nodes, node]
  return mapFolders(nodes, (f) => (f.id === parent ? { ...f, children: [...f.children, node] } : f))
}

export function removeNode(nodes: BookmarkNode[], id: string): BookmarkNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) => (n.type === 'folder' ? { ...n, children: removeNode(n.children, id) } : n))
}

export function updateNode(
  nodes: BookmarkNode[],
  id: string,
  update: (node: BookmarkNode) => BookmarkNode
): BookmarkNode[] {
  return nodes.map((n) => {
    if (n.id === id) return update(n)
    return n.type === 'folder' ? { ...n, children: updateNode(n.children, id, update) } : n
  })
}

/** Moves to the end of folder `parent`, unless that would put a folder inside itself. */
export function moveNode(nodes: BookmarkNode[], id: string, parent: string | null): BookmarkNode[] {
  const node = findNode(nodes, id)
  if (!node || parentOf(nodes, id) === parent) return nodes
  if (parent !== null && (parent === id || findNode(childrenOf(node), parent))) return nodes
  return insertNode(removeNode(nodes, id), parent, node)
}

/** Prompts in a folder and all its subfolders. */
export function countPrompts(node: BookmarkNode): number {
  return node.type === 'prompt' ? 1 : node.children.reduce((sum, c) => sum + countPrompts(c), 0)
}

/** Root level and every folder, as "Work › Reviews", where `node` (or a new item) can go. */
export function folderChoices(
  nodes: BookmarkNode[],
  node?: BookmarkNode
): { id: string | null; label: string }[] {
  const levels = node ? height(node) : 1
  const out: { id: string | null; label: string }[] = [{ id: null, label: 'Top level' }]
  const walk = (list: BookmarkNode[], path: string[]): void => {
    for (const n of list) {
      if (n.type !== 'folder' || n.id === node?.id) continue
      const label = [...path, n.title]
      // Its depth is label.length; what goes in it ends that many levels further down.
      if (label.length + levels <= MAX_BOOKMARK_DEPTH) {
        out.push({ id: n.id, label: label.join(' › ') })
      }
      walk(n.children, label)
    }
  }
  walk(nodes, [])
  return out
}

/** Adds the draft, or applies it to the bookmark it edits (moving it if its folder changed). */
export function applyDraft(nodes: BookmarkNode[], draft: BookmarkDraft): BookmarkNode[] {
  const title = draft.title.trim()
  if (draft.id === undefined) {
    const id = newBookmarkId()
    const node: BookmarkNode =
      draft.type === 'prompt'
        ? { type: 'prompt', id, title: title || titleFromText(draft.text), text: draft.text }
        : { type: 'folder', id, title, children: [] }
    return insertNode(nodes, draft.parent, node)
  }
  const edited = updateNode(nodes, draft.id, (n) =>
    n.type === 'prompt' && draft.type === 'prompt'
      ? { ...n, title: title || titleFromText(draft.text), text: draft.text }
      : { ...n, title }
  )
  return moveNode(edited, draft.id, draft.parent)
}

/** A draft that edits this bookmark. */
export function draftFor(nodes: BookmarkNode[], node: BookmarkNode): BookmarkDraft {
  const parent = parentOf(nodes, node.id) ?? null
  return node.type === 'prompt'
    ? { type: 'prompt', id: node.id, parent, title: node.title, text: node.text }
    : { type: 'folder', id: node.id, parent, title: node.title }
}

function childrenOf(node: BookmarkNode): BookmarkNode[] {
  return node.type === 'folder' ? node.children : []
}

/** Levels a node takes up: 1 for a prompt or an empty folder. */
function height(node: BookmarkNode): number {
  return 1 + Math.max(0, ...childrenOf(node).map(height))
}

function mapFolders(
  nodes: BookmarkNode[],
  fn: (folder: BookmarkFolder) => BookmarkFolder
): BookmarkNode[] {
  return nodes.map((n) =>
    n.type === 'folder' ? fn({ ...n, children: mapFolders(n.children, fn) }) : n
  )
}
