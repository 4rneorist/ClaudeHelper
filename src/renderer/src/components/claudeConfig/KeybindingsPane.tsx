import { useCallback, useState } from 'react'
import type { KeybindingsFile } from '../../../../shared/claudeConfig'
import {
  bindingProblem,
  bindingsText,
  KEYBINDING_CONTEXTS,
  parseBindings,
  type BindingRow,
  type ParsedBindings
} from '../../keybindingCatalog'
import { useDirty, useGuard, useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

const CONTEXTS = Object.keys(KEYBINDING_CONTEXTS)

/** Your Claude Code keybindings (~/.claude/keybindings.json): one row a key. */
export function KeybindingsPane(): React.JSX.Element {
  const load = useCallback(() => window.api.readKeybindings(), [])
  const { data: file, reload } = useLoad(load)
  if (!file) return <Loading text="Reading…" />
  return <KeybindingsEditor key={file.text ?? ''} file={file} onSaved={reload} />
}

function KeybindingsEditor({
  file,
  onSaved
}: {
  file: KeybindingsFile
  onSaved(): void
}): React.JSX.Element {
  const guard = useGuard()
  const [parsed, setParsed] = useState<ParsedBindings | null>(() => parseBindings(file.text))
  // As JSON when asked, or when the file is something the table can't show.
  const [json, setJson] = useState<string | null>(() =>
    parseBindings(file.text) ? null : (file.text ?? '')
  )
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const original = parseBindings(file.text)
  const text = json ?? (parsed ? bindingsText(parsed) : '')
  const dirty =
    json !== null ? json !== (file.text ?? '') : JSON.stringify(parsed) !== JSON.stringify(original)
  useDirty(dirty)

  const rows = parsed?.rows ?? []
  const setRows = (next: BindingRow[]): void =>
    setParsed((p) => ({ extra: p?.extra ?? {}, rows: next }))
  const change = (i: number, patch: Partial<BindingRow>): void =>
    setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const problems = rows.map((_, i) => bindingProblem(rows, i))

  const toggleJson = (): void => {
    if (json === null) {
      setJson(text)
      return
    }
    const p = parseBindings(json)
    if (!p) {
      setStatus({ ok: false, text: 'The table can only show a { "bindings": [...] } file' })
      return
    }
    setParsed(p)
    setJson(null)
    setStatus(null)
  }

  const save = async (): Promise<void> => {
    if (json === null && problems.some(Boolean)) {
      setStatus({ ok: false, text: 'Fix the rows marked in red first' })
      return
    }
    setBusy(true)
    const res = await window.api.saveKeybindings({ text, before: file.text })
    setBusy(false)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onSaved()
  }

  return (
    <div className="cc-editor cc-wide">
      <header className="cc-editor-head">
        <div>
          <h3>Keybindings</h3>
          <small className="muted cc-path" title={file.path}>
            {file.text === null ? `${file.path} (not there yet)` : file.path}
          </small>
        </div>
        <span className="cc-grow" />
        <DocsLink href="https://code.claude.com/docs/en/keybindings">Keys and actions</DocsLink>
      </header>
      <div className="cc-fields">
        <p className="muted small cc-note">
          Keys like <code>ctrl+e</code>, <code>meta+p</code>, <code>shift+tab</code>, or a chord:{' '}
          <code>ctrl+k ctrl+s</code>. Unbind a key Claude Code has to free it. Running sessions pick
          changes up right away.
        </p>
        {file.error && <p className="field-error">This file has a problem: {file.error}</p>}
        {json !== null ? (
          <label className="field cc-grow-field">
            <span>keybindings.json</span>
            <textarea
              className="cc-code"
              value={json}
              onChange={(e) => setJson(e.target.value)}
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            {rows.length === 0 ? (
              <p className="muted">No keys changed: Claude Code uses its own.</p>
            ) : (
              <table className="cc-keys">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th>Key</th>
                    <th>Does</th>
                    <th>Unbind</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={i} className={problems[i] ? 'bad' : undefined}>
                      <td>
                        <select
                          value={row.context}
                          onChange={(e) => change(i, { context: e.target.value })}
                        >
                          {!CONTEXTS.includes(row.context) && (
                            <option value={row.context}>{row.context}</option>
                          )}
                          {CONTEXTS.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={row.key}
                          placeholder="ctrl+e"
                          onChange={(e) => change(i, { key: e.target.value })}
                          spellCheck={false}
                          title={problems[i] ?? undefined}
                        />
                        {problems[i] && <small className="field-error">{problems[i]}</small>}
                      </td>
                      <td>
                        <input
                          type="text"
                          list={`cc-actions-${row.context}`}
                          value={row.action ?? ''}
                          placeholder={
                            row.action === null ? 'Nothing (unbound)' : 'chat:externalEditor'
                          }
                          disabled={row.action === null}
                          onChange={(e) => change(i, { action: e.target.value })}
                          spellCheck={false}
                        />
                      </td>
                      <td className="cc-center">
                        <input
                          type="checkbox"
                          checked={row.action === null}
                          aria-label="Unbind this key"
                          onChange={(e) => change(i, { action: e.target.checked ? null : '' })}
                        />
                      </td>
                      <td>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="Remove"
                          onClick={() => setRows(rows.filter((_, j) => j !== i))}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {CONTEXTS.map((c) => (
              <datalist key={c} id={`cc-actions-${c}`}>
                {KEYBINDING_CONTEXTS[c].map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            ))}
            <div className="row">
              <button
                type="button"
                className="secondary"
                disabled={!parsed}
                onClick={() => setRows([...rows, { context: 'Chat', key: '', action: '' }])}
              >
                Add key
              </button>
            </div>
          </>
        )}
      </div>
      <footer className="cc-editor-foot">
        <button type="button" className="secondary" onClick={toggleJson}>
          {json === null ? 'Edit as JSON' : 'Edit as table'}
        </button>
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
    </div>
  )
}
