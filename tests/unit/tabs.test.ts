import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  activeTerminalKey,
  combinedAttention,
  combinedStatus,
  dotStatus,
  MIN_WORK_MS,
  pairOf,
  snapshot,
  useStore,
  type TerminalState
} from '../../src/renderer/src/store'
import { MAX_TITLE_LENGTH } from '../../src/shared/uiState'

const ROOT = process.platform === 'win32' ? 'C:\\work\\' : '/work/'
const DEV = `${ROOT}dev`
const APP = `${ROOT}app`
const API = `${ROOT}api`

const state = (): ReturnType<typeof useStore.getState> => useStore.getState()

beforeEach(() =>
  useStore.setState({
    workspaces: [],
    activeWorkspace: '',
    terminals: {},
    notifications: [],
    toasts: []
  })
)

/** Opens a new Claude tab in the folder and returns its key. */
function openClaude(cwd = DEV): string {
  state().openInFolder(cwd, { kind: 'claude', mode: 'new' })
  return activeTerminalKey(state())!
}

const folder = (cwd: string): string => state().workspaces.find((w) => w.cwd === cwd)!.key
const order = (): (string | null)[] => state().workspaces.map((w) => w.cwd)
const titleOf = (key: string): string => state().terminals[key].title

describe('updateTerminal', () => {
  it('renames a terminal, and the new name is what gets saved', () => {
    const key = openClaude()
    expect(titleOf(key)).toBe('Claude 1')

    state().updateTerminal(key, { title: '  Backend API  ' })

    expect(titleOf(key)).toBe('Backend API')
    expect(snapshot(state()).terminals.find((t) => t.key === key)?.title).toBe('Backend API')
  })

  it('keeps the old name when the new one is blank, and cuts long ones', () => {
    const key = openClaude()
    state().updateTerminal(key, { title: 'Docs' })
    state().updateTerminal(key, { title: '   ' })
    expect(titleOf(key)).toBe('Docs')

    state().updateTerminal(key, { title: 'x'.repeat(MAX_TITLE_LENGTH + 20) })
    expect(titleOf(key)).toHaveLength(MAX_TITLE_LENGTH)
  })

  it('sets a color, saves it, and clears it with null', () => {
    const key = openClaude()
    state().updateTerminal(key, { color: '#2563eb' })
    expect(snapshot(state()).terminals[0].color).toBe('#2563eb')

    state().updateTerminal(key, { color: null })
    expect(snapshot(state()).terminals[0]).not.toHaveProperty('color')
  })

  it("doesn't change the numbering of new Claude tabs", () => {
    state().updateTerminal(openClaude(), { title: 'Renamed' })
    expect(titleOf(openClaude())).toBe('Claude 2')
  })
})

describe('moveWorkspace', () => {
  it('reorders folder tabs', () => {
    ;[DEV, APP, API].forEach((cwd) => openClaude(cwd))

    state().moveWorkspace(folder(APP), 0)
    expect(order()).toEqual([APP, DEV, API])

    state().moveWorkspace(folder(APP), 3)
    expect(order()).toEqual([DEV, API, APP])
  })
})

