import { useCallback, useState } from 'react'
import {
  MCP_NAME,
  MCP_SCOPES,
  type McpList,
  type McpScope,
  type McpServer,
  type McpStatus
} from '../../../../shared/claudeConfig'
import {
  MCP_SCOPE_FILES,
  MCP_SCOPE_LABELS,
  mcpConfig,
  mcpForm,
  mcpSummary,
  mcpTransport,
  type McpForm
} from '../../claudeConfig'
import { useDirty, useGuard, useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

const keyOf = (s: { scope: McpScope; name: string }): string => `${s.scope}|${s.name}`
const liveKey = (s: McpStatus): string => `live|${s.name}`

/** A server's connection, as a small badge. */
function StateBadge({ status }: { status?: McpStatus }): React.JSX.Element | null {
  if (!status) return null
  const [label, tone] =
    status.state === 'connected'
      ? ['on', ' on']
      : status.state === 'auth'
        ? ['log in', ' warn']
        : status.state === 'pending'
          ? ['to approve', ' warn']
          : status.state === 'failed'
            ? ['failed', ' bad']
            : [status.text.toLowerCase().slice(0, 16), '']
  return (
    <span className={`cc-badge${tone}`} title={status.text}>
      {label}
    </span>
  )
}

/** "claude.ai Gmail" is shown as Gmail, "plugin:context7:context7" as context7. */
function shownName(s: McpStatus): string {
  if (s.source === 'claude.ai') return s.name.slice('claude.ai '.length)
  if (s.source === 'plugin') return s.name.split(':').pop() ?? s.name
  return s.name
}

/**
 * MCP servers: yours and the folder's (changed with `claude mcp`), then the ones from your
 * claude.ai account and from plugins, which Claude Code reports once it has tried them.
 */
export function McpPane({ folder }: { folder: string | null }): React.JSX.Element {
  const guard = useGuard()
  const load = useCallback(() => window.api.listMcp(folder), [folder])
  const { data: list, loading, reload } = useLoad(load)
  const loadStatus = useCallback(() => window.api.mcpStatus(folder), [folder])
  const { data: statuses, loading: checking, reload: recheck } = useLoad(loadStatus)
  const [selected, setSelected] = useState<string | null>(null)

  const choose = async (key: string | null): Promise<void> => {
    if (key === selected) return
    if (await guard.leave()) setSelected(key)
  }
  const refresh = async (): Promise<void> => {
    if (!(await guard.leave())) return
    reload()
    recheck()
  }

  const servers = list?.servers ?? []
  const live = statuses?.ok ? statuses.servers : []
  const statusOf = (name: string): McpStatus | undefined =>
    live.find((s) => s.source === 'config' && s.name === name)
  const byState = (a: McpStatus, b: McpStatus): number =>
    Number(b.state === 'connected') - Number(a.state === 'connected') ||
    shownName(a).localeCompare(shownName(b), undefined, { sensitivity: 'base' })
  const others = [
    { title: 'From claude.ai', rows: live.filter((s) => s.source === 'claude.ai').sort(byState) },
    { title: 'From plugins', rows: live.filter((s) => s.source === 'plugin').sort(byState) }
  ]
  const scopes = folder ? (['user', 'project', 'local'] as const) : (['user'] as const)
  const current = servers.find((s) => keyOf(s) === selected)
  const currentLive = live.find((s) => liveKey(s) === selected)
  const saved = (s: { scope: McpScope; name: string }): void => {
    reload()
    recheck()
    setSelected(keyOf(s))
  }

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <button className="primary" onClick={() => void choose('new')}>
            + New server
          </button>
          <span className="cc-grow" />
          <button
            className="icon-button"
            aria-label="Reload"
            title="Read them again, and check their connections"
            onClick={() => void refresh()}
          >
            ↻
          </button>
        </div>
        <div className="cc-list-scroll">
          {list?.error && <p className="field-error cc-empty">{list.error}</p>}
          {scopes.map((scope) => {
            const rows = servers.filter((s) => s.scope === scope)
            return (
              <section key={scope} className="cc-group">
                <h3 title={list?.files[scope] ?? undefined}>
                  <span>{MCP_SCOPE_LABELS[scope]}</span>
                </h3>
                {rows.length === 0 ? (
                  loading && !list ? (
                    <Loading text="Reading…" />
                  ) : (
                    <p className="muted cc-empty">None</p>
                  )
                ) : (
                  <ul className="cc-rows">
                    {rows.map((s) => (
                      <li key={keyOf(s)}>
                        <button
                          className={`cc-row${keyOf(s) === selected ? ' selected' : ''}`}
                          onClick={() => void choose(keyOf(s))}
                        >
                          <span className="cc-row-name">
                            {s.name}
                            <code className="cc-chip">{mcpTransport(s.config)}</code>
                            <StateBadge status={statusOf(s.name)} />
                          </span>
                          <span className="cc-row-desc cc-mono">{mcpSummary(s.config)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
          {statuses && !statuses.ok && (
            <p className="field-error cc-empty">
              Couldn&apos;t ask Claude Code about its other servers: {statuses.error}
            </p>
          )}
          {!statuses && checking && (
            <Loading text="Asking Claude Code for its other servers (it connects to each, so it takes a few seconds)…" />
          )}
          {others
            .filter((g) => g.rows.length > 0)
            .map((g) => (
              <section key={g.title} className="cc-group">
                <h3>
                  <span>
                    {g.title} ({g.rows.length})
                  </span>
                </h3>
                <ul className="cc-rows">
                  {g.rows.map((s) => (
                    <li key={liveKey(s)}>
                      <button
                        className={`cc-row${liveKey(s) === selected ? ' selected' : ''}`}
                        onClick={() => void choose(liveKey(s))}
                        title={s.name}
                      >
                        <span className="cc-row-name">
                          {shownName(s)}
                          <StateBadge status={s} />
                        </span>
                        <span className="cc-row-desc cc-mono">{s.target}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          {statuses && checking && <Loading text="Checking their connections again…" />}
        </div>
      </aside>
      <section className="cc-detail">
        {selected === 'new' || current ? (
          <McpEditor
            key={selected ?? ''}
            folder={folder}
            server={current}
            list={list}
            onSaved={saved}
            onDeleted={() => {
              reload()
              recheck()
              setSelected(null)
            }}
          />
        ) : currentLive ? (
          <McpInfo status={currentLive} />
        ) : (
          <div className="cc-intro">
            <h3>MCP servers</h3>
            <p>
              An MCP server gives Claude more tools: a database, a browser, your issue tracker. It
              is a program Claude starts (stdio), or a service it calls over the web (HTTP).
            </p>
            <p>
              <b>Global</b> servers work in every project. <b>This folder, shared</b> ones are in
              its <code>.mcp.json</code> and go to git with it (Claude asks before it first uses
              them); <b>only me</b> ones are yours, for this folder.
            </p>
            <p>
              Under them are the connectors from your <b>claude.ai</b> account and the servers that
              come with <b>plugins</b>, once Claude Code has checked them. Those are changed where
              they come from.
            </p>
            <p className="muted">
              Changes go through Claude Code&apos;s own <code>claude mcp</code>. Restart running
              sessions to use them; a server that needs a login asks for it in Claude (
              <code>/mcp</code>).
            </p>
            <DocsLink href="https://code.claude.com/docs/en/mcp">About MCP</DocsLink>
          </div>
        )}
      </section>
    </div>
  )
}

/** A claude.ai connector or a plugin's server: what it is, and where it is changed. */
function McpInfo({ status }: { status: McpStatus }): React.JSX.Element {
  const plugin = status.source === 'plugin' ? status.name.split(':')[1] : null
  return (
    <div className="cc-editor">
      <header className="cc-editor-head">
        <div>
          <h3>
            {shownName(status)} <StateBadge status={status} />
          </h3>
          <small className="muted">
            {plugin ? `Comes with the plugin ${plugin}` : 'A connector from your claude.ai account'}
          </small>
        </div>
      </header>
      <div className="cc-fields">
        <label className="field">
          <span>{/^https?:/.test(status.target) ? 'URL' : 'Command'}</span>
          <input type="text" value={status.target} readOnly spellCheck={false} />
        </label>
        <p>
          <b>{status.text}</b>
          {status.state === 'auth' && ': run /mcp in Claude and pick it to log in.'}
          {status.state === 'failed' && ': Claude Code couldn’t reach it.'}
        </p>
        {plugin ? (
          <p className="muted">
            It is part of the plugin <b>{plugin}</b>: turn the plugin off or uninstall it under
            Plugins to stop using it.
          </p>
        ) : (
          <>
            <p className="muted">
              Connectors are added, removed and set up on claude.ai, and Claude Code gets them with
              your account. In Claude, <code>/mcp</code> turns one off for a while or logs in to it.
            </p>
            <DocsLink href="https://claude.ai/settings/connectors">
              Connectors on claude.ai
            </DocsLink>
          </>
        )}
      </div>
    </div>
  )
}

interface EditorProps {
  folder: string | null
  server?: McpServer
  list: McpList | null
  onSaved(s: { scope: McpScope; name: string }): void
  onDeleted(): void
}

function McpEditor({ folder, server, list, onSaved, onDeleted }: EditorProps): React.JSX.Element {
  const guard = useGuard()
  const [name, setName] = useState(server?.name ?? '')
  const [scope, setScope] = useState<McpScope>(server?.scope ?? 'user')
  const [form, setForm] = useState<McpForm>(() =>
    mcpForm(server?.config ?? { type: 'stdio', command: '' })
  )
  const [json, setJson] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)
  const [initial] = useState(() => JSON.stringify({ name, scope, form }))

  const dirty =
    JSON.stringify({ name, scope, form }) !== initial ||
    (json !== null && json !== JSON.stringify(mcpConfig(form), null, 2))
  useDirty(dirty)

  const taken = list?.servers.some(
    (s) =>
      s.name === name &&
      s.scope === scope &&
      !(server && s.name === server.name && s.scope === server.scope)
  )
  const nameProblem = !MCP_NAME.test(name)
    ? name
      ? 'Use letters, digits, -, _ and . (up to 64)'
      : 'Give it a name'
    : taken
      ? `There is already a "${name}" there`
      : null
  const set = (patch: Partial<McpForm>): void => setForm((f) => ({ ...f, ...patch }))

  /** The settings from the JSON being edited; null (with the error shown) when it isn't valid. */
  const fromJson = (): McpForm | null => {
    if (json === null) return form
    try {
      const v: unknown = JSON.parse(json)
      if (v && typeof v === 'object' && !Array.isArray(v))
        return mcpForm(v as Record<string, unknown>)
      setStatus({ ok: false, text: 'It must be a JSON object' })
    } catch (err) {
      setStatus({ ok: false, text: err instanceof Error ? err.message : String(err) })
    }
    return null
  }

  const toggleJson = (): void => {
    if (json === null) {
      setJson(JSON.stringify(mcpConfig(form), null, 2))
      return
    }
    const f = fromJson()
    if (!f) return
    setForm(f)
    setJson(null)
    setStatus(null)
  }

  const save = async (): Promise<void> => {
    const f = fromJson()
    if (!f || nameProblem) return
    const config = mcpConfig(f)
    if (f.transport === 'stdio' ? !f.command.trim() : !f.url.trim()) {
      setStatus({ ok: false, text: f.transport === 'stdio' ? 'Give the command' : 'Give the URL' })
      return
    }
    setBusy(true)
    setStatus(null)
    const res = await window.api.saveMcp({
      ...(folder ? { folder } : {}),
      scope,
      name,
      config,
      ...(server ? { original: { name: server.name, scope: server.scope } } : {})
    })
    setBusy(false)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onSaved({ scope, name })
  }

  const remove = async (): Promise<void> => {
    if (!server) return
    const ok = await window.api.confirm({
      message: `Remove the MCP server "${server.name}"?`,
      detail: MCP_SCOPE_FILES[server.scope],
      okLabel: 'Remove'
    })
    if (!ok) return
    setBusy(true)
    const res = await window.api.removeMcp({
      ...(folder ? { folder } : {}),
      scope: server.scope,
      name: server.name
    })
    setBusy(false)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onDeleted()
  }

  const stdio = form.transport === 'stdio'
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
          <h3>{server ? server.name : 'New MCP server'}</h3>
          <small className="muted">{MCP_SCOPE_FILES[scope]}</small>
        </div>
        <span className="cc-grow" />
        {server && (
          <button
            type="button"
            className="secondary danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove
          </button>
        )}
      </header>

      <div className="cc-fields">
        <div className="cc-row-fields">
          <label className="field">
            <span>Name</span>
            <input
              type="text"
              value={name}
              placeholder="e.g. github"
              onChange={(e) => setName(e.target.value.trim())}
              spellCheck={false}
              autoFocus={!server}
            />
            {nameProblem && name !== '' && <small className="field-error">{nameProblem}</small>}
          </label>
          <label className="field">
            <span>Save in</span>
            <select value={scope} onChange={(e) => setScope(e.target.value as McpScope)}>
              {MCP_SCOPES.filter((s) => folder || s === 'user').map((s) => (
                <option key={s} value={s}>
                  {MCP_SCOPE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          {json === null && (
            <label className="field">
              <span>Kind</span>
              <select value={form.transport} onChange={(e) => set({ transport: e.target.value })}>
                <option value="stdio">A program (stdio)</option>
                <option value="http">A web service (HTTP)</option>
                <option value="sse">A web service (SSE, older)</option>
                {!['stdio', 'http', 'sse'].includes(form.transport) && (
                  <option value={form.transport}>{form.transport}</option>
                )}
              </select>
            </label>
          )}
        </div>

        {json !== null ? (
          <label className="field cc-grow-field">
            <span>Settings (JSON)</span>
            <textarea
              className="cc-code"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          </label>
        ) : stdio ? (
          <>
            <label className="field">
              <span>Command</span>
              <input
                type="text"
                value={form.command}
                placeholder="e.g. npx"
                onChange={(e) => set({ command: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Arguments, one a line</span>
              <textarea
                className="cc-code"
                rows={4}
                value={form.args}
                placeholder={'-y\n@modelcontextprotocol/server-github'}
                onChange={(e) => set({ args: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Environment, NAME=value a line</span>
              <textarea
                className="cc-code"
                rows={3}
                value={form.env}
                placeholder="GITHUB_TOKEN=…"
                onChange={(e) => set({ env: e.target.value })}
                spellCheck={false}
              />
            </label>
          </>
        ) : (
          <>
            <label className="field">
              <span>URL</span>
              <input
                type="text"
                value={form.url}
                placeholder="https://mcp.example.com/mcp"
                onChange={(e) => set({ url: e.target.value })}
                spellCheck={false}
              />
            </label>
            <label className="field">
              <span>Headers, Name: value a line</span>
              <textarea
                className="cc-code"
                rows={3}
                value={form.headers}
                placeholder="Authorization: Bearer …"
                onChange={(e) => set({ headers: e.target.value })}
                spellCheck={false}
              />
            </label>
          </>
        )}
        {(form.env || form.headers) && json === null && (
          <small className="muted">
            Keys and tokens are saved as plain text where the server is kept
            {scope === 'project' ? ', and .mcp.json goes to git: use ${VAR} for secrets' : ''}.
          </small>
        )}
      </div>

      <footer className="cc-editor-foot">
        <button
          type="button"
          className="secondary"
          onClick={toggleJson}
          title="Every setting the server has (timeouts, OAuth…)"
        >
          {json === null ? 'Edit as JSON' : 'Edit as form'}
        </button>
        {busy ? (
          <Loading text="Saving with claude mcp…" className="cc-status" />
        ) : (
          <StatusLine status={status} />
        )}
        <span className="cc-grow" />
        <button
          type="submit"
          className="primary"
          disabled={busy || !!nameProblem || (!!server && !dirty)}
        >
          {server ? 'Save' : 'Add server'}
        </button>
      </footer>
    </form>
  )
}
