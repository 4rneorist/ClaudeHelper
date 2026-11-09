import { useCallback, useEffect, useState } from 'react'
import {
  AGENT_COLORS,
  AGENT_MODELS,
  ITEM_DEPTH,
  isNewName,
  type ClaudeItem,
  type ClaudeItemRef,
  type ItemKind,
  type ItemScope,
  type ReadOnlyItem
} from '../../../../shared/claudeConfig'
import {
  fieldText,
  joinFrontmatter,
  newAgentText,
  newCommandText,
  newOutputStyleText,
  newSkillText,
  readFields,
  setTextField,
  splitFrontmatter
} from '../../../../shared/frontmatter'
import { ITEM_SCOPE_LABELS } from '../../claudeConfig'
import { useStore } from '../../store'
import { forgetExtras, loadExtras, readOnlyName } from './extras'
import { parentOf, trashName, useDirty, useGuard, useLoad, type Status } from './guard'
import { ReadOnlyGroup, ReadOnlyItemView } from './ReadOnly'
import { DocsLink, Loading, StatusLine } from './shared'

interface KindInfo {
  noun: string
  title: string
  docs: string
  folder: string
  template(): string
  body: string
  placeholder: string
  describe: string
  /** Its frontmatter `name` follows the file name (commands are named by their file only). */
  named: boolean
  intro: React.ReactNode
}

const KINDS: Record<ItemKind, KindInfo> = {
  skill: {
    noun: 'skill',
    title: 'Skills',
    docs: 'https://code.claude.com/docs/en/skills',
    folder: 'skills',
    template: newSkillText,
    body: 'Instructions',
    placeholder: 'e.g. release-notes',
    describe: 'What it does, and when Claude should use it',
    named: true,
    intro: (
      <p>
        A skill is a folder with a SKILL.md: instructions Claude follows for one kind of task, and
        any scripts or notes they need. Claude uses one on its own when its description fits what
        you asked, and you can run it yourself as <code>/name</code>.
      </p>
    )
  },
  command: {
    noun: 'command',
    title: 'Commands',
    docs: 'https://code.claude.com/docs/en/slash-commands',
    folder: 'commands',
    template: newCommandText,
    body: 'Prompt',
    placeholder: 'e.g. fix-issue, or team/deploy',
    describe: 'What it does (shown in the / menu)',
    named: false,
    intro: (
      <p>
        A command is a prompt you keep in a file and run by typing <code>/name</code>, with what you
        type after it as <code>$ARGUMENTS</code>. A file in a subfolder runs as{' '}
        <code>/folder:name</code>. Skills do the same and more; commands are the older, simpler
        form, and still work.
      </p>
    )
  },
  agent: {
    noun: 'agent',
    title: 'Agents',
    docs: 'https://code.claude.com/docs/en/sub-agents',
    folder: 'agents',
    template: newAgentText,
    body: 'System prompt',
    placeholder: 'e.g. code-reviewer',
    describe: 'When Claude should hand work to this agent',
    named: true,
    intro: (
      <p>
        An agent is a helper Claude can hand work to. It has its own instructions, tools and model,
        and works in its own context, so only its answer comes back to the conversation.
      </p>
    )
  },
  outputStyle: {
    noun: 'output style',
    title: 'Output styles',
    docs: 'https://code.claude.com/docs/en/output-styles',
    folder: 'output-styles',
    template: newOutputStyleText,
    body: 'Instructions',
    placeholder: 'e.g. teacher',
    describe: 'What this style is like (shown when you pick one)',
    named: true,
    intro: (
      <p>
        An output style changes how Claude talks and works: its instructions take the place of
        Claude&apos;s usual ones for software work. Pick one with <code>/output-style</code> in
        Claude, or in Settings here.
      </p>
    )
  }
}

const keyOf = (item: { scope: ItemScope; name: string }): string => `${item.scope}|${item.name}`

/** How you run a skill or command: /name, or /folder:name for one in a subfolder. */
const slash = (name: string): string => `/${(name || 'name').split('/').join(':')}`

