import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { folderName } from '../../../shared/paths'
import { MAX_TITLE_LENGTH } from '../../../shared/uiState'
import { focusActiveTerminal } from '../actions'
import { pairOf, useStore, workspaceTitle } from '../store'
import { findFolderColor, TAB_COLORS } from '../tabColors'
import { isFolderMuted } from '../waiting'

/** The open ⚙ popover, if any: a folder's or a terminal's title and color. */
export function TabSettings(): React.JSX.Element | null {
  const target = useStore((s) => s.tabSettings)
  if (!target) return null
  return target.kind === 'folder' ? (
    <FolderSettings key={target.workspace} workspace={target.workspace} anchor={target.anchor} />
  ) : (
    <TerminalSettings key={target.terminal} terminal={target.terminal} anchor={target.anchor} />
  )
}

function FolderSettings({
  workspace,
  anchor
}: {
  workspace: string
  anchor: DOMRect
}): React.JSX.Element | null {
  const ws = useStore((s) => s.workspaces.find((w) => w.key === workspace))
  const settings = useStore((s) => s.settings)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const workspaces = useStore((s) => s.workspaces)
  const setFolderTitle = useStore((s) => s.setFolderTitle)
  const setFolderColor = useStore((s) => s.setFolderColor)
  const joinWorkspace = useStore((s) => s.joinWorkspace)
  const setFolderMuted = useStore((s) => s.setFolderMuted)
  const muted = useStore((s) => (ws?.cwd ? isFolderMuted(s, ws.cwd) : false))
  const close = useStore((s) => s.setTabSettings)
  if (!ws?.cwd) return null
  const cwd = ws.cwd
  const name = folderName(cwd)
  const partner = pairOf(workspaces, workspace).find((k) => k !== workspace) ?? ''
  // Other open folders, unless they are already joined to a third one.
  const candidates = workspaces.filter(
    (w) =>
      w.kind === 'folder' &&
      w.key !== workspace &&
      (w.key === partner || pairOf(workspaces, w.key).length === 1)
  )

  return (
    <SettingsPopover
      label={`Settings for ${workspaceTitle(ws, settings?.folderTitles, platform)}`}
      anchor={anchor}
      title={workspaceTitle(ws, settings?.folderTitles, platform)}
      defaultTitle={name}
      color={findFolderColor(settings?.folderColors, cwd, platform)}
      // The folder's own name is the default, so it isn't stored as a custom title.
      onTitle={(title) => void setFolderTitle(cwd, title.trim() === name ? null : title)}
      onColor={(color) => void setFolderColor(cwd, color)}
      onClose={() => close(null)}
    >
      <MuteSwitch
        muted={muted}
        label="Mute this folder"
        onChange={(on) => void setFolderMuted(cwd, on)}
      />
      <label className="tab-settings-label" htmlFor="tab-settings-join">
        Join sessions to
      </label>
      <select
        id="tab-settings-join"
        className="tab-settings-join"
        value={partner}
        disabled={candidates.length === 0}
        onChange={(e) => {
          joinWorkspace(workspace, e.target.value || null)
          // The tab may have moved next to its partner, away from where this popover points.
          close(null)
        }}
      >
        <option value="">{candidates.length ? 'None' : 'No other folder open'}</option>
        {candidates.map((w) => (
          <option key={w.key} value={w.key}>
            {workspaceTitle(w, settings?.folderTitles, platform)}
          </option>
        ))}
      </select>
      <p className="tab-settings-hint">
        {partner && pairOf(workspaces, workspace)[0] === workspace
          ? 'Side by side, this folder on the left.'
          : 'Shows both folders side by side, this one on the right.'}
      </p>
    </SettingsPopover>
  )
}

function TerminalSettings({
  terminal,
  anchor
}: {
  terminal: string
  anchor: DOMRect
}): React.JSX.Element | null {
  const t = useStore((s) => s.terminals[terminal])
  const updateTerminal = useStore((s) => s.updateTerminal)
  const close = useStore((s) => s.setTabSettings)
  if (!t) return null

  return (
    <SettingsPopover
      label={`Settings for ${t.title}`}
      anchor={anchor}
      title={t.title}
      color={t.color ?? null}
      onTitle={(title) => updateTerminal(terminal, { title })}
      onColor={(color) => updateTerminal(terminal, { color })}
      onClose={() => close(null)}
    >
      <MuteSwitch
        muted={!!t.muted}
        label="Mute this session"
        onChange={(on) => updateTerminal(terminal, { muted: on })}
      />
    </SettingsPopover>
  )
}

