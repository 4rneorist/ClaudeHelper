import type { ReadOnlyHook, ReadOnlyItem } from '../../../../shared/claudeConfig'
import { hookSummary } from '../../claudeConfig'
import { readOnlyName } from './extras'
import { parentOf } from './guard'

/** What comes from claude.ai or a plugin: shown in full, and where to change it. */

function where(item: { source?: string; plugin?: string }): string {
  return item.plugin
    ? `Comes with the plugin ${item.plugin}: turn it off or uninstall it under Plugins.`
    : 'Synced from your claude.ai account: it is changed on claude.ai, with your other skills there.'
}

export function ReadOnlyItemView({ item }: { item: ReadOnlyItem }): React.JSX.Element {
  const slash = item.kind === 'skill' || item.kind === 'command'
  return (
    <div className="cc-editor">
      <header className="cc-editor-head">
        <div>
          <h3>
            {slash ? '/' : ''}
            {readOnlyName(item)}
            <span className="cc-badge">{item.plugin ? 'plugin' : 'claude.ai'}</span>
          </h3>
          <small className="muted cc-path" title={item.path}>
            {item.path}
          </small>
        </div>
        <span className="cc-grow" />
        <button
          type="button"
          className="secondary"
          onClick={() => window.api.openFolder(parentOf(item.path))}
        >
          Open folder
        </button>
      </header>
      <div className="cc-fields">
        <p className="muted cc-note">{where(item)}</p>
        {item.description && <p className="cc-note">{item.description}</p>}
        <label className="field cc-grow-field">
          <span>{item.kind === 'skill' ? 'SKILL.md' : 'File'}</span>
          <textarea className="cc-code" value={item.text} readOnly spellCheck={false} />
        </label>
      </div>
    </div>
  )
}

export function ReadOnlyHookView({ hook }: { hook: ReadOnlyHook }): React.JSX.Element {
  return (
    <div className="cc-editor">
      <header className="cc-editor-head">
        <div>
          <h3>
            {hook.event} hook<span className="cc-badge">plugin</span>
          </h3>
          <small className="muted cc-path" title={hook.path}>
            {hook.path}
          </small>
        </div>
      </header>
      <div className="cc-fields">
        <p className="muted cc-note">{where(hook)}</p>
        <div className="cc-row-fields">
          <label className="field">
            <span>When</span>
            <input type="text" value={hook.event} readOnly />
          </label>
          <label className="field">
            <span>Matcher</span>
            <input type="text" value={hook.matcher || 'Every time'} readOnly />
          </label>
        </div>
        <label className="field">
          <span>Does</span>
          <input type="text" value={hookSummary(hook.handler)} readOnly spellCheck={false} />
        </label>
        <label className="field cc-grow-field">
          <span>Handler (JSON)</span>
          <textarea
            className="cc-code"
            value={JSON.stringify(hook.handler, null, 2)}
            readOnly
            spellCheck={false}
          />
        </label>
      </div>
    </div>
  )
}

/** A group of rows that come from elsewhere, in a section's list. */
export function ReadOnlyGroup<T>({
  title,
  rows,
  keyOf,
  selected,
  onChoose,
  name,
  desc
}: {
  title: string
  rows: T[]
  keyOf(row: T): string
  selected: string | null
  onChoose(key: string): void
  name(row: T): React.ReactNode
  desc(row: T): string
}): React.JSX.Element | null {
  if (rows.length === 0) return null
  return (
    <section className="cc-group">
      <h3>
        <span>
          {title} ({rows.length})
        </span>
      </h3>
      <ul className="cc-rows">
        {rows.map((row) => (
          <li key={keyOf(row)}>
            <button
              className={`cc-row${keyOf(row) === selected ? ' selected' : ''}`}
              onClick={() => onChoose(keyOf(row))}
            >
              <span className="cc-row-name">{name(row)}</span>
              <span className="cc-row-desc">{desc(row)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
