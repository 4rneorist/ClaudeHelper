import { beforeEach, describe, expect, it } from 'vitest'
import { activeTerminalKey, useStore, type TerminalState } from '../../src/renderer/src/store'
import {
  MAX_REMINDERS,
  nextWaiting,
  reminderDue,
  waitingSummary,
  waitingTerminals
} from '../../src/renderer/src/waiting'

const ROOT = process.platform === 'win32' ? 'C:\\work\\' : '/work/'
const DEV = `${ROOT}dev`
const APP = `${ROOT}app`

const state = (): ReturnType<typeof useStore.getState> => useStore.getState()

beforeEach(() =>
  useStore.setState({ workspaces: [], activeWorkspace: '', terminals: {}, settings: null })
)

/** A running Claude tab doing `what`, in the folder. */
function claude(cwd: string, what: Partial<TerminalState> = {}): string {
  state().openInFolder(cwd, { kind: 'claude', mode: 'new' })
  const key = activeTerminalKey(state())!
  state().patchTerminal(key, { status: 'running', ...what })
  return key
}

const asking: Partial<TerminalState> = { activity: 'asking' }
const finished: Partial<TerminalState> = { activity: 'idle', attention: 'finished' }

describe('waitingTerminals', () => {
  it('lists asking sessions first, then unseen finished ones, each in tab order', () => {
    const a = claude(DEV, finished)
    const b = claude(DEV, asking)
    claude(DEV, { activity: 'idle' }) // seen: not waiting
    claude(DEV, { activity: 'working' })
    const c = claude(APP, asking)
    const d = claude(APP, finished)
    expect(waitingTerminals(state())).toEqual([b, c, a, d])
    expect(waitingTerminals(state(), 'finished')).toEqual([a, d])
  })

  it('leaves out muted sessions and sessions in muted folders', () => {
    claude(DEV, { ...asking, muted: true })
    claude(APP, asking)
    const kept = claude(DEV, finished)
    useStore.setState({ settings: { mutedFolders: [APP] } as never })
    expect(waitingTerminals(state())).toEqual([kept])
  })
})

describe('nextWaiting', () => {
  it('goes to the next one and wraps around; none when nothing waits', () => {
    expect(nextWaiting(state(), null)).toBeNull()
    const a = claude(DEV, asking)
    const b = claude(APP, finished)
    expect(nextWaiting(state(), null)).toBe(a)
    expect(nextWaiting(state(), a)).toBe(b)
    expect(nextWaiting(state(), b)).toBe(a)
    expect(nextWaiting(state(), b, 'finished')).toBe(b)
  })
})

describe('waitingSummary', () => {
  it('counts asking, finished and working sessions, without muted ones', () => {
    claude(DEV, asking)
    claude(DEV, finished)
    claude(DEV, { activity: 'working' })
    claude(DEV, { activity: 'working', muted: true })
    expect(waitingSummary(state())).toEqual({ asking: 1, finished: 1, working: 1 })
  })
})

describe('reminderDue', () => {
  const MIN = 60_000
  it('reminds every interval since it started asking or was last reminded, a few times', () => {
    expect(reminderDue(0, undefined, 0, 5 * MIN - 1, 5)).toBe(false)
    expect(reminderDue(0, undefined, 0, 5 * MIN, 5)).toBe(true)
    expect(reminderDue(0, 5 * MIN, 1, 9 * MIN, 5)).toBe(false)
    expect(reminderDue(0, 5 * MIN, 1, 10 * MIN, 5)).toBe(true)
    expect(reminderDue(0, 5 * MIN, MAX_REMINDERS, 60 * MIN, 5)).toBe(false)
    expect(reminderDue(0, undefined, 0, 60 * MIN, 0)).toBe(false) // off
  })
})
