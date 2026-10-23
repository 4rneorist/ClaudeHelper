import { MODE_LABELS } from '../constants'
import { activeTerminalKey, useStore } from '../store'

export function StatusBar(): React.JSX.Element {
  const terminal = useStore((s) => {
    const key = activeTerminalKey(s)
    return key ? s.terminals[key] : undefined
  })
  const claude = useStore((s) => s.claude)

  if (!terminal) {
    return (
      <footer className="statusbar">
        <span className="muted">{claude?.found ? claude.path : 'claude not found'}</span>
      </footer>
    )
  }

  const { spec } = terminal
  const kind =
    spec.kind === 'shell'
      ? terminal.title
      : spec.resumeId
        ? `Resumed ${terminal.title}`
        : MODE_LABELS[spec.mode]
  const state =
    terminal.status === 'running'
      ? `running · pid ${terminal.session?.pid}`
      : terminal.status === 'exited'
        ? `exited (${terminal.exitCode})`
        : terminal.status

  return (
    <footer className="statusbar">
      <span className="status-cwd" title={terminal.cwd}>
        {terminal.cwd}
      </span>
      <span>{kind}</span>
      <span className={`status-state ${terminal.status}`}>{state}</span>
      {terminal.termTitle && (
        <span className="status-title muted" title={terminal.termTitle}>
          {terminal.termTitle}
        </span>
      )}
    </footer>
  )
}
