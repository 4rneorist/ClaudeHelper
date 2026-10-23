import { describe, expect, it } from 'vitest'
import {
  classifyKey,
  imagePasteSequence,
  type KeyInfo
} from '../../src/renderer/src/terminal/keybindings'

function key(k: string, mods: Partial<KeyInfo> = {}, type = 'keydown'): KeyInfo {
  return { type, key: k, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...mods }
}

describe('classifyKey on Windows/Linux', () => {
  for (const platform of ['win32', 'linux']) {
    it(`${platform}: Ctrl+C interrupts claude unless text is selected`, () => {
      expect(classifyKey(key('c', { ctrlKey: true }), platform, false).type).toBe('pass')
      expect(classifyKey(key('c', { ctrlKey: true }), platform, true).type).toBe('copy')
    })

    it(`${platform}: Ctrl+V and Ctrl+Shift+V paste`, () => {
      expect(classifyKey(key('v', { ctrlKey: true }), platform, false).type).toBe('paste')
      expect(classifyKey(key('V', { ctrlKey: true, shiftKey: true }), platform, false).type).toBe(
        'paste'
      )
    })

    it(`${platform}: Shift+Enter inserts a newline, plain Enter passes`, () => {
      expect(classifyKey(key('Enter', { shiftKey: true }), platform, false).type).toBe('newline')
      expect(classifyKey(key('Enter'), platform, false).type).toBe('pass')
    })

    it(`${platform}: keys claude relies on pass through`, () => {
      for (const k of [
        key('Tab', { shiftKey: true }), // cycle permission modes
        key('Escape'),
        key('t', { ctrlKey: true }), // task list
        key('w', { ctrlKey: true }), // delete word
        key('r', { ctrlKey: true }), // history search
        key('_', { ctrlKey: true, shiftKey: true }), // undo
        key('-', { ctrlKey: true, shiftKey: true }) // undo
      ]) {
        expect(classifyKey(k, platform, false).type).toBe('pass')
      }
    })

    it(`${platform}: app shortcuts use Ctrl+Shift`, () => {
      expect(classifyKey(key('T', { ctrlKey: true, shiftKey: true }), platform, false).type).toBe(
        'newTerminal'
      )
      expect(classifyKey(key('W', { ctrlKey: true, shiftKey: true }), platform, false).type).toBe(
        'closePane'
      )
      expect(classifyKey(key('Tab', { ctrlKey: true }), platform, false).type).toBe('nextTab')
      expect(classifyKey(key('Tab', { ctrlKey: true, shiftKey: true }), platform, false).type).toBe(
        'prevTab'
      )
      expect(classifyKey(key('=', { ctrlKey: true }), platform, false)).toEqual({
        type: 'zoom',
        delta: 1
      })
      expect(classifyKey(key('-', { ctrlKey: true }), platform, false)).toEqual({
        type: 'zoom',
        delta: -1
      })
      expect(classifyKey(key('0', { ctrlKey: true }), platform, false)).toEqual({
        type: 'zoom',
        delta: 0
      })
    })
  }
})

describe('folder tab shortcuts', () => {
  it('jumps to the next waiting session with Ctrl+Shift+J, or Cmd+Shift+J on macOS', () => {
    for (const platform of ['win32', 'linux']) {
      const ctrlShiftJ = key('J', { ctrlKey: true, shiftKey: true })
      expect(classifyKey(ctrlShiftJ, platform, false).type).toBe('nextWaiting')
      expect(classifyKey(key('j', { ctrlKey: true }), platform, false).type).toBe('pass')
    }
    const cmdShiftJ = key('J', { metaKey: true, shiftKey: true })
    expect(classifyKey(cmdShiftJ, 'darwin', false).type).toBe('nextWaiting')
  })

  it('opens a folder tab and switches folders with Ctrl+PageUp/PageDown', () => {
    expect(classifyKey(key('N', { ctrlKey: true, shiftKey: true }), 'win32', false).type).toBe(
      'newFolderTab'
    )
    expect(classifyKey(key('n', { metaKey: true }), 'darwin', false).type).toBe('newFolderTab')
    expect(classifyKey(key('PageDown', { ctrlKey: true }), 'linux', false).type).toBe('nextFolder')
    expect(classifyKey(key('PageUp', { ctrlKey: true }), 'darwin', false).type).toBe('prevFolder')
    expect(classifyKey(key('n', { ctrlKey: true }), 'win32', false).type).toBe('pass')
  })
})

describe('classifyKey on macOS', () => {
  it('uses Cmd for copy/paste/tabs and leaves Ctrl keys to claude', () => {
    expect(classifyKey(key('c', { metaKey: true }), 'darwin', true).type).toBe('copy')
    expect(classifyKey(key('c', { metaKey: true }), 'darwin', false).type).toBe('block')
    expect(classifyKey(key('v', { metaKey: true }), 'darwin', false).type).toBe('paste')
    expect(classifyKey(key('t', { metaKey: true }), 'darwin', false).type).toBe('newTerminal')
    expect(classifyKey(key('c', { ctrlKey: true }), 'darwin', true).type).toBe('pass')
    expect(classifyKey(key('v', { ctrlKey: true }), 'darwin', false).type).toBe('pass')
  })
})

describe('classifyKey event phases', () => {
  it('blocks keypress/keyup of a handled combo so xterm does not also emit it', () => {
    expect(classifyKey(key('Enter', { shiftKey: true }, 'keypress'), 'win32', false).type).toBe(
      'block'
    )
    expect(classifyKey(key('v', { ctrlKey: true }, 'keyup'), 'win32', false).type).toBe('block')
    expect(classifyKey(key('a', {}, 'keypress'), 'win32', false).type).toBe('pass')
  })
})

describe('imagePasteSequence', () => {
  it('sends Alt+V on Windows and Ctrl+V elsewhere', () => {
    expect(imagePasteSequence('win32')).toBe('\x1bv')
    expect(imagePasteSequence('darwin')).toBe('\x16')
    expect(imagePasteSequence('linux')).toBe('\x16')
  })
})
