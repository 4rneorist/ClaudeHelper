import { create } from 'zustand'
import type {
  AppInfo,
  ClaudeStatus,
  SessionInfo,
  Settings,
  ShellProfile,
  StartSessionErrorCode,
  TerminalSpec,
  UiState
} from '../../shared/ipc'
import { folderName, samePath } from '../../shared/paths'
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

// Model: a workspace is a top-level tab (one folder, or the start screen). It holds sub-tabs,
// each with a split layout whose leaves are terminals. Terminals are stored flat by key so they
// can move between layouts without being recreated.

export type TerminalStatus = 'starting' | 'running' | 'exited' | 'error'

export interface TerminalState {
  key: string
  cwd: string
  spec: TerminalSpec
  title: string
  status: TerminalStatus
  session?: SessionInfo
  exitCode?: number
  error?: string
  errorCode?: StartSessionErrorCode
  /** Window title the running program set (OSC 0/2). */
  termTitle?: string
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

export interface OpenOptions {
  /** Start-screen workspace to turn into (or replace with) the folder workspace. */
  fromWorkspace?: string
  title?: string
}

interface State {
  appInfo: AppInfo | null
  settings: Settings | null
  claude: ClaudeStatus | null
  shells: ShellProfile[]
  workspaces: Workspace[]
  activeWorkspace: string
  terminals: Record<string, TerminalState>
  settingsOpen: boolean
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
  removeTerminals(keys: string[]): void
  removeWorkspace(key: string): void
  setActiveWorkspace(key: string): void
  setActiveSubTab(workspace: string, subTab: string): void
  focusTerminal(key: string): void
  cycleSubTab(delta: 1 | -1): void
  cycleWorkspace(delta: 1 | -1): void
  resizeSplit(workspace: string, subTab: string, path: number[], sizes: number[]): void
  patchTerminal(key: string, patch: Partial<TerminalState>): void
  restartTerminal(key: string): void
  setDrag(drag: DragPayload | null): void
  updateSettings(patch: Partial<Settings>): Promise<void>
  setSettings(settings: Settings): void
  refreshClaude(): Promise<void>
  setSettingsOpen(open: boolean): void
}

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
    claudeCount: 0
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

  /** A dragged folder tab stands for the sub-tab it is showing. */
  const resolveDrag = (drag: DragPayload): Movable | null => {
    if (drag.kind !== 'workspace') return drag
    const ws = get().workspaces.find((w) => w.key === drag.workspace)
    return ws?.activeSubTab ? { kind: 'subtab', workspace: ws.key, subTab: ws.activeSubTab } : null
  }

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

