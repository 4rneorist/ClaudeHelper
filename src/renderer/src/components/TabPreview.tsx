import { useEffect, useState } from 'react'
import { dotStatus, useStore } from '../store'
import { getTerminal } from '../terminal/TerminalSession'

/** Lines of the terminal shown. */
const PREVIEW_LINES = 12
const WIDTH = 460

const DOING: Record<string, string> = {
  working: 'working',
  idle: 'idle',
  asking: 'needs your answer',
  running: 'running',
  starting: 'starting',
  exited: 'exited',
  error: 'failed to start'
}

/**
 * The card a sub-tab shows on hover: what the session is, what it is doing, and the last lines of
 * its screen, refreshed while shown. It takes no clicks: the tab under it keeps working as before.
 */
export function TabPreview({
  terminal: key,
  anchor,
  panes
}: {
  terminal: string
  anchor: DOMRect
  panes: number
}): React.JSX.Element | null {
  const t = useStore((s) => s.terminals[key])
  const [lines, setLines] = useState<string[]>(() => read(key))

  useEffect(() => {
    const timer = setInterval(() => setLines(read(key)), 1000)
    return () => clearInterval(timer)
  }, [key])

  if (!t) return null
  const status = dotStatus(t)
  return (
    <div
      className="tab-preview"
      role="tooltip"
      style={{
        top: anchor.bottom + 6,
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8)),
        width: WIDTH
      }}
    >
      <div className="tab-preview-head">
        <span className={`status-dot ${status}`} />
        <strong>{t.title}</strong>
        <span className={`tab-preview-doing ${status}`}>{DOING[status]}</span>
      </div>
      {t.termTitle && <div className="tab-preview-topic">{t.termTitle}</div>}
      {lines.length > 0 && <pre className="tab-preview-screen">{lines.join('\n')}</pre>}
      <div className="tab-preview-hint">
        {panes > 1 && `${panes} panes · `}Drag to reorder · ⚙ or right-click: title and color
      </div>
    </div>
  )
}

function read(key: string): string[] {
  return getTerminal(key)?.previewLines(PREVIEW_LINES) ?? []
}
