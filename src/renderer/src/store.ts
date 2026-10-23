import { create } from 'zustand'
import type {
  AppInfo,
  ClaudeStatus,
  GitInfo,
  SessionInfo,
  Settings,
  ShellProfile,
  StartSessionErrorCode,
  TerminalSpec,
  UiState
} from '../../shared/ipc'
import { findByPath, folderName, samePath } from '../../shared/paths'
import { MAX_TITLE_LENGTH } from '../../shared/uiState'
import {
  contains,
  gridOf,
  insertBeside,
  leaf,
  leaves,
  removeLeaf,
  setSizes,
  type LayoutNode,
  type Side
} from './layout'
import type { ClaudeActivity } from './terminal/claudeActivity'

// Model: a workspace is a top-level tab (one folder, or the start screen). It holds sub-tabs,
// each with a split layout whose leaves are terminals. Terminals are stored flat by key so they
// can move between layouts without being recreated.

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

export interface TerminalState {
  key: string
  cwd: string
  spec: TerminalSpec
  title: string
  /** Tab background as #rrggbb, if the user picked one. */
  color?: string
  status: TerminalStatus
  session?: SessionInfo
  exitCode?: number
  error?: string
  errorCode?: StartSessionErrorCode
  /** Window title the running program set (OSC 0/2). */
  termTitle?: string
  /** What Claude is doing, read from its window title and screen; unset for other programs. */
  activity?: ClaudeActivity
  /** When the current stretch of work started, epoch ms. */
  workingSince?: number
  /**
   * Claude finished, or asks for your answer, while you weren't looking; cleared once you look.
   * Drives the tab marker, the sound and the OS notification.
   */
  attention?: Attention
  /** When `attention` was set, epoch ms (for reminders). */
  attentionSince?: number
  /** The last time Claude finished or asked, looked at or not: each new one plays a sound. */
  lastCall?: { kind: Attention; at: number }
  /** No sounds, toasts or notifications from it, and it doesn't count as waiting. Saved. */
  muted?: boolean
  /** The Claude conversation this tab has open (kept current by the save round-trip). */
  claudeSessionId?: string
  /** When the current process started, epoch ms. */
  startedAt?: number
  /** Bumped on every (re)start; the terminal starts a new process when it changes. */
  attempt: number
}

export interface SubTab {
  key: string
  layout: LayoutNode
  activePane: string
}

export interface Workspace {
  key: string
  kind: 'start' | 'folder'
  cwd: string | null
  title: string
  subTabs: SubTab[]
  activeSubTab: string | null
  /** For "Claude 1", "Claude 2"… names. */
  claudeCount: number
  /** Joined folders show side by side: this folder on the right of that one (a workspace key). */
  joinedTo: string | null
  /** In a pair, the left folder's share of the width (kept on the right one). */
  joinSize: number
}

/**
 * What is being dragged. Anything can be docked into any folder's panes or tab row: a terminal
 * keeps its own folder (cwd) wherever it is shown. Dragging a folder tab moves the sub-tab it is
 * currently showing.
 */
export type DragPayload =
  | { kind: 'subtab'; workspace: string; subTab: string }
  | { kind: 'pane'; workspace: string; subTab: string; pane: string }
  | { kind: 'workspace'; workspace: string }

/** Whose ⚙ settings popover is open, and the tab it opens under. */
export type TabSettingsTarget =
  | { kind: 'folder'; workspace: string; anchor: DOMRect }
  | { kind: 'terminal'; terminal: string; anchor: DOMRect }

export interface OpenOptions {
  /** Start-screen workspace to turn into (or replace with) the folder workspace. */
  fromWorkspace?: string
  title?: string
}

export interface State {
  appInfo: AppInfo | null
  settings: Settings | null
  claude: ClaudeStatus | null
  shells: ShellProfile[]
  workspaces: Workspace[]
  activeWorkspace: string
  terminals: Record<string, TerminalState>
  settingsOpen: boolean
  tabSettings: TabSettingsTarget | null
  /** Git branch and changes per open folder (cwd); null for folders outside a repository. */
  gitInfo: Record<string, GitInfo | null>
  /** Newest first; this run only. */
  notifications: AppNotification[]
  /** Ids of the notifications shown as toasts right now, oldest first. */
  toasts: string[]
  /** No sounds, toasts or OS notifications for now; not saved, so it can't be forgotten on. */
  doNotDisturb: boolean
  drag: DragPayload | null

