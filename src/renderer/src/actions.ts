import { DEFAULT_FONT_SIZE } from './constants'
import { leaves } from './layout'
import {
  activeTerminalKey,
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

/** Asks before stopping live processes, then disposes the terminals and drops them from layouts. */
async function closeTerminals(keys: string[], scope: string): Promise<boolean> {
  const { terminals } = useStore.getState()
  const live = keys.filter((k) => isLive(terminals[k]))
  if (live.length > 0) {
    const single = live.length === 1 && keys.length === 1 ? terminals[live[0]] : null
    const ok = await window.api.confirm(
      single
        ? {
            message: `Stop "${single.title}"?`,
            detail: single.cwd,
            okLabel: 'Stop and close'
          }
        : {
            message: `Close ${scope}?`,
            detail: `${live.length} running ${live.length === 1 ? 'process' : 'processes'} will be stopped.`,
            okLabel: 'Stop and close'
          }
    )
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

/** Brings up the next session that asks for your answer or finished unseen (of one kind). */
export function jumpToWaiting(kind?: WaitKind): void {
  const store = useStore.getState()
  const key = nextWaiting(store, activeTerminalKey(store), kind)
  if (key) store.revealTerminal(key)
}

export function focusActiveTerminal(): void {
  const key = activeTerminalKey(useStore.getState())
  if (key) getTerminal(key)?.focus()
}
