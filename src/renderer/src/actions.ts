import { DEFAULT_FONT_SIZE } from './constants'
import { leaves } from './layout'
import { activeTerminalKey, useStore, type TerminalState } from './store'
import { disposeTerminal, getTerminal } from './terminal/TerminalSession'
import type { KeyAction } from './terminal/keybindings'

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
  await closeTerminals(keys, `all terminals in "${ws.title}"`)
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
  }
}

export function focusActiveTerminal(): void {
  const key = activeTerminalKey(useStore.getState())
  if (key) getTerminal(key)?.focus()
}
