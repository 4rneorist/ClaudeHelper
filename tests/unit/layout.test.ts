import { describe, expect, it } from 'vitest'
import {
  dragDivider,
  gridOf,
  insertBeside,
  leaf,
  leaves,
  normalize,
  removeLeaf,
  setSizes,
  sideAt,
  type LayoutNode
} from '../../src/renderer/src/layout'

const row = (children: LayoutNode[], sizes?: number[]): LayoutNode => ({
  type: 'split',
  dir: 'row',
  children,
  sizes: sizes ?? children.map(() => 1 / children.length)
})
const col = (children: LayoutNode[], sizes?: number[]): LayoutNode => ({
  type: 'split',
  dir: 'column',
  children,
  sizes: sizes ?? children.map(() => 1 / children.length)
})

describe('insertBeside', () => {
  it('splits a single pane left/right and top/bottom', () => {
    expect(insertBeside(leaf('a'), 'a', leaf('b'), 'right')).toEqual(row([leaf('a'), leaf('b')]))
    expect(insertBeside(leaf('a'), 'a', leaf('b'), 'left')).toEqual(row([leaf('b'), leaf('a')]))
    expect(insertBeside(leaf('a'), 'a', leaf('b'), 'bottom')).toEqual(col([leaf('a'), leaf('b')]))
    expect(insertBeside(leaf('a'), 'a', leaf('b'), 'top')).toEqual(col([leaf('b'), leaf('a')]))
  })

  it('becomes a sibling in a split of the same direction, halving the target', () => {
    const result = insertBeside(row([leaf('a'), leaf('b')]), 'b', leaf('c'), 'right')
    expect(result).toEqual(row([leaf('a'), leaf('b'), leaf('c')], [0.5, 0.25, 0.25]))
  })

  it('nests a split of the other direction', () => {
    const result = insertBeside(row([leaf('a'), leaf('b')]), 'b', leaf('c'), 'bottom')
    expect(result).toEqual(row([leaf('a'), col([leaf('b'), leaf('c')])]))
  })

  it('can insert a whole layout (a dragged sub-tab with panes)', () => {
    const moved = col([leaf('x'), leaf('y')])
    const result = insertBeside(leaf('a'), 'a', moved, 'right')
    expect(leaves(result)).toEqual(['a', 'x', 'y'])
  })
})

describe('removeLeaf', () => {
  it('collapses a split left with one child', () => {
    expect(removeLeaf(row([leaf('a'), leaf('b')]), 'a')).toEqual(leaf('b'))
  })

  it('returns null when the last pane goes', () => {
    expect(removeLeaf(leaf('a'), 'a')).toBeNull()
  })

  it('redistributes space among the remaining siblings', () => {
    const result = removeLeaf(row([leaf('a'), leaf('b'), leaf('c')], [0.5, 0.25, 0.25]), 'c')
    expect(result).toEqual(row([leaf('a'), leaf('b')], [2 / 3, 1 / 3]))
  })

  it('merges a nested split into its parent when it takes the same direction', () => {
    const tree = row([leaf('a'), col([leaf('b'), row([leaf('c'), leaf('d')])])])
    const result = removeLeaf(tree, 'b')!
    expect(result.type === 'split' && result.dir).toBe('row')
    expect(leaves(result)).toEqual(['a', 'c', 'd'])
    expect(result.type === 'split' && result.children.every((c) => c.type === 'leaf')).toBe(true)
  })
})

describe('normalize', () => {
  it('keeps sizes summing to 1', () => {
    const result = normalize(row([leaf('a'), leaf('b')], [3, 1]))!
    expect(result.type === 'split' && result.sizes).toEqual([0.75, 0.25])
  })
})

describe('setSizes / dragDivider', () => {
  it('updates the split at a path', () => {
    const tree = row([leaf('a'), col([leaf('b'), leaf('c')])])
    const result = setSizes(tree, [1], [0.2, 0.8])
    expect(result.type === 'split' && result.children[1]).toEqual(
      col([leaf('b'), leaf('c')], [0.2, 0.8])
    )
  })

  it('moves a divider and clamps to the minimum size', () => {
    expect(dragDivider([0.5, 0.5], 0, 0.1, 0.1)).toEqual([0.6, 0.4])
    expect(dragDivider([0.5, 0.5], 0, 0.9, 0.1)).toEqual([0.9, 0.09999999999999998])
    expect(dragDivider([0.25, 0.25, 0.5], 1, -0.5, 0.05)).toEqual([0.25, 0.05, 0.7])
  })
})

describe('gridOf', () => {
  it('builds 2, 3 and 4 pane arrangements', () => {
    expect(gridOf(['a', 'b'])).toEqual(row([leaf('a'), leaf('b')]))
    expect(gridOf(['a', 'b', 'c'])).toEqual(col([row([leaf('a'), leaf('b')]), leaf('c')]))
    expect(gridOf(['a', 'b', 'c', 'd'])).toEqual(
      col([row([leaf('a'), leaf('b')]), row([leaf('c'), leaf('d')])])
    )
  })
})

describe('sideAt', () => {
  it('picks the nearest edge', () => {
    expect(sideAt(0.1, 0.5)).toBe('left')
    expect(sideAt(0.9, 0.5)).toBe('right')
    expect(sideAt(0.5, 0.05)).toBe('top')
    expect(sideAt(0.5, 0.95)).toBe('bottom')
  })
})
