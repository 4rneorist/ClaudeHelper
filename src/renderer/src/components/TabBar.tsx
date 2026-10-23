import { useCallback, useContext, useRef, useState } from 'react'
import { closeWorkspace } from '../actions'
import { endDrag, startDrag } from '../dnd'
import { leaves } from '../layout'
import { combinedStatus, useStore, type Workspace } from '../store'
import { findFolderColor, tabColors } from '../tabColors'
import { ThemeContext } from '../themeContext'
import { FolderColorPicker } from './FolderColorPicker'

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  starting: 'Starting',
  exited: 'Exited',
  error: 'Failed to start',
  none: 'Not started'
}

/** Hovering a dragged item over a folder tab for this long opens that folder, to drop into it. */
const HOVER_SWITCH_MS = 500

function fileManagerName(platform: string): string {
  if (platform === 'win32') return 'File Explorer'
  if (platform === 'darwin') return 'Finder'
  return 'file manager'
}

interface PickerTarget {
  folder: string
  title: string
  anchor: DOMRect
}

/** Top row: one tab per folder (or start screen). */
export function TabBar(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspace = useStore((s) => s.activeWorkspace)
  const newStartWorkspace = useStore((s) => s.newStartWorkspace)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const folderColors = useStore((s) => s.settings?.folderColors)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const [picker, setPicker] = useState<PickerTarget | null>(null)
  const closePicker = useCallback(() => setPicker(null), [])

  return (
    <>
      <div className="tabbar" role="tablist" aria-label="Folders">
        <div className="tabs">
          {workspaces.map((ws) => (
            <WorkspaceTab
              key={ws.key}
              ws={ws}
              active={ws.key === activeWorkspace}
              color={ws.cwd ? findFolderColor(folderColors, ws.cwd, platform) : null}
              fileManager={fileManagerName(platform)}
              onPickColor={(anchor) => {
                if (ws.cwd) setPicker({ folder: ws.cwd, title: ws.title, anchor })
              }}
            />
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
      {picker && (
        <FolderColorPicker
          {...picker}
          current={findFolderColor(folderColors, picker.folder, platform)}
          onClose={closePicker}
        />
      )}
    </>
  )
}

interface WorkspaceTabProps {
  ws: Workspace
  active: boolean
  /** The folder's own color, if it has one. */
  color: string | null
  fileManager: string
  onPickColor(anchor: DOMRect): void
}

function WorkspaceTab({
  ws,
  active,
  color,
  fileManager,
  onPickColor
}: WorkspaceTabProps): React.JSX.Element {
  const theme = useContext(ThemeContext)
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
  const colors = isFolder && color ? tabColors(color, theme, active) : null
  const cwd = isFolder ? ws.cwd : null

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab ${active ? 'active' : ''} ${dropHover ? 'drop-target' : ''} ${colors ? 'colored' : ''}`}
      style={colors ? { backgroundColor: colors.background, color: colors.text } : undefined}
      title={
        ws.cwd
          ? `${ws.cwd}\n${keys.length} terminal${keys.length === 1 ? '' : 's'}\nDrag onto a pane of another folder to split with it\nRight-click to set its color`
          : label
      }
      onContextMenu={(e) => {
        if (!cwd) return
        e.preventDefault()
        onPickColor(e.currentTarget.getBoundingClientRect())
      }}
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
      {cwd && (
        <button
          className="tab-action"
          aria-label={`Open ${ws.title} in ${fileManager}`}
          title={`Open in ${fileManager}`}
          onClick={(e) => {
            e.stopPropagation()
            window.api.openFolder(cwd)
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M1.75 4.25v8a1 1 0 0 0 1 1h10.5a1 1 0 0 0 1-1v-6.5a1 1 0 0 0-1-1H8L6.5 3.25H2.75a1 1 0 0 0-1 1z" />
          </svg>
        </button>
      )}
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