  init(): Promise<void>
  newStartWorkspace(): void
  openInFolder(cwd: string, spec: TerminalSpec, opts?: OpenOptions): void
  addTerminal(workspace: string, spec: TerminalSpec, title?: string): void
  splitWithNew(
    workspace: string,
    subTab: string,
    pane: string,
    side: Side,
    spec: TerminalSpec
  ): void
  fillGrid(workspace: string, subTab: string): void
  dockAt(drag: DragPayload, workspace: string, subTab: string, pane: string, side: Side): void
  moveToSubTab(drag: DragPayload, workspace: string, index: number): void
  /** Moves a folder tab (with the folder joined to it, if any) to before position `index`. */
  moveWorkspace(key: string, index: number): void
  /** Shows folder `key` to the right of `partner`, side by side; null shows it on its own again. */
  joinWorkspace(key: string, partner: string | null): void
  /** Sets the left folder's share of the width in the pair `key` belongs to. */
  resizeJoin(key: string, size: number): void
  removeTerminals(keys: string[]): void
  removeWorkspace(key: string): void
  setActiveWorkspace(key: string): void
  setActiveSubTab(workspace: string, subTab: string): void
  focusTerminal(key: string): void
  cycleSubTab(delta: 1 | -1): void
  cycleWorkspace(delta: 1 | -1): void
  resizeSplit(workspace: string, subTab: string, path: number[], sizes: number[]): void
  patchTerminal(key: string, patch: Partial<TerminalState>): void
  /** Sets a terminal's name and/or color; a blank name keeps the old one, color null clears it. */
  updateTerminal(
    key: string,
    change: { title?: string; color?: string | null; muted?: boolean }
  ): void
  restartTerminal(key: string): void
  /**
   * What Claude is doing now (null: not Claude). Finishing after working, or asking you
   * something, calls for your attention, unless you are `looking` at it (focused, in a focused
   * window).
   */
  reportActivity(key: string, activity: ClaudeActivity | null, looking: boolean): void
  /** Claude rang the bell (its "terminal_bell" notification): it asks for you. */
  ringBell(key: string, looking: boolean): void
  /** Shows a terminal wherever it is: its folder, its tab and its pane. */
  revealTerminal(key: string): void
  setDrag(drag: DragPayload | null): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setFolderColor(folder: string, color: string | null): Promise<void>
  setFolderTitle(folder: string, title: string | null): Promise<void>
  setSettings(settings: Settings): void
  refreshClaude(): Promise<void>
  setSettingsOpen(open: boolean): void
  setTabSettings(target: TabSettingsTarget | null): void
  setGitInfo(cwd: string, info: GitInfo | null): void
  /** Adds to the notification list and shows it as a toast. */
  notify(n: Omit<AppNotification, 'id' | 'read'>, opts?: { toast?: boolean }): void
  /** Marks one terminal's notifications as read (and hides their toasts); all without a key. */
  markNotificationsRead(key?: string): void
  clearNotifications(): void
  dismissToast(id: string): void
  setDoNotDisturb(on: boolean): void
  setFolderMuted(folder: string, muted: boolean): Promise<void>
}

/** Claude has to have worked at least this long before finishing calls for you. */
export const MIN_WORK_MS = 1000

/** Why a terminal calls for you: Claude finished its turn, or asks for your answer. */
export type Attention = 'finished' | 'asking'

/** A session that finished or asked while you were elsewhere, for the notification list. */
export interface AppNotification {
  id: string
  /** The terminal it came from; it may have been closed since. */
  key: string
  kind: Attention
  /** The tab's and the folder's titles at the time. */
  tab: string
  folder: string
  /** Claude's name for the conversation, if it had one yet. */
  topic: string
  /** Epoch ms. */
  at: number
  read: boolean
  /** A reminder that it is still asking. */
  reminder?: boolean
  /** The session or its folder is muted, so it came without sound, toast or OS notification. */
  muted?: boolean
}

const MAX_NOTIFICATIONS = 50
const MAX_TOASTS = 3

let initialized: Promise<void> | null = null
let nextId = 1
const newKey = (prefix: string): string => `${prefix}-${nextId++}`

function startWorkspace(): Workspace {
  return {
    key: newKey('ws'),
    kind: 'start',
    cwd: null,
    title: 'New session',
    subTabs: [],
    activeSubTab: null,
    claudeCount: 0,
    joinedTo: null,
    joinSize: 0.5
  }
}

const first = startWorkspace()

/** Where a terminal currently lives. */
export function locate(
  workspaces: Workspace[],
  terminal: string
): { workspace: Workspace; subTab: SubTab } | null {
  for (const workspace of workspaces) {
    for (const subTab of workspace.subTabs) {
      if (contains(subTab.layout, terminal)) return { workspace, subTab }
    }
  }
  return null
}

