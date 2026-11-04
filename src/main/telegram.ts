import {
  TELEGRAM_ALWAYS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  type AttentionRequest,
  type Settings,
  type TelegramMessage,
  type TelegramResult
} from '../shared/ipc'
import { questionButtons, questionHint, telegramText } from '../shared/questions'
import { readableText } from '../shared/screenTables'
import { escapeHtml, htmlText, markdownParts, MAX_TEXT } from './telegramMarkdown'

// Messages go from the app straight to the Telegram Bot API, with the user's own bot: there is no
// server in between. Sent as HTML, with everything in them escaped, so a screen can be monospace.

/** Electron's net.fetch in the app (it follows the system proxy); a fake in tests. */
export type Fetch = (url: string, init: RequestInit) => Promise<Response>

/** What powerMonitor.getSystemIdleState says. */
export type IdleState = 'active' | 'idle' | 'locked' | 'unknown'

export interface TelegramMoment {
  /** The app's window has the focus. */
  focused: boolean
  /** The call came from the pane you had focused. */
  seen: boolean
  /** Whether the computer has had no input for this many seconds, or is locked. */
  idleState(seconds: number): IdleState
}

const API = 'https://api.telegram.org'
const TIMEOUT_MS = 10_000

export const TELEGRAM_TEST_TEXT =
  "ClaudeHelper is connected. You'll get a message here when a Claude session needs you."

const NOT_A_TOKEN = "That doesn't look like a bot token (123456789:AAE…)"

export { telegramText }

/**
 * Whether this call goes to Telegram: switched on and set up, and then every time, or when the
 * app is in the background, or (in "away" mode) when the computer has been left alone long
 * enough or locked.
 */
export function shouldSendTelegram(settings: Settings, moment: TelegramMoment): boolean {
  const { telegramEnabled, telegramBotToken, telegramChatId, telegramAwayMinutes } = settings
  if (!telegramEnabled) return false
  if (!TELEGRAM_BOT_TOKEN.test(telegramBotToken) || !TELEGRAM_CHAT_ID.test(telegramChatId)) {
    return false
  }
  if (telegramAwayMinutes === TELEGRAM_ALWAYS) return true
  if (telegramAwayMinutes === 0) return !moment.focused && !moment.seen
  // 'unknown' (some Linux desktops) counts as away: better a message too many than a missed one.
  return moment.idleState(telegramAwayMinutes * 60) !== 'active'
}

/**
 * The message about a call. A question comes with what the dialog shows and a button per option
 * (with remote control on, the renderer reads it off the screen).
 */
export function attentionMessage(req: AttentionRequest, thread?: number): TelegramMessage {
  const text = telegramText(req)
  const where = thread === undefined ? {} : { thread }
  const q = req.question
  if (!q) return { text, ...where }
  const hint = questionHint(q)
  const buttons = questionButtons(q)
  return {
    text: hint ? `${text}\n\n${hint}` : text,
    pre: readableText(q.text),
    ...(buttons.length ? { buttons } : {}),
    ...where
  }
}

export { escapeHtml }

/** A pause between the messages of one long reply: Telegram limits how fast a chat gets them. */
const PART_GAP_MS = 700
/** The heading above a reply in markdown. */
const MAX_HEAD = 1000

