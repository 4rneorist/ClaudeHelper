import { titleFromText } from '../../shared/bookmarks'
import type { SendTarget } from '../../shared/ipc'
import { samePath } from '../../shared/paths'
import { DEFAULT_FONT_SIZE } from './constants'
import { leaves } from './layout'
import {
  activeTerminalKey,
  locate,
  useStore,
  workspaceTitle,
  type TabSettingsTarget,
  type TerminalState
} from './store'
import { disposeTerminal, getTerminal } from './terminal/TerminalSession'
import type { KeyAction } from './terminal/keybindings'
import { nextWaiting, type WaitKind } from './waiting'

const isLive = (t: TerminalState | undefined): boolean =>
  t?.status === 'running' || t?.status === 'starting'

/**
 * Asks before stopping live processes or deleting notes, then disposes the terminals and drops
 * them from layouts.
 */
async function closeTerminals(keys: string[], scope: string): Promise<boolean> {
  const { terminals } = useStore.getState()
  const live = keys.filter((k) => isLive(terminals[k]))
  const noted = keys.filter((k) => terminals[k]?.notes?.trim())
  const notesGo =
    noted.length === 0
      ? ''
      : keys.length === 1
        ? 'Its notes are deleted too.'
        : `The notes of ${noted.length} ${noted.length === 1 ? 'session' : 'sessions'} are deleted too.`
  if (live.length > 0) {
    const single = live.length === 1 && keys.length === 1 ? terminals[live[0]] : null
    const ok = await window.api.confirm(
      single
        ? {
            message: `Stop "${single.title}"?`,
            detail: [single.cwd, notesGo].filter(Boolean).join('\n\n'),
            okLabel: 'Stop and close'
          }
        : {
            message: `Close ${scope}?`,
            detail: [
              `${live.length} running ${live.length === 1 ? 'process' : 'processes'} will be stopped.`,
              notesGo
            ]
              .filter(Boolean)
              .join(' '),
            okLabel: 'Stop and close'
          }
    )
    if (!ok) return false
  } else if (noted.length > 0) {
    const ok = await window.api.confirm({
      message: keys.length === 1 ? `Close "${terminals[keys[0]].title}"?` : `Close ${scope}?`,
      detail: notesGo,
      okLabel: 'Close'
    })
    if (!ok) return false
  }
  for (const key of keys) disposeTerminal(key)
  useStore.getState().removeTerminals(keys)
  return true
}

export async function closeTerminal(key: string): Promise<void> {
  await closeTerminals([key], 'this terminal')
}

export async function closeSubTab(workspace: string, subTab: string): Promise<void> {
  const ws = useStore.getState().workspaces.find((w) => w.key === workspace)
  const sub = ws?.subTabs.find((s) => s.key === subTab)
  if (!sub) return
  const keys = leaves(sub.layout)
  await closeTerminals(keys, keys.length === 1 ? 'this terminal' : `${keys.length} terminals`)
}

export async function closeWorkspace(workspace: string): Promise<void> {
  const ws = useStore.getState().workspaces.find((w) => w.key === workspace)
  if (!ws) return
  const keys = ws.subTabs.flatMap((s) => leaves(s.layout))
  if (keys.length === 0) {
    useStore.getState().removeWorkspace(workspace)
    return
  }
  const { settings, appInfo } = useStore.getState()
  const title = workspaceTitle(ws, settings?.folderTitles, appInfo?.platform ?? '')
  await closeTerminals(keys, `all terminals in "${title}"`)
}

export function zoom(delta: 1 | -1 | 0): void {
  const { settings, updateSettings } = useStore.getState()
  if (!settings) return
  const fontSize = delta === 0 ? DEFAULT_FONT_SIZE : settings.fontSize + delta
  if (fontSize !== settings.fontSize) void updateSettings({ fontSize })
}

export function runShortcut(action: KeyAction): void {
  const store = useStore.getState()
  const ws = store.workspaces.find((w) => w.key === store.activeWorkspace)
  switch (action.type) {
    case 'newTerminal':
      if (ws?.kind === 'folder') store.addTerminal(ws.key, { kind: 'claude', mode: 'new' })
      else store.newStartWorkspace()
      break
    case 'newFolderTab':
      store.newStartWorkspace()
      break
    case 'closePane': {
      const key = activeTerminalKey(store)
      if (key) void closeTerminal(key)
      else if (ws) void closeWorkspace(ws.key)
      break
    }
    case 'nextTab':
      store.cycleSubTab(1)
      break
    case 'prevTab':
      store.cycleSubTab(-1)
      break
    case 'nextFolder':
      store.cycleWorkspace(1)
      break
    case 'prevFolder':
      store.cycleWorkspace(-1)
      break
    case 'zoom':
      zoom(action.delta)
      break
    case 'nextWaiting':
      jumpToWaiting()
      break
    case 'search': {
      const key = activeTerminalKey(store)
      if (key) void getTerminal(key)?.openSearch()
      break
    }
    case 'snip': {
      const key = activeTerminalKey(store)
      if (key) void snipInto(key)
      break
    }
  }
}