/** The folders shown together with `key`, left first: [left, right], or [key] when not joined. */
export function pairOf(workspaces: Workspace[], key: string): string[] {
  const ws = workspaces.find((w) => w.key === key)
  if (!ws) return []
  if (ws.joinedTo) return [ws.joinedTo, ws.key]
  const right = workspaces.find((w) => w.joinedTo === key)
  return right ? [key, right.key] : [key]
}

/** Drops joins to folders that are gone. */
function unjoinMissing(workspaces: Workspace[]): Workspace[] {
  const keys = new Set(workspaces.map((w) => w.key))
  return workspaces.map((w) => (w.joinedTo && !keys.has(w.joinedTo) ? { ...w, joinedTo: null } : w))
}

export function activeTerminalKey(
  state: Pick<State, 'workspaces' | 'activeWorkspace'>
): string | null {
  const ws = state.workspaces.find((w) => w.key === state.activeWorkspace)
  const sub = ws?.subTabs.find((s) => s.key === ws.activeSubTab)
  return sub?.activePane ?? null
}

export const useStore = create<State>()((set, get) => {
  const updateWorkspace = (key: string, fn: (ws: Workspace) => Workspace): void =>
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.key === key ? fn(w) : w)) }))

  const updateSubTab = (ws: Workspace, key: string, fn: (sub: SubTab) => SubTab): Workspace => ({
    ...ws,
    subTabs: ws.subTabs.map((s) => (s.key === key ? fn(s) : s))
  })

  /** Creates terminal state (the process starts when its view mounts). */
  const createTerminal = (ws: Workspace, rawSpec: TerminalSpec, title?: string): TerminalState => {
    // New conversations get their id up front, so the tab can be resumed after a restart.
    const spec: TerminalSpec =
      rawSpec.kind === 'claude' && rawSpec.mode === 'new' && !rawSpec.sessionId
        ? { ...rawSpec, sessionId: crypto.randomUUID() }
        : rawSpec
    let name = title
    if (!name) {
      if (spec.kind === 'claude') name = `Claude ${ws.claudeCount + 1}`
      else name = get().shells.find((s) => s.id === spec.shellId)?.label ?? spec.shellId
    }
    const terminal: TerminalState = {
      key: newKey('term'),
      cwd: ws.cwd!,
      spec,
      title: name,
      status: 'starting',
      attempt: 1,
      claudeSessionId: spec.kind === 'claude' ? (spec.sessionId ?? spec.resumeId) : undefined
    }
    set((s) => ({ terminals: { ...s.terminals, [terminal.key]: terminal } }))
    return terminal
  }

  const bumpClaude = (ws: Workspace, spec: TerminalSpec, explicitTitle?: string): Workspace =>
    spec.kind === 'claude' && !explicitTitle ? { ...ws, claudeCount: ws.claudeCount + 1 } : ws

  type Movable = Exclude<DragPayload, { kind: 'workspace' }>

  /** A pane or sub-tab dragged within this folder; terminals don't move between folders. */
  const sameFolder = (drag: DragPayload, workspace: string): Movable | null =>
    drag.kind !== 'workspace' && drag.workspace === workspace ? drag : null

  /** Removes the dragged pane/sub-tab from wherever it is and returns it as a sub-tab. */
  const detach = (drag: Movable): SubTab | null => {
    const ws = get().workspaces.find((w) => w.key === drag.workspace)
    const sub = ws?.subTabs.find((s) => s.key === drag.subTab)
    if (!ws || !sub) return null
    if (drag.kind === 'subtab') {
      updateWorkspace(ws.key, (w) => dropSubTab(w, sub.key))
      return sub
    }
    if (!contains(sub.layout, drag.pane)) return null
    const rest = removeLeaf(sub.layout, drag.pane)
    updateWorkspace(ws.key, (w) =>
      rest
        ? updateSubTab(w, sub.key, (s) => ({
            ...s,
            layout: rest,
            activePane: s.activePane === drag.pane ? leaves(rest)[0] : s.activePane
          }))
        : dropSubTab(w, sub.key)
    )
    return { key: newKey('sub'), layout: leaf(drag.pane), activePane: drag.pane }
  }

  return {
    appInfo: null,
    settings: null,
    claude: null,
    shells: [],
    workspaces: [first],
    activeWorkspace: first.key,
    terminals: {},
    settingsOpen: false,
    tabSettings: null,
    gitInfo: {},
    notifications: [],
    toasts: [],
    doNotDisturb: false,
    drag: null,

    init() {
      // Once only: restoring twice (StrictMode runs effects twice) would start every terminal twice.
      initialized ??= (async () => {
        const [appInfo, settings, claude, shells, saved] = await Promise.all([
          window.api.appInfo(),
          window.api.getSettings(),
          window.api.claudeStatus(),
          window.api.listShells(),
          window.api.loadUiState()
        ])
        set({ appInfo, settings, claude, shells, ...(saved ? restoredState(saved) : {}) })
      })()
      return initialized
    },

    newStartWorkspace() {
      const ws = startWorkspace()
      set((s) => ({ workspaces: [...s.workspaces, ws], activeWorkspace: ws.key }))
    },

    openInFolder(cwd, spec, opts = {}) {
      const platform = get().appInfo?.platform ?? 'linux'
      const existing = get().workspaces.find(
        (w) => w.kind === 'folder' && w.cwd && samePath(w.cwd, cwd, platform)
      )
      if (existing) {
        if (opts.fromWorkspace) get().removeWorkspace(opts.fromWorkspace)
        get().addTerminal(existing.key, spec, opts.title)
        return
      }

      const from = opts.fromWorkspace
        ? get().workspaces.find((w) => w.key === opts.fromWorkspace && w.kind === 'start')
        : undefined
      const base: Workspace = {
        ...(from ?? startWorkspace()),
        kind: 'folder',
        cwd,
        title: folderName(cwd)
      }
      const terminal = createTerminal(base, spec, opts.title)
      const sub: SubTab = {
        key: newKey('sub'),
        layout: leaf(terminal.key),
        activePane: terminal.key
      }
      const ws: Workspace = {
        ...bumpClaude(base, spec, opts.title),
        subTabs: [sub],
        activeSubTab: sub.key
      }
      set((s) => ({
        workspaces: from
          ? s.workspaces.map((w) => (w.key === from.key ? ws : w))
          : [...s.workspaces, ws],
        activeWorkspace: ws.key
      }))
    },

    addTerminal(workspace, spec, title) {
      const ws = get().workspaces.find((w) => w.key === workspace)
      if (!ws || ws.kind !== 'folder') return
      const terminal = createTerminal(ws, spec, title)
      const sub: SubTab = {
        key: newKey('sub'),
        layout: leaf(terminal.key),
        activePane: terminal.key
      }
      updateWorkspace(workspace, (w) => ({
        ...bumpClaude(w, spec, title),
        subTabs: [...w.subTabs, sub],
        activeSubTab: sub.key
      }))
      set({ activeWorkspace: workspace })
    },

    splitWithNew(workspace, subTab, pane, side, spec) {
      const ws = get().workspaces.find((w) => w.key === workspace)
      if (!ws || ws.kind !== 'folder') return
      const terminal = createTerminal(ws, spec)
      updateWorkspace(workspace, (w) =>
        updateSubTab(bumpClaude(w, spec), subTab, (s) => ({
          ...s,
          layout: insertBeside(s.layout, pane, leaf(terminal.key), side),
          activePane: terminal.key
        }))
      )
    },

    fillGrid(workspace, subTab) {
      let ws = get().workspaces.find((w) => w.key === workspace)
      const sub = ws?.subTabs.find((s) => s.key === subTab)
      if (!ws || !sub) return
      const ids = leaves(sub.layout)
      if (ids.length > 4) return
      while (ids.length < 4) {
        const spec: TerminalSpec = { kind: 'claude', mode: 'new' }
        ids.push(createTerminal(ws, spec).key)
        ws = bumpClaude(ws, spec)
      }
      const counted = ws
      updateWorkspace(workspace, () =>
        updateSubTab(counted, subTab, (s) => ({ ...s, layout: gridOf(ids) }))
      )
    },

    dockAt(rawDrag, workspace, subTab, pane, side) {
      const drag = sameFolder(rawDrag, workspace)
      if (!drag) return
      if (drag.kind === 'pane' && drag.pane === pane) return
      if (drag.kind === 'subtab' && drag.subTab === subTab) return
      const moved = detach(drag)
      if (!moved) return
      updateWorkspace(workspace, (w) => ({
        ...updateSubTab(w, subTab, (s) => ({
          ...s,
          layout: insertBeside(s.layout, pane, moved.layout, side),
          activePane: moved.activePane
        })),
        activeSubTab: subTab
      }))
    },

    moveToSubTab(rawDrag, workspace, index) {
      const drag = sameFolder(rawDrag, workspace)
      const target = get().workspaces.find((w) => w.key === workspace)
      if (!drag || !target || target.kind !== 'folder') return

      if (drag.kind === 'subtab') {
        // Reorder within the tab row.
        const from = target.subTabs.findIndex((s) => s.key === drag.subTab)
        if (from === -1) return
        const subTabs = [...target.subTabs]
        const [moved] = subTabs.splice(from, 1)
        subTabs.splice(index > from ? index - 1 : index, 0, moved)
        updateWorkspace(workspace, (w) => ({ ...w, subTabs, activeSubTab: moved.key }))
        return
      }

      // A pane becomes a tab of its own. A lone pane already is one.
      const source = target.subTabs.find((s) => s.key === drag.subTab)
      if (!source || leaves(source.layout).length === 1) return
      const moved = detach(drag)
      if (!moved) return
      updateWorkspace(workspace, (w) => {
        const subTabs = [...w.subTabs]
        subTabs.splice(index, 0, moved)
        return { ...w, subTabs, activeSubTab: moved.key }
      })
    },

    moveWorkspace(key, index) {
      set((s) => {
        // A pair of joined folders moves as one.
        const moving = new Set(pairOf(s.workspaces, key))
        const rest = s.workspaces.filter((w) => !moving.has(w.key))
        let at = s.workspaces.slice(0, index).filter((w) => !moving.has(w.key)).length
        // Nothing goes between two joined folders.
        if (at > 0 && rest[at]?.joinedTo === rest[at - 1].key) at++
        rest.splice(at, 0, ...s.workspaces.filter((w) => moving.has(w.key)))
        return { workspaces: rest }
      })
    },

    joinWorkspace(key, partner) {
      set((s) => {
        const ws = s.workspaces.find((w) => w.key === key)
        const target = partner ? s.workspaces.find((w) => w.key === partner) : null
        if (ws?.kind !== 'folder') return s
        if (partner && (target?.kind !== 'folder' || partner === key)) return s
        // Out of the pair it was in, and the target out of its own.
        const free = (w: Workspace): boolean =>
          w.key === key ||
          w.joinedTo === key ||
          (!!partner && pairOf(s.workspaces, partner).includes(w.key))
        let workspaces = s.workspaces.map((w) => (free(w) ? { ...w, joinedTo: null } : w))
        if (partner) {
          // Right next to its partner in the tab row.
          const moved = { ...ws, joinedTo: partner, joinSize: 0.5 }
          workspaces = workspaces.filter((w) => w.key !== key)
          workspaces.splice(workspaces.findIndex((w) => w.key === partner) + 1, 0, moved)
        }
        return { workspaces, activeWorkspace: key }
      })
    },

    resizeJoin(key, size) {
      const right = pairOf(get().workspaces, key)[1]
      if (right) updateWorkspace(right, (w) => ({ ...w, joinSize: size }))
    },

    removeTerminals(keys) {
      if (keys.length === 0) return
      set((s) => {
        const workspaces = s.workspaces
          .map((w) => {
            let ws = w
            for (const sub of w.subTabs) {
              let layout: LayoutNode | null = sub.layout
              for (const key of keys) layout = layout && removeLeaf(layout, key)
              if (layout === sub.layout) continue
              ws = layout
                ? updateSubTab(ws, sub.key, (x) => ({
                    ...x,
                    layout: layout!,
                    activePane: contains(layout!, x.activePane) ? x.activePane : leaves(layout!)[0]
                  }))
                : dropSubTab(ws, sub.key)
            }
            return ws
          })
          // A folder with no terminals left closes.
          .filter((w) => w.kind === 'start' || w.subTabs.length > 0)
        const terminals = { ...s.terminals }
        for (const key of keys) delete terminals[key]
        return { ...afterClosing(s, workspaces), terminals }
      })
    },

    removeWorkspace(key) {
      set((s) => {
        if (!s.workspaces.some((w) => w.key === key)) return s
        return afterClosing(
          s,
          s.workspaces.filter((w) => w.key !== key)
        )
      })
    },

    setActiveWorkspace(key) {
      set({ activeWorkspace: key })
    },

    setActiveSubTab(workspace, subTab) {
      updateWorkspace(workspace, (w) => ({ ...w, activeSubTab: subTab }))
      // In a pair this can be the other folder.
      set({ activeWorkspace: workspace })
    },

    focusTerminal(key) {
      const where = locate(get().workspaces, key)
      if (!where) return
      const { workspace, subTab } = where
      // Looking at it is what it waited for.
      if (get().terminals[key]?.attention) get().patchTerminal(key, { attention: undefined })
      if (get().notifications.some((n) => n.key === key && !n.read)) {
        get().markNotificationsRead(key)
      }
      // Clicking into the other folder of a pair makes it the active one.
      const { workspaces, activeWorkspace } = get()
      if (
        workspace.key !== activeWorkspace &&
        pairOf(workspaces, activeWorkspace).includes(workspace.key)
      ) {
        set({ activeWorkspace: workspace.key })
      }
      if (subTab.activePane === key && workspace.activeSubTab === subTab.key) return
      updateWorkspace(workspace.key, (w) => ({
        ...updateSubTab(w, subTab.key, (s) => ({ ...s, activePane: key })),
        activeSubTab: subTab.key
      }))
    },

    cycleSubTab(delta) {
      const ws = get().workspaces.find((w) => w.key === get().activeWorkspace)
      if (!ws || ws.subTabs.length < 2) return
      const index = ws.subTabs.findIndex((s) => s.key === ws.activeSubTab)
      const next = ws.subTabs[(index + delta + ws.subTabs.length) % ws.subTabs.length]
      get().setActiveSubTab(ws.key, next.key)
    },

    cycleWorkspace(delta) {
      const { workspaces, activeWorkspace } = get()
      const index = workspaces.findIndex((w) => w.key === activeWorkspace)
      const next = workspaces[(index + delta + workspaces.length) % workspaces.length]
      if (next) set({ activeWorkspace: next.key })
    },

    resizeSplit(workspace, subTab, path, sizes) {
      updateWorkspace(workspace, (w) =>
        updateSubTab(w, subTab, (s) => ({ ...s, layout: setSizes(s.layout, path, sizes) }))
      )
    },

    patchTerminal(key, patch) {
      set((s) => {
        const current = s.terminals[key]
        if (!current) return s
        return { terminals: { ...s.terminals, [key]: { ...current, ...patch } } }
      })
    },

    updateTerminal(key, change) {
      const patch: Partial<TerminalState> = {}
      const name = change.title?.trim().slice(0, MAX_TITLE_LENGTH)
      if (name) patch.title = name
      if (change.color !== undefined) patch.color = change.color ?? undefined
      if (change.muted !== undefined) patch.muted = change.muted || undefined
      get().patchTerminal(key, patch)
    },

    restartTerminal(key) {
      const t = get().terminals[key]
      if (!t) return
      get().patchTerminal(key, {
        // A restarted Claude tab picks its conversation back up.
        spec: resumeSpec(t),
        status: 'starting',
        attempt: t.attempt + 1,
        error: undefined,
        errorCode: undefined,
        exitCode: undefined,
        session: undefined,
        termTitle: undefined,
        activity: undefined,
        workingSince: undefined,
        attention: undefined
      })
    },

    reportActivity(key, activity, looking) {
      const t = get().terminals[key]
      if (!t || t.activity === (activity ?? undefined)) return
      const patch: Partial<TerminalState> = { activity: activity ?? undefined }
      let call: Attention | null = null
      if (activity === 'working') {
        patch.workingSince = Date.now()
        patch.attention = undefined
      } else if (activity === 'asking') {
        call = 'asking'
      } else if (activity === 'idle' && t.activity === 'working') {
        // A blink of work (a slash command, /exit) isn't worth a call.
        const worked = Date.now() - (t.workingSince ?? Date.now()) >= MIN_WORK_MS
        if (worked) call = 'finished'
      }
      // Answering a prompt (asking → idle) needs no call: you were there.
      if (activity !== 'working') patch.workingSince = undefined
      if (call) {
        // The sound plays even for the session you look at; the marks are for elsewhere.
        patch.lastCall = { kind: call, at: Date.now() }
        if (!looking) {
          patch.attention = call
          patch.attentionSince = Date.now()
        }
      }
      get().patchTerminal(key, patch)
    },

    ringBell(key, looking) {
      const t = get().terminals[key]
      if (t?.spec.kind !== 'claude' || t.status !== 'running') return
      const patch: Partial<TerminalState> = { lastCall: { kind: 'asking', at: Date.now() } }
      if (!looking && !t.attention) {
        patch.attention = 'asking'
        patch.attentionSince = Date.now()
      }
      get().patchTerminal(key, patch)
    },

    revealTerminal(key) {
      const where = locate(get().workspaces, key)
      if (!where) return
      updateWorkspace(where.workspace.key, (w) => ({
        ...updateSubTab(w, where.subTab.key, (s) => ({ ...s, activePane: key })),
        activeSubTab: where.subTab.key
      }))
      set({ activeWorkspace: where.workspace.key })
      get().patchTerminal(key, { attention: undefined })
      get().markNotificationsRead(key)
    },

    setDrag(drag) {
      set({ drag })
    },

    async updateSettings(patch) {
      const settings = await window.api.updateSettings(patch)
      set({ settings })
      if ('claudePath' in patch) await get().refreshClaude()
    },

    async setFolderColor(folder, color) {
      set({ settings: await window.api.setFolderColor(folder, color) })
    },

    async setFolderTitle(folder, title) {
      set({ settings: await window.api.setFolderTitle(folder, title) })
    },

    setSettings(settings) {
      set({ settings })
    },

    async refreshClaude() {
      set({ claude: await window.api.claudeStatus() })
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open })
    },

    setTabSettings(target) {
      set({ tabSettings: target })
    },

    setGitInfo(cwd, info) {
      const { gitInfo } = get()
      const same =
        cwd in gitInfo &&
        gitInfo[cwd]?.branch === info?.branch &&
        gitInfo[cwd]?.dirty === info?.dirty
      if (!same) set({ gitInfo: { ...gitInfo, [cwd]: info } })
    },

    notify(n, { toast = true } = {}) {
      const notification: AppNotification = { ...n, id: newKey('note'), read: false }
      set((s) => ({
        notifications: [notification, ...s.notifications].slice(0, MAX_NOTIFICATIONS),
        toasts: toast ? [...s.toasts, notification.id].slice(-MAX_TOASTS) : s.toasts
      }))
    },

    markNotificationsRead(key) {
      const hit = (n: AppNotification): boolean => key === undefined || n.key === key
      set((s) => ({
        notifications: s.notifications.map((n) => (hit(n) && !n.read ? { ...n, read: true } : n)),
        toasts: s.toasts.filter((id) => !s.notifications.some((n) => n.id === id && hit(n)))
      }))
    },

    clearNotifications() {
      set({ notifications: [], toasts: [] })
    },

    setDoNotDisturb(on) {
      set({ doNotDisturb: on, ...(on ? { toasts: [] } : {}) })
    },

    async setFolderMuted(folder, muted) {
      set({ settings: await window.api.setFolderMuted(folder, muted) })
    },

    dismissToast(id) {
      set((s) => ({ toasts: s.toasts.filter((t) => t !== id) }))
    }
  }
})

