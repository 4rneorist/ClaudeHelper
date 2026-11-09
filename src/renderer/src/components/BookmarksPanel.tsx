import { useState } from 'react'
import {
  MAX_BOOKMARK_DEPTH,
  MAX_BOOKMARK_TITLE,
  MAX_PROMPT_LENGTH,
  type BookmarkFolder,
  type BookmarkNode,
  type BookmarkPrompt
} from '../../../shared/bookmarks'
import { insertIntoActiveTerminal, toggleBookmarks } from '../actions'
import {
  applyDraft,
  countPrompts,
  draftFor,
  findNode,
  folderChoices,
  promptForHotkey,
  removeNode,
  updateNode,
  type BookmarkDraft
} from '../bookmarks'
import { hotkeyNotes } from '../hotkeyNotes'
import { hotkeyOf, hotkeyProblem, partialHotkey, showHotkey } from '../../../shared/hotkeys'
import { activeTerminalKey, useStore } from '../store'

/** How much of a prompt its tooltip shows. */
const PREVIEW_LENGTH = 400

/** A bookmark ribbon: the top bar's button for the panel. */
export function BookmarkIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 2.5h8v11l-4-2.75-4 2.75z" />
    </svg>
  )
}

function FolderPlusIcon(): React.JSX.Element {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M1.75 4.25V12.5h12.5V5.5H7.5L6 3.75H1.75z" />
      <path d="M8 7.25v3.5M6.25 9h3.5" />
    </svg>
  )
}

function TrashIcon(): React.JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 4h11M6 4V2.5h4V4M4 4l.75 9.5h6.5L12 4M6.75 6.5v4.5M9.25 6.5v4.5" />
    </svg>
  )
}

const newPrompt = (parent: string | null): BookmarkDraft => ({
  type: 'prompt',
  parent,
  title: '',
  text: ''
})
const newFolder = (parent: string | null): BookmarkDraft => ({ type: 'folder', parent, title: '' })

/**
 * The column on the right with the bookmarked prompts, in folders. A click puts a prompt into the
 * active terminal's prompt; the editor adds, changes and moves prompts and folders.
 */
export function BookmarksPanel(): React.JSX.Element {
  const bookmarks = useStore((s) => s.bookmarks)
  const draft = useStore((s) => s.bookmarkDraft)
  const editBookmark = useStore((s) => s.editBookmark)

  return (
    <aside className="bookmarks" aria-label="Bookmarks">
      <header>
        <strong>Bookmarks</strong>
        <button
          className="icon-button"
          aria-label="New prompt"
          title="New prompt"
          onClick={() => editBookmark(newPrompt(null))}
        >
          +
        </button>
        <button
          className="icon-button"
          aria-label="New folder"
          title="New folder"
          onClick={() => editBookmark(newFolder(null))}
        >
          <FolderPlusIcon />
        </button>
        <button
          className="icon-button"
          aria-label="Close bookmarks"
          title="Close"
          onClick={() => toggleBookmarks(false)}
        >
          ×
        </button>
      </header>
      {draft ? (
        <BookmarkEditor key={draft.seq} draft={draft} />
      ) : bookmarks.length > 0 ? (
        <BookmarkList nodes={bookmarks} depth={1} />
      ) : (
        <p className="bookmarks-empty muted">
          No bookmarks yet. Select text in a terminal and right-click → Add Selection to Bookmarks,
          or press + to write a prompt.
        </p>
      )}
    </aside>
  )
}

function BookmarkList({
  nodes,
  depth
}: {
  nodes: BookmarkNode[]
  depth: number
}): React.JSX.Element {
  return (
    <ul className="bookmark-list">
      {nodes.map((n) =>
        n.type === 'folder' ? (
          <FolderItem key={n.id} folder={n} depth={depth} />
        ) : (
          <PromptItem key={n.id} prompt={n} depth={depth} />
        )
      )}
    </ul>
  )
}

