import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { matchRunningSessions, readRunningSessions } from '../../src/main/claudeSessions'
import { registrySignature } from '../../src/main/registryWatcher'
import { sanitizeUiState, UiStateStore } from '../../src/main/uiState'

const ROOT = process.platform === 'win32' ? 'C:\\work' : '/work'
const A = path.join(ROOT, 'a')
const B = path.join(ROOT, 'b')
const ID1 = '11111111-1111-4111-8111-111111111111'
const ID2 = '22222222-2222-4222-8222-222222222222'

const claude = (key: string, cwd = A, extra: object = {}): object => ({
  key,
  cwd,
  title: `Claude ${key}`,
  spec: { kind: 'claude', mode: 'new', sessionId: ID1 },
  ...extra
})

function state(overrides: object = {}): object {
  return {
    version: 1,
    activeWorkspace: 0,
    workspaces: [
      {
        cwd: A,
        claudeCount: 2,
        activeSubTab: 0,
        subTabs: [
          {
            layout: {
              type: 'split',
              dir: 'row',
              children: [
                { type: 'leaf', id: 't1' },
                { type: 'leaf', id: 't2' }
              ],
              sizes: [3, 1]
            },
            activePane: 't2'
          }
        ]
      }
    ],
    terminals: [claude('t1'), { ...claude('t2'), spec: { kind: 'shell', shellId: 'cmd' } }],
    ...overrides
  }
}

describe('sanitizeUiState', () => {
  it('keeps a valid state and normalises split sizes', () => {
    const s = sanitizeUiState(state())!
    expect(s.workspaces[0].subTabs[0].layout).toMatchObject({ sizes: [0.75, 0.25] })
    expect(s.workspaces[0].subTabs[0].activePane).toBe('t2')
    expect(s.terminals.map((t) => t.key)).toEqual(['t1', 't2'])
  })

  it('drops invalid terminals and collapses layouts around them', () => {
    const s = sanitizeUiState(
      state({
        terminals: [claude('t1'), { ...claude('t2'), spec: { kind: 'claude', mode: 'rm -rf' } }]
      })
    )!
    expect(s.workspaces[0].subTabs[0].layout).toEqual({ type: 'leaf', id: 't1' })
    expect(s.workspaces[0].subTabs[0].activePane).toBe('t1')
    expect(s.terminals).toHaveLength(1)
  })

  it('uses each terminal once and ignores relative folders', () => {
    const dup = state()
    ;(dup as { workspaces: object[] }).workspaces.push(
      {
        cwd: B,
        claudeCount: 0,
        activeSubTab: 5,
        subTabs: [{ layout: { type: 'leaf', id: 't1' } }]
      },
      { cwd: 'relative', claudeCount: 0, activeSubTab: 0, subTabs: [] }
    )
    const s = sanitizeUiState(dup)!
    expect(s.workspaces).toHaveLength(1)
  })

  it('clamps indexes and returns null when nothing usable is left', () => {
    expect(sanitizeUiState(state({ activeWorkspace: 9 }))!.activeWorkspace).toBe(0)
    expect(sanitizeUiState(state({ workspaces: [] }))).toBeNull()
    expect(sanitizeUiState('garbage')).toBeNull()
  })

  it('keeps tab colors that are #rrggbb and drops anything else', () => {
    const s = sanitizeUiState(
      state({
        terminals: [claude('t1', A, { color: '#2563EB' }), claude('t2', A, { color: 'red' })]
      })
    )!
    expect(s.terminals[0].color).toBe('#2563eb')
    expect(s.terminals[1]).not.toHaveProperty('color')
  })

  it('keeps a muted tab muted, and only true counts', () => {
    const s = sanitizeUiState(
      state({ terminals: [claude('t1', A, { muted: true }), claude('t2', A, { muted: 'yes' })] })
    )!
    expect(s.terminals[0].muted).toBe(true)
    expect(s.terminals[1]).not.toHaveProperty('muted')
  })

  it('keeps joined folders as pairs: two kept folders, each in one pair, size clamped', () => {
    const folder = (cwd: string, key: string, extra: object = {}): object => ({
      cwd,
      claudeCount: 1,
      activeSubTab: 0,
      subTabs: [{ layout: { type: 'leaf', id: key } }],
      ...extra
    })
    const C = path.join(ROOT, 'c')
    const s = sanitizeUiState({
      version: 1,
      activeWorkspace: 0,
      workspaces: [
        folder(A, 't1'),
        { cwd: 'relative', subTabs: [] }, // dropped, so later indexes shift
        folder(B, 't2', { joinedTo: 0, joinSize: 0.99 }),
        folder(C, 't3', { joinedTo: 0 }) // A is already in a pair
      ],
      terminals: [claude('t1'), claude('t2', B), claude('t3', C)]
    })!
    expect(s.workspaces.map((w) => [w.joinedTo, w.joinSize])).toEqual([
      [undefined, undefined],
      [0, 0.85],
      [undefined, undefined]
    ])
    // Joined to itself or to a folder that isn't there: ignored.
    for (const joinedTo of [0, 7, 'x']) {
      const alone = sanitizeUiState(state({ workspaces: [folder(A, 't1', { joinedTo })] }))!
      expect(alone.workspaces[0]).not.toHaveProperty('joinedTo')
    }
  })

  it('keeps pid/startedAt only when asked to', () => {
    const withRuntime = state({
      terminals: [claude('t1', A, { pid: 5, startedAt: 9 }), claude('t2')]
    })
    expect(sanitizeUiState(withRuntime)!.terminals[0]).not.toHaveProperty('pid')
    expect(sanitizeUiState(withRuntime, true)!.terminals[0]).toMatchObject({ pid: 5, startedAt: 9 })
  })
})