/**
 * The workspaces left after some closed, with joins to closed folders dropped. When the active
 * one closed, its partner takes over, or else the tab now in its place.
 */
function afterClosing(
  before: Pick<State, 'workspaces' | 'activeWorkspace'>,
  remaining: Workspace[]
): Pick<State, 'workspaces' | 'activeWorkspace'> {
  const workspaces = remaining.length > 0 ? unjoinMissing(remaining) : [startWorkspace()]
  const { activeWorkspace } = before
  if (workspaces.some((w) => w.key === activeWorkspace)) return { workspaces, activeWorkspace }
  const partner = pairOf(before.workspaces, activeWorkspace).find(
    (k) => k !== activeWorkspace && workspaces.some((w) => w.key === k)
  )
  const index = before.workspaces.findIndex((w) => w.key === activeWorkspace)
  return {
    workspaces,
    activeWorkspace: partner ?? workspaces[Math.min(index, workspaces.length - 1)].key
  }
}

function dropSubTab(ws: Workspace, key: string): Workspace {
  const index = ws.subTabs.findIndex((s) => s.key === key)
  const subTabs = ws.subTabs.filter((s) => s.key !== key)
  const activeSubTab =
    ws.activeSubTab === key
      ? (subTabs[Math.min(index, subTabs.length - 1)]?.key ?? null)
      : ws.activeSubTab
  return { ...ws, subTabs, activeSubTab }
}

