import { useCallback, useEffect, useState } from 'react'
import {
  isNewName,
  NAMED_AREAS,
  type MemoryArea,
  type MemoryFile,
  type MemoryRef
} from '../../../../shared/claudeConfig'
import { useStore } from '../../store'
import { parentOf, trashName, useDirty, useGuard, useLoad, type Status } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'

const FILE_LABELS: Partial<Record<MemoryArea, string>> = {
  user: 'CLAUDE.md',
  project: 'CLAUDE.md',
  projectDot: '.claude/CLAUDE.md',
  local: 'CLAUDE.local.md'
}

const HINTS: Record<MemoryArea, string> = {
  user: 'Claude reads it in every project',
  userRule: 'A rule for every project',
  project: 'Read in this folder, and committed with it',
  projectDot: 'Read in this folder, and committed with it',
  local: 'Read in this folder; only yours, not committed',
  projectRule: 'A rule for this folder',
  note: 'A note Claude keeps about this folder'
}

const RULE_TEMPLATE = '# Rule\n\nWhat Claude should always do here.\n'

const keyOf = (f: MemoryRef): string => `${f.area}|${f.name ?? ''}`
const label = (f: MemoryRef): string => FILE_LABELS[f.area] ?? `${f.name}.md`
const isNamed = (area: MemoryArea): boolean => NAMED_AREAS.includes(area)