function cut(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The message as Telegram HTML: the text, then the reply formatted (in as many messages as that
 * takes) or the monospace block (its start cut to fit one).
 */
export function messageParts(msg: Pick<TelegramMessage, 'text' | 'pre' | 'markdown'>): string[] {
  if (msg.markdown === undefined) return [messageHtml(msg)]
  const parts = markdownParts(escapeHtml(cut(msg.text, MAX_HEAD)), msg.markdown)
  return parts.length ? parts : [escapeHtml(cut(msg.text, MAX_TEXT))]
}

/** The message as Telegram HTML: the text, then the monospace block with its start cut to fit. */
export function messageHtml(msg: Pick<TelegramMessage, 'text' | 'pre'>): string {
  const text = cut(msg.text, MAX_TEXT)
  const room = MAX_TEXT - text.length - (text ? 1 : 0)
  if (!msg.pre || room < 20) return escapeHtml(text)
  const pre = msg.pre.length > room ? `…${msg.pre.slice(msg.pre.length - room + 1)}` : msg.pre
  return `${text ? `${escapeHtml(text)}\n` : ''}<pre>${escapeHtml(pre)}</pre>`
}

function replyMarkup(msg: TelegramMessage): object | undefined {
  if (msg.forceReply) return { force_reply: true }
  if (!msg.buttons?.length) return undefined
  return {
    inline_keyboard: msg.buttons.map((row) =>
      row.map((b) => ({ text: b.label, callback_data: b.data }))
    )
  }
}

export async function sendTelegram(
  fetchFn: Fetch,
  token: string,
  chatId: string,
  msg: TelegramMessage
): Promise<TelegramResult> {
  if (!TELEGRAM_BOT_TOKEN.test(token)) return { ok: false, error: NOT_A_TOKEN }
  if (!TELEGRAM_CHAT_ID.test(chatId)) {
    return { ok: false, error: "That doesn't look like a chat ID (a number, or @channel)" }
  }
  const parts = messageParts(msg)
  const ids: number[] = []
  let thread = msg.thread
  let threadGone = false
  for (const [i, html] of parts.entries()) {
    if (i) await new Promise((resolve) => setTimeout(resolve, PART_GAP_MS))
    const body = (): object => ({
      chat_id: chatId,
      message_thread_id: thread,
      link_preview_options: { is_disabled: true },
      // The first answers what it answers; the buttons go under the last.
      reply_markup: i === parts.length - 1 ? replyMarkup(msg) : undefined,
      reply_parameters:
        i === 0 && msg.replyTo
          ? { message_id: msg.replyTo, allow_sending_without_reply: true }
          : undefined
    })
    const post = async (): Promise<ApiResult> => {
      const res = await callApi(fetchFn, token, 'sendMessage', {
        ...body(),
        text: html,
        parse_mode: 'HTML'
      })
      // Formatting Telegram can't read (Claude's markdown can be odd): the same text, plain.
      if (!res.ok && /can't parse entities/i.test(res.error)) {
        return callApi(fetchFn, token, 'sendMessage', { ...body(), text: htmlText(html) })
      }
      return res
    }
    let res = await post()
    // The topic is gone (deleted, or topics turned off): the main chat then.
    if (!res.ok && thread !== undefined && THREAD_GONE.test(res.error)) {
      thread = undefined
      threadGone = true
      res = await post()
    }
    if (!res.ok) {
      if (!ids.length) return { ok: false, error: res.error }
      break
    }
    const id = (res.result as { message_id?: unknown } | null)?.message_id
    if (typeof id === 'number') ids.push(id)
  }
  const gone = threadGone ? { threadGone: true } : {}
  return ids.length
    ? { ok: true, messageId: ids[ids.length - 1], messageIds: ids, ...gone }
    : { ok: true, ...gone }
}

/** What Telegram says about a topic that isn't there (any more). */
const THREAD_GONE = /thread not found|topic_deleted|topic_closed|topic not found|TOPIC_ID_INVALID/i

/** Whether the bot has Threaded Mode on (in @BotFather), so it can make topics in its chats. */
export async function getBotInfo(
  fetchFn: Fetch,
  token: string
): Promise<{ ok: true; topics: boolean } | { ok: false; error: string }> {
  if (!TELEGRAM_BOT_TOKEN.test(token)) return { ok: false, error: NOT_A_TOKEN }
  const res = await callApi(fetchFn, token, 'getMe', {})
  if (!res.ok) return { ok: false, error: res.error }
  return {
    ok: true,
    topics: (res.result as { has_topics_enabled?: unknown })?.has_topics_enabled === true
  }
}

/** Makes a topic in the chat; its thread. */
export async function createTopic(
  fetchFn: Fetch,
  token: string,
  chatId: string,
  name: string,
  color: number
): Promise<{ ok: true; thread: number } | { ok: false; error: string }> {
  const res = await callApi(fetchFn, token, 'createForumTopic', {
    chat_id: chatId,
    name,
    icon_color: color
  })
  if (!res.ok) return { ok: false, error: res.error }
  const thread = (res.result as { message_thread_id?: unknown } | null)?.message_thread_id
  return typeof thread === 'number'
    ? { ok: true, thread }
    : { ok: false, error: 'No topic came back' }
}

export async function renameTopic(
  fetchFn: Fetch,
  token: string,
  chatId: string,
  thread: number,
  name: string
): Promise<TelegramResult> {
  const res = await callApi(fetchFn, token, 'editForumTopic', {
    chat_id: chatId,
    message_thread_id: thread,
    name
  })
  // Renaming it to the name it has is no failure.
  if (!res.ok && /not modified/i.test(res.error)) return { ok: true }
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** Replaces a bot message's text and buttons; null only takes its buttons away. */
export async function editTelegram(
  fetchFn: Fetch,
  token: string,
  chatId: string,
  messageId: number,
  msg: TelegramMessage | null
): Promise<TelegramResult> {
  const res = msg
    ? await callApi(fetchFn, token, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text: messageHtml(msg),
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: replyMarkup(msg) ?? { inline_keyboard: [] }
      })
    : await callApi(fetchFn, token, 'editMessageReplyMarkup', {
        chat_id: chatId,
        message_id: messageId,
        reply_markup: { inline_keyboard: [] }
      })
  // Refreshing a screen that hasn't changed is no failure.
  if (!res.ok && /not modified/i.test(res.error)) return { ok: true }
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** Stops the spinner on a pressed button, with a short popup text if given. */
export async function answerButton(
  fetchFn: Fetch,
  token: string,
  callbackId: string,
  text?: string
): Promise<TelegramResult> {
  const res = await callApi(fetchFn, token, 'answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text ? cut(text, 200) : undefined
  })
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/** The commands Telegram offers in its "/" menu, while remote control is on. */
export const TELEGRAM_COMMANDS = [
  { command: 'chats', description: 'The open Claude chats, numbered' },
  { command: 'newchat', description: 'Open a new chat in a folder: /newchat [name]' },
  { command: 'prompt', description: 'Send a prompt: /prompt <chat> <text>' },
  { command: 'getchat', description: 'Show what a chat shows: /getchat <chat> [rows]' },
  { command: 'help', description: 'What this bot can do' }
]

/** Puts the commands in Telegram's menu, or takes them out. */
export async function setTelegramCommands(
  fetchFn: Fetch,
  token: string,
  on: boolean
): Promise<TelegramResult> {
  const res = on
    ? await callApi(fetchFn, token, 'setMyCommands', { commands: TELEGRAM_COMMANDS })
    : await callApi(fetchFn, token, 'deleteMyCommands', {})
  return res.ok ? { ok: true } : { ok: false, error: res.error }
}

/**
 * What arrived for the bot after `offset`, waiting up to `waitSeconds` for something (a long
 * poll). `signal` cancels the wait.
 */
export async function getTelegramUpdates(
  fetchFn: Fetch,
  token: string,
  offset: number,
  waitSeconds: number,
  signal?: AbortSignal
): Promise<{ ok: true; updates: unknown[] } | { ok: false; error: string; status?: number }> {
  const res = await callApi(
    fetchFn,
    token,
    'getUpdates',
    { offset, timeout: waitSeconds },
    { timeoutMs: (waitSeconds + 10) * 1000, signal }
  )
  if (!res.ok) return res
  return { ok: true, updates: Array.isArray(res.result) ? res.result : [] }
}

/** The chat that last wrote to the bot: pressing Start in it is enough. */
export async function findTelegramChat(fetchFn: Fetch, token: string): Promise<TelegramResult> {
  if (!TELEGRAM_BOT_TOKEN.test(token)) return { ok: false, error: NOT_A_TOKEN }
  const res = await callApi(fetchFn, token, 'getUpdates', {})
  if (!res.ok) return { ok: false, error: res.error }
  const chat = latestChat(res.result)
  if (!chat) {
    return {
      ok: false,
      error: "No chat yet: press Start in your bot's chat (or send it a message), then Find again"
    }
  }
  return { ok: true, chatId: chat.id, chatName: chat.name }
}

type ApiResult = { ok: true; result: unknown } | { ok: false; error: string; status?: number }

async function callApi(
  fetchFn: Fetch,
  token: string,
  method: string,
  body: object,
  opts: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<ApiResult> {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_MS)
  let res: Response
  try {
    res = await fetchFn(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout
    })
  } catch (err) {
    if (opts.signal?.aborted) return { ok: false, error: 'Stopped' }
    // The error could carry the URL, and with it the token: only its kind is told.
    const timedOut = err instanceof Error && ['TimeoutError', 'AbortError'].includes(err.name)
    return {
      ok: false,
      error: timedOut
        ? "Telegram didn't answer in time"
        : "Couldn't reach Telegram: check the internet connection or proxy"
    }
  }
  let data: Record<string, unknown> = {}
  try {
    const json: unknown = await res.json()
    if (json && typeof json === 'object') data = json as Record<string, unknown>
  } catch {
    // Not JSON (a proxy's error page): the status tells enough.
  }
  if (res.ok && data.ok === true) return { ok: true, result: data.result }
  const description = typeof data.description === 'string' ? data.description : ''
  return {
    ok: false,
    error: explain(res.status, description).replaceAll(token, '…'),
    status: res.status
  }
}

/** Telegram's error in words that say what to do. */
function explain(status: number, description: string): string {
  if (status === 401 || status === 404) return 'Wrong bot token: copy it again from @BotFather'
  if (/chat not found/i.test(description)) {
    return "Chat not found: press Start in your bot's chat first, or check the chat ID"
  }
  if (status === 403) {
    return "The bot can't write to this chat: press Start in its chat, or unblock it"
  }
  if (status === 409) {
    return 'This bot has a webhook, so Find cannot read its chats: enter the chat ID by hand'
  }
  if (status === 429) return 'Too many messages: Telegram asks to wait a little'
  return `Telegram says: ${description || `HTTP ${status}`}`
}

export function latestChat(updates: unknown): { id: string; name: string } | null {
  if (!Array.isArray(updates)) return null
  for (let i = updates.length - 1; i >= 0; i--) {
    const update = updates[i] as Record<string, unknown> | null
    for (const field of ['message', 'channel_post', 'my_chat_member', 'edited_message']) {
      const chat = (update?.[field] as { chat?: unknown } | undefined)?.chat
      if (!chat || typeof chat !== 'object') continue
      const c = chat as Record<string, unknown>
      if (typeof c.id !== 'number' && typeof c.id !== 'string') continue
      return { id: String(c.id), name: chatName(c) }
    }
  }
  return null
}

/** A group's or channel's title, a person's name, or else their @username. */
function chatName(chat: Record<string, unknown>): string {
  const text = (v: unknown): string => (typeof v === 'string' ? v : '')
  const person = [text(chat.first_name), text(chat.last_name)].filter(Boolean).join(' ')
  const username = text(chat.username)
  return text(chat.title) || person || (username ? `@${username}` : '')
}
