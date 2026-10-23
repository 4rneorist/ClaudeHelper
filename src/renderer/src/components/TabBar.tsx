import { useRef, useState } from 'react'
import { closeWorkspace } from '../actions'
import { endDrag, startDrag } from '../dnd'
import { leaves } from '../layout'
import { combinedStatus, useStore, type Workspace } from '../store'

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  starting: 'Starting',
  exited: 'Exited',
  error: 'Failed to start',
  none: 'Not started'
}

/** Hovering a dragged item over a folder tab for this long opens that folder, to drop into it. */
const HOVER_SWITCH_MS = 500

/** Top row: one tab per folder (or start screen). */
export function TabBar(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspace = useStore((s) => s.activeWorkspace)
  const newStartWorkspace = useStore((s) => s.newStartWorkspace)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  return (
    <div className="tabbar" role="tablist" aria-label="Folders">
      <div className="tabs">
        {workspaces.map((ws) => (
          <WorkspaceTab key={ws.key} ws={ws} active={ws.key === activeWorkspace} />
        ))}
        <button
          className="tab-new"
          aria-label="New folder tab"
          title="Open another folder"
          onClick={newStartWorkspace}
        >
          +
        </button>
      </div>
      <button
        className="icon-button"
        aria-label="Settings"
        title="Settings"
        onClick={() => setSettingsOpen(true)}
      >
        ⚙
      </button>
    </div>
  )
}

function WorkspaceTab({ ws, active }: { ws: Workspace; active: boolean }): React.JSX.Element {
  const terminals = useStore((s) => s.terminals)
  const drag = useStore((s) => s.drag)
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace)
  const moveToSubTab = useStore((s) => s.moveToSubTab)
  const [dropHover, setDropHover] = useState(false)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const keys = ws.subTabs.flatMap((s) => leaves(s.layout))
  const status = combinedStatus(keys.map((k) => terminals[k]))
  const label = STATUS_LABELS[status]
  const isFolder = ws.kind === 'folder'
  // Dropping on a folder tab adds the dragged terminal(s) to that folder as a new tab.
  const canDrop = !!drag && isFolder && !(drag.kind === 'workspace' && drag.workspace === ws.key)

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab ${active ? 'active' : ''} ${dropHover ? 'drop-target' : ''}`}
      title={
        ws.cwd
          ? `${ws.cwd}\n${keys.length} terminal${keys.length === 1 ? '' : 's'}\nDrag onto a pane of another folder to split with it`
          : label
      }
      draggable={isFolder}
      onDragStart={(e) => startDrag(e, { kind: 'workspace', workspace: ws.key })}
      onDragEnd={endDrag}
      onDragEnter={() => {
        if (!drag || active || (drag.kind === 'workspace' && drag.workspace === ws.key)) return
        clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(() => setActiveWorkspace(ws.key), HOVER_SWITCH_MS)
      }}
      onDragOver={(e) => {
        if (!canDrop) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setDropHover(true)
      }}
      onDragLeave={() => {
        clearTimeout(hoverTimer.current)
        setDropHover(false)
      }}
      onDrop={(e) => {
        clearTimeout(hoverTimer.current)
        setDropHover(false)
        if (!canDrop || !drag) return
        e.preventDefault()
        moveToSubTab(drag, ws.key, ws.subTabs.length)
        endDrag()
      }}
      onClick={() => setActiveWorkspace(ws.key)}
      onAuxClick={(e) => e.button === 1 && void closeWorkspace(ws.key)}
    >
      <span className={`status-dot ${status}`} aria-label={label} />
      <span className="tab-title">{ws.title}</span>
      <button
        className="tab-close"
        aria-label={`Close ${ws.title}`}
        onClick={(e) => {
          e.stopPropagation()
          void closeWorkspace(ws.key)
        }}
      >
        ×
      </button>
    </div>
  )
}
