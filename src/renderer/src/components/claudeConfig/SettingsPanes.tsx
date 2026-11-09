import { useCallback, useMemo, useState } from 'react'
import {
  ENV_NAME,
  PERMISSION_LISTS,
  PERMISSION_MODES,
  type HookScope,
  type SettingsFile,
  type SettingsKey
} from '../../../../shared/claudeConfig'
import { HOOK_SCOPE_FILES, HOOK_SCOPE_LABELS } from '../../claudeConfig'
import { useDirty, useGuard, useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const list = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []

/** The three settings files on the left, and an editor for the one picked. */
function SettingsFilesPane({
  folder,
  summary,
  intro,
  editor
}: {
  folder: string | null
  summary(file: SettingsFile): string
  intro: React.ReactNode
  editor(file: SettingsFile, onSaved: () => void): React.ReactNode
}): React.JSX.Element {
  const guard = useGuard()
  const load = useCallback(() => window.api.readSettingsFiles(folder), [folder])
  const { data: files, reload } = useLoad(load)
  const [selected, setSelected] = useState<HookScope | null>(null)
  const current = files?.find((f) => f.scope === selected)

  const choose = async (scope: HookScope): Promise<void> => {
    if (scope === selected) return
    if (await guard.leave()) setSelected(scope)
  }

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <span className="muted small">Settings files</span>
          <span className="cc-grow" />
          <button
            className="icon-button"
            aria-label="Reload"
            title="Read them again"
            onClick={() => void guard.leave().then((ok) => ok && reload())}
          >
            ↻
          </button>
        </div>
        <div className="cc-list-scroll">
          {!files && <Loading text="Reading…" />}
          <ul className="cc-rows">
            {(files ?? []).map((f) => (
              <li key={f.scope}>
                <button
                  className={`cc-row${f.scope === selected ? ' selected' : ''}`}
                  onClick={() => void choose(f.scope)}
                  title={f.path}
                >
                  <span className="cc-row-name">
                    {HOOK_SCOPE_LABELS[f.scope]}
                    {f.error && (
                      <span className="cc-warn" title={f.error}>
                        ⚠
                      </span>
                    )}
                  </span>
                  <span className="cc-row-desc">{f.error ? "Can't be read" : summary(f)}</span>
                </button>
              </li>
            ))}
          </ul>
          {!folder && <p className="muted cc-empty">Open a folder to see its own settings too.</p>}
        </div>
      </aside>
      <section className="cc-detail">
        {current ? (
          current.error ? (
            <div className="cc-intro">
              <p className="field-error">
                {current.path} can&apos;t be read, so it is left alone: {current.error}
              </p>
            </div>
          ) : (
            <div className="cc-editor" key={current.scope}>
              {editor(current, reload)}
            </div>
          )
        ) : (
          <div className="cc-intro">{intro}</div>
        )}
      </section>
    </div>
  )
}

/** The head of a settings editor: which file it is. */
function FileHead({ file }: { file: SettingsFile }): React.JSX.Element {
  return (
    <header className="cc-editor-head">
      <div>
        <h3>{HOOK_SCOPE_LABELS[file.scope]}</h3>
        <small className="muted cc-path" title={file.path}>
          {HOOK_SCOPE_FILES[file.scope]}
        </small>
      </div>
    </header>
  )
}

/** Saves some settings of a file, if they are still as they were read. */
async function patch(
  folder: string | null,
  file: SettingsFile,
  set: Partial<Record<SettingsKey, unknown>>
): Promise<Status> {
  const before = Object.fromEntries(
    Object.keys(set).map((k) => [k, file.values[k as SettingsKey] ?? null])
  )
  const res = await window.api.patchSettings({
    ...(folder ? { folder } : {}),
    scope: file.scope,
    set,
    before
  })
  return res.ok ? { ok: true, text: 'Saved' } : { ok: false, text: res.error }
}

