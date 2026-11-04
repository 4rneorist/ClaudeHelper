import type {
  TelegramButton,
  TelegramIncoming,
  TelegramMessage,
  TelegramOutgoing,
  TelegramSent
} from '../../shared/ipc'
import { dotStatus, useStore, workspaceTitle } from './store'
import {
  chatLabel,
  chatList,
  DEFAULT_ROWS,
  findChats,
  HELP,
  keyForThread,
  MAX_ROWS,
  readAnswer,
  splitChat,
  STATUS_ICONS,
  type Chat
} from './telegramChats'
import { buttonLabel, questionButtons, questionHint, telegramText } from '../../shared/questions'
import { readableLines, readableText } from '../../shared/screenTables'
import { callPlace } from './attention'
import { startTelegramTopics, topicRef } from './telegramTopics'
import { promptRows, withoutTickBox } from './terminal/claudeActivity'
import { getTerminal } from './terminal/TerminalSession'

// Remote control from Telegram. Main passes on only what you wrote in your own private chat with
// the bot. A reply to a bot message about a chat goes to that chat: a prompt, or the answer to
// its question; questions also come with a button per option. Once Claude is done with what was
// sent from Telegram, its whole reply goes there. Commands: /chats, /newchat, /prompt, /getchat
// and /help. With Threaded Mode on for the bot, each chat has its own topic: what is written there
// goes to that chat, and what the chat has to say (its calls, questions and replies) goes there.
// Answers to what you write go where you wrote it.

/** How long a question the bot asked (a name, which chat) waits for its answer. */
const PENDING_MS = 10 * 60_000

/** Bot messages that wait for an answer: a name for a new chat, or which chat was meant. */
type Pending = { at: number } & (
  | { kind: 'name'; workspace: string }
  | { kind: 'folder'; name: string }
  | { kind: 'prompt'; text: string }
  | { kind: 'show'; rows: number }
)
const pending = new Map<number, Pending>()

/** Where you wrote: a topic's thread, or undefined for the main chat. */
type Here = number | undefined

const WHICH_CHAT =
  'Which chat is that for? Reply to a message about a chat (swipe it), write in its topic, or use /prompt <chat> <text>. /chats lists them; /help says more.'
const CLOSED_TOPIC =
  "This topic's tab isn't open in ClaudeHelper any more. /chats lists the open chats; /newchat opens a new one."

let started = false

export function startTelegramCommands(): void {
  if (started) return
  started = true
  startTelegramTopics()
  window.api.onTelegramIncoming((msg) => {
    for (const [id, p] of pending) if (Date.now() - p.at > PENDING_MS) pending.delete(id)
    handle(msg).catch((err) => console.warn('Telegram command failed', err))
  })
  // A chat driven from Telegram: its questions, and its whole reply once it is done, go there.
  useStore.subscribe((state, prev) => {
    if (state.terminals === prev.terminals) return
    for (const t of Object.values(state.terminals)) {
      const before = prev.terminals[t.key]
      if (!t.telegramReply || t.activity === before?.activity) continue
      const failed = (err: unknown): void => console.warn('Telegram reply failed', err)
      if (t.activity === 'idle' && before?.activity === 'working') sendReply(t.key).catch(failed)
      else if (t.activity === 'asking') sendQuestion(t.key).catch(failed)
    }
  })
}

/** What a chat has to say: in its topic (made the first time, with topics), else the main chat. */
function tell(key: string, msg: Omit<TelegramOutgoing, 'key' | 'topic'>): Promise<TelegramSent> {
  const topic = topicRef(key)
  return window.api.sendTelegram({ ...msg, key, ...(topic ? { topic } : {}) })
}

/** An answer to what you wrote: where you wrote it. Its id. */
async function reply(here: Here, msg: TelegramOutgoing): Promise<number | null> {
  const sent = await window.api.sendTelegram(here === undefined ? msg : { ...msg, thread: here })
  return sent.messageId
}

/**
 * Claude's reply to what was sent from Telegram goes there once it is done: to a prompt (sent at
 * `since`), or to an answer (0) when no prompt waits for one already. A slash command gets none.
 */
