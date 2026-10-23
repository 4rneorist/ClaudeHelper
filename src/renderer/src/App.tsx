import { useEffect } from 'react'
import { focusActiveTerminal, runShortcut } from './actions'
import { startAttention } from './attention'
import { startGitPolling } from './gitPolling'
import { startPersistence } from './persist'
import { SettingsDialog } from './components/SettingsDialog'
import { StatusBar } from './components/StatusBar'
import { TabBar } from './components/TabBar'
import { Toasts } from './components/Notifications'
import { TabSettings } from './components/TabSettings'
import { FolderSplitter, WorkspaceView } from './components/WorkspaceView'
import { activeTerminalKey, pairOf, useStore } from './store'
import { classifyKey } from './terminal/keybindings'
import { ThemeContext } from './themeContext'
import { useResolvedTheme } from './useTheme'

const APP_SHORTCUTS = new Set([
  'newTerminal',
  'newFolderTab',
  'closePane',
  'nextTab',
  'prevTab',
  'nextFolder',
  'prevFolder',
  'nextWaiting',
  'zoom'
])

function App(): React.JSX.Element {
  const ready = useStore((s) => s.appInfo !== null && s.settings !== null)
  const init = useStore((s) => s.init)
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspace = useStore((s) => s.activeWorkspace)
  const activeTerminal = useStore(activeTerminalKey)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const themeSetting = useStore((s) => s.settings?.theme)
  const resolvedTheme = useResolvedTheme(themeSetting)

  useEffect(() => {
    // Persist only after the saved state has been restored, or it would be overwritten.
    void init().then(() => {
      startPersistence()
      startAttention()
      startGitPolling()
    })
  }, [init])

  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme
  }, [resolvedTheme])

  // App shortcuts when focus is outside a terminal (start screen, tab bars). Terminals handle their own.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if ((e.target as Element | null)?.closest?.('.xterm')) return
      const action = classifyKey(e, platform, false)
      if (!APP_SHORTCUTS.has(action.type)) return
      e.preventDefault()
      runShortcut(action)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [platform])

  useEffect(() => {
    // A file dropped outside a drop target must not make the window navigate to it.
    const prevent = (e: DragEvent): void => e.preventDefault()
    // Bubble phase, after React's handlers: a cancelled drag, or one whose source was removed.
    const clearDrag = (): void => useStore.getState().setDrag(null)
    // Ctrl+wheel outside a terminal must not zoom the whole page.
    const noPageZoom = (e: WheelEvent): void => {
      if (e.ctrlKey) e.preventDefault()
    }
    window.addEventListener('dragover', prevent)
    window.addEventListener('drop', prevent)
    window.addEventListener('dragend', clearDrag)
    window.addEventListener('drop', clearDrag)
    window.addEventListener('wheel', noPageZoom, { passive: false })
    return () => {
      window.removeEventListener('dragover', prevent)
      window.removeEventListener('drop', prevent)
      window.removeEventListener('dragend', clearDrag)
      window.removeEventListener('drop', clearDrag)
      window.removeEventListener('wheel', noPageZoom)
    }
  }, [])

  useEffect(() => {
    focusActiveTerminal()
  }, [activeTerminal, activeWorkspace])

  if (!ready) return <div className="loading">Loading…</div>

  // The active folder, or the two joined folders it belongs to (left first).
  const shown = pairOf(workspaces, activeWorkspace)
  const joinSize = workspaces.find((w) => w.key === shown[1])?.joinSize ?? 1

  return (
    <ThemeContext.Provider value={resolvedTheme}>
      <div className="app">
        <TabBar />
        <main className="workspace">
          {workspaces.map((ws) => {
            // Panels stay in tab order (moving them would restart their terminals); a joined
            // pair is placed left and right by position instead.
            const side = shown.length > 1 ? shown.indexOf(ws.key) : -1
            return (
              <div
                key={ws.key}
                className="workspace-panel"
                hidden={!shown.includes(ws.key)}
                role="tabpanel"
                style={
                  side === 0
                    ? { right: `${(1 - joinSize) * 100}%` }
                    : side === 1
                      ? { left: `${joinSize * 100}%` }
                      : undefined
                }
              >
                <WorkspaceView workspace={ws} visible={shown.includes(ws.key)} />
              </div>
            )
          })}
          {shown.length > 1 && <FolderSplitter left={shown[0]} size={joinSize} />}
        </main>
        <StatusBar />
        <SettingsDialog />
        <TabSettings />
        <Toasts />
      </div>
    </ThemeContext.Provider>
  )
}

export default App