/** A list of strings: each with a ✕, and a field to add one. */
function StringList({
  title,
  hint,
  items,
  placeholder,
  onChange
}: {
  title: string
  hint: string
  items: string[]
  placeholder: string
  onChange(items: string[]): void
}): React.JSX.Element {
  const [draft, setDraft] = useState('')
  const add = (): void => {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setDraft('')
  }
  return (
    <section className="cc-strings">
      <h4>
        {title} <span className="muted">{hint}</span>
      </h4>
      {items.length > 0 && (
        <ul>
          {items.map((item) => (
            <li key={item}>
              <code>{item}</code>
              <button
                type="button"
                className="icon-button"
                aria-label={`Remove ${item}`}
                onClick={() => onChange(items.filter((i) => i !== item))}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="row">
        <input
          type="text"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
          spellCheck={false}
        />
        <button type="button" className="secondary" onClick={add} disabled={!draft.trim()}>
          Add
        </button>
      </div>
    </section>
  )
}

// ---- permissions ----

const MODE_LABELS: Record<string, string> = {
  default: 'Ask the first time each tool is used',
  acceptEdits: 'Accept file edits without asking',
  plan: 'Plan only: look, but change nothing',
  auto: 'Auto: a safety check decides',
  dontAsk: "Don't ask: only what's allowed below runs",
  bypassPermissions: 'Bypass: never ask (risky)'
}

const LISTS: { key: (typeof PERMISSION_LISTS)[number]; title: string; hint: string }[] = [
  { key: 'allow', title: 'Allow', hint: 'runs without asking' },
  { key: 'ask', title: 'Ask', hint: 'always asks first' },
  { key: 'deny', title: 'Deny', hint: 'never runs' }
]

function permissionCounts(file: SettingsFile): string {
  const p = isObject(file.values.permissions) ? file.values.permissions : {}
  const parts = LISTS.map((l) => [list(p[l.key]).length, l.title.toLowerCase()] as const)
    .filter(([n]) => n > 0)
    .map(([n, what]) => `${n} ${what}`)
  if (typeof p.defaultMode === 'string') parts.unshift(p.defaultMode)
  return parts.join(' · ') || 'Nothing set'
}

export function PermissionsPane({ folder }: { folder: string | null }): React.JSX.Element {
  return (
    <SettingsFilesPane
      folder={folder}
      summary={permissionCounts}
      editor={(file, onSaved) => (
        <PermissionsEditor file={file} folder={folder} onSaved={onSaved} />
      )}
      intro={
        <>
          <h3>Permissions</h3>
          <p>
            Rules for what Claude may do without asking. A rule names a tool, and maybe what it
            works on: <code>Bash(npm run test:*)</code>, <code>Read(./.env)</code>,{' '}
            <code>Edit(src/**)</code>, <code>WebFetch(domain:github.com)</code>,{' '}
            <code>mcp__github</code>. Deny wins over ask, and ask over allow.
          </p>
          <p>
            Pick a file on the left: your <b>global</b> settings, the folder&apos;s
            <b> shared</b> ones (committed), or the folder&apos;s settings <b>only for you</b>. A
            folder&apos;s rules add to yours.
          </p>
          <DocsLink href="https://code.claude.com/docs/en/permissions">About permissions</DocsLink>
        </>
      }
    />
  )
}

function PermissionsEditor({
  file,
  folder,
  onSaved
}: {
  file: SettingsFile
  folder: string | null
  onSaved(): void
}): React.JSX.Element {
  const guard = useGuard()
  const original = useMemo(
    () => (isObject(file.values.permissions) ? file.values.permissions : {}),
    [file]
  )
  const [lists, setLists] = useState(() => ({
    allow: list(original.allow),
    ask: list(original.ask),
    deny: list(original.deny),
    additionalDirectories: list(original.additionalDirectories)
  }))
  const [mode, setMode] = useState(
    typeof original.defaultMode === 'string' ? original.defaultMode : ''
  )
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const built = useMemo(() => {
    const next: Json = { ...original }
    for (const [key, items] of Object.entries(lists)) {
      if (items.length) next[key] = items
      else delete next[key]
    }
    if (mode) next.defaultMode = mode
    else delete next.defaultMode
    return next
  }, [original, lists, mode])
  const dirty = JSON.stringify(built) !== JSON.stringify(original)
  useDirty(dirty)

  const save = async (): Promise<void> => {
    setBusy(true)
    const result = await patch(folder, file, {
      permissions: Object.keys(built).length ? built : null
    })
    setBusy(false)
    setStatus(result)
    if (result.ok) {
      guard.setDirty(false)
      onSaved()
    }
  }

  const ignored = file.scope !== 'user' && (mode === 'auto' || mode === 'bypassPermissions')
  return (
    <>
      <FileHead file={file} />
      <div className="cc-fields">
        <label className="field">
          <span>Mode when a session starts</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="">Not set here</option>
            {PERMISSION_MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
          {ignored && (
            <small className="field-error">
              Claude Code ignores this mode in a folder&apos;s settings; set it globally.
            </small>
          )}
        </label>
        {LISTS.map((l) => (
          <StringList
            key={l.key}
            title={l.title}
            hint={l.hint}
            items={lists[l.key]}
            placeholder={l.key === 'deny' ? 'e.g. Read(./.env)' : 'e.g. Bash(npm run test:*)'}
            onChange={(items) => setLists((s) => ({ ...s, [l.key]: items }))}
          />
        ))}
        <StringList
          title="More folders"
          hint="Claude may also work in these"
          items={lists.additionalDirectories}
          placeholder="e.g. ../shared-lib"
          onChange={(items) => setLists((s) => ({ ...s, additionalDirectories: items }))}
        />
      </div>
      <footer className="cc-editor-foot">
        <StatusLine status={status} />
        <span className="cc-grow" />
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty}
          onClick={() => void save()}
        >
          Save
        </button>
      </footer>
    </>
  )
}

// ---- model, output style, environment, status line ----

const MODELS = ['default', 'sonnet', 'opus', 'haiku', 'fable', 'opusplan', 'sonnet[1m]']
const BUILT_IN_STYLES = ['default', 'Explanatory', 'Learning', 'Concise', 'Proactive']

function generalSummary(file: SettingsFile): string {
  const v = file.values
  const parts = [
    typeof v.model === 'string' && `model ${v.model}`,
    typeof v.outputStyle === 'string' && `style ${v.outputStyle}`,
    isObject(v.env) && Object.keys(v.env).length > 0 && `${Object.keys(v.env).length} env`,
    isObject(v.statusLine) && 'status line'
  ].filter(Boolean)
  return parts.join(' · ') || 'Nothing set'
}

export function SettingsPane({ folder }: { folder: string | null }): React.JSX.Element {
  // Your own output styles can be picked too.
  const loadStyles = useCallback(() => window.api.listClaudeItems('outputStyle', folder), [folder])
  const { data: styles } = useLoad(loadStyles)
  const styleNames = [
    ...new Set((styles?.items ?? []).map((s) => s.title ?? s.name.split('/').pop()!))
  ]
  return (
    <SettingsFilesPane
      folder={folder}
      summary={generalSummary}
      editor={(file, onSaved) => (
        <GeneralEditor file={file} folder={folder} styles={styleNames} onSaved={onSaved} />
      )}
      intro={
        <>
          <h3>Settings</h3>
          <p>
            The model Claude starts with, its output style, environment variables for its sessions,
            and the command that draws its status line, in each settings file. A folder&apos;s
            settings win over your global ones, and <b>only me</b> over
            <b> shared</b>.
          </p>
          <p className="muted">Everything else in the file stays as it is.</p>
          <DocsLink href="https://code.claude.com/docs/en/settings">About settings</DocsLink>
        </>
      }
    />
  )
}

interface EnvRow {
  key: string
  value: string
}

function GeneralEditor({
  file,
  folder,
  styles,
  onSaved
}: {
  file: SettingsFile
  folder: string | null
  styles: string[]
  onSaved(): void
}): React.JSX.Element {
  const guard = useGuard()
  const v = file.values
  const statusLine = isObject(v.statusLine) ? v.statusLine : null
  const [model, setModel] = useState(typeof v.model === 'string' ? v.model : '')
  const [style, setStyle] = useState(typeof v.outputStyle === 'string' ? v.outputStyle : '')
  const [env, setEnv] = useState<EnvRow[]>(() =>
    Object.entries(isObject(v.env) ? v.env : {}).map(([key, value]) => ({
      key,
      value: String(value)
    }))
  )
  const [command, setCommand] = useState(
    typeof statusLine?.command === 'string' ? statusLine.command : ''
  )
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const envObject = Object.fromEntries(
    env.filter((r) => r.key.trim()).map((r) => [r.key.trim(), r.value])
  )
  const badEnv = env.find((r) => r.key.trim() && !ENV_NAME.test(r.key.trim()))
  // Only what changed is written.
  const set: Partial<Record<SettingsKey, unknown>> = {}
  if (model.trim() !== (typeof v.model === 'string' ? v.model : ''))
    set.model = model.trim() || null
  if (style !== (typeof v.outputStyle === 'string' ? v.outputStyle : ''))
    set.outputStyle = style || null
  if (JSON.stringify(envObject) !== JSON.stringify(isObject(v.env) ? v.env : {})) {
    set.env = Object.keys(envObject).length ? envObject : null
  }
  if (command.trim() !== (typeof statusLine?.command === 'string' ? statusLine.command : '')) {
    set.statusLine = command.trim()
      ? { ...statusLine, type: 'command', command: command.trim() }
      : null
  }
  const dirty = Object.keys(set).length > 0
  useDirty(dirty)

  const save = async (): Promise<void> => {
    if (badEnv) return
    setBusy(true)
    const result = await patch(folder, file, set)
    setBusy(false)
    setStatus(result)
    if (result.ok) {
      guard.setDirty(false)
      onSaved()
    }
  }

  const allStyles = [...new Set([...BUILT_IN_STYLES, ...styles, ...(style ? [style] : [])])]
  return (
    <>
      <FileHead file={file} />
      <div className="cc-fields">
        <div className="cc-row-fields">
          <label className="field">
            <span>Model</span>
            <input
              type="text"
              list="cc-models"
              value={model}
              placeholder="Not set here"
              onChange={(e) => setModel(e.target.value)}
              spellCheck={false}
            />
            <datalist id="cc-models">
              {MODELS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
            <small className="muted">An alias like opus, or a full model ID.</small>
          </label>
          <label className="field">
            <span>Output style</span>
            <select value={style} onChange={(e) => setStyle(e.target.value)}>
              <option value="">Not set here</option>
              {allStyles.map((s) => (
                <option key={s} value={s}>
                  {s === 'default' ? 'Default' : s}
                </option>
              ))}
            </select>
          </label>
        </div>

        <section className="cc-strings">
          <h4>
            Environment <span className="muted">for Claude and the commands it runs</span>
          </h4>
          {env.map((row, i) => (
            <div className="row cc-env" key={i}>
              <input
                type="text"
                value={row.key}
                placeholder="NAME"
                onChange={(e) =>
                  setEnv((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, key: e.target.value } : r))
                  )
                }
                spellCheck={false}
              />
              <input
                type="text"
                value={row.value}
                placeholder="value"
                onChange={(e) =>
                  setEnv((rows) =>
                    rows.map((r, j) => (j === i ? { ...r, value: e.target.value } : r))
                  )
                }
                spellCheck={false}
              />
              <button
                type="button"
                className="icon-button"
                aria-label="Remove"
                onClick={() => setEnv((rows) => rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
          {badEnv && (
            <small className="field-error">
              &quot;{badEnv.key}&quot; can&apos;t be a variable name: letters, digits and _ only.
            </small>
          )}
          <div className="row">
            <button
              type="button"
              className="secondary"
              onClick={() => setEnv((rows) => [...rows, { key: '', value: '' }])}
            >
              Add variable
            </button>
          </div>
        </section>

        <label className="field">
          <span>Status line command</span>
          <input
            type="text"
            value={command}
            placeholder="Not set here: e.g. node ~/.claude/statusline.js"
            onChange={(e) => setCommand(e.target.value)}
            spellCheck={false}
          />
          <small className="muted">
            Gets the session as JSON on its input; what it prints is shown under the prompt.
          </small>
        </label>
      </div>
      <footer className="cc-editor-foot">
        <StatusLine status={status} />
        <span className="cc-grow" />
        <button
          type="button"
          className="primary"
          disabled={busy || !dirty || !!badEnv}
          onClick={() => void save()}
        >
          Save
        </button>
      </footer>
    </>
  )
}
