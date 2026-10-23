import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listPastSessions,
  projectDirName,
  promptText,
  scanHead,
  scanTitles
} from '../../src/main/claudeSessions'

const CWD = process.platform === 'win32' ? 'C:\\Projects\\My App' : '/home/me/My App'
const ID = (n: number): string => `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`

const line = (o: object): string => JSON.stringify(o)
const user = (content: unknown, extra: object = {}): string =>
  line({ type: 'user', cwd: CWD, message: { role: 'user', content }, ...extra })

describe('projectDirName', () => {
  it('matches Claude Code folder naming', () => {
    expect(projectDirName('C:\\Projects\\Guideline\\dev')).toBe('C--Projects-Guideline-dev')
    expect(projectDirName('/home/me/my_app.v2')).toBe('-home-me-my-app-v2')
  })
})

describe('promptText', () => {
  it('reads string and block content, skipping meta, sidechain and command wrappers', () => {
    expect(promptText({ type: 'user', message: { content: '  fix   the bug ' } })).toBe(
      'fix the bug'
    )
    expect(
      promptText({ type: 'user', message: { content: [{ type: 'text', text: 'hello' }] } })
    ).toBe('hello')
    expect(
      promptText({
        type: 'user',
        message: { content: 'error here: <pasted_content id="1">long\nlog</pasted_content> why?' }
      })
    ).toBe('error here: [pasted text] why?')
    expect(promptText({ type: 'user', isMeta: true, message: { content: 'x' } })).toBeNull()
    expect(promptText({ type: 'user', isSidechain: true, message: { content: 'x' } })).toBeNull()
    expect(
      promptText({ type: 'user', message: { content: '<command-name>/clear</command-name>' } })
    ).toBeNull()
    expect(
      promptText({ type: 'user', message: { content: [{ type: 'tool_result', content: 'x' }] } })
    ).toBeNull()
  })
})

describe('scanHead / scanTitles', () => {
  it('finds the first real prompt and the latest titles', () => {
    const lines = [
      line({ type: 'mode', mode: 'normal' }),
      user('meta stuff', { isMeta: true }),
      user('first real prompt'),
      line({ type: 'ai-title', aiTitle: 'Old title' }),
      user('second prompt'),
      line({ type: 'ai-title', aiTitle: 'New title' }),
      line({ type: 'agent-name', agentName: 'my-agent' })
    ]
    expect(scanHead(lines)).toEqual({ firstPrompt: 'first real prompt', cwd: CWD })
    expect(scanTitles(lines)).toEqual({ aiTitle: 'New title', agentName: 'my-agent' })
  })

  it('ignores truncated or invalid lines', () => {
    expect(scanTitles(['{"type":"ai-title","aiT', 'garbage'])).toEqual({})
  })
})

describe('listPastSessions', () => {
  let config: string
  let dir: string

  beforeEach(() => {
    config = mkdtempSync(path.join(tmpdir(), 'claude-config-'))
    dir = path.join(config, 'projects', projectDirName(CWD))
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(config, { recursive: true, force: true }))

  const write = (id: string, lines: string[], ageMinutes: number): void => {
    const file = path.join(dir, `${id}.jsonl`)
    writeFileSync(file, lines.join('\n') + '\n')
    const t = (Date.now() - ageMinutes * 60_000) / 1000
    utimesSync(file, t, t)
  }
  const list = (limit = 5): ReturnType<typeof listPastSessions> =>
    listPastSessions(CWD, { configDir: config, limit, platform: process.platform })

  it('lists sessions newest first with titles, falling back to the first prompt', async () => {
    write(ID(1), [user('older prompt'), line({ type: 'ai-title', aiTitle: 'Older' })], 60)
    write(ID(2), [user('newest prompt, no title yet')], 1)
    const sessions = await list()
    expect(sessions.map((s) => s.id)).toEqual([ID(2), ID(1)])
    expect(sessions[0].title).toBe('newest prompt, no title yet')
    expect(sessions[1]).toMatchObject({ title: 'Older', firstPrompt: 'older prompt' })
  })

  it('respects the limit and skips empty sessions, foreign folders and non-session files', async () => {
    write(ID(1), [line({ type: 'mode', mode: 'normal' })], 1) // nothing said
    write(ID(2), [user('elsewhere', { cwd: '/some/other/My-App' })], 2)
    write(ID(3), [user('a')], 3)
    write(ID(4), [user('b')], 4)
    write(ID(5), [user('c')], 5)
    writeFileSync(path.join(dir, 'notes.jsonl'), user('not a session'))
    mkdirSync(path.join(dir, ID(6))) // subagent folder, not a file
    const sessions = await list(2)
    expect(sessions.map((s) => s.firstPrompt)).toEqual(['a', 'b'])
  })

  it('finds the prompt after a large SessionStart attachment', async () => {
    const big = line({ type: 'attachment', cwd: CWD, attachment: { stdout: 'x'.repeat(600_000) } })
    write(ID(1), [big, user('late prompt')], 1)
    expect((await list())[0].firstPrompt).toBe('late prompt')
  })

  it('returns nothing for a folder without history', async () => {
    const sessions = await listPastSessions('/never/used', {
      configDir: config,
      limit: 5,
      platform: process.platform
    })
    expect(sessions).toEqual([])
  })
})