function expectReply(key: string, messageId: number, since: number, text = ''): void {
  const store = useStore.getState()
  const waiting = store.terminals[key]?.telegramReply
  if (text.trimStart().startsWith('/') || (!since && waiting)) return
  store.patchTerminal(key, { telegramReply: { messageId, since } })
}

/** Claude finished: its whole reply, read from the conversation (the screen's end without it). */
async function sendReply(key: string): Promise<void> {
  const reply = useStore.getState().terminals[key]?.telegramReply
  if (!reply) return
  const turn = await window.api.claudeTurn(key, reply.since)
  // That finished an earlier turn: the prompt is still queued.
  if (turn.kind === 'earlier') return
  const store = useStore.getState()
  const t = store.terminals[key]
  // A newer prompt came meanwhile: its reply is the one to send.
  if (!t || t.telegramReply !== reply) return
  store.patchTerminal(key, { telegramReply: undefined })
  const text = telegramText({ event: 'finished', ...callPlace(t) })
  const answer = { text, replyTo: reply.messageId }
  if (turn.kind === 'turn') {
    await tell(key, { ...answer, markdown: turn.text || '_Claude wrote nothing back._' })
    return
  }
  const lines = replyOnScreen(key)
  await tell(key, { ...answer, pre: lines.length ? lines.join('\n') : '(nothing on screen)' })
}

/** What the screen shows below your last prompt. */
function replyOnScreen(key: string): string[] {
  const lines = getTerminal(key)?.screenText(MAX_ROWS) ?? []
  const prompts = promptRows(lines)
  const readable = readableLines(
    prompts.length ? lines.slice(prompts[prompts.length - 1] + 1) : lines
  )
  const first = readable.findIndex((line) => line.trim())
  return first < 0 ? [] : readable.slice(first)
}

/** Claude asks something in a chat driven from Telegram: the question, with its buttons. */
async function sendQuestion(key: string): Promise<void> {
  const t = useStore.getState().terminals[key]
  const question = getTerminal(key)?.question()
  if (!t?.telegramReply || !question) return
  const hint = questionHint(question)
  const buttons = questionButtons(question)
  const text = telegramText({ event: 'asking', ...callPlace(t) })
  await tell(key, {
    text: hint ? `${text}\n\n${hint}` : text,
    pre: readableText(question.text),
    replyTo: t.telegramReply.messageId,
    ...(buttons.length ? { buttons } : {})
  })
}

function wait(id: number | null, p: Pending): void {
  if (id !== null) pending.set(id, p)
}

async function handle(msg: TelegramIncoming): Promise<void> {
  if (msg.kind === 'button') return pressed(msg)
  const here = msg.thread
  // Written in a chat's topic: that chat is meant.
  const inTopic = here === undefined ? undefined : keyForThread(useStore.getState().terminals, here)
  if (msg.kind === 'command') {
    return command(msg.command, msg.args, msg.messageId, here, inTopic)
  }
  const asked = msg.replyTo === undefined ? undefined : pending.get(msg.replyTo)
  if (asked?.kind === 'name') {
    pending.delete(msg.replyTo!)
    return startChat(asked.workspace, msg.text === '-' ? '' : msg.text, here)
  }
  const key = msg.key ?? inTopic
  if (key) return toChat(key, msg.text, msg.messageId, here)
  await reply(here, {
    text: here === undefined ? WHICH_CHAT : CLOSED_TOPIC,
    replyTo: msg.messageId
  })
}

