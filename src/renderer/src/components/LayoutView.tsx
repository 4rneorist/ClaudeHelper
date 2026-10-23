import { Fragment, useContext, useRef, useState } from 'react'
import { closeTerminal, tabAnchor, toggleTabSettings } from '../actions'
import { dragDivider, leaves, sideAt, type Dir, type LayoutNode, type Side } from '../layout'
import { dotStatus, foreignFolder, useStore, type SubTab, type Workspace } from '../store'
import { endDrag, fromFolder, startDrag } from '../dnd'
import { tabColors } from '../tabColors'
import { getTerminal } from '../terminal/TerminalSession'
import { ThemeContext } from '../themeContext'
import { TerminalView } from './TerminalView'

/** Smallest pane, in pixels, when dragging a divider. */
const MIN_PANE_PX = 80

interface Ctx {
  workspace: Workspace
  subTab: SubTab
  visible: boolean
  multi: boolean
}

function nodeKey(node: LayoutNode): string {
  return node.type === 'leaf' ? node.id : `split:${leaves(node).join(',')}`
}

export function SubTabLayout({
  workspace,
  subTab,
  visible
}: {
  workspace: Workspace
  subTab: SubTab
  visible: boolean
}): React.JSX.Element {
  const ctx: Ctx = {
    workspace,
    subTab,
    visible,
    multi: subTab.layout.type === 'split'
  }
  return (
    <div className="layout-root">
      <LayoutNodeView node={subTab.layout} path={[]} ctx={ctx} />
    </div>
  )
}

function LayoutNodeView({
  node,
  path,
  ctx
}: {
  node: LayoutNode
  path: number[]
  ctx: Ctx
}): React.JSX.Element {
  if (node.type === 'leaf') return <PaneView terminalKey={node.id} ctx={ctx} />
  return (
    <div className={`split split-${node.dir}`}>
      {node.children.map((child, i) => (
        <Fragment key={nodeKey(child)}>
          {i > 0 && (
            <Splitter dir={node.dir} sizes={node.sizes} index={i - 1} path={path} ctx={ctx} />
          )}
          <div className="split-cell" style={{ flex: `${node.sizes[i]} 1 0px` }}>
            <LayoutNodeView node={child} path={[...path, i]} ctx={ctx} />
          </div>
        </Fragment>
      ))}
    </div>
  )
}

function Splitter({
  dir,
  sizes,
  index,
  path,
  ctx
}: {
  dir: Dir
  sizes: number[]
  index: number
  path: number[]
  ctx: Ctx
}): React.JSX.Element {
  const drag = useRef<{ start: number; total: number; initial: number[] } | null>(null)
  const resizeSplit = useStore((s) => s.resizeSplit)
  const resize = (next: number[]): void =>
    resizeSplit(ctx.workspace.key, ctx.subTab.key, path, next)

  return (
    <div
      className={`splitter splitter-${dir}`}
      role="separator"
      aria-orientation={dir === 'row' ? 'vertical' : 'horizontal'}
      onPointerDown={(e) => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        const rect = e.currentTarget.parentElement!.getBoundingClientRect()
        drag.current = {
          start: dir === 'row' ? e.clientX : e.clientY,
          total: dir === 'row' ? rect.width : rect.height,
          initial: sizes
        }
        document.body.classList.add(dir === 'row' ? 'resizing-col' : 'resizing-row')
      }}
      onPointerMove={(e) => {
        const d = drag.current
        if (!d || d.total === 0) return
        const delta = ((dir === 'row' ? e.clientX : e.clientY) - d.start) / d.total
        resize(dragDivider(d.initial, index, delta, MIN_PANE_PX / d.total))
      }}
      onPointerUp={(e) => {
        drag.current = null
        e.currentTarget.releasePointerCapture(e.pointerId)
        document.body.classList.remove('resizing-col', 'resizing-row')
      }}
      onDoubleClick={() => {
        // Even out the two neighbours.
        const next = [...sizes]
        const pair = next[index] + next[index + 1]
        next[index] = next[index + 1] = pair / 2
        resize(next)
      }}
    />
  )
}

