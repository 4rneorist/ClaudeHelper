import { useContext, useRef, useState } from 'react'
import type { TerminalSpec } from '../../../shared/ipc'
import { MIN_JOIN_SIZE } from '../../../shared/uiState'
import { closeSubTab, tabAnchor, toggleTabSettings } from '../actions'
import { MODE_LABELS } from '../constants'
import { dragDivider, leaves } from '../layout'
import {
  combinedAttention,
  combinedStatus,
  foreignFolder,
  pairOf,
  useStore,
  workspaceTitle,
  type SubTab,
  type Workspace
} from '../store'
import { findFolderColor, tabColors } from '../tabColors'
import { ThemeContext } from '../themeContext'
import { DropdownMenu, type MenuItem } from './DropdownMenu'
import { endDrag, fromFolder, startDrag } from '../dnd'
import { isMuted } from '../waiting'
import { BellIcon } from './Notifications'
import { TabPreview } from './TabPreview'
import { SubTabLayout } from './LayoutView'
import { StartScreen } from './StartScreen'

/** Hovering a dragged item over a sub-tab for this long switches to it, to drop into its panes. */
const HOVER_SWITCH_MS = 500
/** Hovering a sub-tab this long shows its preview. */
const PREVIEW_DELAY_MS = 400

export function WorkspaceView({
  workspace,
  visible
}: {
  workspace: Workspace
  visible: boolean
}): React.JSX.Element {
  if (workspace.kind === 'start') return <StartScreen workspace={workspace} />
  return (
    <div className="workspace-view">
      <SubTabBar workspace={workspace} />
      <div className="subtab-area">
        {workspace.subTabs.map((sub) => (
          <div key={sub.key} className="subtab-panel" hidden={sub.key !== workspace.activeSubTab}>
            <SubTabLayout
              workspace={workspace}
              subTab={sub}
              visible={visible && sub.key === workspace.activeSubTab}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/** The divider between two folders shown side by side; `size` is the left one's share. */
export function FolderSplitter({ left, size }: { left: string; size: number }): React.JSX.Element {
  const drag = useRef<{ start: number; total: number; initial: number } | null>(null)
  const resizeJoin = useStore((s) => s.resizeJoin)

  return (
    <div
      className="splitter splitter-row folder-splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the two folders"
      style={{ left: `${size * 100}%` }}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const total = e.currentTarget.parentElement!.getBoundingClientRect().width
        drag.current = { start: e.clientX, total, initial: size }
        document.body.classList.add('resizing-col')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.total === 0) return
        const delta = (e.clientX - d.start) / d.total
        resizeJoin(left, dragDivider([d.initial, 1 - d.initial], 0, delta, MIN_JOIN_SIZE)[0])
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing-col')
      }}
      onDoubleClick={() => resizeJoin(left, 0.5)}
    />
  )
}

function SubTabBar({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const shells = useStore((s) => s.shells)
  const drag = useStore((s) => s.drag)
  const title = useStore((s) =>
    workspaceTitle(workspace, s.settings?.folderTitles, s.appInfo?.platform ?? '')
  )
  const joined = useStore((s) => pairOf(s.workspaces, workspace.key).length > 1)
  const addTerminal = useStore((s) => s.addTerminal)
  const splitWithNew = useStore((s) => s.splitWithNew)
  const fillGrid = useStore((s) => s.fillGrid)
  const moveToSubTab = useStore((s) => s.moveToSubTab)
  const active = workspace.subTabs.find((s) => s.key === workspace.activeSubTab)

  const add = (spec: TerminalSpec): void => addTerminal(workspace.key, spec)
  const newItems: MenuItem[] = [
    { header: 'Claude' },
    { label: MODE_LABELS.new, onSelect: () => add({ kind: 'claude', mode: 'new' }) },
    { label: MODE_LABELS.continue, onSelect: () => add({ kind: 'claude', mode: 'continue' }) },
    { label: MODE_LABELS.resume, onSelect: () => add({ kind: 'claude', mode: 'resume' }) },
    ...(shells.length ? ([{ separator: true }, { header: 'Terminal' }] as MenuItem[]) : []),
    ...shells.map((sh) => ({
      label: sh.label,
      onSelect: () => add({ kind: 'shell', shellId: sh.id })
    }))
  ]

  const claude: TerminalSpec = { kind: 'claude', mode: 'new' }
  const splitItems: MenuItem[] = active
    ? [
        {
          label: 'Split right',
          hint: 'new Claude',
          onSelect: () =>
            splitWithNew(workspace.key, active.key, active.activePane, 'right', claude)
        },
        {
          label: 'Split down',
          hint: 'new Claude',
          onSelect: () =>
            splitWithNew(workspace.key, active.key, active.activePane, 'bottom', claude)
        },
        {
          label: '2 × 2 grid',
          hint: 'fill with Claude',
          onSelect: () => fillGrid(workspace.key, active.key)
        },
        { separator: true },
        { header: 'Tip: drag a tab onto a pane edge to split with it' }
      ]
    : []

  // A pane dragged onto the tab row becomes a tab of its own.
  const canDropHere = fromFolder(drag, workspace.key)

  return (
    <div
      className="subtabbar"
      role="tablist"
      aria-label={`Terminals in ${title}`}
      onDragOver={(e) => {
        if (!canDropHere) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
      }}
      onDrop={(e) => {
        if (!canDropHere || !drag) return
        e.preventDefault()
        moveToSubTab(drag, workspace.key, workspace.subTabs.length)
        endDrag()
      }}
    >
      {joined && <PairLabel workspace={workspace} title={title} />}
      <div className="subtabs">
        {workspace.subTabs.map((sub, i) => (
          <SubTabItem key={sub.key} workspace={workspace} sub={sub} index={i} />
        ))}
      </div>
      <button
        className="tab-new"
        title="New Claude session"
        aria-label="New Claude session"
        onClick={() => add(claude)}
      >
        +
      </button>
      <DropdownMenu className="tab-new chevron" label="▾" title="New terminal…" items={newItems} />
      <div className="spacer" />
      {active && (
        <DropdownMenu className="icon-button" label="⊞" title="Split" items={splitItems} />
      )}
    </div>
  )
}

/** Which folder this half of a pair is, in the folder's color; bold on the active half. */
function PairLabel({
  workspace,
  title
}: {
  workspace: Workspace
  title: string
}): React.JSX.Element {
  const theme = useContext(ThemeContext)
  const active = useStore((s) => s.activeWorkspace === workspace.key)
  const color = useStore((s) =>
    workspace.cwd
      ? findFolderColor(s.settings?.folderColors, workspace.cwd, s.appInfo?.platform ?? '')
      : null
  )
  const setActiveWorkspace = useStore((s) => s.setActiveWorkspace)
  const colors = color ? tabColors(color, theme, active, 'session') : null

  return (
    <button
      className={`pair-label ${active ? 'active' : ''}`}
      style={colors ? { backgroundColor: colors.background, color: colors.text } : undefined}
      title={workspace.cwd ?? undefined}
      onClick={() => setActiveWorkspace(workspace.key)}
    >
      {title}
    </button>
  )
}

function SubTabItem({
  workspace,
  sub,
  index
}: {
  workspace: Workspace
  sub: SubTab
  index: number
}): React.JSX.Element {
  const theme = useContext(ThemeContext)
  const terminals = useStore((s) => s.terminals)
  const drag = useStore((s) => s.drag)
  const setActiveSubTab = useStore((s) => s.setActiveSubTab)
  const moveToSubTab = useStore((s) => s.moveToSubTab)
  const [insert, setInsert] = useState<'before' | 'after' | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [preview, setPreview] = useState<DOMRect | null>(null)
  const previewTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const hidePreview = (): void => {
    clearTimeout(previewTimer.current)
    setPreview(null)
  }

  const keys = leaves(sub.layout)
  // Named after its first (top-left) pane, so the label stays put while focus moves between panes.
  const main = terminals[keys[0]]
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const otherFolder = main ? foreignFolder(main, workspace, platform) : null
  const status = combinedStatus(keys.map((k) => terminals[k]))
  const attention = combinedAttention(keys.map((k) => terminals[k]))
  const isActive = sub.key === workspace.activeSubTab
  const canDrop = fromFolder(drag, workspace.key)
  const colors = main?.color ? tabColors(main.color, theme, isActive, 'session') : null
  const muted = useStore((s) => {
    const t = s.terminals[keys[0]]
    return t ? isMuted(s, t) : false
  })

  const sideOf = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after'
  }
  // A split tab is named after its first pane, so that is the one its ⚙ sets up.
  const openSettings = (anchor: DOMRect): void => {
    if (main) toggleTabSettings({ kind: 'terminal', terminal: main.key, anchor })
  }

  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={`subtab ${isActive ? 'active' : ''} ${insert ? `insert-${insert}` : ''} ${colors ? 'colored' : ''} ${attention ? `attention-${attention}` : ''}`}
      style={colors ? { backgroundColor: colors.background, color: colors.text } : undefined}
      draggable
      onDragStart={(e) =>
        startDrag(e, { kind: 'subtab', workspace: workspace.key, subTab: sub.key })
      }
      onDragEnd={endDrag}
      onDragEnter={() => {
        if (!canDrop || isActive) return
        clearTimeout(hoverTimer.current)
        hoverTimer.current = setTimeout(
          () => setActiveSubTab(workspace.key, sub.key),
          HOVER_SWITCH_MS
        )
      }}
      onDragOver={(e) => {
        if (!canDrop) return
        e.preventDefault()
        e.stopPropagation()
        setInsert(sideOf(e))
      }}
      onDragLeave={() => {
        clearTimeout(hoverTimer.current)
        setInsert(null)
      }}
      onDrop={(e) => {
        clearTimeout(hoverTimer.current)
        setInsert(null)
        if (!canDrop || !drag) return
        e.preventDefault()
        e.stopPropagation()
        moveToSubTab(drag, workspace.key, sideOf(e) === 'before' ? index : index + 1)
        endDrag()
      }}
      onClick={() => setActiveSubTab(workspace.key, sub.key)}
      onContextMenu={(e) => {
        e.preventDefault()
        hidePreview()
        openSettings(e.currentTarget.getBoundingClientRect())
      }}
      onMouseEnter={(e) => {
        if (drag) return
        const rect = e.currentTarget.getBoundingClientRect()
        previewTimer.current = setTimeout(() => setPreview(rect), PREVIEW_DELAY_MS)
      }}
      onMouseLeave={hidePreview}
      onMouseDown={hidePreview}
      onAuxClick={(e) => e.button === 1 && void closeSubTab(workspace.key, sub.key)}
    >
      <span className={`status-dot ${status}`} />
      <span className="tab-title">
        {main?.title ?? 'Terminal'}
        {otherFolder && <span className="tab-folder"> · {otherFolder}</span>}
      </span>
      {keys.length > 1 && <span className="pane-count">{keys.length}</span>}
      {muted && (
        <span className="tab-muted" title="Muted: no sounds, toasts or notifications">
          <BellIcon off size={12} />
        </span>
      )}
      {main && (
        <button
          className="tab-action tab-extra"
          aria-label={`Settings for ${main.title}`}
          title="Title and color"
          // Keeps an open popover from closing on mousedown, so the click toggles it.
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            openSettings(tabAnchor(e, '.subtab'))
          }}
        >
          ⚙
        </button>
      )}
      <button
        className="tab-close"
        aria-label={`Close ${main?.title ?? 'terminal'}`}
        onClick={(e) => {
          e.stopPropagation()
          void closeSubTab(workspace.key, sub.key)
        }}
      >
        ×
      </button>
      {preview && main && !drag && (
        <TabPreview terminal={main.key} anchor={preview} panes={keys.length} />
      )}
    </div>
  )
}
