import { jumpToWaiting } from '../actions'
import { MODE_LABELS } from '../constants'
import { activeTerminalKey, dotStatus, useStore } from '../store'
import type { ClaudeActivity } from '../terminal/claudeActivity'
import { waitingTerminals } from '../waiting'

const DOING: Record<ClaudeActivity, string> = {
  working: 'working',
  idle: 'idle',
  asking: 'needs your answer'
}

export function StatusBar(): React.JSX.Element {
  const terminal = useStore((s) => {
    const key = activeTerminalKey(s)
    return key ? s.terminals[key] : undefined
  })
  const claude = useStore((s) => s.claude)
  const git = useStore((s) => {
    const key = activeTerminalKey(s)
    const cwd = key ? s.terminals[key]?.cwd : undefined
    return cwd ? s.gitInfo[cwd] : undefined
  })

  if (!terminal) {
    return (
      <footer className="statusbar">
        <span className="muted">{claude?.found ? claude.path : 'claude not found'}</span>
        <WaitingSummary />
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
  // For Claude, what it is doing (read from its window title and screen); other programs just run.
  const doing = terminal.activity ? DOING[terminal.activity] : 'running'
  const state =
    terminal.status === 'running'
      ? `${doing} · pid ${terminal.session?.pid}`
      : terminal.status === 'exited'
        ? `exited (${terminal.exitCode})`
        : terminal.status

  return (
    <footer className="statusbar">
      <span className="status-cwd" title={terminal.cwd}>
        {terminal.cwd}
      </span>
      <span>{kind}</span>
      {git && (
        <span
          className="status-branch"
          title={git.dirty ? 'Branch, with uncommitted changes' : 'Branch'}
        >
          ⎇ {git.branch}
          {git.dirty && '*'}
        </span>
      )}
      <span className={`status-state ${dotStatus(terminal)}`}>{state}</span>
      {terminal.termTitle && (
        <span className="status-title muted" title={terminal.termTitle}>
          {terminal.termTitle}
        </span>
      )}
      <WaitingSummary />
    </footer>
  )
}

/** "● 1 needs your answer · ● 2 finished" at the right; each part jumps to the next of its kind. */
function WaitingSummary(): React.JSX.Element | null {
  const asking = useStore((s) => waitingTerminals(s, 'asking').length)
  const finished = useStore((s) => waitingTerminals(s, 'finished').length)
  const shortcut = useStore((s) => (s.appInfo?.platform === 'darwin' ? '⌘⇧J' : 'Ctrl+Shift+J'))
  if (!asking && !finished) return null
  return (
    <span className="status-waiting">
      {asking > 0 && (
        <button
          className="status-wait asking"
          title={`Go to the next session that needs your answer (${shortcut} for any)`}
          onClick={() => jumpToWaiting('asking')}
        >
          <span className="status-dot asking" />
          {asking} {asking === 1 ? 'needs' : 'need'} your answer
        </button>
      )}
      {finished > 0 && (
        <button
          className="status-wait finished"
          title={`Go to the next session that finished (${shortcut} for any)`}
          onClick={() => jumpToWaiting('finished')}
        >
          <span className="status-dot idle" />
          {finished} finished
        </button>
      )}
    </span>
  )
}
