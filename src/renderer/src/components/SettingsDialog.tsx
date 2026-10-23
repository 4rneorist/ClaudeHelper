import { useEffect, useRef, useState } from 'react'
import type { Settings, ThemeSetting } from '../../../shared/ipc'
import { useStore } from '../store'

export function SettingsDialog(): React.JSX.Element {
  const open = useStore((s) => s.settingsOpen)
  const settings = useStore((s) => s.settings)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const close = (): void => setSettingsOpen(false)

  return (
    <dialog ref={dialogRef} className="settings" onClose={close} aria-labelledby="settings-title">
      {/* Mounted per opening, so the draft always starts from the current settings. */}
      {open && settings && <SettingsForm initial={settings} onDone={close} />}
    </dialog>
  )
}

function SettingsForm({
  initial,
  onDone
}: {
  initial: Settings
  onDone(): void
}): React.JSX.Element {
  const claude = useStore((s) => s.claude)
  const appInfo = useStore((s) => s.appInfo)
  const updateSettings = useStore((s) => s.updateSettings)
  const [draft, setDraft] = useState(initial)

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    const { claudePath, fontSize, theme, experimentalConptyDll, restoreSession } = draft
    await updateSettings({ claudePath, fontSize, theme, experimentalConptyDll, restoreSession })
    onDone()
  }

  const browse = async (): Promise<void> => {
    const path = await window.api.pickExecutable()
    if (path) setDraft({ ...draft, claudePath: path })
  }

  return (
    <form onSubmit={(e) => void save(e)}>
      <h2 id="settings-title">Settings</h2>

      <label className="field">
        <span>Claude executable</span>
        <div className="row">
          <input
            type="text"
            value={draft.claudePath}
            placeholder={
              claude?.found && !claude.explicit ? `Auto-detected: ${claude.path}` : 'Auto-detect'
            }
            onChange={(e) => setDraft({ ...draft, claudePath: e.target.value })}
            spellCheck={false}
          />
          <button type="button" className="secondary" onClick={() => void browse()}>
            Browse…
          </button>
        </div>
        <small className="muted">Leave empty to find claude on PATH automatically.</small>
      </label>

      <label className="field">
        <span>Font size</span>
        <input
          type="number"
          min={8}
          max={32}
          value={draft.fontSize}
          onChange={(e) => setDraft({ ...draft, fontSize: Number(e.target.value) })}
        />
        <small className="muted">Ctrl/Cmd + and − also change it, Ctrl/Cmd 0 resets.</small>
      </label>

      <label className="field">
        <span>Theme</span>
        <select
          value={draft.theme}
          onChange={(e) => setDraft({ ...draft, theme: e.target.value as ThemeSetting })}
        >
          <option value="system">Follow system</option>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.restoreSession}
          onChange={(e) => setDraft({ ...draft, restoreSession: e.target.checked })}
        />
        <span>
          Reopen folders, tabs and splits from last time
          <small className="muted"> — Claude tabs resume their conversations</small>
        </span>
      </label>

      {appInfo?.platform === 'win32' && (
        <label className="field checkbox">
          <input
            type="checkbox"
            checked={draft.experimentalConptyDll}
            onChange={(e) => setDraft({ ...draft, experimentalConptyDll: e.target.checked })}
          />
          <span>
            Experimental: use the newer console engine bundled from Windows Terminal (OpenConsole)
            instead of the one built into Windows
            <small className="muted">
              {' '}
              — applies to new sessions; known to occasionally crash the app on exit
            </small>
          </span>
        </label>
      )}

      <div className="row end">
        <button type="button" className="secondary" onClick={onDone}>
          Cancel
        </button>
        <button type="submit" className="primary">
          Save
        </button>
      </div>
    </form>
  )
}