async function command(
  name: string,
  args: string,
  messageId: number,
  here: Here,
  inTopic: string | undefined
): Promise<void> {
  const chats = chatList(useStore.getState())
  switch (name) {
    case 'start':
    case 'help':
      await reply(here, { text: HELP })
      return
    case 'chats':
      return listChats(chats, here)
    case 'newchat':
      return newChat(args.trim(), here)
    case 'prompt': {
      // In a chat's topic, it is that chat's.
      if (inTopic) {
        if (args.trim()) return toChat(inTopic, args.trim(), messageId, here)
        await reply(here, {
          text: "Send it as /prompt <text>, or just write it: here it goes to this topic's chat.",
          replyTo: messageId
        })
        return
      }
      const { query, rest } = splitChat(chats, args)
      if (!query || !rest) {
        await reply(here, {
          text: 'Send it as /prompt <chat> <text>. /chats lists the chats.',
          replyTo: messageId
        })
        return
      }
      return pick(chats, query, messageId, here, { kind: 'prompt', text: rest }, (chat) =>
        toChat(chat.key, rest, messageId, here)
      )
    }
    case 'getchat': {
      // In a chat's topic: that chat's screen, the rows given or not.
      if (inTopic && /^\s*\d*\s*$/.test(args)) return showChat(inTopic, rowsOf(args), here)
      const { query, rest } = splitChat(chats, args)
      if (!query) {
        await reply(here, {
          text: 'Send it as /getchat <chat> [rows]. /chats lists the chats.',
          replyTo: messageId
        })
        return
      }
      const rows = rowsOf(rest)
      return pick(chats, query, messageId, here, { kind: 'show', rows }, (chat) =>
        showChat(chat.key, rows, here)
      )
    }
    default:
      await reply(here, { text: `There is no /${name}.\n\n${HELP}`, replyTo: messageId })
  }
}

/** The rows asked for, within bounds. */
function rowsOf(text: string): number {
  const asked = Number(text.trim())
  return Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_ROWS) : DEFAULT_ROWS
}

/** Runs `then` for the one chat `query` names; asks which one, with buttons, when several do. */
async function pick(
  chats: Chat[],
  query: string,
  messageId: number,
  here: Here,
  later: { kind: 'prompt'; text: string } | { kind: 'show'; rows: number },
  then: (chat: Chat) => Promise<void>
): Promise<void> {
  const found = findChats(chats, query)
  if (found.length === 1) return then(found[0])
  if (!found.length) {
    await reply(here, {
      text: `No chat is called “${query}”. /chats lists them.`,
      replyTo: messageId
    })
    return
  }
  const id = await reply(here, {
    text: `“${query}” could be any of these:`,
    replyTo: messageId,
    buttons: found.slice(0, 20).map((c) => [button(`${c.n}. ${chatLabel(c)}`, `c:${c.key}`)])
  })
  wait(id, { ...later, at: Date.now() })
}

function button(label: string, data: string): TelegramButton {
  return { label: buttonLabel(label), data }
}

async function listChats(chats: Chat[], here: Here): Promise<void> {
  if (!chats.length) {
    await reply(here, { text: 'No Claude chat is open. /newchat opens one.' })
    return
  }
  await reply(here, {
    text: [
      'Open chats:',
      ...chats.map((c) => `${c.n}. ${STATUS_ICONS[c.status]} ${chatLabel(c)}`),
      '',
      'Tap one to see it. Then reply to it to send a prompt, or use /prompt <number> <text>.'
    ].join('\n'),
    buttons: chats.slice(0, 30).map((c) => [button(`${c.n}. ${chatLabel(c)}`, `g:${c.key}`)])
  })
}

async function newChat(name: string, here: Here): Promise<void> {
  const state = useStore.getState()
  const folders = state.workspaces.filter((w) => w.kind === 'folder')
  if (!folders.length) {
    await reply(here, {
      text: 'No folder is open in ClaudeHelper: open one on the computer first.'
    })
    return
  }
  if (folders.length === 1) {
    return name ? startChat(folders[0].key, name, here) : askName(folders[0].key, here)
  }
  const platform = state.appInfo?.platform ?? ''
  const id = await reply(here, {
    text: name ? `Which folder is “${name}” for?` : 'Which folder is the new chat for?',
    buttons: folders.map((w) => [
      button(workspaceTitle(w, state.settings?.folderTitles, platform), `n:${w.key}`)
    ])
  })
  wait(id, { kind: 'folder', name, at: Date.now() })
}

function folderTitle(workspace: string): string | null {
  const state = useStore.getState()
  const ws = state.workspaces.find((w) => w.key === workspace && w.kind === 'folder')
  return ws ? workspaceTitle(ws, state.settings?.folderTitles, state.appInfo?.platform ?? '') : null
}

async function askName(workspace: string, here: Here): Promise<void> {
  const folder = folderTitle(workspace)
  if (folder === null) return
  const id = await reply(here, {
    text: `Name for the new chat in ${folder}? Reply with it, or with - for the usual “Claude N”.`,
    forceReply: true
  })
  wait(id, { kind: 'name', workspace, at: Date.now() })
}

