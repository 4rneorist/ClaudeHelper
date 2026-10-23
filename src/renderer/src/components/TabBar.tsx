import { Fragment, useContext, useState } from 'react'
import { closeWorkspace, tabAnchor, toggleTabSettings } from '../actions'
import { endDrag, startDrag } from '../dnd'
import { leaves } from '../layout'
import {
  combinedAttention,
  combinedStatus,
  pairOf,
  useStore,
  workspaceTitle,
  type Workspace
} from '../store'
import { findFolderColor, tabColors } from '../tabColors'
import { ThemeContext } from '../themeContext'
import { BellIcon, NotificationBell } from './Notifications'
import { isFolderMuted } from '../waiting'

const STATUS_LABELS: Record<string, string> = {
  asking: 'Needs your answer',
  idle: 'Idle',
  working: 'Working',
  running: 'Running',
  starting: 'Starting',
  exited: 'Exited',
  error: 'Failed to start',
  none: 'Not started'
}

function fileManagerName(platform: string): string {
  if (platform === 'win32') return 'File Explorer'
  if (platform === 'darwin') return 'Finder'
  return 'file manager'
}

/** Top row: one tab per folder (or start screen). */
export function TabBar(): React.JSX.Element {
  const workspaces = useStore((s) => s.workspaces)
  const activeWorkspace = useStore((s) => s.activeWorkspace)
  const newStartWorkspace = useStore((s) => s.newStartWorkspace)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const folderColors = useStore((s) => s.settings?.folderColors)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const shown = pairOf(workspaces, activeWorkspace)

  return (
    <div className="tabbar" role="tablist" aria-label="Folders">
      <div className="tabs">
        {workspaces.map((ws, i) => (
          <Fragment key={ws.key}>
            {ws.joinedTo && (
              <span className="pair-link" title="Joined: shown side by side" aria-hidden="true">
                ⇆
              </span>
            )}
            <WorkspaceTab
              ws={ws}
              index={i}
              active={ws.key === activeWorkspace}
              partner={ws.key !== activeWorkspace && shown.includes(ws.key)}
              color={ws.cwd ? findFolderColor(folderColors, ws.cwd, platform) : null}
              fileManager={fileManagerName(platform)}
            />
          </Fragment>
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
      <NotificationBell />
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

interface WorkspaceTabProps {
  ws: Workspace
  index: number
  active: boolean
  /** Shown next to the active folder, joined to it. */
  partner: boolean
  /** The folder's own color, if it has one. */
  color: string | null
  fileManager: string
}

function WorkspaceTab({
  ws,
  index,
  active,
  partner,
  color,
  fileManager
}: WorkspaceTabProps): React.JSX.Element {
  const theme = useContext(ThemeContext)
  const terminals = useStore((s) => s.terminals)
  const drag = useStore((s) => s.drag)
  const title = useStore((s) =>
    workspaceTitle(ws, s.settings?.folderTitles, s.appInfo?.platform ?? '')
  )
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace)
  const moveWorkspace = useStore((s) => s.moveWorkspace)
  const [insert, setInsert] = useState<'before' | 'after' | null>(null)
  const git = useStore((s) => (ws.cwd ? s.gitInfo[ws.cwd] : null))
  const muted = useStore((s) => (ws.cwd ? isFolderMuted(s, ws.cwd) : false))

  const keys = ws.subTabs.flatMap((s) => leaves(s.layout))
  const status = combinedStatus(keys.map((k) => terminals[k]))
  const attention = combinedAttention(keys.map((k) => terminals[k]))
  const label = STATUS_LABELS[status]
  const isFolder = ws.kind === 'folder'
  // Folder tabs only take other folder tabs, to reorder them.
  const canDrop = drag?.kind === 'workspace' && drag.workspace !== ws.key
  const colors = isFolder && color ? tabColors(color, theme, active) : null
  const cwd = isFolder ? ws.cwd : null

  const sideOf = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after'
  }
  const openSettings = (anchor: DOMRect): void =>
    toggleTabSettings({ kind: 'folder', workspace: ws.key, anchor })

  return (
    <div
      role="tab"
      aria-selected={active}
      className={`tab ${active ? 'active' : ''} ${partner ? 'partner' : ''} ${insert ? `insert-${insert}` : ''} ${colors ? 'colored' : ''} ${attention ? `attention-${attention}` : ''}`}
      style={colors ? { backgroundColor: colors.background, color: colors.text } : undefined}
      title={
        ws.cwd
          ? [
              ws.cwd,
              git && `Branch ${git.branch}${git.dirty ? ', with uncommitted changes' : ''}`,
              `${keys.length} terminal${keys.length === 1 ? '' : 's'} · ${label}`,
              'Drag to reorder. ⚙ or right-click: title and color'
            ]
              .filter(Boolean)
              .join('\n')
          : label
      }
      onContextMenu={(e) => {
        if (!cwd) return
        e.preventDefault()
        openSettings(e.currentTarget.getBoundingClientRect())
      }}
      draggable
      onDragStart={(e) => startDrag(e, { kind: 'workspace', workspace: ws.key })}
      onDragEnd={endDrag}
      onDragOver={(e) => {
        if (!canDrop) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setInsert(sideOf(e))
      }}
      onDragLeave={() => setInsert(null)}
      onDrop={(e) => {
        setInsert(null)
        if (!canDrop || drag?.kind !== 'workspace') return
        e.preventDefault()
        moveWorkspace(drag.workspace, sideOf(e) === 'before' ? index : index + 1)
        endDrag()
      }}
      onClick={() => setActiveWorkspace(ws.key)}
      onAuxClick={(e) => e.button === 1 && void closeWorkspace(ws.key)}
    >
      <span className={`status-dot ${status}`} aria-label={label} />
      <span className="tab-title">{title}</span>
      {git && (
        <span className="tab-branch">
          {git.branch}
          {git.dirty && '*'}
        </span>
      )}
      {muted && (
        <span className="tab-muted" title="Muted: no sounds, toasts or notifications">
          <BellIcon off size={12} />
        </span>
      )}
      {cwd && (
        <button
          className="tab-action tab-extra"
          aria-label={`Settings for ${title}`}
          title="Title and color"
          // Keeps an open popover from closing on mousedown, so the click toggles it.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            openSettings(tabAnchor(e, '.tab'))
          }}
        >
          ⚙
        </button>
      )}
      {cwd && (
        <button
          className="tab-action tab-extra"
          aria-label={`Open ${title} in ${fileManager}`}
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
        aria-label={`Close ${title}`}
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