  /** Folders whose last terminal was dragged away close; focus stays with the drop target. */
  const pruneEmpty = (target: string): void =>
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.kind === 'start' || w.subTabs.length > 0),
      activeWorkspace: target
    }))

  return {
    appInfo: null,
    settings: null,
    claude: null,
    shells: [],
    workspaces: [first],
    activeWorkspace: first.key,
    terminals: {},
    settingsOpen: false,
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
      const drag = resolveDrag(rawDrag)
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
      pruneEmpty(workspace)
    },

    moveToSubTab(rawDrag, workspace, index) {
      const drag = resolveDrag(rawDrag)
      const target = get().workspaces.find((w) => w.key === workspace)
      if (!drag || !target || target.kind !== 'folder') return
      const sameFolder = drag.workspace === workspace

      if (drag.kind === 'subtab' && sameFolder) {
        // Reorder within the tab row.
        const from = target.subTabs.findIndex((s) => s.key === drag.subTab)
        if (from === -1) return
        const subTabs = [...target.subTabs]
        const [moved] = subTabs.splice(from, 1)
        subTabs.splice(index > from ? index - 1 : index, 0, moved)
        updateWorkspace(workspace, (w) => ({ ...w, subTabs, activeSubTab: moved.key }))
        return
      }

      const source = get()
        .workspaces.find((w) => w.key === drag.workspace)
        ?.subTabs.find((s) => s.key === drag.subTab)
      if (!source) return
      // A lone pane dropped on its own tab row is already a tab of its own.
      if (drag.kind === 'pane' && sameFolder && leaves(source.layout).length === 1) return
      const sourceIndex = target.subTabs.indexOf(source) // -1 unless same folder
      const moved = detach(drag)
      if (!moved) return
      updateWorkspace(workspace, (w) => {
        const subTabs = [...w.subTabs]
        // detach() may have removed the source tab from this row, shifting later indices.
        const removed = sourceIndex !== -1 && !w.subTabs.some((s) => s.key === source.key)
        subTabs.splice(removed && index > sourceIndex ? index - 1 : index, 0, moved)
        return { ...w, subTabs, activeSubTab: moved.key }
      })
      pruneEmpty(workspace)
    },

    removeTerminals(keys) {
      if (keys.length === 0) return
      set((s) => {
        let workspaces = s.workspaces
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
        let activeWorkspace = s.activeWorkspace
        if (!workspaces.some((w) => w.key === activeWorkspace)) {
          const index = s.workspaces.findIndex((w) => w.key === activeWorkspace)
          if (workspaces.length === 0) workspaces = [startWorkspace()]
          activeWorkspace = workspaces[Math.min(index, workspaces.length - 1)].key
        }
        const terminals = { ...s.terminals }
        for (const key of keys) delete terminals[key]
        return { workspaces, activeWorkspace, terminals }
      })
    },

    removeWorkspace(key) {
      set((s) => {
        const index = s.workspaces.findIndex((w) => w.key === key)
        if (index === -1) return s
        let workspaces = s.workspaces.filter((w) => w.key !== key)
        if (workspaces.length === 0) workspaces = [startWorkspace()]
        const activeWorkspace =
          s.activeWorkspace === key
            ? workspaces[Math.min(index, workspaces.length - 1)].key
            : s.activeWorkspace
        return { workspaces, activeWorkspace }
      })
    },

    setActiveWorkspace(key) {
      set({ activeWorkspace: key })
    },

    setActiveSubTab(workspace, subTab) {
      updateWorkspace(workspace, (w) => ({ ...w, activeSubTab: subTab }))
    },

    focusTerminal(key) {
      const where = locate(get().workspaces, key)
      if (!where) return
      const { workspace, subTab } = where
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
        termTitle: undefined
      })
    },

    setDrag(drag) {
      set({ drag })
    },

    async updateSettings(patch) {
      const settings = await window.api.updateSettings(patch)
      set({ settings })
      if ('claudePath' in patch) await get().refreshClaude()
    },

    setSettings(settings) {
      set({ settings })
    },

    async refreshClaude() {
      set({ claude: await window.api.claudeStatus() })
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open })
    }
  }
})

function dropSubTab(ws: Workspace, key: string): Workspace {
  const index = ws.subTabs.findIndex((s) => s.key === key)
  const subTabs = ws.subTabs.filter((s) => s.key !== key)
  const activeSubTab =
    ws.activeSubTab === key
      ? (subTabs[Math.min(index, subTabs.length - 1)]?.key ?? null)
      : ws.activeSubTab
  return { ...ws, subTabs, activeSubTab }
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

/** Aggregate status shown on a folder or sub-tab: the most attention-worthy wins. */
export function combinedStatus(states: (TerminalState | undefined)[]): TerminalStatus | 'none' {
  const present = states.filter((s): s is TerminalState => !!s)
  for (const status of ['error', 'starting', 'running', 'exited'] as const) {
    if (present.some((s) => s.status === status)) return status
  }
  return 'none'
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
      claudeCount: w.claudeCount
    }
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
    workspaces: folders.map((w) => ({
      cwd: w.cwd!,
      claudeCount: w.claudeCount,
      activeSubTab: Math.max(
        0,
        w.subTabs.findIndex((s) => s.key === w.activeSubTab)
      ),
      subTabs: w.subTabs.map((s) => ({ layout: s.layout, activePane: s.activePane }))
    })),
    terminals: Object.values(state.terminals)
      .filter((t) => used.has(t.key))
      .map((t) => ({
        key: t.key,
        cwd: t.cwd,
        title: t.title,
        spec: t.spec,
        ...(t.claudeSessionId ? { claudeSessionId: t.claudeSessionId } : {}),
        ...(t.status === 'running' && t.session && t.startedAt
          ? { pid: t.session.pid, startedAt: t.startedAt }
          : {})
      }))
  }
}
