import { useCallback, useMemo, useState } from 'react'
import {
  HOOK_EVENTS,
  HOOK_TYPES,
  sameJson,
  stableJson,
  type ReadOnlyHook,
  type HookEntry,
  type HookFile,
  type HookHandler,
  type HookScope
} from '../../../../shared/claudeConfig'
import {
  HOOK_SCOPE_FILES,
  HOOK_SCOPE_LABELS,
  hookSummary,
  timeoutValue,
  withField,
  withType
} from '../../claudeConfig'
import { forgetExtras, loadExtras } from './extras'
import { useDirty, useGuard, useLoad, type Status } from './guard'
import { ReadOnlyGroup, ReadOnlyHookView } from './ReadOnly'
import { DocsLink, Loading, StatusLine } from './shared'

const TYPE_LABELS: Record<string, string> = {
  command: 'Run a command',
  prompt: 'Ask a model',
  agent: 'Ask an agent',
  http: 'Call a URL',
  mcp_tool: 'Call an MCP tool'
}

/** Seconds Claude Code waits for a handler when it says nothing else. */
const DEFAULT_TIMEOUT: Record<string, number> = {
  command: 600,
  http: 600,
  mcp_tool: 600,
  prompt: 30,
  agent: 60
}

const keyOf = (e: HookEntry): string => `${e.scope}|${e.event}|${e.group}|${e.index}`
const eventOrder = (name: string): number => {
  const i = HOOK_EVENTS.findIndex((e) => e.name === name)
  return i === -1 ? HOOK_EVENTS.length : i
}

/** Hooks in your settings and in the folder's: a list by file, and an editor. */
export function HooksPane({ folder }: { folder: string | null }): React.JSX.Element {
  const guard = useGuard()
  const load = useCallback(() => window.api.listHooks(folder), [folder])
  const { data: files, loading, reload } = useLoad(load)
  const [selected, setSelected] = useState<string | null>(null)
  // After a save the hook may have moved: found again by what it is.
  const [find, setFind] = useState<Omit<HookEntry, 'group' | 'index'> | null>(null)

  const all = useMemo(() => (files ?? []).flatMap((f) => f.hooks), [files])
  const found =
    find &&
    all.find(
      (e) =>
        e.scope === find.scope &&
        e.event === find.event &&
        e.matcher === find.matcher &&
        sameJson(e.handler, find.handler)
    )
  const selectedKey = found ? keyOf(found) : selected
  const current = all.find((e) => keyOf(e) === selectedKey)

  const choose = async (key: string | null): Promise<void> => {
    if (key === selectedKey) return
    if (await guard.leave()) {
      setFind(null)
      setSelected(key)
    }
  }
  const refresh = async (): Promise<void> => {
    if (!(await guard.leave())) return
    forgetExtras()
    reload()
    reloadOthers()
  }
  // Hooks that come with plugins: shown, not changed here.
  const loadOthers = useCallback(() => loadExtras(folder), [folder])
  const { data: extras, reload: reloadOthers } = useLoad(loadOthers)
  const pluginHooks = [...(extras?.hooks ?? [])].sort(
    (a, b) => eventOrder(a.event) - eventOrder(b.event)
  )
  const otherKey = (h: ReadOnlyHook): string =>
    `other|${h.plugin}|${h.event}|${h.matcher}|${stableJson(h.handler)}`
  const currentOther = pluginHooks.find((h) => otherKey(h) === selectedKey)

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <button className="primary" onClick={() => void choose('new')}>
            + New hook
          </button>
          <span className="cc-grow" />
          <button
            className="icon-button"
            aria-label="Reload"
            title="Read them again"
            onClick={() => void refresh()}
          >
            ↻
          </button>
        </div>
        <div className="cc-list-scroll">
          {(files ?? []).map((file) => (
            <HookGroup
              key={file.scope}
              file={file}
              selected={selectedKey}
              onChoose={(key) => void choose(key)}
            />
          ))}
          {loading && !files && <Loading text="Reading…" />}
          <ReadOnlyGroup
            title="From plugins"
            rows={pluginHooks}
            keyOf={otherKey}
            selected={selectedKey}
            onChoose={(key) => void choose(key)}
            name={(h) => (
              <>
                {h.event}
                {h.matcher && <code className="cc-chip">{h.matcher}</code>}
                <span className="cc-badge">{h.plugin}</span>
              </>
            )}
            desc={(h) => hookSummary(h.handler)}
          />
          {!extras && <Loading text="Looking at what plugins bring…" />}
        </div>
      </aside>
      <section className="cc-detail">
        {currentOther ? (
          <ReadOnlyHookView key={otherKey(currentOther)} hook={currentOther} />
        ) : selectedKey === 'new' || current ? (
          <HookEditor
            key={selectedKey ?? ''}
            folder={folder}
            entry={current}
            files={files ?? []}
            onSaved={(change) => {
              setFind(change)
              setSelected(null)
              reload()
            }}
            onDeleted={() => {
              setFind(null)
              setSelected(null)
              reload()
            }}
          />
        ) : (
          <Intro />
        )}
      </section>
    </div>
  )
}

