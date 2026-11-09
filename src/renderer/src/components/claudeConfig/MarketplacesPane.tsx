import { useCallback, useState } from 'react'
import { MAX_SOURCE, type Marketplace, type PluginScope } from '../../../../shared/claudeConfig'
import { PLUGIN_SCOPE_HINTS, PLUGIN_SCOPE_LABELS } from '../../claudeConfig'
import { useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

/** Marketplaces: where plugins come from. Changed with `claude plugin marketplace`. */
export function MarketplacesPane({ folder }: { folder: string | null }): React.JSX.Element {
  const load = useCallback(() => window.api.listMarketplaces(folder), [folder])
  const { data: list, loading, reload } = useLoad(load)
  const [selected, setSelected] = useState<string | null>(null)
  const items = list?.ok ? list.items : []
  const current = items.find((m) => m.name === selected)

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <button className="primary" onClick={() => setSelected('\0new')}>
            + Add marketplace
          </button>
          <span className="cc-grow" />
          <button
            className="icon-button"
            aria-label="Reload"
            title="Ask Claude Code again"
            onClick={reload}
          >
            ↻
          </button>
        </div>
        <div className="cc-list-scroll">
          {!list ? (
            <Loading text="Asking Claude Code…" />
          ) : !list.ok ? (
            <p className="field-error cc-empty">{list.error}</p>
          ) : (
            <ul className="cc-rows">
              {items.map((m) => (
                <li key={m.name}>
                  <button
                    className={`cc-row${m.name === selected ? ' selected' : ''}`}
                    onClick={() => setSelected(m.name)}
                  >
                    <span className="cc-row-name">{m.name}</span>
                    <span className="cc-row-desc cc-mono">{m.source}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {loading && list && <Loading text="Reading again…" />}
        </div>
      </aside>
      <section className="cc-detail">
        {selected === '\0new' ? (
          <AddMarketplace
            folder={folder}
            onAdded={() => {
              reload()
              setSelected(null)
            }}
          />
        ) : current ? (
          <MarketplaceDetail
            key={current.name}
            item={current}
            onChanged={reload}
            onRemoved={() => {
              reload()
              setSelected(null)
            }}
          />
        ) : (
          <div className="cc-intro">
            <h3>Marketplaces</h3>
            <p>
              A marketplace is a list of plugins, kept in a git repository, at a URL, or in a
              folder. Anthropic&apos;s official one is there from the start; add others (your
              team&apos;s, say) to install their plugins under Plugins.
            </p>
            <p className="muted">
              This uses Claude Code&apos;s own <code>claude plugin marketplace</code> commands.
            </p>
            <DocsLink href="https://code.claude.com/docs/en/plugin-marketplaces">
              About marketplaces
            </DocsLink>
          </div>
        )}
      </section>
    </div>
  )
}

function AddMarketplace({
  folder,
  onAdded
}: {
  folder: string | null
  onAdded(): void
}): React.JSX.Element {
  const [source, setSource] = useState('')
  const [scope, setScope] = useState<PluginScope>('user')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const scopes: PluginScope[] = folder ? ['user', 'project', 'local'] : ['user']
  const problem =
    source.includes('"') || source.length > MAX_SOURCE || source.trim().startsWith('-')
      ? 'That doesn’t look like a source'
      : null

  const add = async (): Promise<void> => {
    if (!source.trim() || problem) return
    setBusy(true)
    setStatus(null)
    const res = await window.api.marketplaceAction({
      action: 'add',
      target: source.trim(),
      scope,
      ...(folder ? { folder } : {})
    })
    setBusy(false)
    setStatus(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error })
    if (res.ok) onAdded()
  }

  return (
    <form
      className="cc-editor"
      onSubmit={(e) => {
        e.preventDefault()
        void add()
      }}
    >
      <header className="cc-editor-head">
        <div>
          <h3>Add a marketplace</h3>
        </div>
      </header>
      <div className="cc-fields">
        <label className="field">
          <span>Where it is</span>
          <input
            type="text"
            value={source}
            placeholder="owner/repo, a git or https URL, or a folder"
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            autoFocus
          />
          {problem ? (
            <small className="field-error">{problem}</small>
          ) : (
            <small className="muted">e.g. anthropics/claude-code, or C:\work\our-plugins</small>
          )}
        </label>
        <label className="field">
          <span>Known in</span>
          <select value={scope} onChange={(e) => setScope(e.target.value as PluginScope)}>
            {scopes.map((s) => (
              <option key={s} value={s}>
                {PLUGIN_SCOPE_LABELS[s]}: {PLUGIN_SCOPE_HINTS[s]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <footer className="cc-editor-foot">
        {busy ? (
          <Loading text="Adding (it is downloaded)…" className="cc-status" />
        ) : (
          <StatusLine status={status} />
        )}
        <span className="cc-grow" />
        <button type="submit" className="primary" disabled={busy || !source.trim() || !!problem}>
          Add
        </button>
      </footer>
    </form>
  )
}

function MarketplaceDetail({
  item,
  onChanged,
  onRemoved
}: {
  item: Marketplace
  onChanged(): void
  onRemoved(): void
}): React.JSX.Element {
  const [busy, setBusy] = useState<string | null>(null)
  const [status, setStatus] = useState<Status | null>(null)

  const run = async (action: 'update' | 'remove', doing: string): Promise<void> => {
    if (action === 'remove') {
      const ok = await window.api.confirm({
        message: `Remove the marketplace "${item.name}"?`,
        detail: 'Plugins installed from it may stop working until you add it again.',
        okLabel: 'Remove'
      })
      if (!ok) return
    }
    setBusy(doing)
    setStatus(null)
    const res = await window.api.marketplaceAction({ action, target: item.name })
    setBusy(null)
    setStatus(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error })
    if (res.ok) (action === 'remove' ? onRemoved : onChanged)()
  }

  return (
    <div className="cc-editor">
      <header className="cc-editor-head">
        <div>
          <h3>{item.name}</h3>
          <small className="muted cc-mono">{item.source}</small>
        </div>
        <span className="cc-grow" />
        {item.url && <DocsLink href={item.url}>Its page</DocsLink>}
      </header>
      <div className="cc-fields">
        {item.installLocation && (
          <p className="small">
            Downloaded to{' '}
            <button
              type="button"
              className="cc-link"
              onClick={() => window.api.openFolder(item.installLocation!)}
            >
              {item.installLocation}
            </button>
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="secondary"
            disabled={!!busy}
            onClick={() => void run('update', 'Updating')}
          >
            Update
          </button>
          <button
            type="button"
            className="secondary danger"
            disabled={!!busy}
            onClick={() => void run('remove', 'Removing')}
          >
            Remove
          </button>
        </div>
        <p className="muted small">
          Update downloads its newest plugin list; installed plugins update under Plugins.
        </p>
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