describe('matchRunningSessions', () => {
  const running = [
    { pid: 100, sessionId: ID1, cwd: A, startedAt: 1_000 },
    { pid: 200, sessionId: ID2, cwd: A, startedAt: 5_000 }
  ]

  it('matches by pid', () => {
    const ids = matchRunningSessions(
      [{ key: 'x', pid: 200, cwd: A, startedAt: 0 }],
      running,
      'linux'
    )
    expect(ids).toEqual({ x: ID2 })
  })

  it('falls back to the same folder and closest start time, never claiming one twice', () => {
    const ids = matchRunningSessions(
      [
        { key: 'shim1', pid: 1, cwd: A, startedAt: 900 }, // wrapper pid, claude started 100 ms later
        { key: 'shim2', pid: 2, cwd: A, startedAt: 4_000 },
        { key: 'other', pid: 3, cwd: B, startedAt: 900 }
      ],
      running,
      'linux'
    )
    expect(ids).toEqual({ shim1: ID1, shim2: ID2 })
  })
})

describe('readRunningSessions / UiStateStore', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'ui-state-'))
    mkdirSync(path.join(dir, 'claude', 'sessions'), { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const registry = (pid: number, sessionId: string, cwd = A): void =>
    writeFileSync(
      path.join(dir, 'claude', 'sessions', `${pid}.json`),
      JSON.stringify({ pid, sessionId, cwd, startedAt: 1_000, status: 'idle' })
    )

  it('reads Claude Code registry files and skips foreign ones', async () => {
    registry(100, ID1)
    writeFileSync(path.join(dir, 'claude', 'sessions', '7.json'), '{ broken')
    writeFileSync(path.join(dir, 'claude', 'sessions', '100.something.key'), '{}')
    expect(await readRunningSessions(path.join(dir, 'claude'))).toEqual([
      { pid: 100, sessionId: ID1, cwd: A, startedAt: 1_000 }
    ])
  })

  it('saves with the current conversation ids and loads them back without runtime fields', async () => {
    const file = path.join(dir, 'ui-state.json')
    const store = new UiStateStore(file, () => path.join(dir, 'claude'), 'linux')
    registry(4242, ID2) // claude switched conversation (e.g. after /clear)
    const ids = await store.save(
      state({ terminals: [claude('t1', A, { pid: 4242, startedAt: 900 }), claude('t2')] })
    )
    expect(ids).toEqual({ t1: ID2 })
    const loaded = store.load()!
    expect(loaded.terminals[0]).toMatchObject({ key: 't1', claudeSessionId: ID2 })
    expect(loaded.terminals[0]).not.toHaveProperty('pid')
    expect(JSON.parse(readFileSync(file, 'utf8')).terminals[0]).not.toHaveProperty('startedAt')
  })

  it('flush re-reads ids before quitting', async () => {
    const store = new UiStateStore(
      path.join(dir, 'ui-state.json'),
      () => path.join(dir, 'claude'),
      'linux'
    )
    await store.save(
      state({ terminals: [claude('t1', A, { pid: 77, startedAt: 900 }), claude('t2')] })
    )
    registry(77, ID2)
    await store.flush()
    expect(store.load()!.terminals[0].claudeSessionId).toBe(ID2)
  })

  it('an empty UI saves as "nothing to restore"', async () => {
    const store = new UiStateStore(
      path.join(dir, 'ui-state.json'),
      () => path.join(dir, 'claude'),
      'linux'
    )
    await store.save(state())
    await store.save({ version: 1, activeWorkspace: 0, workspaces: [], terminals: [] })
    expect(store.load()).toBeNull()
  })
})

describe('registrySignature', () => {
  it('changes only when a process opens a different conversation', () => {
    const a = { pid: 1, sessionId: ID1, cwd: A, startedAt: 1 }
    const b = { pid: 2, sessionId: ID2, cwd: A, startedAt: 2 }
    expect(registrySignature([a, b])).toBe(registrySignature([b, { ...a, startedAt: 99 }]))
    expect(registrySignature([a, b])).not.toBe(registrySignature([a, { ...b, sessionId: ID1 }]))
    expect(registrySignature([a])).not.toBe(registrySignature([a, b]))
  })
})

describe('matchRunningSessions with known ids', () => {
  it('lets a wrapped process keep its own conversation even if another started earlier', () => {
    const running = [
      { pid: 10, sessionId: ID2, cwd: A, startedAt: 1_000 }, // the other tab's claude
      { pid: 11, sessionId: ID1, cwd: A, startedAt: 1_050 }
    ]
    const ids = matchRunningSessions(
      [
        { key: 'mine', pid: 1, cwd: A, startedAt: 900, knownSessionId: ID1 },
        { key: 'other', pid: 2, cwd: A, startedAt: 950 } // e.g. "Continue last": id unknown
      ],
      running,
      'linux'
    )
    expect(ids).toEqual({ mine: ID1, other: ID2 })
  })
})
