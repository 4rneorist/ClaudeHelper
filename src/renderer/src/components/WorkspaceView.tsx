import { useRef, useState } from 'react'
import type { TerminalSpec } from '../../../shared/ipc'
import { closeSubTab } from '../actions'
import { MODE_LABELS } from '../constants'
import { leaves } from '../layout'
import { combinedStatus, foreignFolder, useStore, type SubTab, type Workspace } from '../store'
import { DropdownMenu, type MenuItem } from './DropdownMenu'
import { endDrag, startDrag } from '../dnd'
import { SubTabLayout } from './LayoutView'
import { StartScreen } from './StartScreen'

/** Hovering a dragged item over a sub-tab for this long switches to it, to drop into its panes. */
const HOVER_SWITCH_MS = 500

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

function SubTabBar({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const shells = useStore((s) => s.shells)
  const drag = useStore((s) => s.drag)
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

  // Anything dragged (from this or another folder) can be dropped on the tab row.
  const canDropHere = !!drag

  return (
    <div
      className="subtabbar"
      role="tablist"
      aria-label={`Terminals in ${workspace.title}`}
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

function SubTabItem({
  workspace,
  sub,
  index
}: {
  workspace: Workspace
  sub: SubTab
  index: number
}): React.JSX.Element {
  const terminals = useStore((s) => s.terminals)
  const drag = useStore((s) => s.drag)
  const setActiveSubTab = useStore((s) => s.setActiveSubTab)
  const moveToSubTab = useStore((s) => s.moveToSubTab)
  const [insert, setInsert] = useState<'before' | 'after' | null>(null)
  const hoverTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const keys = leaves(sub.layout)
  // Named after its first (top-left) pane, so the label stays put while focus moves between panes.
  const main = terminals[keys[0]]
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const otherFolder = main ? foreignFolder(main, workspace, platform) : null
  const status = combinedStatus(keys.map((k) => terminals[k]))
  const isActive = sub.key === workspace.activeSubTab
  const canDrop = !!drag

  const sideOf = (e: React.DragEvent): 'before' | 'after' => {
    const r = e.currentTarget.getBoundingClientRect()
    return e.clientX < r.left + r.width / 2 ? 'before' : 'after'
  }

  return (
    <div
      role="tab"
      aria-selected={isActive}
      className={`subtab ${isActive ? 'active' : ''} ${insert ? `insert-${insert}` : ''}`}
      title={[main?.title, main?.termTitle, keys.length > 1 ? `${keys.length} panes` : null]
        .filter(Boolean)
        .join('\n')}
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
      onAuxClick={(e) => e.button === 1 && void closeSubTab(workspace.key, sub.key)}
    >
      <span className={`status-dot ${status}`} />
      <span className="tab-title">
        {main?.title ?? 'Terminal'}
        {otherFolder && <span className="tab-folder"> · {otherFolder}</span>}
      </span>
      {keys.length > 1 && <span className="pane-count">{keys.length}</span>}
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
    </div>
  )
}
