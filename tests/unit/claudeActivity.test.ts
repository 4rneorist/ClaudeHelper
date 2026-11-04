import { describe, expect, it } from 'vitest'
import {
  activityFromTitle,
  conversationTitle,
  hasTickBox,
  isAsking,
  isSubmitScreen,
  isTicked,
  isTranscriptView,
  previewOf,
  promptRows,
  promptTarget,
  questionOf
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

// Screens as Claude Code 2.1.310 drew them (fullscreen renderer), trimmed to the interesting rows.
const RULE_LINE = '─'.repeat(60)
const liveScreen = [
  ' ▐▛███▛█   Claude Code v2.1.310',
  '',
  '❯ Reply with just the word PONG and nothing else',
  '',
  '● PONG',
  '',
  '✻ Worked for 1s · done 2:47 PM',
  '',
  RULE_LINE,
  '❯ ',
  RULE_LINE,
  '  Opus 5.5 │ effort xhigh │ tokens 53k (ctx 5%)'
]
const transcript = [
  ' ▐▛███▛█   Claude Code v2.1.310',
  '',
  '❯ Print the numbers 1 to 3',
  '',
  '                                         02:48 PM claude-opus-5-5',
  '● 1',
  '  2',
  '  3',
  '',
  '❯ And now in words',
  '  with a second line',
  '',
  '● one two three',
  '',
  RULE_LINE,
  '  Showing detailed transcript · ctrl+o to toggle · v to open in notepad'
]

describe('promptRows', () => {
  it('finds the rows where your messages start', () => {
    expect(promptRows(transcript)).toEqual([2, 9])
    expect(promptRows(liveScreen)).toEqual([2])
  })

  it('skips the input box, even with a draft in it, and the choices of a question', () => {
    const drafting = [...liveScreen.slice(0, 9), '❯ half-typed draft', RULE_LINE]
    expect(promptRows(drafting)).toEqual([2])
    expect(promptRows(['Do you want to proceed?', '❯ 1. Yes', '  2. No', 'Esc to cancel'])).toEqual(
      []
    )
  })
})

describe('isTranscriptView', () => {
  it("tells Claude's transcript view from its normal screen", () => {
    expect(isTranscriptView(transcript)).toBe(true)
    expect(isTranscriptView(liveScreen)).toBe(false)
  })
})

describe('promptTarget', () => {
  // Prompts at rows 10, 50 and 90 of a buffer whose screen is 40 rows high.
  const rows = [10, 50, 90]

  it('from the bottom, goes to the last prompt first, even when it is on screen', () => {
    expect(promptTarget(rows, { top: 70, bottom: true, screen: 40 }, -1)).toBe(90)
    expect(promptTarget(rows, { top: 90, bottom: true, screen: 40 }, -1)).toBe(50)
  })

  it('scrolled up, goes to the prompt above or below the top of the view', () => {
    expect(promptTarget(rows, { top: 50, bottom: false, screen: 40 }, -1)).toBe(10)
    expect(promptTarget(rows, { top: 50, bottom: false, screen: 40 }, 1)).toBe(90)
    expect(promptTarget(rows, { top: 30, bottom: false, screen: 40 }, 1)).toBe(50)
  })

  it('has nowhere to go past the first or the last prompt', () => {
    expect(promptTarget(rows, { top: 10, bottom: false, screen: 40 }, -1)).toBeNull()
    expect(promptTarget(rows, { top: 90, bottom: false, screen: 40 }, 1)).toBeNull()
    expect(promptTarget([], { top: 0, bottom: true, screen: 40 }, -1)).toBeNull()
  })
})

describe('questionOf', () => {
  // Claude Code 2.1 screens, as in isAsking's tests, with the conversation above them.
  const permission = [
    '● Running the tests now.',
    '─'.repeat(40),
    ' Bash command',
    '   npm test',
    ' Do you want to proceed?',
    ' ❯ 1. Yes',
    "   2. Yes, and don't ask again for npm test commands in this project",
    '   3. No',
    ' Esc to cancel · Tab to amend'
  ]
  const question = [
    '1. A numbered list Claude wrote above',
    '☐ Drink',
    'Do you prefer tea or coffee?',
    '  1. Tea',
    '     You prefer tea.',
    '❯ 2. Coffee',
    '  3. Type something.',
    '─'.repeat(40),
    '  4. Chat about this',
    'Enter to select · ↑/↓ to navigate · Esc to cancel'
  ]

  it('reads a permission prompt: its dialog as text, and its options', () => {
    const q = questionOf(permission)!
    expect(q.text).toBe(
      [
        'Bash command',
        '  npm test',
        'Do you want to proceed?',
        '  1. Yes',
        "  2. Yes, and don't ask again for npm test commands in this project",
        '  3. No'
      ].join('\n')
    )
    expect(q.options).toEqual([
      { n: 1, label: 'Yes' },
      { n: 2, label: "Yes, and don't ask again for npm test commands in this project" },
      { n: 3, label: 'No' }
    ])
    expect(q).toMatchObject({ multi: false, freeText: null, cursor: 1 })
  })

  it('reads a question with its free-text option and where the cursor is', () => {
    const q = questionOf(question)!
    expect(q.options.map((o) => o.n)).toEqual([1, 2, 3, 4])
    expect(q).toMatchObject({ freeText: 3, cursor: 2, multi: false })
    // A list further up isn't one of its options; its descriptions are part of the text.
    expect(q.text).toContain('You prefer tea.')
    expect(q.text.startsWith('1. A numbered list')).toBe(true)
  })

  it('sees tick boxes as a question that takes several answers', () => {
    const multi = question.map((l) => l.replace(/(\d\. )(Tea|Coffee)/, '$1[ ] $2'))
    expect(questionOf(multi)!.multi).toBe(true)
  })

  it('gives the same id for the same question, and another for another', () => {
    expect(questionOf(permission)!.id).toBe(questionOf([...permission])!.id)
    const other = permission.map((l) => l.replace('npm test', 'npm run lint'))
    expect(questionOf(other)!.id).not.toBe(questionOf(permission)!.id)
    expect(questionOf(permission)!.id).toMatch(/^[a-z0-9]{1,12}$/)
  })

  it('is null when Claude asks nothing', () => {
    expect(questionOf(['● Done.', '─'.repeat(40), '❯ ', '─'.repeat(40)])).toBeNull()
  })
})

describe('questionOf with tick boxes', () => {
  // Claude Code 2.1.316, AskUserQuestion with multiSelect, after pressing 1.
  const fruits = [
    '─'.repeat(40),
    '←  ☒ Fruits  ✔ Submit  →',
    'Which fruits?',
    '❯ 1. [✔] Apple',
    '         Apple',
    '  2. [ ] Banana',
    '         Banana',
    '  3. [ ] Cherry',
    '         Cherry',
    '  4. [ ] Type something',
    '     Submit',
    '─'.repeat(40),
    '  5. Chat about this',
    'Enter to select · ↑/↓ to navigate · Esc to cancel'
  ]

  it('reads the boxes, which are ticked, and the box for your own words', () => {
    const q = questionOf(fruits)!
    expect(q.multi).toBe(true)
    expect(q.freeText).toBe(4)
    expect(q.options.map((o) => [o.n, hasTickBox(o.label), isTicked(o.label)])).toEqual([
      [1, true, true],
      [2, true, false],
      [3, true, false],
      [4, true, false],
      [5, false, false]
    ])
  })
})

describe('isSubmitScreen', () => {
  it("sees the last screen of Claude's question form", () => {
    // Claude Code 2.1.316, after the last answer of a form.
    const review = [
      '←  ☒ Fruits  ✔ Submit  →',
      'Review your answers',
      ' ● Which fruits?',
      '   → Apple, Cherry',
      'Ready to submit your answers?',
      '❯ 1. Submit answers',
      '  2. Cancel'
    ]
    expect(isSubmitScreen(review)).toBe(true)
    expect(isSubmitScreen(['Do you want to proceed?', '❯ 1. Yes', '  2. No'])).toBe(false)
  })
})