function HookGroup({
  file,
  selected,
  onChoose
}: {
  file: HookFile
  selected: string | null
  onChoose(key: string): void
}): React.JSX.Element {
  const hooks = [...file.hooks].sort((a, b) => eventOrder(a.event) - eventOrder(b.event))
  return (
    <section className="cc-group">
      <h3 title={file.path}>
        <span>{HOOK_SCOPE_LABELS[file.scope]}</span>
      </h3>
      {file.error ? (
        <p className="field-error cc-empty">
          {file.path} can&apos;t be read, so it is left alone: {file.error}
        </p>
      ) : hooks.length === 0 ? (
        <p className="muted cc-empty">No hooks here</p>
      ) : (
        <ul className="cc-rows">
          {hooks.map((e) => (
            <li key={keyOf(e)}>
              <button
                className={`cc-row${keyOf(e) === selected ? ' selected' : ''}`}
                onClick={() => onChoose(keyOf(e))}
              >
                <span className="cc-row-name">
                  {e.event}
                  {e.matcher && <code className="cc-chip">{e.matcher}</code>}
                </span>
                <span className="cc-row-desc cc-mono">{hookSummary(e.handler)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function Intro(): React.JSX.Element {
  return (
    <div className="cc-intro">
      <h3>Hooks</h3>
      <p>
        A hook runs at a moment in Claude&apos;s work: a command before a tool runs, a check when
        Claude wants to stop, a sound when it needs you. It gets the moment&apos;s details as JSON
        on its input, and can block or add to what happens.
      </p>
      <p>
        <b>Global</b> hooks are in your own settings and run in every project. <b>This folder</b>
        &apos;s are in <code>.claude/settings.json</code> (committed, for everyone on the project)
        or <code>.claude/settings.local.json</code> (only you).
      </p>
      <p className="muted">Sessions already running may need a restart to use a change.</p>
      <DocsLink href="https://code.claude.com/docs/en/hooks">About hooks</DocsLink>
    </div>
  )
}

interface EditorProps {
  folder: string | null
  entry?: HookEntry
  files: HookFile[]
  onSaved(change: Omit<HookEntry, 'group' | 'index'>): void
  onDeleted(): void
}

function HookEditor({ folder, entry, files, onSaved, onDeleted }: EditorProps): React.JSX.Element {
  const guard = useGuard()
  const [scope, setScope] = useState<HookScope>(entry?.scope ?? 'user')
  const [event, setEvent] = useState(entry?.event ?? 'PreToolUse')
  const [matcher, setMatcher] = useState(entry?.matcher ?? '')
  const [handler, setHandler] = useState<HookHandler>(
    entry?.handler ?? { type: 'command', command: '' }
  )
  // The handler as JSON while it is edited that way.
  const [json, setJson] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [initial] = useState(() => JSON.stringify({ scope, event, matcher, handler }))

  const info = HOOK_EVENTS.find((e) => e.name === event)
  const dirty =
    JSON.stringify({ scope, event, matcher, handler }) !== initial ||
    (json !== null && json !== JSON.stringify(handler, null, 2))
  useDirty(dirty)

  const broken = (s: HookScope): boolean => !!files.find((f) => f.scope === s)?.error
  const text = (key: string): string =>
    typeof handler[key] === 'string' ? (handler[key] as string) : ''
  const set = (key: string, value: unknown): void => setHandler((h) => withField(h, key, value))

  /** The handler from the JSON being edited; null (with the error shown) when it isn't one. */
  const parsed = (): HookHandler | null => {
    if (json === null) return handler
    try {
      const v: unknown = JSON.parse(json)
      if (
        v &&
        typeof v === 'object' &&
        !Array.isArray(v) &&
        typeof (v as HookHandler).type === 'string'
      ) {
        return v as HookHandler
      }
      setStatus({ ok: false, text: 'It must be an object with a "type"' })
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    return null
  }

  const toggleJson = (): void => {
    if (json === null) {
      setJson(JSON.stringify(handler, null, 2))
      return
    }
    const h = parsed()
    if (!h) return
    setHandler(h)
    setJson(null)
    setStatus(null)
  }

  const problem = (h: HookHandler): string | null => {
    if (!(HOOK_TYPES as readonly string[]).includes(h.type)) return `Unknown type "${h.type}"`
    const has = (k: string): boolean => typeof h[k] === 'string' && (h[k] as string).trim() !== ''
    if (h.type === 'command' && !has('command') && !Array.isArray(h.args))
      return 'Write the command to run'
    if ((h.type === 'prompt' || h.type === 'agent') && !has('prompt')) return 'Write the prompt'
    if (h.type === 'http' && !has('url')) return 'Give the URL'
    if (h.type === 'mcp_tool' && !(has('server') && has('tool')))
      return 'Give the server and the tool'
    return null
  }

  const save = async (): Promise<void> => {
    const h = parsed()
    if (!h) return
    const wrong = problem(h)
    if (wrong) {
      setStatus({ ok: false, text: wrong })
      return
    }
    const change = { scope, event, matcher: info?.matcher ? matcher.trim() : '', handler: h }
    setBusy(true)
    const res = await window.api.saveHook({
      ...(folder ? { folder } : {}),
      ...change,
      ...(entry ? { original: entry } : {})
    })
    setBusy(false)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onSaved(change)
  }

  const remove = async (): Promise<void> => {
    if (!entry) return
    const ok = await window.api.confirm({
      message: `Delete this ${entry.event} hook?`,
      detail: hookSummary(entry.handler),
      okLabel: 'Delete'
    })
    if (!ok) return
    const res = await window.api.deleteHook({ ...(folder ? { folder } : {}), entry })
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onDeleted()
  }

  const timeout = handler.timeout
  return (
    <form
      className="cc-editor"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <header className="cc-editor-head">
        <div>
          <h3>{entry ? `${entry.event} hook` : 'New hook'}</h3>
          <small className="muted">{HOOK_SCOPE_FILES[scope]}</small>
        </div>
        <span className="cc-grow" />
        {entry && (
          <button type="button" className="secondary danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </header>

      <div className="cc-fields">
        <div className="cc-row-fields">
          <label className="field">
            <span>When</span>
            <select value={event} onChange={(e) => setEvent(e.target.value)}>
              {HOOK_EVENTS.map((e) => (
                <option key={e.name} value={e.name}>
                  {e.name}
                </option>
              ))}
              {!info && <option value={event}>{event}</option>}
            </select>
            <small className="muted">{info?.when ?? 'An event this app doesn’t know'}</small>
          </label>
          <label className="field">
            <span>Matcher</span>
            <input
              type="text"
              value={info?.matcher ? matcher : ''}
              disabled={!info?.matcher}
              placeholder={info?.matcher ? 'Empty: every time' : 'This event always runs it'}
              onChange={(e) => setMatcher(e.target.value)}
              spellCheck={false}
            />
            <small className="muted">{info?.matcher ?? 'No matcher for this event'}</small>
          </label>
          <label className="field">
            <span>Save in</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as HookScope)}>
              <option value="user" disabled={broken('user')}>
                {HOOK_SCOPE_LABELS.user}
              </option>
              {folder && (
                <option value="project" disabled={broken('project')}>
                  {HOOK_SCOPE_LABELS.project}
                </option>
              )}
              {folder && (
                <option value="local" disabled={broken('local')}>
                  {HOOK_SCOPE_LABELS.local}
                </option>
              )}
            </select>
          </label>
        </div>

        {json !== null ? (
          <label className="field cc-grow-field">
            <span>Handler (JSON)</span>
            <textarea
              className="cc-code"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            <div className="cc-row-fields">
              <label className="field">
                <span>Do</span>
                <select
                  value={handler.type}
                  onChange={(e) => setHandler((h) => withType(h, e.target.value))}
                >
                  {HOOK_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                  {!(HOOK_TYPES as readonly string[]).includes(handler.type) && (
                    <option value={handler.type}>{handler.type}</option>
                  )}
                </select>
              </label>
              <label className="field">
                <span>Timeout (seconds)</span>
                <input
                  type="number"
                  min={1}
                  value={typeof timeout === 'number' ? timeout : ''}
                  placeholder={String(DEFAULT_TIMEOUT[handler.type] ?? '')}
                  onChange={(e) => set('timeout', timeoutValue(e.target.value))}
                />
              </label>
            </div>
            {handler.type === 'command' && (
              <label className="field cc-grow-field">
                <span>Command</span>
                <textarea
                  className="cc-code"
                  value={text('command')}
                  placeholder={'e.g. npx prettier --write "$CLAUDE_PROJECT_DIR"'}
                  onChange={(e) => set('command', e.target.value)}
                  spellCheck={false}
                />
                <small className="muted">
                  It gets the event as JSON on its input. Exit code 2 blocks the action and tells
                  Claude why (what it wrote to stderr).
                </small>
              </label>
            )}
            {(handler.type === 'prompt' || handler.type === 'agent') && (
              <>
                <label className="field cc-grow-field">
                  <span>Prompt</span>
                  <textarea
                    className="cc-code"
                    value={text('prompt')}
                    placeholder="What to check; $ARGUMENTS is the event's JSON"
                    onChange={(e) => set('prompt', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span>Model</span>
                  <input
                    type="text"
                    value={text('model')}
                    placeholder="Default (a fast model)"
                    onChange={(e) => set('model', e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </>
            )}
            {handler.type === 'http' && (
              <label className="field">
                <span>URL</span>
                <input
                  type="text"
                  value={text('url')}
                  placeholder="https://…"
                  onChange={(e) => set('url', e.target.value)}
                  spellCheck={false}
                />
                <small className="muted">The event is POSTed to it as JSON.</small>
              </label>
            )}
            {handler.type === 'mcp_tool' && (
              <div className="cc-row-fields">
                <label className="field">
                  <span>MCP server</span>
                  <input
                    type="text"
                    value={text('server')}
                    onChange={(e) => set('server', e.target.value)}
                    spellCheck={false}
                  />
                </label>
                <label className="field">
                  <span>Tool</span>
                  <input
                    type="text"
                    value={text('tool')}
                    onChange={(e) => set('tool', e.target.value)}
                    spellCheck={false}
                  />
                </label>
              </div>
            )}
          </>
        )}
      </div>

      <footer className="cc-editor-foot">
        <button
          type="button"
          className="secondary"
          onClick={toggleJson}
          title="Every field the handler has (headers, async, if, statusMessage…)"
        >
          {json === null ? 'Edit as JSON' : 'Edit as form'}
        </button>
        <StatusLine status={status} />
        <span className="cc-grow" />
        <button
          type="submit"
          className="primary"
          disabled={busy || broken(scope) || (!!entry && !dirty)}
        >
          {entry ? 'Save' : 'Add hook'}
        </button>
      </footer>
    </form>
  )
}