describe('joinWorkspace', () => {
  beforeEach(() => [DEV, APP, API].forEach((cwd) => openClaude(cwd)))

  it('puts the folder right of its partner and shows the pair', () => {
    state().joinWorkspace(folder(API), folder(DEV))

    expect(order()).toEqual([DEV, API, APP])
    expect(pairOf(state().workspaces, folder(DEV))).toEqual([folder(DEV), folder(API)])
    expect(pairOf(state().workspaces, folder(API))).toEqual([folder(DEV), folder(API)])
    expect(state().activeWorkspace).toBe(folder(API))
  })

  it('moves a pair as one, and nothing lands between the two', () => {
    state().joinWorkspace(folder(API), folder(DEV))

    state().moveWorkspace(folder(DEV), 3)
    expect(order()).toEqual([APP, DEV, API])

    state().moveWorkspace(folder(APP), 2) // between DEV and API
    expect(order()).toEqual([DEV, API, APP])
  })

  it('unjoins with null, from either folder', () => {
    state().joinWorkspace(folder(API), folder(DEV))
    state().joinWorkspace(folder(DEV), null)
    expect(pairOf(state().workspaces, folder(API))).toEqual([folder(API)])
  })

  it('takes a folder out of its old pair when it joins another', () => {
    state().joinWorkspace(folder(API), folder(DEV))
    state().joinWorkspace(folder(APP), folder(DEV))

    expect(pairOf(state().workspaces, folder(DEV))).toEqual([folder(DEV), folder(APP)])
    expect(pairOf(state().workspaces, folder(API))).toEqual([folder(API)])
  })

  it('splits the pair when one of them closes, and shows the other', () => {
    state().joinWorkspace(folder(API), folder(DEV))
    state().removeWorkspace(folder(API))

    expect(pairOf(state().workspaces, folder(DEV))).toEqual([folder(DEV)])
    expect(state().activeWorkspace).toBe(folder(DEV))
  })

  it('makes the folder you click into the active one', () => {
    state().joinWorkspace(folder(API), folder(DEV))
    const devTerminal = state().workspaces.find((w) => w.cwd === DEV)!.subTabs[0].activePane

    state().focusTerminal(devTerminal)

    expect(state().activeWorkspace).toBe(folder(DEV))
  })

  it('remembers where the divider is', () => {
    state().joinWorkspace(folder(API), folder(DEV))
    state().resizeJoin(folder(DEV), 0.3)

    const saved = snapshot(state()).workspaces
    expect(saved.map((w) => [w.joinedTo, w.joinSize])).toEqual([
      [undefined, undefined],
      [0, 0.3],
      [undefined, undefined]
    ])
  })
})

describe('dragging', () => {
  it('reorders sub-tabs within a folder', () => {
    const first = openClaude()
    openClaude()
    const ws = state().workspaces[0]
    const [a, b] = ws.subTabs.map((s) => s.key)

    state().moveToSubTab({ kind: 'subtab', workspace: ws.key, subTab: a }, ws.key, 2)

    expect(state().workspaces[0].subTabs.map((s) => s.key)).toEqual([b, a])
    expect(state().workspaces[0].subTabs[1].activePane).toBe(first)
  })

  it("doesn't move terminals into another folder", () => {
    openClaude(DEV)
    openClaude(APP)
    const [dev, app] = state().workspaces
    const drag = { kind: 'subtab', workspace: dev.key, subTab: dev.subTabs[0].key } as const

    state().moveToSubTab(drag, app.key, 0)
    state().dockAt(drag, app.key, app.subTabs[0].key, app.subTabs[0].activePane, 'right')

    expect(state().workspaces).toEqual([dev, app])
  })
})