function FolderItem({
  folder,
  depth
}: {
  folder: BookmarkFolder
  depth: number
}): React.JSX.Element {
  const editBookmark = useStore((s) => s.editBookmark)
  const toggle = (): void => {
    const { bookmarks, setBookmarks } = useStore.getState()
    setBookmarks(
      updateNode(bookmarks, folder.id, (n) =>
        n.type === 'folder' ? { ...n, collapsed: !n.collapsed } : n
      )
    )
  }
  // A folder at the deepest level takes nothing more.
  const canHold = depth < MAX_BOOKMARK_DEPTH

  return (
    <li>
      <div className="bookmark-row" style={{ paddingLeft: indent(depth) }}>
        <button
          className="bookmark-main folder"
          aria-expanded={!folder.collapsed}
          title={folder.title}
          onClick={toggle}
        >
          <span className="bookmark-chevron" aria-hidden="true">
            {folder.collapsed ? '▸' : '▾'}
          </span>
          <span className="bookmark-title">{folder.title}</span>
        </button>
        <span className="bookmark-actions">
          {canHold && (
            <>
              <button
                aria-label={`New prompt in ${folder.title}`}
                title="New prompt here"
                onClick={() => editBookmark(newPrompt(folder.id))}
              >
                +
              </button>
              <button
                aria-label={`New folder in ${folder.title}`}
                title="New folder here"
                onClick={() => editBookmark(newFolder(folder.id))}
              >
                <FolderPlusIcon />
              </button>
            </>
          )}
          <EditButtons node={folder} />
        </span>
      </div>
      {!folder.collapsed &&
        (folder.children.length > 0 ? (
          <BookmarkList nodes={folder.children} depth={depth + 1} />
        ) : (
          <div className="bookmark-row muted empty" style={{ paddingLeft: indent(depth + 1) }}>
            Empty
          </div>
        ))}
    </li>
  )
}

function PromptItem({
  prompt,
  depth
}: {
  prompt: BookmarkPrompt
  depth: number
}): React.JSX.Element {
  const canInsert = useStore((s) => activeTerminalKey(s) !== null)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const preview =
    prompt.text.length > PREVIEW_LENGTH ? `${prompt.text.slice(0, PREVIEW_LENGTH)}…` : prompt.text
  const key = prompt.hotkey ? showHotkey(prompt.hotkey, platform) : null

  return (
    <li>
      <div className="bookmark-row" style={{ paddingLeft: indent(depth) }}>
        <button
          className="bookmark-main"
          disabled={!canInsert}
          title={
            canInsert
              ? `${preview}\n\nClick${key ? ` or press ${key}` : ''} to put it into the prompt`
              : 'Open a session first'
          }
          onClick={() => insertIntoActiveTerminal(prompt.text)}
        >
          <span className="bookmark-title">{prompt.title}</span>
          {key && <kbd className="bookmark-key">{key}</kbd>}
        </button>
        <span className="bookmark-actions">
          <EditButtons node={prompt} />
        </span>
      </div>
    </li>
  )
}

function EditButtons({ node }: { node: BookmarkNode }): React.JSX.Element {
  const edit = (): void => {
    const { bookmarks, editBookmark } = useStore.getState()
    editBookmark(draftFor(bookmarks, node))
  }
  const remove = async (): Promise<void> => {
    const prompts = countPrompts(node)
    const ok = await window.api.confirm(
      node.type === 'folder'
        ? {
            message: `Delete the folder "${node.title}"?`,
            detail: prompts
              ? `The ${prompts} prompt${prompts === 1 ? '' : 's'} in it go too.`
              : undefined,
            okLabel: 'Delete'
          }
        : { message: `Delete the bookmark "${node.title}"?`, okLabel: 'Delete' }
    )
    if (!ok) return
    const { bookmarks, setBookmarks } = useStore.getState()
    setBookmarks(removeNode(bookmarks, node.id))
  }
  const what = node.type === 'folder' ? 'folder' : 'bookmark'

  return (
    <>
      <button aria-label={`Edit ${what} ${node.title}`} title="Edit or move" onClick={edit}>
        ✎
      </button>
      <button
        aria-label={`Delete ${what} ${node.title}`}
        title="Delete"
        onClick={() => void remove()}
      >
        <TrashIcon />
      </button>
    </>
  )
}

