import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  finishedTurn,
  lastTurn,
  listPastSessions,
  projectDirName,
  promptText,
  scanHead,
  scanTitles,
  type ClaudeTurn
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

const assistant = (blocks: object[], stop: string | null, extra: object = {}): string =>
  line({
    type: 'assistant',
    message: { role: 'assistant', content: blocks, stop_reason: stop },
    ...extra
  })
const text = (t: string): object => ({ type: 'text', text: t })
const at = (iso: string): object => ({ timestamp: iso })

describe('lastTurn', () => {
  it("is Claude's text since your last prompt, between its tool calls and at the end", () => {
    const lines = [
      user('first question', at('2026-11-04T10:00:00.000Z')),
      assistant([text('An old answer.')], 'end_turn'),
      user('fix the bug', at('2026-11-04T10:05:00.000Z')),
      assistant([{ type: 'thinking', thinking: 'hmm' }], 'tool_use'),
      assistant([text('Let me look at the file.')], 'tool_use'),
      assistant([{ type: 'tool_use', name: 'Read', input: {} }], 'tool_use'),
      user([{ type: 'tool_result', content: 'file contents' }]),
      assistant([text('Found it, an off-by-one in `loop`.')], 'end_turn', { isSidechain: false }),
      assistant([text('A subagent says hi')], 'end_turn', { isSidechain: true }),
      line({ type: 'system', subtype: 'turn_duration' })
    ]
    expect(lastTurn(lines)).toEqual({
      promptAt: Date.parse('2026-11-04T10:05:00.000Z'),
      text: 'Let me look at the file.\n\nFound it, an off-by-one in `loop`.',
      complete: true
    })
  })

  it("isn't complete while Claude still works, or when it was stopped", () => {
    const lines = [
      user('go', at('2026-11-04T10:05:00.000Z')),
      assistant([text('Starting.')], 'tool_use')
    ]
    expect(lastTurn(lines)?.complete).toBe(false)
  })

  it('without its prompt (cut off), is what is there', () => {
    expect(lastTurn([assistant([text('The end.')], 'end_turn')])).toEqual({
      promptAt: 0,
      text: 'The end.',
      complete: true
    })
    expect(lastTurn(['', 'not json'])).toBeNull()
  })
})

describe('finishedTurn', () => {
  const turn = (promptAt: number, complete = true): ClaudeTurn => ({
    promptAt,
    text: 'Done.',
    complete
  })
  const opts = { tries: 3, delayMs: 1 }

  it('is the turn once it has ended', async () => {
    expect(await finishedTurn(async () => turn(5000), 5000, opts)).toEqual({
      kind: 'turn',
      text: 'Done.'
    })
  })

  it('reads again while the turn is still being written, then takes what there is', async () => {
    let reads = 0
    const read = async (): Promise<ClaudeTurn> => turn(5000, ++reads >= 2)
    expect(await finishedTurn(read, 5000, opts)).toEqual({ kind: 'turn', text: 'Done.' })
    expect(reads).toBe(2)
    reads = 0
    expect(await finishedTurn(async () => (reads++, turn(5000, false)), 5000, opts)).toEqual({
      kind: 'turn',
      text: 'Done.'
    })
    expect(reads).toBe(opts.tries + 1)
  })

  it('tells a turn that started before the prompt was sent: that prompt is still queued', async () => {
    expect(await finishedTurn(async () => turn(1000), 60_000, opts)).toEqual({ kind: 'earlier' })
    // For an answer (0), any turn is the one.
    expect(await finishedTurn(async () => turn(1000), 0, opts)).toEqual({
      kind: 'turn',
      text: 'Done.'
    })
  })

  it('is unknown without a transcript', async () => {
    expect(await finishedTurn(async () => null, 0, opts)).toEqual({ kind: 'unknown' })
  })
})
