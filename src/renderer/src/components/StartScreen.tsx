import { useEffect, useState } from 'react'
import type { LaunchMode, PastSession, TerminalSpec } from '../../../shared/ipc'
import { folderName } from '../../../shared/paths'
import { formatAgo, INSTALL_HINTS, MODE_LABELS } from '../constants'
import { useStore, type Workspace } from '../store'

const SESSIONS_PER_FOLDER = 5

export function StartScreen({ workspace }: { workspace: Workspace }): React.JSX.Element {
  const [mode, setMode] = useState<LaunchMode>('new')
  const [dragging, setDragging] = useState(false)
  const settings = useStore((s) => s.settings)
  const claude = useStore((s) => s.claude)
  const appInfo = useStore((s) => s.appInfo)
  const openInFolder = useStore((s) => s.openInFolder)
  const updateSettings = useStore((s) => s.updateSettings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)

  const open = (folder: string, spec?: TerminalSpec, title?: string): void =>
    openInFolder(folder, spec ?? { kind: 'claude', mode }, { fromWorkspace: workspace.key, title })

  const pickFolder = async (): Promise<void> => {
    const folder = await window.api.pickFolder()
    if (folder) open(folder)
  }

  const chooseExecutable = async (): Promise<void> => {
    const path = await window.api.pickExecutable()
    if (path) await updateSettings({ claudePath: path })
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (!file) return
    const path = window.api.getPathForFile(file)
    if (path) open(path) // main validates that it is a folder
  }

  const recent = settings?.recentFolders ?? []

  return (
    <div
      className={`start-screen ${dragging ? 'dragging' : ''}`}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div className="start-card">
        <h1>Start a Claude session</h1>
        <p className="muted">Pick a folder and Claude Code starts there, in a real terminal.</p>

        {claude && !claude.found && (
          <div className="notice" role="alert">
            <strong>Claude Code CLI not found.</strong>
            {claude.explicit ? (
              <p>
                The configured path does not exist: <code>{claude.path}</code>
              </p>
            ) : (
              <p>
                Install it with <code>{INSTALL_HINTS[appInfo?.platform ?? 'linux']}</code>, then
                restart this app, or point to the executable yourself.
              </p>
            )}
            <div className="row">
              <button onClick={() => void chooseExecutable()}>Choose executable…</button>
              <button className="secondary" onClick={() => setSettingsOpen(true)}>
                Settings
              </button>
            </div>
          </div>
        )}

        <fieldset className="modes">
          <legend>Conversation</legend>
          {(Object.keys(MODE_LABELS) as LaunchMode[]).map((m) => (
            <label key={m} className={mode === m ? 'selected' : ''}>
              <input
                type="radio"
                name={`mode-${workspace.key}`}
                value={m}
                checked={mode === m}
                onChange={() => setMode(m)}
              />
              {MODE_LABELS[m]}
            </label>
          ))}
        </fieldset>

        <button className="primary" onClick={() => void pickFolder()}>
          Open folder…
        </button>
        <p className="muted small">…or drop a folder anywhere on this window.</p>

        {recent.length > 0 && (
          <section className="recent">
            <h2>Recent folders</h2>
            <ul>
              {recent.map((folder) => (
                <RecentFolder key={folder} folder={folder} onOpen={open} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}

function RecentFolder({
  folder,
  onOpen
}: {
  folder: string
  onOpen(folder: string, spec?: TerminalSpec, title?: string): void
}): React.JSX.Element {
  const setSettings = useStore((s) => s.setSettings)
  const [expanded, setExpanded] = useState(false)
  const [sessions, setSessions] = useState<PastSession[] | null>(null)

  useEffect(() => {
    if (!expanded) return
    let cancelled = false
    void window.api.listPastSessions(folder, SESSIONS_PER_FOLDER).then((list) => {
      if (!cancelled) setSessions(list)
    })
    return () => {
      cancelled = true
    }
  }, [expanded, folder])

  const listId = `sessions-${folder.replace(/[^a-zA-Z0-9]/g, '-')}`

  return (
    <li className="recent-item">
      <div className="recent-row">
        <button
          className={`recent-toggle ${expanded ? 'expanded' : ''}`}
          aria-expanded={expanded}
          aria-controls={listId}
          aria-label={`${expanded ? 'Hide' : 'Show'} recent sessions in ${folderName(folder)}`}
          title={expanded ? 'Hide recent sessions' : 'Show recent sessions'}
          onClick={() => setExpanded((x) => !x)}
        >
          ›
        </button>
        <button className="recent-open" title={folder} onClick={() => onOpen(folder)}>
          <span className="recent-name">{folderName(folder)}</span>
          <span className="recent-path">{folder}</span>
        </button>
        <button
          className="recent-remove"
          aria-label={`Remove ${folder} from recent folders`}
          title="Remove from list"
          onClick={async () => setSettings(await window.api.removeRecent(folder))}
        >
          ×
        </button>
      </div>
      {expanded && (
        <ul
          className="sessions"
          id={listId}
          aria-label={`Recent sessions in ${folderName(folder)}`}
        >
          {sessions === null && <li className="sessions-note muted">Loading…</li>}
          {sessions?.length === 0 && <li className="sessions-note muted">No previous sessions</li>}
          {sessions?.map((s) => (
            <li key={s.id}>
              <button
                className="session"
                title={s.firstPrompt ?? s.title}
                onClick={() =>
                  onOpen(
                    folder,
                    { kind: 'claude', mode: 'resume', resumeId: s.id },
                    shortTitle(s.title)
                  )
                }
              >
                <span className="session-title">{s.title}</span>
                <span className="session-when">{formatAgo(s.lastActive)}</span>
                {s.firstPrompt && s.firstPrompt !== s.title && (
                  <span className="session-prompt">{s.firstPrompt}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function shortTitle(title: string): string {
  return title.length > 28 ? `${title.slice(0, 27)}…` : title
}