/** Skills, commands, agents or output styles: this folder's and your own, and an editor. */
export function ItemsPane({
  kind,
  folder
}: {
  kind: ItemKind
  folder: string | null
}): React.JSX.Element {
  const guard = useGuard()
  const info = KINDS[kind]
  const load = useCallback(() => window.api.listClaudeItems(kind, folder), [kind, folder])
  const { data: list, loading, reload } = useLoad(load)
  // What claude.ai syncs and plugins bring: shown, not changed here.
  const loadOthers = useCallback(() => loadExtras(folder), [folder])
  const { data: extras, reload: reloadOthers } = useLoad(loadOthers)
  const [selected, setSelected] = useState<string | null>(null)

  const choose = async (key: string | null): Promise<void> => {
    if (key === selected) return
    if (await guard.leave()) setSelected(key)
  }
  const refresh = async (): Promise<void> => {
    if (!(await guard.leave())) return
    forgetExtras()
    reload()
    reloadOthers()
  }
  const others = (extras?.items ?? []).filter((i) => i.kind === kind)
  const fromClaudeAi = others.filter((i) => i.source === 'claude.ai')
  const fromPlugins = others.filter((i) => i.source === 'plugin')
  const otherKey = (i: ReadOnlyItem): string => `other|${i.path}`
  const currentOther = others.find((i) => otherKey(i) === selected)

  const items = list?.items ?? []
  const groups: { scope: ItemScope; dir: string | null | undefined; items: ClaudeItem[] }[] = [
    ...(folder
      ? [
          {
            scope: 'project' as const,
            dir: list?.projectDir,
            items: items.filter((i) => i.scope === 'project')
          }
        ]
      : []),
    { scope: 'user', dir: list?.userDir, items: items.filter((i) => i.scope === 'user') }
  ]
  const current = items.find((i) => keyOf(i) === selected)
  const saved = (ref: ClaudeItemRef): void => {
    reload()
    setSelected(keyOf(ref))
  }

  return (
    <div className="cc-split">
      <aside className="cc-list">
        <div className="cc-list-tools">
          <button className="primary" onClick={() => void choose('new')}>
            + New {info.noun}
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
          {groups.map((g) => (
            <section key={g.scope} className="cc-group">
              <h3 title={g.dir ?? undefined}>
                <span>{ITEM_SCOPE_LABELS[g.scope]}</span>
                {g.dir && (
                  <button
                    className="cc-link"
                    title={`Open ${g.dir}`}
                    onClick={() => window.api.openFolder(g.dir!)}
                  >
                    Open folder
                  </button>
                )}
              </h3>
              {g.items.length === 0 ? (
                loading && !list ? (
                  <Loading text="Reading…" />
                ) : (
                  <p className="muted cc-empty">No {info.noun}s here yet</p>
                )
              ) : (
                <ul className="cc-rows">
                  {g.items.map((item) => (
                    <li key={keyOf(item)}>
                      <button
                        className={`cc-row${keyOf(item) === selected ? ' selected' : ''}`}
                        onClick={() => void choose(keyOf(item))}
                        title={item.path}
                      >
                        <span className="cc-row-name">
                          {kind === 'command' ? slash(item.name) : item.name}
                          {item.problem && (
                            <span className="cc-warn" title={item.problem}>
                              ⚠
                            </span>
                          )}
                        </span>
                        <span className="cc-row-desc">{item.description || item.problem}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {[
            { title: 'From claude.ai', rows: fromClaudeAi },
            { title: 'From plugins', rows: fromPlugins }
          ].map((g) => (
            <ReadOnlyGroup
              key={g.title}
              title={g.title}
              rows={g.rows}
              keyOf={otherKey}
              selected={selected}
              onChoose={(key) => void choose(key)}
              name={(i) => (kind === 'skill' || kind === 'command' ? '/' : '') + readOnlyName(i)}
              desc={(i) => i.description}
            />
          ))}
          {!extras && <Loading text="Looking at what plugins bring…" />}
          {extras?.error && (
            <p className="muted cc-empty" title={extras.error}>
              Plugins couldn&apos;t be asked: {extras.error}
            </p>
          )}
        </div>
      </aside>
      <section className="cc-detail">
        {currentOther ? (
          <ReadOnlyItemView key={otherKey(currentOther)} item={currentOther} />
        ) : selected === 'new' ? (
          <ItemEditor
            key="new"
            kind={kind}
            folder={folder}
            onSaved={saved}
            onDeleted={() => setSelected(null)}
          />
        ) : current ? (
          <ItemEditor
            key={keyOf(current)}
            kind={kind}
            folder={folder}
            item={current}
            onSaved={saved}
            onDeleted={() => {
              reload()
              setSelected(null)
            }}
          />
        ) : (
          <div className="cc-intro">
            <h3>{info.title}</h3>
            {info.intro}
            <p>
              <b>Global</b> ones (in your Claude folder) work in every project. <b>This folder</b>
              &apos;s are in its <code>.claude/{info.folder}</code>, and go to git with the project.
            </p>
            <p className="muted">Pick one on the left, or make a new one.</p>
            <DocsLink href={info.docs}>{`About ${info.title.toLowerCase()}`}</DocsLink>
          </div>
        )}
      </section>
    </div>
  )
}

interface EditorProps {
  kind: ItemKind
  folder: string | null
  /** The one being changed; absent for a new one. */
  item?: ClaudeItem
  onSaved(ref: ClaudeItemRef): void
  onDeleted(): void
}

function ItemEditor({ kind, folder, item, onSaved, onDeleted }: EditorProps): React.JSX.Element {
  const guard = useGuard()
  const info = KINDS[kind]
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const [blank] = useState(() => info.template())
  // The text as it is on disk (null while it is read), and as edited.
  const [saved, setSaved] = useState<string | null>(item ? null : blank)
  const [text, setText] = useState(blank)
  const [name, setName] = useState(item?.name ?? '')
  const [scope, setScope] = useState<ItemScope>(item?.scope ?? (folder ? 'project' : 'user'))
  const [raw, setRaw] = useState(false)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!item) return
    let live = true
    void window.api.readClaudeItem(item).then((t) => {
      if (!live) return
      setSaved(t ?? '')
      setText(t ?? '')
      if (t === null) setStatus({ ok: false, text: "It can't be read (too big, or gone)" })
    })
    return () => {
      live = false
    }
  }, [item])

  const renamed = item ? name !== item.name : true
  const nameProblem =
    renamed && !isNewName(name, ITEM_DEPTH[kind])
      ? name === ''
        ? 'Give it a name'
        : ITEM_DEPTH[kind] > 1
          ? 'Use lowercase letters, digits and hyphens, maybe in a folder: team/review'
          : 'Use lowercase letters, digits and hyphens, like code-review'
      : null
  const dirty = saved !== null && (text !== saved || (item ? name !== item.name : name !== ''))
  useDirty(dirty)

  const { yaml, body } = splitFrontmatter(text)
  let fields: Record<string, unknown> = {}
  let yamlError: string | null = null
  try {
    fields = readFields(yaml)
  } catch (err) {
    yamlError = err instanceof Error ? err.message.split('\n')[0] : String(err)
  }
  const field = (key: string): string => fieldText(fields[key])
  // The blank line after the frontmatter isn't part of what you write.
  const lead = yaml !== null && body.startsWith('\n') ? '\n' : ''
  const set = (key: string, value: string | boolean | undefined): void =>
    setText((t) => setTextField(t, key, value))

  const changeName = (value: string): void => {
    setName(value)
    // The frontmatter's name is what Claude Code calls it.
    if (info.named && value && !yamlError) set('name', value.split('/').pop()!)
  }

  const save = async (): Promise<void> => {
    if (nameProblem) return
    const ref: ClaudeItemRef = {
      kind,
      scope,
      ...(scope === 'project' && folder ? { folder: item?.folder ?? folder } : {}),
      name
    }
    setBusy(true)
    const res = await window.api.saveClaudeItem({
      ref,
      text,
      ...(item ? { from: item.name } : {})
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

  const revert = (): void => {
    if (saved === null) return
    setText(saved)
    setName(item?.name ?? '')
    setStatus(null)
  }

  const remove = async (): Promise<void> => {
    if (!item) return
    const ok = await window.api.confirm({
      message: `Delete the ${info.noun} "${item.name}"?`,
      detail:
        kind === 'skill'
          ? `Its folder, with everything in it, goes to ${trashName(platform)}.`
          : `Its file goes to ${trashName(platform)}.`,
      okLabel: 'Delete'
    })
    if (!ok) return
    const res = await window.api.deleteClaudeItem(item)
    if (!res.ok) {
      setStatus({ ok: false, text: res.error })
      return
    }
    guard.setDirty(false)
    onDeleted()
  }

  if (saved === null) return <Loading text="Reading…" />

  const off = !!yamlError
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
          <h3>{item ? (kind === 'command' ? slash(item.name) : item.name) : `New ${info.noun}`}</h3>
          {item && (
            <small className="muted cc-path" title={item.path}>
              {item.path}
            </small>
          )}
        </div>
        <span className="cc-grow" />
        {item && (
          <button
            type="button"
            className="secondary"
            onClick={() => window.api.openFolder(parentOf(item.path))}
          >
            Open folder
          </button>
        )}
        {item && (
          <button type="button" className="secondary danger" onClick={() => void remove()}>
            Delete
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
              placeholder={info.placeholder}
              onChange={(e) => changeName(e.target.value.trim())}
              spellCheck={false}
              autoFocus={!item}
            />
            {nameProblem && name !== '' ? (
              <small className="field-error">{nameProblem}</small>
            ) : kind === 'skill' || kind === 'command' ? (
              <small className="muted">
                You run it as <code>{slash(name)}</code>.
              </small>
            ) : null}
          </label>
          {!item && (
            <label className="field">
              <span>Save in</span>
              <select value={scope} onChange={(e) => setScope(e.target.value as ItemScope)}>
                <option value="user">Global: every project</option>
                {folder && <option value="project">This folder</option>}
              </select>
            </label>
          )}
        </div>

        {raw ? (
          <label className="field cc-grow-field">
            <span>{kind === 'skill' ? 'SKILL.md' : 'File'}</span>
            <textarea
              className="cc-code"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
          </label>
        ) : (
          <>
            {yamlError && (
              <p className="field-error">
                The settings at the top of the file aren&apos;t valid YAML ({yamlError}). Fix them
                with “Edit as text”.
              </p>
            )}
            <label className="field">
              <span>Description</span>
              <textarea
                rows={kind === 'command' || kind === 'outputStyle' ? 2 : 3}
                value={field('description')}
                disabled={off}
                placeholder={info.describe}
                onChange={(e) => set('description', e.target.value || undefined)}
              />
              {(kind === 'skill' || kind === 'agent') && (
                <small className="muted">
                  Claude reads this to decide when to use it, so say when it fits.
                </small>
              )}
            </label>

            {kind === 'skill' && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={fields['disable-model-invocation'] !== true}
                  disabled={off}
                  onChange={(e) =>
                    set('disable-model-invocation', e.target.checked ? undefined : true)
                  }
                />
                <span>
                  Claude may use it on its own (otherwise only when you type {slash(name)})
                </span>
              </label>
            )}
            {kind === 'command' && (
              <label className="field">
                <span>Argument hint</span>
                <input
                  type="text"
                  value={field('argument-hint')}
                  disabled={off}
                  placeholder="e.g. [issue number]"
                  onChange={(e) => set('argument-hint', e.target.value || undefined)}
                  spellCheck={false}
                />
                <small className="muted">Shown after the command while you type it.</small>
              </label>
            )}
            {kind === 'outputStyle' && (
              <label className="field checkbox">
                <input
                  type="checkbox"
                  checked={fields['keep-coding-instructions'] === true}
                  disabled={off}
                  onChange={(e) =>
                    set('keep-coding-instructions', e.target.checked ? true : undefined)
                  }
                />
                <span>
                  Keep Claude&apos;s instructions for software work, and add these to them
                </span>
              </label>
            )}
            {kind === 'agent' && <AgentFields field={field} set={set} disabled={off} />}

            <label className="field cc-grow-field">
              <span>{info.body}</span>
              <textarea
                className="cc-code"
                value={body.slice(lead.length)}
                onChange={(e) => setText(joinFrontmatter(yaml, lead + e.target.value))}
                placeholder="Markdown"
                spellCheck={false}
              />
            </label>
          </>
        )}
      </div>

      <footer className="cc-editor-foot">
        <button
          type="button"
          className="secondary"
          onClick={() => setRaw((r) => !r)}
          title="The whole file, with every setting it has"
        >
          {raw ? 'Edit as form' : 'Edit as text'}
        </button>
        <StatusLine status={status} />
        <span className="cc-grow" />
        {item && dirty && (
          <button type="button" className="secondary" onClick={revert}>
            Revert
          </button>
        )}
        <button
          type="submit"
          className="primary"
          disabled={busy || !!nameProblem || (!!item && !dirty)}
        >
          {item ? 'Save' : `Create ${info.noun}`}
        </button>
      </footer>
    </form>
  )
}

function AgentFields({
  field,
  set,
  disabled
}: {
  field(key: string): string
  set(key: string, value: string | undefined): void
  disabled: boolean
}): React.JSX.Element {
  const model = field('model')
  const color = field('color')
  return (
    <div className="cc-row-fields">
      <label className="field">
        <span>Tools</span>
        <input
          type="text"
          value={field('tools')}
          disabled={disabled}
          placeholder="All of them"
          onChange={(e) => set('tools', e.target.value || undefined)}
          spellCheck={false}
        />
        <small className="muted">e.g. Read, Grep, Glob. Empty: all tools.</small>
      </label>
      <label className="field">
        <span>Model</span>
        <select
          value={model}
          disabled={disabled}
          onChange={(e) => set('model', e.target.value || undefined)}
        >
          <option value="">Default</option>
          {AGENT_MODELS.map((m) => (
            <option key={m} value={m}>
              {m === 'inherit' ? 'Same as the session' : m}
            </option>
          ))}
          {model && !(AGENT_MODELS as readonly string[]).includes(model) && (
            <option value={model}>{model}</option>
          )}
        </select>
      </label>
      <label className="field">
        <span>Color</span>
        <select
          value={color}
          disabled={disabled}
          onChange={(e) => set('color', e.target.value || undefined)}
        >
          <option value="">None</option>
          {AGENT_COLORS.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {color && !(AGENT_COLORS as readonly string[]).includes(color) && (
            <option value={color}>{color}</option>
          )}
        </select>
      </label>
    </div>
  )
}
