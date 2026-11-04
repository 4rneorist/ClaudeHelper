import { TOPIC_COLORS, type ClaudeQuestion } from '../../shared/ipc'
import { leaves } from './layout'
import { dotStatus, workspaceTitle, type DotStatus, type State, type TerminalState } from './store'
import { hasTickBox, withoutTickBox } from './terminal/claudeActivity'

// The Claude chats as Telegram's remote control names them: numbered in the order the tabs show
// them, or found by name. Pure, for unit tests.

/** A Claude chat as Telegram lists it. */
export interface Chat {
  /** Its number in /chats: folders, then their tabs, in the order shown. */
  n: number
  key: string
  folder: string
  title: string
  status: DotStatus
}

export const STATUS_ICONS: Record<DotStatus, string> = {
  asking: '🔔',
  working: '⏳',
  idle: '✅',
  starting: '🚀',
  running: '▶️',
  dormant: '💤',
  exited: '⏹',
  error: '⚠️'
}

/** Rows /getchat shows unless told otherwise, and at most. */
export const DEFAULT_ROWS = 50
export const MAX_ROWS = 100

export const HELP = [
  'ClaudeHelper remote control',
  '',
  'Reply to a message about a chat (swipe it) to send that chat a prompt, or to answer its question. Questions also come with buttons. Once Claude is done, its whole reply comes here.',
  '',
  'With Threaded Mode on for this bot (in @BotFather), each chat gets its own topic: just write there, and /getchat and /prompt need no chat name.',
  '',
  '/chats – the open chats, numbered',
  '/newchat [name] – open a new chat in a folder',
  '/prompt <chat> <text> – send a prompt; <chat> is a number from /chats or a name',
  `/getchat <chat> [rows] – what the chat shows (${DEFAULT_ROWS} rows)`
].join('\n')

type ChatState = Pick<State, 'workspaces' | 'terminals' | 'settings' | 'appInfo'>

/** The Claude chats in the order the tabs show them. */
export function chatList(state: ChatState): Chat[] {
  const chats: Chat[] = []
  const platform = state.appInfo?.platform ?? ''
  for (const ws of state.workspaces) {
    if (ws.kind !== 'folder') continue
    const folder = workspaceTitle(ws, state.settings?.folderTitles, platform)
    for (const sub of ws.subTabs) {
      for (const key of leaves(sub.layout)) {
        const t = state.terminals[key]
        if (t?.spec.kind !== 'claude') continue
        chats.push({ n: chats.length + 1, key, folder, title: t.title, status: dotStatus(t) })
      }
    }
  }
  return chats
}

export function chatLabel(chat: Pick<Chat, 'folder' | 'title'>): string {
  return `${chat.folder} › ${chat.title}`
}

/** The chats `query` names exactly: its number, its name, or "folder/name". */
function exactChats(chats: Chat[], query: string): Chat[] {
  const q = query.trim().toLowerCase()
  if (/^\d+$/.test(q)) return chats.filter((c) => c.n === Number(q))
  const { folder, name } = splitFolder(q)
  return chats.filter(
    (c) => c.title.toLowerCase() === name && (folder === null || c.folder.toLowerCase() === folder)
  )
}

function splitFolder(q: string): { folder: string | null; name: string } {
  const slash = q.indexOf('/')
  return slash < 0
    ? { folder: null, name: q }
    : { folder: q.slice(0, slash).trim(), name: q.slice(slash + 1).trim() }
}

/**
 * The chats `query` names: its number in /chats, its name or the start of it ("fix" for "Fix
 * login"), case aside. "folder/name" picks among chats of the same name.
 */
export function findChats(chats: Chat[], query: string): Chat[] {
  const exact = exactChats(chats, query)
  if (exact.length) return exact
  const q = query.trim().toLowerCase()
  if (!q || /^\d+$/.test(q)) return []
  const { folder, name } = splitFolder(q)
  return chats.filter(
    (c) =>
      c.title.toLowerCase().startsWith(name) &&
      (folder === null || c.folder.toLowerCase().startsWith(folder))
  )
}

/**
 * Splits "<chat> <rest>". Names have spaces ("Claude 1"), so the chat is the most leading words
 * that name one exactly, else the first word. "Quoted names" work too.
 */
