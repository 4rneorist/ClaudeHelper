import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import type {
  LayoutNode,
  SavedSubTab,
  SavedTerminal,
  SavedWorkspace,
  UiState
} from '../shared/uiState'
import { matchRunningSessions, readRunningSessions, SESSION_ID } from './claudeSessions'
import { checkSpec } from './validation'

const MAX_TERMINALS = 64
const MAX_DEPTH = 8

const isAbsolutePath = (p: unknown): p is string =>
  typeof p === 'string' && p.length > 0 && path.isAbsolute(p)

/** A layout whose leaves are known terminals, each used once; sizes renormalised. */
function sanitizeLayout(
  node: unknown,
  known: Set<string>,
  used: Set<string>,
  depth = 0
): LayoutNode | null {
  if (depth > MAX_DEPTH || !node || typeof node !== 'object') return null
  const raw = node as Record<string, unknown>
  if (raw.type === 'leaf') {
    if (typeof raw.id !== 'string' || !known.has(raw.id) || used.has(raw.id)) return null
    used.add(raw.id)
    return { type: 'leaf', id: raw.id }
  }
  if (raw.type !== 'split' || (raw.dir !== 'row' && raw.dir !== 'column')) return null
  if (!Array.isArray(raw.children)) return null
  const rawSizes = Array.isArray(raw.sizes) ? raw.sizes : []
  const children: LayoutNode[] = []
  const sizes: number[] = []
  raw.children.forEach((c, i) => {
    const child = sanitizeLayout(c, known, used, depth + 1)
    if (!child) return
    const s = rawSizes[i]
    children.push(child)
    sizes.push(typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : 1)
  })
  if (children.length === 0) return null
  if (children.length === 1) return children[0]
  const total = sizes.reduce((a, b) => a + b, 0)
  return { type: 'split', dir: raw.dir, children, sizes: sizes.map((s) => s / total) }
}

function leafIds(node: LayoutNode): string[] {
  return node.type === 'leaf' ? [node.id] : node.children.flatMap(leafIds)
}

/**
 * Validates a UI state from disk or from the renderer. Unknown fields are dropped, and so are
 * terminals no layout uses. `keepRuntime` keeps pid/startedAt (only meaningful while running).
 */
export function sanitizeUiState(input: unknown, keepRuntime = false): UiState | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (!Array.isArray(raw.terminals) || !Array.isArray(raw.workspaces)) return null

  const terminals = new Map<string, SavedTerminal>()
  for (const t of raw.terminals.slice(0, MAX_TERMINALS)) {
    if (!t || typeof t !== 'object') continue
    const r = t as Record<string, unknown>
    const spec = checkSpec(r.spec)
    if (typeof r.key !== 'string' || r.key.length > 64 || !isAbsolutePath(r.cwd) || !spec) continue
    const saved: SavedTerminal = {
      key: r.key,
      cwd: r.cwd,
      title:
        typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 80) : 'Terminal',
      spec
    }
    if (typeof r.claudeSessionId === 'string' && SESSION_ID.test(r.claudeSessionId)) {
      saved.claudeSessionId = r.claudeSessionId
    }
    if (keepRuntime && typeof r.pid === 'number' && typeof r.startedAt === 'number') {
      saved.pid = r.pid
      saved.startedAt = r.startedAt
    }
    terminals.set(saved.key, saved)
  }

  const known = new Set(terminals.keys())
  const used = new Set<string>()
  const workspaces: SavedWorkspace[] = []
  for (const w of raw.workspaces) {
    if (!w || typeof w !== 'object') continue
    const r = w as Record<string, unknown>
    if (!isAbsolutePath(r.cwd) || !Array.isArray(r.subTabs)) continue
    const subTabs: SavedSubTab[] = []
    for (const s of r.subTabs) {
      const sub = s as Record<string, unknown> | null
      const layout = sanitizeLayout(sub?.layout, known, used)
      if (!layout) continue
      const ids = leafIds(layout)
      const activePane =
        typeof sub?.activePane === 'string' && ids.includes(sub.activePane)
          ? sub.activePane
          : ids[0]
      subTabs.push({ layout, activePane })
    }
    if (subTabs.length === 0) continue
    const activeSubTab = typeof r.activeSubTab === 'number' ? Math.floor(r.activeSubTab) : 0
    workspaces.push({
      cwd: r.cwd,
      claudeCount:
        typeof r.claudeCount === 'number' && r.claudeCount >= 0 ? Math.floor(r.claudeCount) : 0,
      subTabs,
      activeSubTab: Math.min(Math.max(activeSubTab, 0), subTabs.length - 1)
    })
  }
  if (workspaces.length === 0) return null

  const activeWorkspace =
    typeof raw.activeWorkspace === 'number' ? Math.floor(raw.activeWorkspace) : 0
  return {
    version: 1,
    workspaces,
    activeWorkspace: Math.min(Math.max(activeWorkspace, 0), workspaces.length - 1),
    terminals: [...terminals.values()].filter((t) => used.has(t.key))
  }
}