/** Adds or changes a prompt or folder: its title, its text and the folder it is in. */
function BookmarkEditor({ draft }: { draft: BookmarkDraft }): React.JSX.Element {
  const bookmarks = useStore((s) => s.bookmarks)
  const editBookmark = useStore((s) => s.editBookmark)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const [title, setTitle] = useState(draft.title)
  const [text, setText] = useState(draft.type === 'prompt' ? draft.text : '')
  const [hotkey, setHotkey] = useState(draft.type === 'prompt' ? draft.hotkey : undefined)
  const [parent, setParent] = useState(draft.parent)
  const editing = draft.id !== undefined ? findNode(bookmarks, draft.id) : null
  const choices = folderChoices(bookmarks, editing ?? undefined)
  const isPrompt = draft.type === 'prompt'
  const keyProblem = hotkey ? hotkeyProblem(hotkey, platform) : null
  const valid = (isPrompt ? text.trim() !== '' : title.trim() !== '') && !keyProblem
  const heading = `${editing ? 'Edit' : 'New'} ${isPrompt ? 'prompt' : 'folder'}`

  const save = (): void => {
    if (!valid) return
    const next: BookmarkDraft = isPrompt
      ? { type: 'prompt', id: draft.id, parent, title, text, ...(hotkey ? { hotkey } : {}) }
      : { type: 'folder', id: draft.id, parent, title }
    const { bookmarks, setBookmarks } = useStore.getState()
    setBookmarks(applyDraft(bookmarks, next))
    editBookmark(null)
  }

  return (
    <form
      className="bookmark-editor"
      aria-label={heading}
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') editBookmark(null)
        else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault()
          save()
        }
      }}
    >
      <h3>{heading}</h3>
      <label className="field">
        <span>Title</span>
        <input
          type="text"
          value={title}
          maxLength={MAX_BOOKMARK_TITLE}
          placeholder={isPrompt ? 'Its first line, if empty' : 'Folder name'}
          autoFocus={!isPrompt || text !== ''}
          onChange={(e) => setTitle(e.target.value)}
        />
      </label>
      {isPrompt && (
        <label className="field">
          <span>Prompt</span>
          <textarea
            value={text}
            rows={10}
            maxLength={MAX_PROMPT_LENGTH}
            autoFocus={text === ''}
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
      )}
      {isPrompt && (
        <HotkeyField
          value={hotkey}
          onChange={setHotkey}
          platform={platform}
          problem={keyProblem}
          takenBy={(() => {
            const other = hotkey ? promptForHotkey(bookmarks, hotkey) : null
            return other && other.id !== draft.id ? other.title : null
          })()}
        />
      )}
      <label className="field">
        <span>Folder</span>
        <select
          value={parent ?? ''}
          onChange={(e) => setParent(e.target.value === '' ? null : e.target.value)}
        >
          {choices.map((c) => (
            <option key={c.id ?? ''} value={c.id ?? ''}>
              {c.label}
            </option>
          ))}
        </select>
      </label>
      <div className="row end">
        <button type="button" className="secondary" onClick={() => editBookmark(null)}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={!valid} title="Ctrl+Enter">
          Save
        </button>
      </div>
    </form>
  )
}

/**
 * Records a hotkey: focus it and press the keys. Backspace or Delete clears it; Tab moves on;
 * Escape stops recording.
 */
function HotkeyField({
  value,
  onChange,
  platform,
  problem,
  takenBy
}: {
  value: string | undefined
  onChange(hotkey: string | undefined): void
  platform: string
  problem: string | null
  takenBy: string | null
}): React.JSX.Element {
  // The modifiers held while recording ("Ctrl+Shift+…").
  const [held, setHeld] = useState('')
  const notes = value && !problem ? hotkeyNotes(value, platform) : []
  const record = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const mods = e.ctrlKey || e.altKey || e.metaKey || e.shiftKey
    if (e.key === 'Tab' && !mods) return
    e.preventDefault()
    e.stopPropagation() // not the editor's own Escape and Ctrl+Enter
    if (!mods && (e.key === 'Backspace' || e.key === 'Delete')) {
      setHeld('')
      onChange(undefined)
      return
    }
    if (!mods && e.key === 'Escape') {
      setHeld('')
      e.currentTarget.blur()
      return
    }
    const hotkey = hotkeyOf(e.nativeEvent)
    if (!hotkey) {
      setHeld(partialHotkey(e))
      return
    }
    setHeld('')
    onChange(hotkey)
  }
  return (
    <label className="field">
      <span>Hotkey</span>
      <div className="row hotkey-row">
        <input
          type="text"
          className="hotkey-input"
          readOnly
          value={held || (value ? showHotkey(value, platform) : '')}
          placeholder="Click, then press the keys"
          onKeyDown={record}
          onKeyUp={(e) => {
            if (!e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) setHeld('')
          }}
          onBlur={() => setHeld('')}
          spellCheck={false}
        />
        {value && (
          <button type="button" className="secondary" onClick={() => onChange(undefined)}>
            Clear
          </button>
        )}
      </div>
      {problem ? (
        <small className="field-error">{problem}</small>
      ) : value ? (
        <small className="muted">
          Pastes it into the terminal, unsent.
          {takenBy && ` It is now on “${takenBy}”: saving moves it here.`}
          {notes.map((n) => ` ${n}`)}
        </small>
      ) : (
        <small className="muted">Optional: a key like Ctrl+Shift+C that pastes it.</small>
      )}
    </label>
  )
}

const indent = (depth: number): number => 4 + (depth - 1) * 12