export function splitChat(chats: Chat[], args: string): { query: string; rest: string } {
  const text = args.trim()
  const quoted = /^"([^"]+)"\s*([\s\S]*)$/.exec(text)
  if (quoted) return { query: quoted[1].trim(), rest: quoted[2] }
  const firstLine = text.split('\n')[0]
  const ends = [...firstLine.matchAll(/ +/g)].map((m) => m.index).concat(firstLine.length)
  for (const end of [...ends].reverse()) {
    const query = text.slice(0, end)
    if (exactChats(chats, query).length) return { query, rest: text.slice(end).trim() }
  }
  return { query: text.slice(0, ends[0]), rest: text.slice(ends[0]).trim() }
}

/** What a reply to a question Claude asks picks. */
export type Answer =
  /** One option, by its number. */
  | { kind: 'choose'; n: number }
  /** Option `n`, which takes your own words ("Type something."). */
  | { kind: 'words'; n: number; text: string }
  /** A question that takes several answers: these boxes ticked, and its own-words box with `text`. */
  | { kind: 'tick'; numbers: number[]; text: string | null }
  /** Not an answer to it: why, for the reply. */
  | { kind: 'unclear'; why: string }

/** Numbers, maybe followed by a colon and your own words: "1 3", "1, 2, 5: Black". */
const NUMBERED = /^\s*(\d{1,2}(?:[\s,]+\d{1,2})*)\s*(?::\s*([\s\S]*))?$/

/**
 * Reads a reply to a question: option numbers ("2", or "1 3" where several can be ticked), your
 * own words for its "Type something" option, or both ("1 3: Black").
 */
export function readAnswer(q: ClaudeQuestion, reply: string): Answer {
  const m = NUMBERED.exec(reply)
  const numbers = m ? [...new Set(m[1].split(/[\s,]+/).map(Number))] : []
  const words = (m ? (m[2] ?? '') : reply).trim()
  const missing = numbers.find((n) => !q.options.some((o) => o.n === n))
  if (missing !== undefined) return { kind: 'unclear', why: `It has no option ${missing}.` }
  const free = q.freeText
  const ownWords =
    free === null
      ? ''
      : ` For “${optionLabel(q, free)}”, write your words after its number and a colon, like ${free}: …`
  if (!q.multi) {
    if (numbers.length > 1) return { kind: 'unclear', why: `It takes one answer.${ownWords}` }
    const [n] = numbers
    if (n === undefined) {
      if (free !== null && words) return { kind: 'words', n: free, text: words }
      return { kind: 'unclear', why: 'Tap a button, or reply with its number.' }
    }
    if (n === free) {
      return words ? { kind: 'words', n, text: words } : { kind: 'unclear', why: ownWords.trim() }
    }
    if (words) return { kind: 'unclear', why: `Words only go with “Type something”.${ownWords}` }
    return { kind: 'choose', n }
  }
  const unboxed = numbers.find(
    (n) => n !== free && !hasTickBox(q.options.find((o) => o.n === n)!.label)
  )
  if (unboxed !== undefined) {
    return { kind: 'unclear', why: `Option ${unboxed} can't be ticked: answer it on the computer.` }
  }
  if (words && free === null) {
    return { kind: 'unclear', why: 'It has no option for your own words: reply with numbers.' }
  }
  // "Type something" ticked needs its words; and a reply has to tick something.
  if (!words && (!numbers.length || (free !== null && numbers.includes(free)))) {
    return { kind: 'unclear', why: `Reply with the numbers to tick, like 1 3.${ownWords}` }
  }
  return { kind: 'tick', numbers: numbers.filter((n) => n !== free), text: words || null }
}

function optionLabel(q: ClaudeQuestion, n: number): string {
  return withoutTickBox(q.options.find((o) => o.n === n)?.label ?? '')
}

/** Telegram's limit on a topic's name. */
const MAX_TOPIC_NAME = 128

/** A chat's topic name in Telegram: "my project › Claude 1". */
export function topicName(chat: Pick<Chat, 'folder' | 'title'>): string {
  const name = chatLabel(chat).replace(/\s+/g, ' ').trim()
  return name.length > MAX_TOPIC_NAME ? `${name.slice(0, MAX_TOPIC_NAME - 1)}…` : name
}

/** One of Telegram's topic colours, the same for every chat of a folder. */
export function topicColor(folder: string): number {
  let hash = 0
  for (const ch of folder) hash = (Math.imul(hash, 31) + ch.codePointAt(0)!) >>> 0
  return TOPIC_COLORS[hash % TOPIC_COLORS.length]
}

/** The open tab whose topic `thread` is. */
export function keyForThread(
  terminals: Record<string, Pick<TerminalState, 'key' | 'telegramTopic'>>,
  thread: number
): string | undefined {
  return Object.values(terminals).find((t) => t.telegramTopic === thread)?.key
}