/** Muting keeps the dot and the list entry, without sound, toast or OS notification. */
function MuteSwitch({
  muted,
  label,
  onChange
}: {
  muted: boolean
  label: string
  onChange(muted: boolean): void
}): React.JSX.Element {
  return (
    <label className="tab-settings-mute">
      <input type="checkbox" checked={muted} onChange={(e) => onChange(e.target.checked)} />
      <span>
        {label}
        <small>No sounds, toasts or notifications</small>
      </span>
    </label>
  )
}

interface PopoverProps {
  label: string
  /** The tab it opens below. */
  anchor: DOMRect
  title: string
  /** What a blank title stands for, with a Reset button; without it a blank title is ignored. */
  defaultTitle?: string
  color: string | null
  onTitle(title: string): void
  onColor(color: string | null): void
  onClose(): void
  children?: React.ReactNode
}

/**
 * Title field, swatches, a custom color and "No color". Changes apply as you make them; Esc
 * undoes the title and color changes, Enter or a click outside keeps them.
 */
function SettingsPopover({
  label,
  anchor,
  title,
  defaultTitle,
  color,
  onTitle,
  onColor,
  onClose,
  children
}: PopoverProps): React.JSX.Element {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const [draft, setDraft] = useState(title)
  const ref = useRef<HTMLDivElement>(null)
  const customRef = useRef<HTMLInputElement>(null)
  // What to go back to on Esc; and the latest callbacks for the listeners set up once below.
  const initial = useRef({ title, color })
  const latest = useRef({ color, onTitle, onColor, onClose })
  useLayoutEffect(() => {
    latest.current = { color, onTitle, onColor, onClose }
  })

  useLayoutEffect(() => {
    if (!ref.current) return
    const width = ref.current.offsetWidth
    setPos({
      top: anchor.bottom + 4,
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    })
  }, [anchor])

  // Only once it is placed: until then it is visibility: hidden, which can't take the focus.
  const placed = pos !== null
  useLayoutEffect(() => {
    if (!placed) return
    const field = ref.current?.querySelector<HTMLInputElement>('.tab-settings-title')
    field?.focus()
    field?.select()
  }, [placed])

  useEffect(() => {
    // No close on window blur, unlike menus: the OS color dialog of "Custom…" takes the focus.
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) latest.current.onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape') return
      const { onTitle, onColor, onClose } = latest.current
      onTitle(initial.current.title)
      if (latest.current.color !== initial.current.color) onColor(initial.current.color)
      onClose()
      focusActiveTerminal()
    }
    // "change" fires once the color dialog closes; React's onChange would fire on every drag step.
    const input = customRef.current
    const onCustom = (): void => {
      if (input) latest.current.onColor(input.value)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    input?.addEventListener('change', onCustom)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      input?.removeEventListener('change', onCustom)
    }
  }, [])

  const changeTitle = (value: string): void => {
    setDraft(value)
    onTitle(value.trim() || defaultTitle || '')
  }

  return (
    <div
      ref={ref}
      className="color-picker tab-settings"
      role="dialog"
      aria-label={label}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <label className="tab-settings-label" htmlFor="tab-settings-title">
        Title
      </label>
      <div className="tab-settings-row">
        <input
          id="tab-settings-title"
          className="tab-settings-title"
          type="text"
          value={draft}
          placeholder={defaultTitle}
          maxLength={MAX_TITLE_LENGTH}
          spellCheck={false}
          onChange={(e) => changeTitle(e.target.value)}
          onKeyDown={(e) => {
            // Typing here mustn't trigger app shortcuts such as Ctrl+Tab.
            if (e.key !== 'Escape') e.stopPropagation()
            if (e.key !== 'Enter') return
            e.preventDefault()
            onClose()
            focusActiveTerminal()
          }}
        />
        {defaultTitle !== undefined && (
          <button
            className="color-picker-none"
            title={`Use the folder's name, ${defaultTitle}`}
            disabled={title === defaultTitle}
            onClick={() => changeTitle(defaultTitle)}
          >
            Reset
          </button>
        )}
      </div>

      <span className="tab-settings-label">Color</span>
      <div className="color-picker-swatches">
        {TAB_COLORS.map((c) => (
          <button
            key={c.value}
            className="swatch"
            style={{ backgroundColor: c.value }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={color === c.value}
            onClick={() => onColor(c.value)}
          />
        ))}
      </div>
      <div className="color-picker-row">
        <label className="color-picker-custom">
          <input
            ref={customRef}
            type="color"
            aria-label="Custom color"
            defaultValue={color ?? TAB_COLORS[5].value}
          />
          Custom…
        </label>
        <button className="color-picker-none" disabled={!color} onClick={() => onColor(null)}>
          No color
        </button>
      </div>
      {children}
    </div>
  )
}
