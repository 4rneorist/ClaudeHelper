// Pane layout of a sub-tab: a tree of splits whose leaves are terminal keys.
// Pure functions only, so the docking/resizing rules are unit-testable.

import type { Dir, LayoutNode } from '../../shared/uiState'

export type { Dir, LayoutNode } from '../../shared/uiState'
export type Side = 'left' | 'right' | 'top' | 'bottom'

export const leaf = (id: string): LayoutNode => ({ type: 'leaf', id })

export function leaves(node: LayoutNode): string[] {
  return node.type === 'leaf' ? [node.id] : node.children.flatMap(leaves)
}

export function contains(node: LayoutNode, id: string): boolean {
  return leaves(node).includes(id)
}

function scaled(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total > 0 ? sizes.map((s) => s / total) : sizes.map(() => 1 / sizes.length)
}

/** Drops empty splits, unwraps single-child splits and merges nested splits of the same direction. */
export function normalize(node: LayoutNode | null): LayoutNode | null {
  if (!node || node.type === 'leaf') return node
  const children: LayoutNode[] = []
  const sizes: number[] = []
  node.children.forEach((raw, i) => {
    const child = normalize(raw)
    if (!child) return
    const size = node.sizes[i] ?? 1 / node.children.length
    if (child.type === 'split' && child.dir === node.dir) {
      const inner = scaled(child.sizes)
      child.children.forEach((c, j) => {
        children.push(c)
        sizes.push(size * inner[j])
      })
    } else {
      children.push(child)
      sizes.push(size)
    }
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  return { type: 'split', dir: node.dir, children, sizes: scaled(sizes) }
}

export function removeLeaf(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'leaf') return node.id === id ? null : node
  const kept = node.children
    .map((child, i) => ({ child: removeLeaf(child, id), size: node.sizes[i] }))
    .filter((c): c is { child: LayoutNode; size: number } => c.child !== null)
  return normalize({
    type: 'split',
    dir: node.dir,
    children: kept.map((c) => c.child),
    sizes: kept.map((c) => c.size)
  })
}

/** Places `insert` next to the pane `targetId`, taking half of that pane's space. */
export function insertBeside(
  root: LayoutNode,
  targetId: string,
  insert: LayoutNode,
  side: Side
): LayoutNode {
  const dir: Dir = side === 'left' || side === 'right' ? 'row' : 'column'
  const before = side === 'left' || side === 'top'

  const visit = (node: LayoutNode): LayoutNode => {
    if (node.type === 'leaf') {
      if (node.id !== targetId) return node
      return {
        type: 'split',
        dir,
        children: before ? [insert, node] : [node, insert],
        sizes: [0.5, 0.5]
      }
    }
    const index = node.children.findIndex((c) => c.type === 'leaf' && c.id === targetId)
    if (index !== -1 && node.dir === dir) {
      // Same direction as the parent: become a sibling instead of nesting another split.
      const children = [...node.children]
      const sizes = [...node.sizes]
      const half = sizes[index] / 2
      sizes[index] = half
      const at = before ? index : index + 1
      children.splice(at, 0, insert)
      sizes.splice(at, 0, half)
      return { ...node, children, sizes }
    }
    return { ...node, children: node.children.map(visit) }
  }
  return normalize(visit(root)) ?? insert
}

export function splitAt(root: LayoutNode, path: number[]): LayoutNode | null {
  let node: LayoutNode = root
  for (const i of path) {
    if (node.type !== 'split' || !node.children[i]) return null
    node = node.children[i]
  }
  return node
}

/** Replaces the sizes of the split at `path` (indices from the root). */
export function setSizes(root: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (path.length === 0) {
    if (root.type !== 'split' || sizes.length !== root.children.length) return root
    return { ...root, sizes: scaled(sizes) }
  }
  if (root.type !== 'split') return root
  const [head, ...rest] = path
  return {
    ...root,
    children: root.children.map((c, i) => (i === head ? setSizes(c, rest, sizes) : c))
  }
}

/** Moves the divider between children `index` and `index + 1`, keeping both above `min`. */
export function dragDivider(sizes: number[], index: number, delta: number, min: number): number[] {
  const next = [...sizes]
  const pair = next[index] + next[index + 1]
  const floor = Math.min(min, pair / 2)
  const a = Math.max(floor, Math.min(pair - floor, next[index] + delta))
  next[index] = a
  next[index + 1] = pair - a
  return next
}

/** Grid arrangement for up to four panes: 2 side by side, 3 = 2 + 1, 4 = 2×2. */
export function gridOf(ids: string[]): LayoutNode {
  const [a, b, c, d] = ids.map(leaf)
  const row = (...n: LayoutNode[]): LayoutNode => ({
    type: 'split',
    dir: 'row',
    children: n,
    sizes: n.map(() => 1 / n.length)
  })
  if (ids.length <= 1) return a
  if (ids.length === 2) return row(a, b)
  return {
    type: 'split',
    dir: 'column',
    children: [row(a, b), ids.length === 3 ? c : row(c, d)],
    sizes: [0.5, 0.5]
  }
}

/** Which edge of a pane the pointer is closest to (x, y relative 0..1). */
export function sideAt(x: number, y: number): Side {
  const distances: [Side, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y]
  ]
  return distances.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
}