/** Opens the ⚙ popover for a folder or terminal, or closes it if it is already open for it. */
export function toggleTabSettings(target: TabSettingsTarget): void {
  const { tabSettings, setTabSettings } = useStore.getState()
  const id = (t: TabSettingsTarget | null): string | null =>
    t && (t.kind === 'folder' ? `folder:${t.workspace}` : `terminal:${t.terminal}`)
  setTabSettings(id(tabSettings) === id(target) ? null : target)
}

/** The rect a tab's ⚙ popover opens under: the whole tab, not just the button. */
export function tabAnchor(e: React.MouseEvent, tabSelector: string): DOMRect {
  const el = (e.currentTarget as Element).closest(tabSelector) ?? e.currentTarget
  return el.getBoundingClientRect()
}

/**
 * The Claude sessions a terminal's text can be sent to: every other one that runs or can be
 * resumed, this folder's first, then in tab order.
 */
export function sendTargets(from: string): SendTarget[] {
  const { terminals, workspaces, settings, appInfo } = useStore.getState()
  const platform = appInfo?.platform ?? ''
  const source = terminals[from]
  const reachable = new Set(['dormant', 'starting', 'running'])
  const keys = workspaces
    .flatMap((w) => w.subTabs.flatMap((s) => leaves(s.layout)))
    .filter((k) => {
      const t = terminals[k]
      return k !== from && t?.spec.kind === 'claude' && reachable.has(t.status)
    })
  const here = (k: string): boolean => !!source && samePath(terminals[k].cwd, source.cwd, platform)
  return [...keys.filter(here), ...keys.filter((k) => !here(k))].map((key) => {
    const ws = locate(workspaces, key)?.workspace
    const folder = ws ? workspaceTitle(ws, settings?.folderTitles, platform) : ''
    return { key, label: folder ? `${terminals[key].title} · ${folder}` : terminals[key].title }
  })
}

/** Shows session `to` and puts the text into its prompt, unsent, for you to add to. */
export function sendToTerminal(to: string, text: string): void {
  if (!useStore.getState().terminals[to]) return
  useStore.getState().revealTerminal(to) // a dormant tab starts once shown
  getTerminal(to)?.deliver(text)
}

export function toggleBookmarks(open?: boolean): void {
  const { settings, updateSettings, editBookmark } = useStore.getState()
  const next = open ?? !settings?.bookmarksOpen
  if (!next) editBookmark(null)
  if (next !== settings?.bookmarksOpen) void updateSettings({ bookmarksOpen: next })
}

/** Opens the bookmarks panel with a new prompt holding this text, for you to name and file. */
export function bookmarkText(text: string): void {
  toggleBookmarks(true)
  useStore
    .getState()
    .editBookmark({ type: 'prompt', parent: null, title: titleFromText(text), text })
}

/** Puts a bookmarked prompt into the active terminal's prompt, unsent, and goes there. */
export function insertIntoActiveTerminal(text: string): void {
  const key = activeTerminalKey(useStore.getState())
  if (!key) return
  sendToTerminal(key, text)
  getTerminal(key)?.focus()
}

/** Lets you snip a region of the screen and puts it into this Claude's prompt as an image. */
export async function snipInto(key: string): Promise<void> {
  const t = useStore.getState().terminals[key]
  if (t?.spec.kind !== 'claude' || t.status !== 'running') return
  const result = await window.api.snip()
  if (result === 'unavailable') {
    await window.api.confirm({
      message: 'No screenshot tool found',
      detail: 'Snipping needs gnome-screenshot, Spectacle or Flameshot. Install one of them.',
      okLabel: 'OK'
    })
  }
  if (result === 'captured') {
    useStore.getState().revealTerminal(key)
    getTerminal(key)?.pasteImage()
  } else getTerminal(key)?.focus()
}

/** Brings up the next session that asks for your answer or finished unseen (of one kind). */
export function jumpToWaiting(kind?: WaitKind): void {
  const store = useStore.getState()
  const key = nextWaiting(store, activeTerminalKey(store), kind)
  if (key) store.revealTerminal(key)
}

export function focusActiveTerminal(): void {
  const key = activeTerminalKey(useStore.getState())
  // Writing in its notes is working in it too: the focus stays there.
  if (key && !notesOf(key)?.contains(document.activeElement)) getTerminal(key)?.focus()
}

/** The textarea of a session's notes bar, if it is open. */
function notesOf(key: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(
    `.notes-bar[data-terminal="${CSS.escape(key)}"] textarea`
  )
}

/**
 * Opens or closes a session's notes bar (flips it without `open`), and puts the focus into the
 * notes it opened, or back into the terminal.
 */
export function toggleSessionNotes(key: string, open?: boolean): void {
  const { terminals, toggleNotes } = useStore.getState()
  const t = terminals[key]
  if (!t) return
  const next = open ?? !t.notesOpen
  toggleNotes(key, next)
  // After React has shown or removed the bar.
  requestAnimationFrame(() => (next ? notesOf(key)?.focus() : getTerminal(key)?.focus()))
}