function PaneView({
  terminalKey,
  ctx
}: {
  terminalKey: string
  ctx: Ctx
}): React.JSX.Element | null {
  const terminal = useStore((s) => s.terminals[terminalKey])
  const drag = useStore((s) => s.drag)
  const focusTerminal = useStore((s) => s.focusTerminal)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const theme = useContext(ThemeContext)
  const active = ctx.subTab.activePane === terminalKey
  if (!terminal) return null
  const otherFolder = foreignFolder(terminal, ctx.workspace, platform)
  // The pane header sits on the same background as the folder tab bar.
  const colors = terminal.color ? tabColors(terminal.color, theme, active, 'folder') : null

  // Docking target for a pane or sub-tab of this folder, except onto itself.
  const canDrop =
    fromFolder(drag, ctx.workspace.key) &&
    !(drag?.kind === 'pane' && drag.pane === terminalKey) &&
    !(drag?.kind === 'subtab' && drag.subTab === ctx.subTab.key)

  return (
    <div
      className={`pane ${active && ctx.multi ? 'active' : ''}`}
      data-terminal={terminalKey}
      data-active={active}
      onMouseDown={() => {
        focusTerminal(terminalKey)
        getTerminal(terminalKey)?.focus()
      }}
    >
      {ctx.multi && (
        <div
          className={`pane-header ${colors ? 'colored' : ''}`}
          style={colors ? { backgroundColor: colors.background, color: colors.text } : undefined}
          draggable
          title="Drag onto another pane to re-dock, or onto the tab row to make it a tab"
          onDragStart={(e) =>
            startDrag(e, {
              kind: 'pane',
              workspace: ctx.workspace.key,
              subTab: ctx.subTab.key,
              pane: terminalKey
            })
          }
          onDragEnd={endDrag}
          onContextMenu={(e) => {
            e.preventDefault()
            toggleTabSettings({
              kind: 'terminal',
              terminal: terminalKey,
              anchor: e.currentTarget.getBoundingClientRect()
            })
          }}
        >
          <span className={`status-dot ${dotStatus(terminal)}`} />
          <span className="pane-title">{terminal.title}</span>
          {otherFolder && (
            <span className="pane-folder" title={terminal.cwd}>
              {otherFolder}
            </span>
          )}
          {terminal.termTitle && <span className="pane-subtitle">{terminal.termTitle}</span>}
          <button
            className="pane-close pane-settings"
            aria-label={`Settings for ${terminal.title}`}
            title="Title and color"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) =>
              toggleTabSettings({
                kind: 'terminal',
                terminal: terminalKey,
                anchor: tabAnchor(e, '.pane-header')
              })
            }
          >
            ⚙
          </button>
          <button
            className="pane-close"
            aria-label={`Close ${terminal.title}`}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => void closeTerminal(terminalKey)}
          >
            ×
          </button>
        </div>
      )}
      <div className="pane-body">
        <TerminalView terminal={terminal} visible={ctx.visible} />
        {canDrop && (
          <DropZone
            onDrop={(side) => {
              useStore.getState().dockAt(drag, ctx.workspace.key, ctx.subTab.key, terminalKey, side)
              endDrag()
            }}
          />
        )}
      </div>
    </div>
  )
}

function DropZone({ onDrop }: { onDrop(side: Side): void }): React.JSX.Element {
  const [side, setSide] = useState<Side | null>(null)
  const sideOf = (e: React.DragEvent): Side => {
    const r = e.currentTarget.getBoundingClientRect()
    return sideAt((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height)
  }
  return (
    <div
      className="drop-zone"
      onDragOver={(e) => {
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setSide(sideOf(e))
      }}
      onDragLeave={() => setSide(null)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onDrop(sideOf(e))
      }}
    >
      {side && <div className={`drop-preview drop-${side}`} />}
    </div>
  )
}