/**
 * Opens a new Claude chat in the folder, in the background: the screen stays as it is. With
 * topics, it gets its own right away.
 */
async function startChat(workspace: string, name: string, here: Here): Promise<void> {
  const folder = folderTitle(workspace)
  const store = useStore.getState()
  const key =
    folder === null
      ? null
      : store.addTerminal(workspace, { kind: 'claude', mode: 'new' }, name.trim() || undefined, {
          background: true
        })
  if (!key) {
    await reply(here, { text: 'That folder is no longer open.' })
    return
  }
  const title = useStore.getState().terminals[key]?.title ?? name
  const sent = await tell(key, {
    text: `✅ Started “${title}” in ${folder}. Reply to this message with its first prompt.`
  })
  // It went in its own topic: say so where you asked.
  if (sent.thread !== undefined && sent.thread !== here) {
    await reply(here, {
      text: `✅ Started “${title}” in ${folder}, with its own topic: write there for its first prompt.`,
      key
    })
  }
}

/**
 * Text for a chat (a reply, written in its topic, or /prompt): while Claude asks something, the
 * answer to that (option numbers, or your own words where it takes them); else a prompt.
 */
async function toChat(key: string, text: string, messageId: number, here: Here): Promise<void> {
  const t = useStore.getState().terminals[key]
  const session = getTerminal(key)
  const question = t?.activity === 'asking' ? session?.question() : null
  if (!t || !session || !question) return prompt(key, text, messageId, here)
  const label = chatLabel({ folder: folderOf(key), title: t.title })
  const done = (answer: string): Promise<number | null> => {
    expectReply(key, messageId, 0)
    return reply(here, { text: `✔ ${label}: ${answer}`, replyTo: messageId, key })
  }
  const answer = readAnswer(question, text)
  const named = (n: number): string =>
    `${n}. ${withoutTickBox(question.options.find((o) => o.n === n)?.label ?? '')}`
  switch (answer.kind) {
    case 'choose':
      session.choose(answer.n)
      await done(named(answer.n))
      break
    case 'words':
      await session.answerText(question, answer.n, answer.text)
      await done(`“${answer.text}”`)
      break
    case 'tick':
      await session.tick(question, answer.numbers, answer.text)
      await done(
        [...answer.numbers.map(named), ...(answer.text ? [`“${answer.text}”`] : [])].join(', ')
      )
      break
    case 'unclear':
      await reply(here, {
        text: `Claude is waiting for a choice in ${label}. ${answer.why}`,
        replyTo: messageId,
        key
      })
      return
  }
  return followUp(key, question.id, messageId)
}

/**
 * After an answer: a form's next question is asked too, in the chat's topic (its last screen,
 * which submits the answers, is confirmed by the terminal).
 */
async function followUp(key: string, answered: string, replyTo: number): Promise<void> {
  const next = await getTerminal(key)?.afterAnswer(answered)
  const t = useStore.getState().terminals[key]
  if (!next || !t) return
  const hint = questionHint(next)
  const buttons = questionButtons(next)
  const label = chatLabel({ folder: folderOf(key), title: t.title })
  await tell(key, {
    text: `🔔 Next question in ${label}${hint ? `\n\n${hint}` : ''}`,
    pre: readableText(next.text),
    replyTo,
    ...(buttons.length ? { buttons } : {})
  })
}

function folderOf(key: string): string {
  const state = useStore.getState()
  return chatList(state).find((c) => c.key === key)?.folder ?? ''
}

/** Types the prompt into the chat and presses Enter; a dormant chat starts first. */
async function prompt(key: string, text: string, messageId: number, here: Here): Promise<void> {
  const store = useStore.getState()
  const t = store.terminals[key]
  const session = getTerminal(key)
  if (!t || !session) {
    await reply(here, {
      text: 'That chat is closed. /chats lists the open ones.',
      replyTo: messageId
    })
    return
  }
  const label = chatLabel({ folder: folderOf(key), title: t.title })
  if (t.status === 'exited' || t.status === 'error') {
    await reply(here, {
      text: `${label} has ended: restart it on the computer, or open a new one with /newchat.`,
      replyTo: messageId,
      key
    })
    return
  }
  if (t.status === 'dormant') store.wakeTerminal(key)
  expectReply(key, messageId, Date.now(), text)
  session.submit(text)
  const busy = t.activity === 'working' ? ' Claude is busy, and reads it next.' : ''
  await reply(here, { text: `📨 Sent to ${label}.${busy}`, replyTo: messageId, key })
}

