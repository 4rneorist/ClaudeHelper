import { describe, expect, it } from 'vitest'
import { findPaths } from '../../src/renderer/src/terminal/filePaths'

/** The paths found in a line, as written there and as they will be opened. */
const found = (line: string): [string, string][] =>
  findPaths(line).map((m) => [line.slice(m.start, m.end), m.path])
const paths = (line: string): string[] => findPaths(line).map((m) => m.path)

describe('findPaths', () => {
  it('finds Windows paths in Claude output, without the punctuation after them', () => {
    const line =
      'C:\\Users\\me\\scratchpad\\wrap-check\\out\\head.png (before) and C:/Users/me/work.png.'
    expect(found(line)).toEqual([
      [
        'C:\\Users\\me\\scratchpad\\wrap-check\\out\\head.png',
        'C:\\Users\\me\\scratchpad\\wrap-check\\out\\head.png'
      ],
      ['C:/Users/me/work.png', 'C:/Users/me/work.png']
    ])
  })

  it('finds relative, home and Unix paths, and bare file names', () => {
    expect(paths('see src/main/ipc.ts, ./run.sh and ../docs/')).toEqual([
      'src/main/ipc.ts',
      './run.sh',
      '../docs/'
    ])
    expect(paths('in ~/projects/app or /etc/hosts')).toEqual(['~/projects/app', '/etc/hosts'])
    expect(paths('Updated README.md and package.json.')).toEqual(['README.md', 'package.json'])
  })

  it('keeps the line number in the link but opens the file', () => {
    expect(found('Error at src/store.ts:877:5 and (lib/a.ts:12)')).toEqual([
      ['src/store.ts:877:5', 'src/store.ts'],
      ['lib/a.ts:12', 'lib/a.ts']
    ])
    expect(found('main.cs(42,7): error')).toEqual([['main.cs(42,7)', 'main.cs']])
  })

  it("reads the path out of Claude's tool lines, @ mentions and VAR=path", () => {
    expect(paths('● Update(src/renderer/src/store.ts)')).toEqual(['src/renderer/src/store.ts'])
    expect(paths('look at @src/jira.ts')).toEqual(['src/jira.ts'])
    expect(paths('CLAUDE_HELPER_USER_DATA=C:\\tmp\\dev-profile npm run dev')).toEqual([
      'C:\\tmp\\dev-profile'
    ])
  })

  it('takes a quoted path with spaces as one', () => {
    expect(found('cd "C:\\Program Files\\App" && dir')).toEqual([
      ['C:\\Program Files\\App', 'C:\\Program Files\\App']
    ])
    expect(paths("open '~/My Documents/a.txt' now")).toEqual(['~/My Documents/a.txt'])
    expect(paths("Claude's notes are in 'C:\\My Files\\a.txt'")).toEqual(['C:\\My Files\\a.txt'])
  })

  it('keeps brackets that belong to the path', () => {
    expect(paths('app/[id]/page.tsx and app/(auth)/login.tsx')).toEqual([
      'app/[id]/page.tsx',
      'app/(auth)/login.tsx'
    ])
  })

  it('leaves URLs, numbers, options and plain words alone', () => {
    expect(paths('https://example.com/a/b.html and file:///C:/x.txt')).toEqual([])
    expect(paths('version 1.0.1, 50/50, --flag, 12:30, -> and / or //')).toEqual([])
    expect(paths('Crunched for 2m 28s · done 12:51 PM')).toEqual([])
  })

  it('gives each found path its position in the line', () => {
    const line = 'a src/x.ts b'
    const [m] = findPaths(line)
    expect(m).toMatchObject({ start: 2, end: 10, path: 'src/x.ts' })
  })
})