/** CLAUDE.md files, rules and Claude's own notes: what Claude reads when a session starts. */
export function MemoryPane({ folder }: { folder: string | null }): React.JSX.Element {
  const guard = useGuard()
  const load = useCallback(() => window.api.listMemory(folder), [folder])
  const { data: files, loading, reload } = useLoad(load)
  const [selected, setSelected] = useState<string | null>(null)

  const choose = async (key: string | null): Promise<void> => {
    if (key === selected) return
    if (await guard.leave()) setSelected(key)
  }
  const refresh = async (): Promise<void> => {
    if (await guard.leave()) reload()
  }

  const all = files ?? []
  const groups: { title: string; areas: MemoryArea[] }[] = [
    { title: 'Global', areas: ['user', 'userRule'] },
    ...(folder
      ? [
          { title: 'This folder', areas: ['project', 'projectDot', 'local', 'projectRule'] },
          { title: "Claude's notes on this folder", areas: ['note'] }
        ]
      : [])
  ] as { title: string; areas: MemoryArea[] }[]
  const current = all.find((f) => keyOf(f) === selected)
  const saved = (ref: MemoryRef): void => {
    reload()
    setSelected(keyOf(ref))
  }

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <button className="primary" onClick={() => void choose('new')}>
            + New rule
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
          {groups.map((g) => {
            const rows = all.filter((f) => g.areas.includes(f.area))
            return (
              <section key={g.title} className="cc-group">
                <h3>
                  <span>{g.title}</span>
                </h3>
                {rows.length === 0 ? (
                  loading && !files ? (
                    <Loading text="Reading…" />
                  ) : (
                    <p className="muted cc-empty">None yet: Claude writes them as it learns</p>
                  )
                ) : (
                  <ul className="cc-rows">
                    {rows.map((f) => (
                      <li key={keyOf(f)}>
                        <button
                          className={`cc-row${keyOf(f) === selected ? ' selected' : ''}`}
                          onClick={() => void choose(keyOf(f))}
                          title={f.path}
                        >
                          <span className="cc-row-name">
                            {isNamed(f.area) && f.area !== 'note' && (
                              <span className="muted">rules/</span>
                            )}
                            {label(f)}
                          </span>
                          <span className="cc-row-desc">
                            {f.exists ? HINTS[f.area] : 'Not there yet: write it to create it'}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )
          })}
        </div>
      </aside>
      <section className="cc-detail">
        {selected === 'new' ? (
          <MemoryEditor key="new" folder={folder} onSaved={saved} onDeleted={() => {}} />
        ) : current ? (
          <MemoryEditor
            key={keyOf(current)}
            folder={folder}
            file={current}
            onSaved={saved}
            onDeleted={() => {
              reload()
              setSelected(null)
            }}
          />
        ) : (
          <div className="cc-intro">
            <h3>Memory</h3>
            <p>
              What Claude reads when a session starts. <b>CLAUDE.md</b> holds what it should know
              and do: your conventions, commands, warnings. The one in your Claude folder works in
              every project; a folder&apos;s own goes to git with it, and <b>CLAUDE.local.md</b> is
              only yours.
            </p>
            <p>
              <b>Rules</b> are smaller files in <code>.claude/rules</code>, each about one thing; a
              rule can apply only to some files with <code>paths:</code> at its top.
            </p>
            <p>
              <b>Claude&apos;s notes</b> are what it wrote down itself about this folder (its auto
              memory). You can correct or remove them here.
            </p>
            <DocsLink href="https://code.claude.com/docs/en/memory">About memory</DocsLink>
          </div>
        )}
      </section>
    </div>
  )
}

interface EditorProps {
  folder: string | null
  /** The file being changed; absent for a new rule. */
  file?: MemoryFile
  onSaved(ref: MemoryRef): void
  onDeleted(): void
}

function MemoryEditor({ folder, file, onSaved, onDeleted }: EditorProps): React.JSX.Element {
  const guard = useGuard()
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const named = file ? isNamed(file.area) : true
  // As it is on disk (null when there is no file yet), and whether it has been read.
  const [saved, setSaved] = useState<string | null>(null)
  const [read, setRead] = useState(!file?.exists)
  const [text, setText] = useState(file ? '' : RULE_TEMPLATE)
  const [name, setName] = useState(file?.name ?? '')
  const [area, setArea] = useState<MemoryArea>(file?.area ?? (folder ? 'projectRule' : 'userRule'))
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!file?.exists) return
    let live = true
    void window.api.readMemory(file).then((t) => {
      if (!live) return
      setSaved(t)
      setText(t ?? '')
      setRead(true)
      if (t === null) setStatus({ ok: false, text: "It can't be read (too big, or gone)" })
    })
    return () => {
      live = false
    }
  }, [file])

  const renamed = named && (file ? name !== file.name : true)
  const nameProblem =
    renamed && !isNewName(name, area === 'note' ? 1 : 3)
      ? name === ''
        ? 'Give it a name'
        : 'Use lowercase letters, digits and hyphens, like testing'
      : null
  const dirty = read && (text !== (saved ?? (file ? '' : RULE_TEMPLATE)) || (named && renamed))
  useDirty(dirty)

  const save = async (): Promise<void> => {
    if (nameProblem) return
    const ref: MemoryRef = {
      area,
      ...(folder && area !== 'user' && area !== 'userRule'
        ? { folder: file?.folder ?? folder }
        : {}),
      ...(named ? { name } : {})
    }
    setBusy(true)
    const res = await window.api.saveMemory({
      ref,
      text,
      before: saved,
      ...(file && named ? { from: file.name } : {})
    })
    setBusy(false)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    setSaved(text)
    guard.setDirty(false)
    setStatus({ ok: true, text: 'Saved' })
    onSaved(ref)
  }

  const remove = async (): Promise<void> => {
    if (!file) return
    const ok = await window.api.confirm({
      message: `Delete ${label(file)}?`,
      detail: `${file.path}\n\nIt goes to ${trashName(platform)}.`,
      okLabel: 'Delete'
    })
    if (!ok) return
    const res = await window.api.deleteMemory(file)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onDeleted()
  }

  if (!read) return <Loading text="Reading…" />

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
          <h3>{file ? label(file) : 'New rule'}</h3>
          <small className="muted cc-path" title={file?.path}>
            {file ? file.path : HINTS[area]}
          </small>
        </div>
        <span className="cc-grow" />
        {file?.exists && (
          <button
            type="button"
            className="secondary"
            onClick={() => window.api.openFolder(parentOf(file.path))}
          >
            Open folder
          </button>
        )}
        {file?.exists && (
          <button type="button" className="secondary danger" onClick={() => void remove()}>
            Delete
          </button>
        )}
      </header>

      <div className="cc-fields">
        {named && (
          <div className="cc-row-fields">
            <label className="field">
              <span>Name</span>
              <input
                type="text"
                value={name}
                placeholder="e.g. testing"
                onChange={(e) => setName(e.target.value.trim())}
                spellCheck={false}
                autoFocus={!file}
              />
              {nameProblem && name !== '' && <small className="field-error">{nameProblem}</small>}
            </label>
            {!file && (
              <label className="field">
                <span>Save in</span>
                <select value={area} onChange={(e) => setArea(e.target.value as MemoryArea)}>
                  <option value="userRule">Global: every project</option>
                  {folder && <option value="projectRule">This folder</option>}
                </select>
              </label>
            )}
          </div>
        )}
        <label className="field cc-grow-field">
          <span>{file?.exists === false ? `${label(file)} (new)` : 'Text'}</span>
          <textarea
            className="cc-code"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={
              area === 'note'
                ? ''
                : '# This project\n\n- Build with npm run build\n- Never commit to master'
            }
            spellCheck={false}
            autoFocus={!!file && !file.exists}
          />
          {(area === 'userRule' || area === 'projectRule') && (
            <small className="muted">
              To apply it only to some files, start it with <code>---</code>,{' '}
              <code>paths: [&quot;src/**/*.ts&quot;]</code>, <code>---</code>.
            </small>
          )}
        </label>
      </div>

      <footer className="cc-editor-foot">
        <StatusLine status={status} />
        <span className="cc-grow" />
        {file && dirty && (
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setText(saved ?? '')
              setName(file.name ?? '')
              setStatus(null)
            }}
          >
            Revert
          </button>
        )}
        <button type="submit" className="primary" disabled={busy || !!nameProblem || !dirty}>
          {file?.exists === false ? 'Create' : file ? 'Save' : 'Create rule'}
        </button>
      </footer>
    </form>
  )
}
