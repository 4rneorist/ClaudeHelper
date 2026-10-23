import { useEffect, useRef, useState } from 'react'
import { SOUND_NAMES, type Settings, type SoundName, type ThemeSetting } from '../../../shared/ipc'
import { playSound, SOUND_LABELS } from '../sounds'
import { useStore } from '../store'

/** Choices for the reminder while a session keeps asking, in minutes; 0 = never. */
const REMINDER_CHOICES = [0, 2, 5, 10, 15, 30]

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
    const {
      claudePath,
      fontSize,
      theme,
      experimentalConptyDll,
      restoreSession,
      notifyWhenWaiting,
      soundOnAttention,
      finishedSound,
      askingSound,
      soundVolume,
      reminderMinutes
    } = draft
    await updateSettings({
      claudePath,
      fontSize,
      theme,
      experimentalConptyDll,
      restoreSession,
      notifyWhenWaiting,
      soundOnAttention,
      finishedSound,
      askingSound,
      soundVolume,
      reminderMinutes
    })
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

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.notifyWhenWaiting}
          onChange={(e) => setDraft({ ...draft, notifyWhenWaiting: e.target.checked })}
        />
        <span>
          Notify me when a session needs me
          <small className="muted">
            {' '}
            — Claude finished or waits for an answer while the app is in the background
          </small>
        </span>
      </label>

      <label className="field checkbox">
        <input
          type="checkbox"
          checked={draft.soundOnAttention}
          onChange={(e) => setDraft({ ...draft, soundOnAttention: e.target.checked })}
        />
        <span>
          Play a sound when a session finishes or needs me
          <small className="muted">
            {' '}
            — a different one for each, also for the session you are looking at
          </small>
        </span>
      </label>

      <fieldset className="field sounds" disabled={!draft.soundOnAttention}>
        <SoundPicker
          label="When a session finishes"
          value={draft.finishedSound}
          volume={draft.soundVolume}
          onChange={(finishedSound) => setDraft({ ...draft, finishedSound })}
        />
        <SoundPicker
          label="When a session needs your answer"
          value={draft.askingSound}
          volume={draft.soundVolume}
          onChange={(askingSound) => setDraft({ ...draft, askingSound })}
        />
        <label className="sound-row">
          <span>Volume</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={draft.soundVolume}
            onChange={(e) => setDraft({ ...draft, soundVolume: Number(e.target.value) })}
          />
          <span className="muted">{draft.soundVolume}%</span>
        </label>
      </fieldset>

      <label className="field">
        <span>Remind me while a session keeps asking for my answer</span>
        <select
          value={draft.reminderMinutes}
          onChange={(e) => setDraft({ ...draft, reminderMinutes: Number(e.target.value) })}
        >
          {REMINDER_CHOICES.map((m) => (
            <option key={m} value={m}>
              {m === 0 ? 'Never' : `Every ${m} minutes`}
            </option>
          ))}
        </select>
        <small className="muted">
          At most 3 times, until you look at it. Muted sessions and Do not disturb are skipped.
        </small>
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

/** A sound for one kind of call, with a button to hear it at the chosen volume. */
function SoundPicker({
  label,
  value,
  volume,
  onChange
}: {
  label: string
  value: SoundName
  volume: number
  onChange(name: SoundName): void
}): React.JSX.Element {
  return (
    <div className="sound-row">
      <span>{label}</span>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value as SoundName)}
      >
        {SOUND_NAMES.map((name) => (
          <option key={name} value={name}>
            {SOUND_LABELS[name]}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="secondary play"
        aria-label={`Play ${SOUND_LABELS[value]}`}
        title="Play"
        onClick={() => playSound(value, volume)}
      >
        ▶
      </button>
    </div>
  )
}