/** A folder tab's title: the one set in its settings, or else the folder's name. */
export function workspaceTitle(
  workspace: Workspace,
  titles: Record<string, string> | undefined,
  platform: string
): string {
  return (workspace.cwd && findByPath(titles, workspace.cwd, platform)) || workspace.title
}

/** Folder name of a terminal shown under another folder's tab (after cross-folder docking). */
export function foreignFolder(
  terminal: TerminalState,
  workspace: Workspace,
  platform: string
): string | null {
  if (!workspace.cwd || samePath(terminal.cwd, workspace.cwd, platform)) return null
  return folderName(terminal.cwd)
}

/** What a terminal's status dot shows: a running Claude also says what it is doing. */
export type DotStatus = TerminalStatus | ClaudeActivity

export function dotStatus(t: TerminalState): DotStatus {
  return t.status === 'running' && t.activity ? t.activity : t.status
}

/** Aggregate status shown on a folder or sub-tab: what needs you most wins. */
export function combinedStatus(states: (TerminalState | undefined)[]): DotStatus | 'none' {
  const present = states.filter((s): s is TerminalState => !!s).map(dotStatus)
  const order = ['asking', 'error', 'idle', 'working', 'starting', 'running', 'exited'] as const
  return order.find((status) => present.includes(status)) ?? 'none'
}

