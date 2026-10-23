import { describe, expect, it } from 'vitest'
import {
  activityFromTitle,
  conversationTitle,
  isAsking,
  previewOf
} from '../../src/renderer/src/terminal/claudeActivity'

describe('activityFromTitle', () => {
  // Titles as Claude Code 2.1 set them in a real session.
  it('reads the spinner as working and ✳ as idle', () => {
    expect(activityFromTitle('◐ Claude Code')).toBe('working')
    expect(activityFromTitle('◑ Probe.txt file creation')).toBe('working')
    expect(activityFromTitle('✳ Probe.txt file creation')).toBe('idle')
  })

  it('knows the other spinner frames', () => {
    expect(activityFromTitle('◒ Task')).toBe('working')
    expect(activityFromTitle('◓ Task')).toBe('working')
    expect(activityFromTitle('⠂ Task')).toBe('working') // braille, older versions
  })

  it("says nothing for titles that aren't Claude's", () => {
    for (const title of ['', 'claude', 'PowerShell', 'C:\\WINDOWS\\system32\\cmd.exe', '● x']) {
      expect(activityFromTitle(title)).toBeNull()
    }
  })
})

describe('isAsking', () => {
  // Screens of Claude Code 2.1 as captured from a real session.
  const permission = [
    '● Write(probe2.txt)',
    ' Create file',
    ' probe2.txt',
    ' 1 hi',
    'Do you want to create probe2.txt?',
    '❯ 1. Yes',
    '  2. Yes, and switch to accept edits (auto-approve file edits) for this session (shift+tab)',
    '  3. No',
    'Esc to cancel · Tab to amend'
  ]
  const question = [
    '☐ Drink',
    'Do you prefer tea or coffee?',
    '❯ 1. Tea',
    '     You prefer tea.',
    '  2. Coffee',
    '  3. Type something.',
    '  4. Chat about this',
    'Enter to select · ↑/↓ to navigate · Esc to cancel'
  ]
  const finished = [
    '● Done.',
    '─'.repeat(40),
    '❯ ',
    '─'.repeat(40),
    '  Opus 5.5 │ effort xhigh │ tokens 53k (ctx 5%)',
    '  ⏵⏵ bypass permissions on (shift+tab to cycle)'
  ]

  it('sees a permission prompt or a question as asking you', () => {
    expect(isAsking(permission)).toBe(true)
    expect(isAsking(question)).toBe(true)
  })

  it('sees the plain input prompt as not asking, even with a draft typed in', () => {
    expect(isAsking(finished)).toBe(false)
    expect(isAsking(finished.map((l) => (l === '❯ ' ? '❯ 1. first point' : l)))).toBe(false)
  })

  it('finds a question near the top of a screen that is empty below it (after a clear)', () => {
    expect(isAsking(['ANSWERED', ...permission, ...Array(30).fill('')])).toBe(true)
  })

  it('only looks at the bottom of the screen', () => {
    expect(isAsking([...permission, ...Array(30).fill(''), ...finished])).toBe(false)
  })
})

describe('previewOf', () => {
  it("cuts Claude's input box and status line off, to show the conversation", () => {
    const screen = [
      '❯ Reply with just the word done.',
      '',
      '● done',
      '',
      '─'.repeat(40),
      '❯ ',
      '─'.repeat(40),
      '  Opus 5.5 │ effort xhigh │ tokens 53k (ctx 5%)',
      '  ⏵⏵ bypass permissions on (shift+tab to cycle)',
      ''
    ]
    expect(previewOf(screen, 12)).toEqual(['❯ Reply with just the word done.', '● done'])
    expect(previewOf(screen, 1)).toEqual(['● done'])
  })

  it('shows a question as it is', () => {
    const question = [
      'Do you prefer tea or coffee?',
      '❯ 1. Tea',
      '  2. Coffee',
      '─'.repeat(40),
      '  3. Chat about this',
      'Enter to select · ↑/↓ to navigate · Esc to cancel'
    ]
    expect(previewOf(question, 12)).toEqual(question)
  })

  it('shows any other program as it is', () => {
    expect(previewOf(['PS C:\\> dir', '', 'file.txt', ''], 12)).toEqual([
      'PS C:\\> dir',
      'file.txt'
    ])
  })
})

describe('conversationTitle', () => {
  it('drops the activity glyph', () => {
    expect(conversationTitle('✳ Fix the login bug')).toBe('Fix the login bug')
    expect(conversationTitle('◐ Claude Code')).toBe('Claude Code')
    expect(conversationTitle('PowerShell')).toBe('PowerShell')
  })
})