describe('finished and asking', () => {
  let now = 0
  beforeEach(() => {
    now = 1_000_000
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    return () => vi.restoreAllMocks()
  })

  /** A running Claude tab, as TerminalSession leaves it once the process started. */
  function runningClaude(cwd = DEV): string {
    const key = openClaude(cwd)
    state().patchTerminal(key, { status: 'running' })
    return key
  }
  const t = (key: string): TerminalState => state().terminals[key]

  it('calls when Claude finishes after working, unless you are looking at it', () => {
    const key = runningClaude()
    state().reportActivity(key, 'working', false)
    expect(dotStatus(t(key))).toBe('working')

    now += MIN_WORK_MS
    state().reportActivity(key, 'idle', false)
    expect(dotStatus(t(key))).toBe('idle')
    expect(t(key).attention).toBe('finished')
    expect(t(key).attentionSince).toBe(now)

    state().reportActivity(key, 'working', false)
    expect(t(key).attention).toBeUndefined()
    now += MIN_WORK_MS
    state().reportActivity(key, 'idle', true)
    expect(t(key).attention).toBeUndefined()
  })

  it('sounds every finish and question, also in the session you are looking at', () => {
    const key = runningClaude()
    state().reportActivity(key, 'working', true)
    now += MIN_WORK_MS
    state().reportActivity(key, 'idle', true)
    expect(t(key).lastCall).toEqual({ kind: 'finished', at: now })
    expect(t(key).attention).toBeUndefined()

    state().reportActivity(key, 'working', true)
    now += 10
    state().reportActivity(key, 'asking', true)
    expect(t(key).lastCall).toEqual({ kind: 'asking', at: now })

    // Answering it, or a blink of work, is no call.
    const answered = t(key).lastCall
    state().reportActivity(key, 'idle', true)
    state().reportActivity(key, 'working', true)
    state().reportActivity(key, 'idle', true)
    expect(t(key).lastCall).toBe(answered)
  })

  it("doesn't call for a blink of work, or for a Claude that starts idle", () => {
    const key = runningClaude()
    state().reportActivity(key, 'idle', false)
    state().reportActivity(key, 'working', false)
    now += MIN_WORK_MS - 1
    state().reportActivity(key, 'idle', false)
    expect(t(key).attention).toBeUndefined()
  })

  it('calls when Claude asks, however short it worked; answering needs no call', () => {
    const key = runningClaude()
    state().reportActivity(key, 'working', false)
    state().reportActivity(key, 'asking', false)
    expect(dotStatus(t(key))).toBe('asking')
    expect(t(key).attention).toBe('asking')

    state().focusTerminal(key)
    state().reportActivity(key, 'idle', true)
    expect(dotStatus(t(key))).toBe('idle')
    expect(t(key).attention).toBeUndefined()
  })

  it('clears when you look at the terminal, or when it is brought up from a notification', () => {
    const key = runningClaude()
    const other = runningClaude(APP)
    state().ringBell(key, false)
    state().ringBell(other, false)
    expect(t(key).attention).toBe('asking')

    state().focusTerminal(key)
    expect(t(key).attention).toBeUndefined()

    state().revealTerminal(other)
    expect(state().activeWorkspace).toBe(folder(APP))
    expect(t(other).attention).toBeUndefined()
  })

  it('ignores the bell in shell tabs', () => {
    state().openInFolder(DEV, { kind: 'shell', shellId: 'bash' })
    const key = activeTerminalKey(state())!
    state().patchTerminal(key, { status: 'running' })
    state().ringBell(key, false)
    expect(t(key).attention).toBeUndefined()
  })

  it('shows what needs you most on a tab: asking, then errors, then idle', () => {
    const [a, b, c, d] = [runningClaude(), runningClaude(), runningClaude(), runningClaude()]
    state().reportActivity(a, 'working', false)
    state().reportActivity(b, 'idle', false)
    const tabOf = (...keys: string[]): string => combinedStatus(keys.map(t))
    expect(tabOf(a, b)).toBe('idle')
    state().patchTerminal(c, { status: 'error' })
    expect(tabOf(a, b, c)).toBe('error')
    state().reportActivity(d, 'asking', false)
    expect(tabOf(a, b, c, d)).toBe('asking')

    expect(combinedAttention([a, b].map(t))).toBeNull()
    now += MIN_WORK_MS
    state().reportActivity(a, 'idle', false)
    expect(combinedAttention([a, b].map(t))).toBe('finished')
    expect(combinedAttention([a, d].map(t))).toBe('asking')
  })
})

describe('notifications', () => {
  const note = (key: string, kind: 'finished' | 'asking' = 'finished'): void =>
    state().notify({ key, kind, tab: 'Claude 1', folder: 'dev', topic: '', at: 1 })

  it('lists newest first, unread, and shows the last three as toasts', () => {
    for (const key of ['a', 'b', 'c', 'd']) note(key)
    expect(state().notifications.map((n) => n.key)).toEqual(['d', 'c', 'b', 'a'])
    expect(state().notifications.every((n) => !n.read)).toBe(true)
    expect(state().toasts.map((id) => state().notifications.find((n) => n.id === id)?.key)).toEqual(
      ['b', 'c', 'd']
    )
  })

  it('looking at a session reads its notifications and hides its toasts', () => {
    const key = openClaude()
    note(key, 'asking')
    note('other')
    state().focusTerminal(key)
    expect(state().notifications.find((n) => n.key === key)?.read).toBe(true)
    expect(state().notifications.find((n) => n.key === 'other')?.read).toBe(false)
    expect(state().toasts).toHaveLength(1)
  })

  it('marks all read, dismisses a toast, and clears', () => {
    note('a')
    note('b')
    state().dismissToast(state().toasts[0])
    expect(state().toasts).toHaveLength(1)
    state().markNotificationsRead()
    expect(state().notifications.every((n) => n.read)).toBe(true)
    expect(state().toasts).toEqual([])
    state().clearNotifications()
    expect(state().notifications).toEqual([])
  })
})