/** The strongest call for attention among these terminals: asking beats finished. */
export function combinedAttention(states: (TerminalState | undefined)[]): Attention | null {
  const calls = states.map((s) => s?.attention)
  return calls.includes('asking') ? 'asking' : calls.includes('finished') ? 'finished' : null
}

/** How to start a terminal again: a Claude tab resumes its conversation if it has one. */
export function resumeSpec(t: Pick<TerminalState, 'spec' | 'claudeSessionId'>): TerminalSpec {
  if (t.spec.kind !== 'claude' || !t.claudeSessionId) return t.spec
  return { kind: 'claude', mode: 'resume', resumeId: t.claudeSessionId }
}

/** Rebuilds the store from the state saved at last exit. Every terminal starts afresh. */
export function restoredState(
  saved: UiState
): Pick<State, 'workspaces' | 'activeWorkspace' | 'terminals'> {
  const keys = new Map<string, string>()
  const terminals: Record<string, TerminalState> = {}
  for (const t of saved.terminals) {
    const key = newKey('term')
    keys.set(t.key, key)
    const spec = resumeSpec(t)
    terminals[key] = {
      key,
      cwd: t.cwd,
      spec,
      title: t.title,
      ...(t.color ? { color: t.color } : {}),
      ...(t.muted ? { muted: true } : {}),
      status: 'starting',
      attempt: 1,
      claudeSessionId: spec.kind === 'claude' ? (spec.resumeId ?? spec.sessionId) : undefined
    }
  }
  const rename = (node: LayoutNode): LayoutNode =>
    node.type === 'leaf'
      ? { type: 'leaf', id: keys.get(node.id)! }
      : { ...node, children: node.children.map(rename) }

  const workspaces: Workspace[] = saved.workspaces.map((w) => {
    const subTabs: SubTab[] = w.subTabs.map((s) => ({
      key: newKey('sub'),
      layout: rename(s.layout),
      activePane: keys.get(s.activePane)!
    }))
    return {
      key: newKey('ws'),
      kind: 'folder',
      cwd: w.cwd,
      title: folderName(w.cwd),
      subTabs,
      activeSubTab: (subTabs[w.activeSubTab] ?? subTabs[0]).key,
      claudeCount: w.claudeCount,
      joinedTo: null,
      joinSize: w.joinSize ?? 0.5
    }
  })
  // Pairs are saved by position; main has already checked each folder is in one pair at most.
  saved.workspaces.forEach((w, i) => {
    if (w.joinedTo !== undefined) workspaces[i].joinedTo = workspaces[w.joinedTo]?.key ?? null
  })
  return {
    workspaces,
    activeWorkspace: (workspaces[saved.activeWorkspace] ?? workspaces[0]).key,
    terminals
  }
}