/**
 * What the chat shows, with its question's buttons when it asks one, and a Refresh button. Its
 * last `rows` lines once its tables are made to fit a phone: read from further up, so a table
 * cut off at the top still has its header.
 */
function chatScreen(key: string, rows: number): TelegramMessage | null {
  const t = useStore.getState().terminals[key]
  const session = getTerminal(key)
  if (!t || !session) return null
  const readable = readableLines(session.screenText(MAX_ROWS)).slice(-rows)
  const first = readable.findIndex((line) => line.trim())
  const lines = first < 0 ? [] : readable.slice(first)
  const question = t.activity === 'asking' ? session.question() : null
  const answers = question ? questionButtons(question) : []
  return {
    text: `${STATUS_ICONS[dotStatus(t)]} ${chatLabel({ folder: folderOf(key), title: t.title })}`,
    pre: lines.length ? lines.join('\n') : '(nothing on screen yet)',
    buttons: [...answers, [button('🔄 Refresh', `r:${rows}`)]]
  }
}

async function showChat(key: string, rows: number, here: Here): Promise<void> {
  const screen = chatScreen(key, rows)
  if (!screen) {
    await reply(here, { text: 'That chat is closed. /chats lists the open ones.' })
    return
  }
  await reply(here, { ...screen, key })
}

async function pressed(msg: Extract<TelegramIncoming, { kind: 'button' }>): Promise<void> {
  const [kind, ...rest] = msg.data.split(':')
  const arg = rest.join(':')
  const here = msg.thread
  const done = (text?: string): void => window.api.answerTelegramButton(msg.callbackId, text)
  const asked = pending.get(msg.messageId)
  switch (kind) {
    case 'a':
      return answer(msg, arg, done)
    case 'g':
      done()
      return showChat(arg, DEFAULT_ROWS, here)
    case 'r': {
      const screen = msg.key ? chatScreen(msg.key, Number(arg) || DEFAULT_ROWS) : null
      done(screen ? undefined : 'That chat is closed')
      if (screen) window.api.editTelegram(msg.messageId, screen)
      return
    }
    case 'n':
      done()
      pending.delete(msg.messageId)
      window.api.editTelegram(msg.messageId, null)
      return asked?.kind === 'folder' && asked.name
        ? startChat(arg, asked.name, here)
        : askName(arg, here)
    case 'c': {
      if (asked?.kind !== 'prompt' && asked?.kind !== 'show') {
        done('That was a while ago: send it again')
        return
      }
      done()
      pending.delete(msg.messageId)
      window.api.editTelegram(msg.messageId, null)
      return asked.kind === 'prompt'
        ? toChat(arg, asked.text, msg.messageId, here)
        : showChat(arg, asked.rows, here)
    }
    default:
      done()
  }
}

/** A tap on one of a question's buttons: only while that same question is still on screen. */
async function answer(
  msg: Extract<TelegramIncoming, { kind: 'button' }>,
  arg: string,
  done: (text?: string) => void
): Promise<void> {
  const [id, number] = arg.split(':')
  const t = msg.key ? useStore.getState().terminals[msg.key] : undefined
  const session = msg.key ? getTerminal(msg.key) : undefined
  const question = t?.activity === 'asking' ? session?.question() : null
  const option = question?.id === id ? question.options.find((o) => o.n === Number(number)) : null
  if (!t || !session || !option) {
    done('This question is no longer open')
    window.api.editTelegram(msg.messageId, null)
    return
  }
  session.choose(option.n)
  expectReply(msg.key!, msg.messageId, 0)
  done(`${option.n}. ${option.label}`)
  window.api.editTelegram(msg.messageId, null)
  const label = chatLabel({ folder: folderOf(msg.key!), title: t.title })
  await reply(msg.thread, {
    text: `✔ ${label}: ${option.n}. ${option.label}`,
    replyTo: msg.messageId,
    key: msg.key
  })
  return followUp(msg.key!, id, msg.messageId)
}
