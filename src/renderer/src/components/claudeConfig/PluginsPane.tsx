import { useCallback, useMemo, useState } from 'react'
import {
  PLUGIN_SCOPES,
  type InstalledPlugin,
  type PluginActionRequest,
  type PluginScope
} from '../../../../shared/claudeConfig'
import {
  filterPlugins,
  PLUGIN_SCOPE_HINTS,
  PLUGIN_SCOPE_LABELS,
  pluginRows,
  shortCount,
  type PluginRow
} from '../../claudeConfig'
import { useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

/** Rows shown at once; a search narrows the rest down. */
const SHOWN = 200

const isChangeable = (scope: string): scope is PluginScope =>
  (PLUGIN_SCOPES as readonly string[]).includes(scope)

/** Plugins: what is installed (and where), what the marketplaces offer, and changing that. */
export function PluginsPane({ folder }: { folder: string | null }): React.JSX.Element {
  const load = useCallback(() => window.api.listPlugins(folder), [folder])
  const { data: list, loading, reload } = useLoad(load)
  const [query, setQuery] = useState('')
  const [installedOnly, setInstalledOnly] = useState(true)
  const [selected, setSelected] = useState<string | null>(null)

  const rows = useMemo(() => (list?.ok ? pluginRows(list.installed, list.available) : []), [list])
  const installedCount = rows.filter((r) => r.installs.length > 0).length
  const shown = useMemo(
    () => filterPlugins(rows, query, installedOnly),
    [rows, query, installedOnly]
  )
  const current = rows.find((r) => r.id === selected)

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <input
            type="search"
            className="cc-search"
            placeholder="Search plugins"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            spellCheck={false}
          />
          <button
            className="icon-button"
            aria-label="Reload"
            title="Ask Claude Code again"
            onClick={reload}
          >
            ↻
          </button>
        </div>
        <div className="cc-segment" role="group" aria-label="Which plugins">
          <button aria-pressed={installedOnly} onClick={() => setInstalledOnly(true)}>
            Installed ({installedCount})
          </button>
          <button aria-pressed={!installedOnly} onClick={() => setInstalledOnly(false)}>
            All ({rows.length})
          </button>
        </div>
        <div className="cc-list-scroll">
          {!list ? (
            <Loading text="Asking Claude Code for its plugins…" />
          ) : !list.ok ? (
            <p className="field-error cc-empty">{list.error}</p>
          ) : shown.length === 0 ? (
            <p className="muted cc-empty">
              {query ? 'Nothing matches' : 'No plugins installed. See All to find some.'}
            </p>
          ) : (
            <ul className="cc-rows">
              {shown.slice(0, SHOWN).map((row) => (
                <li key={row.id}>
                  <button
                    className={`cc-row${row.id === selected ? ' selected' : ''}`}
                    onClick={() => setSelected(row.id)}
                    title={row.id}
                  >
                    <span className="cc-row-name">
                      {row.name}
                      {row.installs.length > 0 && (
                        <span
                          className={`cc-badge${row.installs.some((i) => i.enabled) ? ' on' : ''}`}
                        >
                          {row.installs.some((i) => i.enabled) ? 'on' : 'off'}
                        </span>
                      )}
                      {row.installs.some((i) => i.errors.length > 0) && (
                        <span
                          className="cc-warn"
                          title={row.installs.flatMap((i) => i.errors).join('\n')}
                        >
                          ⚠
                        </span>
                      )}
                    </span>
                    <span className="cc-row-desc">{row.description || row.marketplace}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {shown.length > SHOWN && (
            <p className="muted cc-empty">{shown.length - SHOWN} more: search to find them</p>
          )}
          {loading && list && <Loading text="Reading again…" />}
        </div>
      </aside>
      <section className="cc-detail">
        {current ? (
          <PluginDetail key={current.id} row={current} folder={folder} onChanged={reload} />
        ) : (
          <Intro />
        )}
      </section>
    </div>
  )
}

function Intro(): React.JSX.Element {
  return (
    <div className="cc-intro">
      <h3>Plugins</h3>
      <p>
        A plugin bundles skills, agents, hooks and MCP servers, from a marketplace (Anthropic&apos;s
        is there already). Install one <b>globally</b> for every project, or for <b>this folder</b>:
        shared with the project, or only for you.
      </p>
      <p className="muted">
        This uses Claude Code&apos;s own <code>claude plugin</code> commands. New sessions get the
        change; restart the ones already running.
      </p>
      <DocsLink href="https://code.claude.com/docs/en/discover-plugins">About plugins</DocsLink>
    </div>
  )
}

function PluginDetail({
  row,
  folder,
  onChanged
}: {
  row: PluginRow
  folder: string | null
  onChanged(): void
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)
  const [details, setDetails] = useState<string | null>(null)
  const scopes = folder ? PLUGIN_SCOPES : (['user'] as const)
  const here = (i: InstalledPlugin): boolean => i.scope === 'user' || i.projectPath === folder
  const takenHere = new Set(row.installs.filter(here).map((i) => i.scope))
  const free = scopes.filter((s) => !takenHere.has(s))
  const [chosen, setScope] = useState<PluginScope>(free[0] ?? 'user')
  const scope = free.includes(chosen) ? chosen : (free[0] ?? 'user')

  const act = async (req: PluginActionRequest, doing: string): Promise<void> => {
    setBusy(doing)
    setStatus(null)
    let res = await window.api.pluginAction(req)
    if (!res.ok && res.confirm) {
      // Some marketplaces install by running a command: you see it first.
      const ok = await window.api.confirm({
        message: `${row.name} is installed by running a command from its marketplace`,
        detail: `${res.confirm.command}\n\nRun it only if you trust this marketplace.`,
        okLabel: 'Run it'
      })
      res = ok
        ? await window.api.pluginAction({ ...req, acceptCommand: res.confirm.sha256 })
        : { ok: false, error: 'Nothing was run.' }
    }
    setBusy(null)
    setStatus(
      res.ok
        ? { ok: true, text: `${res.message}. Restart running Claude sessions to apply it.` }
        : { ok: false, text: res.error }
    )
    if (res.ok) onChanged()
  }

  const showDetails = async (): Promise<void> => {
    setBusy('Reading')
    setDetails(await window.api.pluginDetails(row.id, folder))
    setBusy(null)
  }

  /** Where an install's project is, for actions on it. */
  const folderOf = (i: InstalledPlugin): string | undefined =>
    i.scope === 'user' ? (folder ?? undefined) : i.projectPath

  const uninstall = async (i: InstalledPlugin): Promise<void> => {
    const ok = await window.api.confirm({
      message: `Uninstall ${row.name}?`,
      detail: `From ${PLUGIN_SCOPE_LABELS[i.scope] ?? i.scope}${i.projectPath ? ` (${i.projectPath})` : ''}.`,
      okLabel: 'Uninstall'
    })
    if (ok) {
      void act(
        { action: 'uninstall', id: row.id, scope: i.scope as PluginScope, folder: folderOf(i) },
        'Uninstalling'
      )
    }
  }

  return (
    <div className="cc-editor">
      <header className="cc-editor-head">
        <div>
          <h3>{row.name}</h3>
          <small className="muted">
            {row.marketplace && `from ${row.marketplace}`}
            {row.installCount !== undefined && ` · ${shortCount(row.installCount)} installs`}
            {row.version && ` · ${row.version}`}
          </small>
        </div>
        <span className="cc-grow" />
        {row.url && <DocsLink href={row.url}>Its page</DocsLink>}
      </header>

      <div className="cc-fields cc-plugin">
        {row.description && <p className="cc-plugin-desc">{row.description}</p>}

        {row.installs.length > 0 && (
          <section>
            <h4>Installed</h4>
            <ul className="cc-installs">
              {row.installs.map((i) => {
                const mine = isChangeable(i.scope)
                const elsewhere = i.scope !== 'user' && i.projectPath !== folder
                return (
                  <li key={`${i.scope}|${i.projectPath ?? ''}`}>
                    <div className="cc-install-what">
                      <b>{PLUGIN_SCOPE_LABELS[i.scope] ?? i.scope}</b>
                      {elsewhere && i.projectPath && (
                        <span className="muted" title={i.projectPath}>
                          {' '}
                          in {i.projectPath}
                        </span>
                      )}
                      {i.version && <span className="muted"> · {i.version}</span>}
                      {!elsewhere && (
                        <span className={`cc-badge${i.enabled ? ' on' : ''}`}>
                          {i.enabled ? 'on' : 'off'}
                        </span>
                      )}
                      {i.mcpServers.length > 0 && (
                        <div className="muted small">MCP servers: {i.mcpServers.join(', ')}</div>
                      )}
                      {i.errors.map((e) => (
                        <div key={e} className="field-error small">
                          {e}
                        </div>
                      ))}
                    </div>
                    {mine && (
                      <div className="cc-install-actions">
                        {!elsewhere && (
                          <button
                            type="button"
                            className="secondary"
                            disabled={!!busy}
                            onClick={() =>
                              void act(
                                {
                                  action: i.enabled ? 'disable' : 'enable',
                                  id: row.id,
                                  scope: i.scope as PluginScope,
                                  folder: folderOf(i)
                                },
                                i.enabled ? 'Turning it off' : 'Turning it on'
                              )
                            }
                          >
                            {i.enabled ? 'Turn off' : 'Turn on'}
                          </button>
                        )}
                        <button
                          type="button"
                          className="secondary"
                          disabled={!!busy}
                          onClick={() =>
                            void act(
                              {
                                action: 'update',
                                id: row.id,
                                scope: i.scope as PluginScope,
                                folder: folderOf(i)
                              },
                              'Updating'
                            )
                          }
                        >
                          Update
                        </button>
                        <button
                          type="button"
                          className="secondary danger"
                          disabled={!!busy}
                          onClick={() => void uninstall(i)}
                        >
                          Uninstall
                        </button>
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}

        {free.length > 0 && (
          <section>
            <h4>{row.installs.length > 0 ? 'Also install it' : 'Install'}</h4>
            <div className="row">
              <select value={scope} onChange={(e) => setScope(e.target.value as PluginScope)}>
                {free.map((s) => (
                  <option key={s} value={s}>
                    {PLUGIN_SCOPE_LABELS[s]}: {PLUGIN_SCOPE_HINTS[s]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="primary"
                disabled={!!busy}
                onClick={() =>
                  void act(
                    {
                      action: 'install',
                      id: row.id,
                      scope,
                      ...(folder ? { folder } : {})
                    },
                    'Installing'
                  )
                }
              >
                Install
              </button>
            </div>
          </section>
        )}

        {row.installs.length > 0 && (
          <section>
            {details === null ? (
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => void showDetails()}
              >
                What&apos;s inside
              </button>
            ) : (
              <>
                <h4>What&apos;s inside</h4>
                <pre className="cc-details">{details}</pre>
              </>
            )}
          </section>
        )}
      </div>

      <footer className="cc-editor-foot">
        {busy ? (
          <Loading text={`${busy}…`} className="cc-status" />
        ) : (
          <StatusLine status={status} />
        )}
      </footer>
    </div>
  )
}
