import { describe, expect, it } from 'vitest'
import { readableLines, readableText } from '../../src/shared/screenTables'

// Claude Code's table, as wide as its terminal: the header centred, a row's cells wrapped inside
// their columns (and centred top to bottom), a border between every two rows.
const WIDE = [
  'Here is where each repo stands:',
  '  ┌────────────┬────────────┬──────────────────────────────────────────────────┐',
  '  │    Repo    │   Branch   │                     Changes                      │',
  '  ├────────────┼────────────┼──────────────────────────────────────────────────┤',
  '  │ Tenant     │ develop_70 │ The Import Inspector work: 10 modified and 8     │',
  '  │            │            │ untracked files. Check the feature branch.       │',
  '  ├────────────┼────────────┼──────────────────────────────────────────────────┤',
  '  │            │            │ src/Web.Api/ConfigureServices.cs gains 7 lines   │',
  '  │ userlicen… │ develop    │ that register Redis when it is configured, so    │',
  '  │            │            │ tenant-cache invalidation can work.              │',
  '  ├────────────┼────────────┼──────────────────────────────────────────────────┤',
  '  │ API        │ bugfix/MT… │ An untracked docs/ folder only.                  │',
  '  └────────────┴────────────┴──────────────────────────────────────────────────┘',
  'Submodule pointers that differ from what the branch records'
]

describe('readableLines', () => {
  it('turns a wide table into its rows, a field a line', () => {
    expect(readableLines(WIDE)).toEqual([
      'Here is where each repo stands:',
      '',
      'Repo: Tenant',
      'Branch: develop_70',
      'Changes: The Import Inspector work: 10 modified and 8 untracked files. Check the feature branch.',
      '',
      'Repo: userlicen…',
      'Branch: develop',
      'Changes: src/Web.Api/ConfigureServices.cs gains 7 lines that register Redis when it is configured, so tenant-cache invalidation can work.',
      '',
      'Repo: API',
      'Branch: bugfix/MT…',
      'Changes: An untracked docs/ folder only.',
      '',
      'Submodule pointers that differ from what the branch records'
    ])
  })

  it('without the header (cut off at the top), puts a row on a line', () => {
    expect(readableLines(WIDE.slice(5))).toEqual([
      'untracked files. Check the feature branch.',
      '',
      'userlicen… │ develop │ src/Web.Api/ConfigureServices.cs gains 7 lines that register Redis when it is configured, so tenant-cache invalidation can work.',
      '',
      'API │ bugfix/MT… │ An untracked docs/ folder only.',
      '',
      'Submodule pointers that differ from what the branch records'
    ])
  })

  it('keeps a table that fits a phone as a grid, without its outer border', () => {
    const narrow = [
      '┌──────────────────────────┬───────────────────────────────┐',
      '│           File           │             Lines             │',
      '├──────────────────────────┼───────────────────────────────┤',
      '│ a.ts                     │ +3                            │',
      '├──────────────────────────┼───────────────────────────────┤',
      '│ store.ts                 │ +10 −2                        │',
      '└──────────────────────────┴───────────────────────────────┘'
    ]
    expect(readableLines(narrow)).toEqual([
      'File     │ Lines',
      '─────────┼───────',
      'a.ts     │ +3',
      'store.ts │ +10 −2'
    ])
  })

  it("knows the top of a table that starts Claude's message, behind its bullet", () => {
    const message = [
      '❯ list the files',
      '● ┌──────────────────────────┬───────────────────────────────┐',
      '  │           File           │             Lines             │',
      '  ├──────────────────────────┼───────────────────────────────┤',
      '  │ a.ts                     │ +3 −1                         │',
      '  └──────────────────────────┴───────────────────────────────┘'
    ]
    expect(readableLines(message)).toEqual([
      '❯ list the files',
      '',
      'File │ Lines',
      '─────┼──────',
      'a.ts │ +3 −1'
    ])
  })

  it('takes two tables one after the other apart', () => {
    const one = ['┌───┬───┐', '│ A │ B │', '├───┼───┤', '│ 1 │ 2 │', '└───┴───┘']
    expect(readableLines([...one, ...one])).toEqual([
      'A │ B',
      '──┼──',
      '1 │ 2',
      '',
      'A │ B',
      '──┼──',
      '1 │ 2'
    ])
  })

  it('leaves boxes with one column alone, and everything else', () => {
    const lines = [
      '┌──────────┐',
      '│ const a  │',
      '│ const b  │',
      '└──────────┘',
      '╭──────────╮',
      '│ hi │ you │',
      '╰──────────╯',
      '  1. Yes',
      '│ not │ a table │'
    ]
    expect(readableLines(lines)).toEqual(lines)
  })

  it('cuts rules as wide as the terminal short', () => {
    expect(readableLines(['text', '─'.repeat(200), '──────', 'more'])).toEqual([
      'text',
      '─'.repeat(20),
      '──────',
      'more'
    ])
  })

  it('works on text too', () => {
    expect(readableText('a\n┌───┬───┐\n│ x │ y │\n└───┴───┘\nb')).toBe('a\n\nx │ y\n\nb')
  })
})