export class UiStateStore {
  /** Latest state from the renderer, with runtime fields, for the final save at quit. */
  private latest: UiState | null = null
  private written = ''
  private saveWaiters: (() => void)[] = []

  constructor(
    private readonly filePath: string,
    private readonly configDir: () => string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  load(): UiState | null {
    try {
      return sanitizeUiState(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return null
    }
  }

  /** Saves a renderer snapshot; returns the current conversation id of each claude terminal. */
  async save(input: unknown): Promise<Record<string, string>> {
    const state = sanitizeUiState(input, true)
    if (!state) {
      // Nothing open (e.g. only the start screen): next start shows the start screen too.
      this.latest = null
      this.write(null)
      for (const resolve of this.saveWaiters.splice(0)) resolve()
      return {}
    }
    const ids = await this.currentSessionIds(state)
    this.latest = state
    this.write(state, ids)
    for (const resolve of this.saveWaiters.splice(0)) resolve()
    return ids
  }

  /** Resolves after the next save from the renderer, or after `timeoutMs`. */
  nextSave(timeoutMs: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, timeoutMs)
      this.saveWaiters.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /** Re-checks conversation ids (they change on /clear) and writes; run before stopping sessions. */
  async flush(): Promise<void> {
    if (!this.latest) return
    this.write(this.latest, await this.currentSessionIds(this.latest))
  }

  private async currentSessionIds(state: UiState): Promise<Record<string, string>> {
    const processes = state.terminals.flatMap((t) =>
      t.spec.kind === 'claude' && t.pid !== undefined && t.startedAt !== undefined
        ? [
            {
              key: t.key,
              pid: t.pid,
              cwd: t.cwd,
              startedAt: t.startedAt,
              knownSessionId: t.claudeSessionId
            }
          ]
        : []
    )
    if (processes.length === 0) return {}
    return matchRunningSessions(
      processes,
      await readRunningSessions(this.configDir()),
      this.platform
    )
  }

  private write(state: UiState | null, ids: Record<string, string> = {}): void {
    const persisted = state && {
      ...state,
      // pid/startedAt only mean something while this run's processes are alive.
      terminals: state.terminals.map((t) => {
        const persistedTerminal: SavedTerminal = {
          key: t.key,
          cwd: t.cwd,
          title: t.title,
          spec: t.spec
        }
        const id = ids[t.key] ?? t.claudeSessionId
        if (id) persistedTerminal.claudeSessionId = id
        return persistedTerminal
      })
    }
    const json = JSON.stringify(persisted, null, 2)
    if (json === this.written) return
    try {
      mkdirSync(path.dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      writeFileSync(tmp, json, 'utf8')
      renameSync(tmp, this.filePath)
      this.written = json
    } catch {
      // Best effort: failing to save the layout must never break the app.
    }
  }
}
