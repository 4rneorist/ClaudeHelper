import { describe, expect, it } from 'vitest'
import { menuAccelerator, sanitizeBookmarks } from '../../src/main/bookmarksStore'
import {
  applyDraft,
  draftFor,
  promptForHotkey,
  type BookmarkDraft
} from '../../src/renderer/src/bookmarks'
import { hotkeyNotes, pressOf } from '../../src/renderer/src/hotkeyNotes'
import type { BookmarkNode } from '../../src/shared/bookmarks'
import {
  claudeKeyTaken,
  hotkeyOf,
  hotkeyProblem,
  isHotkey,
  partialHotkey,
  showHotkey
} from '../../src/shared/hotkeys'

const press = (
  key: string,
  code: string,
  mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}
): Parameters<typeof hotkeyOf>[0] => ({
  key,
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('hotkeyOf', () => {
  it('names the physical key, whatever the layout types there', () => {
    const ctrlShift = { ctrlKey: true, shiftKey: true }
    expect(hotkeyOf(press('C', 'KeyC', ctrlShift))).toBe('Ctrl+Shift+C')
    expect(hotkeyOf(press('С', 'KeyC', ctrlShift))).toBe('Ctrl+Shift+C') // Cyrillic Es
    expect(hotkeyOf(press('!', 'Digit1', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+1')
    expect(hotkeyOf(press('F5', 'F5'))).toBe('F5')
    expect(hotkeyOf(press('ArrowUp', 'ArrowUp', { ctrlKey: true, metaKey: true }))).toBe(
      'Ctrl+Cmd+Up'
    )
    expect(hotkeyOf(press('/', 'Slash', { ctrlKey: true }))).toBe('Ctrl+/')
  })

  it('has none for a modifier on its own', () => {
    expect(hotkeyOf(press('Control', 'ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(hotkeyOf(press('Shift', 'ShiftLeft', { shiftKey: true }))).toBeNull()
    expect(partialHotkey({ ctrlKey: true, altKey: false, shiftKey: true, metaKey: false })).toBe(
      'Ctrl+Shift+…'
    )
  })
})

describe('which hotkeys are allowed', () => {
  it('knows the names it makes', () => {
    for (const k of ['Ctrl+Shift+C', 'Alt+1', 'F12', 'Ctrl+Up', 'Ctrl+Alt+Shift+Cmd+Num5']) {
      expect(isHotkey(k)).toBe(true)
    }
    for (const k of ['Shift+Ctrl+C', 'Ctrl+', 'Ctrl+Foo', 'ctrl+c', '', 42]) {
      expect(isHotkey(k)).toBe(false)
    }
  })

  it('refuses keys that would stop typing, and the keys Claude needs', () => {
    expect(hotkeyProblem('Ctrl+Shift+C', 'win32')).toBeNull()
    expect(hotkeyProblem('F5', 'win32')).toBeNull()
    expect(hotkeyProblem('Shift+A', 'win32')).toMatch(/Ctrl or Alt/)
    expect(hotkeyProblem('A', 'win32')).toMatch(/Ctrl or Alt/)
    expect(hotkeyProblem('Ctrl+C', 'win32')).toMatch(/can’t be used/)
    expect(hotkeyProblem('Ctrl+D', 'linux')).toMatch(/can’t be used/)
    expect(hotkeyProblem('Cmd+V', 'darwin')).toMatch(/can’t be used/)
    expect(hotkeyProblem('Ctrl+C', 'darwin')).toBeNull()
  })

  it('says what a hotkey takes over', () => {
    expect(hotkeyNotes('Ctrl+Shift+C', 'win32')).toEqual([
      'With text selected it still copies; otherwise it pastes the prompt.'
    ])
    expect(hotkeyNotes('Ctrl+Shift+T', 'win32')).toEqual([
      'It replaces the app’s “New terminal” shortcut.'
    ])
    expect(hotkeyNotes('Ctrl+R', 'win32')).toEqual([
      'In Claude tabs it replaces Claude’s history search.'
    ])
    expect(hotkeyNotes('Ctrl+Up', 'win32')).toEqual([
      'It replaces the app’s “Jump to your previous prompt” shortcut.'
    ])
    expect(hotkeyNotes('Alt+Shift+1', 'win32')).toEqual([])
    expect(claudeKeyTaken('Ctrl+Shift+C')).toBeNull()
    expect(pressOf('Ctrl+Up')).toMatchObject({ key: 'ArrowUp', ctrlKey: true })
  })

  it('shows Cmd as Win off macOS, and Alt as Option on it', () => {
    expect(showHotkey('Ctrl+Cmd+K', 'win32')).toBe('Ctrl+Win+K')
    expect(showHotkey('Alt+Cmd+K', 'darwin')).toBe('Option+Cmd+K')
  })
})

describe('bookmarks with hotkeys', () => {
  const tree: BookmarkNode[] = [
    { type: 'prompt', id: 'a', title: 'Clear', text: '/clear', hotkey: 'Ctrl+Shift+C' },
    {
      type: 'folder',
      id: 'f',
      title: 'Work',
      children: [{ type: 'prompt', id: 'b', title: 'Review', text: 'Review this' }]
    }
  ]

  /** A draft that edits this prompt, with another hotkey. */
  const withKey = (node: BookmarkNode, hotkey: string | undefined): BookmarkDraft => {
    const draft = draftFor(tree, node)
    if (draft.type !== 'prompt') throw new Error('not a prompt')
    return { ...draft, hotkey }
  }

  it('finds the prompt a hotkey pastes, also in folders', () => {
    expect(promptForHotkey(tree, 'Ctrl+Shift+C')?.id).toBe('a')
    const withB = applyDraft(tree, withKey(findB(tree), 'Alt+R'))
    expect(promptForHotkey(withB, 'Alt+R')?.id).toBe('b')
    expect(promptForHotkey(withB, 'Alt+X')).toBeNull()
  })

  it('moves a hotkey to the prompt it is given to, and clears it', () => {
    const moved = applyDraft(tree, withKey(findB(tree), 'Ctrl+Shift+C'))
    expect(promptForHotkey(moved, 'Ctrl+Shift+C')?.id).toBe('b')
    expect(moved[0]).not.toHaveProperty('hotkey')
    const cleared = applyDraft(tree, withKey(tree[0], undefined))
    expect(cleared[0]).not.toHaveProperty('hotkey')
    expect(draftFor(tree, tree[0])).toMatchObject({ hotkey: 'Ctrl+Shift+C' })
  })

  it('keeps valid hotkeys in the file, each on one prompt only', () => {
    const kept = sanitizeBookmarks([
      { type: 'prompt', id: 'a', title: 'A', text: 'a', hotkey: 'Ctrl+Shift+C' },
      { type: 'prompt', id: 'b', title: 'B', text: 'b', hotkey: 'Ctrl+Shift+C' },
      { type: 'prompt', id: 'c', title: 'C', text: 'c', hotkey: 'nonsense' }
    ])
    expect(kept.map((n) => (n.type === 'prompt' ? n.hotkey : null))).toEqual([
      'Ctrl+Shift+C',
      undefined,
      undefined
    ])
  })

  it('shows the hotkey in the right-click menu where Electron can name it', () => {
    expect(menuAccelerator('Ctrl+Shift+C', 'win32')).toBe('Ctrl+Shift+C')
    expect(menuAccelerator('Ctrl+Cmd+Enter', 'win32')).toBe('Ctrl+Super+Return')
    expect(menuAccelerator('Cmd+Num1', 'darwin')).toBe('Cmd+num1')
    expect(menuAccelerator(undefined)).toBeNull()
  })
})

function findB(tree: BookmarkNode[]): BookmarkNode {
  const folder = tree[1]
  if (folder.type !== 'folder') throw new Error('folder')
  return folder.children[0]
}