/** What gets persisted: folders, tabs, splits (with sizes) and terminals; no transient state. */
export function snapshot(
  state: Pick<State, 'workspaces' | 'activeWorkspace' | 'terminals'>
): UiState {
  const folders = state.workspaces.filter((w) => w.kind === 'folder' && w.cwd)
  const used = new Set(folders.flatMap((w) => w.subTabs.flatMap((s) => leaves(s.layout))))
  const activeIndex = folders.findIndex((w) => w.key === state.activeWorkspace)
  return {
    version: 1,
    activeWorkspace: Math.max(0, activeIndex),
    workspaces: folders.map((w) => {
      const partner = w.joinedTo ? folders.findIndex((f) => f.key === w.joinedTo) : -1
      return {
        cwd: w.cwd!,
        claudeCount: w.claudeCount,
        activeSubTab: Math.max(
          0,
          w.subTabs.findIndex((s) => s.key === w.activeSubTab)
        ),
        subTabs: w.subTabs.map((s) => ({ layout: s.layout, activePane: s.activePane })),
        ...(partner !== -1 ? { joinedTo: partner, joinSize: w.joinSize } : {})
      }
    }),
    terminals: Object.values(state.terminals)
      .filter((t) => used.has(t.key))
      .map((t) => ({
        key: t.key,
        cwd: t.cwd,
        title: t.title,
        ...(t.color ? { color: t.color } : {}),
        ...(t.muted ? { muted: true } : {}),
        spec: t.spec,
        ...(t.claudeSessionId ? { claudeSessionId: t.claudeSessionId } : {}),
        ...(t.status === 'running' && t.session && t.startedAt
          ? { pid: t.session.pid, startedAt: t.startedAt }
          : {})
      }))
  }
}
