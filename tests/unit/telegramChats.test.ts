import { describe, expect, it } from 'vitest'
import { leaf, type LayoutNode } from '../../src/renderer/src/layout'
import type { TerminalState, Workspace } from '../../src/renderer/src/store'
import {
  chatList,
  findChats,
  keyForThread,
  readAnswer,
  splitChat,
  topicColor,
  topicName,
  type Chat
} from '../../src/renderer/src/telegramChats'
import { TOPIC_COLORS, type ClaudeQuestion } from '../../src/shared/ipc'

const terminal = (
  key: string,
  title: string,
  patch: Partial<TerminalState> = {}
): TerminalState => ({
  key,
  cwd: '/work',
  spec: { kind: 'claude', mode: 'new' },
  title,
  status: 'running',
  attempt: 1,
  ...patch
})

const split = (panes: string[]): LayoutNode =>
  panes.length === 1
    ? leaf(panes[0])
    : {
        type: 'split',
        dir: 'row',
        children: panes.map(leaf),
        sizes: panes.map(() => 1 / panes.length)
      }

const workspace = (key: string, title: string, tabs: string[][]): Workspace => ({
  key,
  kind: 'folder',
  cwd: `/${title}`,
  title,
  subTabs: tabs.map((panes, i) => ({
    key: `${key}-sub${i}`,
    layout: split(panes),
    activePane: panes[0]
  })),
  activeSubTab: `${key}-sub0`,
  claudeCount: 0,
  joinedTo: null,
  joinSize: 0.5
})

const state = {
  appInfo: null,
  settings: null,
  workspaces: [workspace('ws1', 'app', [['t1', 'sh'], ['t2']]), workspace('ws2', 'api', [['t3']])],
  terminals: {
    t1: terminal('t1', 'Claude 1', { activity: 'asking' }),
    sh: terminal('sh', 'PowerShell', { spec: { kind: 'shell', shellId: 'pwsh' } }),
    t2: terminal('t2', 'Fix login', { activity: 'working' }),
    t3: terminal('t3', 'Claude 1', { status: 'dormant' })
  }
}

describe('chatList', () => {
  it('numbers the Claude chats in tab order, leaving shells out', () => {
    expect(chatList(state).map((c) => [c.n, c.folder, c.title, c.status])).toEqual([
      [1, 'app', 'Claude 1', 'asking'],
      [2, 'app', 'Fix login', 'working'],
      [3, 'api', 'Claude 1', 'dormant']
    ])
  })
})

describe('findChats', () => {
  const chats = chatList(state)
  const keys = (found: Chat[]): string[] => found.map((c) => c.key)

  it('finds a chat by its number, its name or the start of it', () => {
    expect(keys(findChats(chats, '2'))).toEqual(['t2'])
    expect(keys(findChats(chats, 'fix login'))).toEqual(['t2'])
    expect(keys(findChats(chats, 'Fix'))).toEqual(['t2'])
  })

  it('finds every chat of a name, and folder/name tells them apart', () => {
    expect(keys(findChats(chats, 'claude 1'))).toEqual(['t1', 't3'])
    expect(keys(findChats(chats, 'api/claude 1'))).toEqual(['t3'])
    expect(keys(findChats(chats, 'ap/claude'))).toEqual(['t1', 't3'])
  })

  it('finds nothing for an unknown name or number', () => {
    expect(findChats(chats, '9')).toEqual([])
    expect(findChats(chats, 'nope')).toEqual([])
  })
})

describe('splitChat', () => {
  const chats = chatList(state)

  it('takes the longest name that matches, since names have spaces', () => {
    expect(splitChat(chats, 'Claude 1 run the tests')).toEqual({
      query: 'Claude 1',
      rest: 'run the tests'
    })
    expect(splitChat(chats, 'api/Claude 1 hi')).toEqual({ query: 'api/Claude 1', rest: 'hi' })
    expect(splitChat(chats, '2 first line\nsecond line')).toEqual({
      query: '2',
      rest: 'first line\nsecond line'
    })
  })

  it('takes quotes, and else the first word', () => {
    expect(splitChat(chats, '"Fix login" go')).toEqual({ query: 'Fix login', rest: 'go' })
    expect(splitChat(chats, 'fix go on')).toEqual({ query: 'fix', rest: 'go on' })
    expect(splitChat(chats, 'Claude 1')).toEqual({ query: 'Claude 1', rest: '' })
  })
})

describe('readAnswer', () => {
  const single: ClaudeQuestion = {
    id: 'q1',
    text: 'Tea or coffee?',
    options: [
      { n: 1, label: 'Tea' },
      { n: 2, label: 'Coffee' },
      { n: 3, label: 'Type something.' },
      { n: 4, label: 'Chat about this' }
    ],
    multi: false,
    freeText: 3
  }
  const multi: ClaudeQuestion = {
    id: 'q2',
    text: 'Which colors?',
    options: [
      { n: 1, label: '[ ] Red' },
      { n: 2, label: '[ ] Green' },
      { n: 3, label: '[ ] Blue' },
      { n: 4, label: '[ ] Yellow' },
      { n: 5, label: '[ ] Type something' },
      { n: 6, label: 'Chat about this' }
    ],
    multi: true,
    freeText: 5
  }

  it('picks one option by its number, or the own-words one with your words', () => {
    expect(readAnswer(single, '2')).toEqual({ kind: 'choose', n: 2 })
    expect(readAnswer(single, 'Green tea, please')).toEqual({
      kind: 'words',
      n: 3,
      text: 'Green tea, please'
    })
    expect(readAnswer(single, '3: Green tea')).toEqual({ kind: 'words', n: 3, text: 'Green tea' })
  })

  it('turns down what a question with one answer cannot take', () => {
    expect(readAnswer(single, '1 2').kind).toBe('unclear')
    expect(readAnswer(single, '7').kind).toBe('unclear')
    expect(readAnswer(single, '3').kind).toBe('unclear')
    expect(readAnswer(single, '1: with milk').kind).toBe('unclear')
    expect(readAnswer({ ...single, freeText: null }, 'Green tea').kind).toBe('unclear')
  })

  it('ticks several, with your words for "Type something" after a colon', () => {
    expect(readAnswer(multi, '1 3')).toEqual({ kind: 'tick', numbers: [1, 3], text: null })
    expect(readAnswer(multi, '1, 2, 5: Black')).toEqual({
      kind: 'tick',
      numbers: [1, 2],
      text: 'Black'
    })
    // The colon says what the words are for, so the own-words number can be left out.
    expect(readAnswer(multi, '1 2: Black')).toEqual({
      kind: 'tick',
      numbers: [1, 2],
      text: 'Black'
    })
    expect(readAnswer(multi, 'Black')).toEqual({ kind: 'tick', numbers: [], text: 'Black' })
  })

  it('turns down what a question with several answers cannot take', () => {
    expect(readAnswer(multi, '1 5')).toEqual({
      kind: 'unclear',
      why: 'Reply with the numbers to tick, like 1 3. For “Type something”, write your words after its number and a colon, like 5: …'
    })
    expect(readAnswer(multi, '1 6').kind).toBe('unclear')
    expect(readAnswer(multi, '9').kind).toBe('unclear')
    expect(readAnswer({ ...multi, freeText: null }, '1: Black').kind).toBe('unclear')
  })
})

describe('topics', () => {
  it('names a topic after the folder and tab, cut to what Telegram takes', () => {
    expect(topicName({ folder: 'my project', title: 'Fix  login' })).toBe('my project › Fix login')
    const long = topicName({ folder: 'f', title: 'x'.repeat(300) })
    expect(long).toHaveLength(128)
    expect(long.endsWith('…')).toBe(true)
  })

  it('gives all chats of a folder the same of Telegram’s colours', () => {
    expect(topicColor('my project')).toBe(topicColor('my project'))
    expect(TOPIC_COLORS).toContain(topicColor('my project'))
    const colors = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(topicColor))
    expect(colors.size).toBeGreaterThan(1)
  })

  it('finds the tab a topic belongs to', () => {
    const terminals = {
      t1: { key: 't1', telegramTopic: 5 },
      t2: { key: 't2' },
      t3: { key: 't3', telegramTopic: 9 }
    }
    expect(keyForThread(terminals, 9)).toBe('t3')
    expect(keyForThread(terminals, 7)).toBeUndefined()
  })
})
