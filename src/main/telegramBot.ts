import {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_PRIVATE_CHAT,
  type Settings,
  type TelegramIncoming,
  type TelegramMessage,
  type TelegramOutgoing,
  type TelegramSent
} from '../shared/ipc'
import {
  answerButton,
  editTelegram,
  getTelegramUpdates,
  latestChat,
  sendTelegram,
  setTelegramCommands,
  type Fetch
} from './telegram'
import type { TelegramTopics } from './telegramTopics'

// Remote control: the bot reads what you write to it (a long poll, so no server is needed) and
// passes it to the renderer, which owns the tabs. Only your own private chat with the bot is
// obeyed, and only what you wrote while the app was running: a /prompt sent while it was closed
// never runs later.

/** How long one poll waits for something to arrive, in seconds. */
const POLL_SECONDS = 50
const RETRY_MIN_MS = 5_000
const RETRY_MAX_MS = 60_000
/** How far Telegram's clock may be behind this computer's before a message counts as old. */
const CLOCK_SLACK_MS = 120_000
/** Bot messages remembered for the replies to them and their buttons. */
const MAX_REMEMBERED = 500

/** A Telegram user or chat id, as text. */
function idOf(v: unknown): string | null {
  const id = (v as { id?: unknown } | null | undefined)?.id
  return typeof id === 'number' || typeof id === 'string' ? String(id) : null
}

/**
 * What one update from `getUpdates` asks for, if it comes from `owner`'s private chat with the
 * bot (and, for a message, was written after `since`, epoch ms); null otherwise.
 */
export function toIncoming(update: unknown, owner: string, since: number): TelegramIncoming | null {
  if (!update || typeof update !== 'object') return null
  const u = update as Record<string, unknown>
  if (u.message) return fromMessage(u.message as Record<string, unknown>, owner, since)
  if (u.callback_query) return fromButton(u.callback_query as Record<string, unknown>, owner)
  return null
}

function fromMessage(
  m: Record<string, unknown>,
  owner: string,
  since: number
): TelegramIncoming | null {
  const chat = m.chat as { type?: unknown } | undefined
  if (chat?.type !== 'private' || idOf(chat) !== owner || idOf(m.from) !== owner) return null
  if (typeof m.date !== 'number' || m.date * 1000 < since - CLOCK_SLACK_MS) return null
  if (typeof m.message_id !== 'number' || typeof m.text !== 'string') return null
  const text = m.text.trim()
  if (!text) return null
  const reply = (m.reply_to_message as { message_id?: unknown } | undefined)?.message_id
  const thread = topicOf(m)
  const base = {
    messageId: m.message_id,
    ...(typeof reply === 'number' ? { replyTo: reply } : {}),
    ...(thread !== undefined ? { thread } : {})
  }
  // "/prompt 3 hi", or "/prompt@my_bot 3 hi" as Telegram's menu writes it in some clients.
  const command = /^\/([A-Za-z0-9_]{1,32})(?:@\w+)?(?:\s+([\s\S]*))?$/.exec(text)
  if (command) {
    return { kind: 'command', command: command[1].toLowerCase(), args: command[2] ?? '', ...base }
  }
  return { kind: 'text', text, ...base }
}

function fromButton(q: Record<string, unknown>, owner: string): TelegramIncoming | null {
  if (idOf(q.from) !== owner) return null
  const message = q.message as Record<string, unknown> | undefined
  if (idOf(message?.chat) !== owner || typeof message?.message_id !== 'number') return null
  if (typeof q.id !== 'string' || typeof q.data !== 'string') return null
  const thread = topicOf(message)
  return {
    kind: 'button',
    data: q.data,
    messageId: message.message_id,
    callbackId: q.id,
    ...(thread !== undefined ? { thread } : {})
  }
}

/** The topic a message is in (with Threaded Mode); undefined for the main chat. */
function topicOf(m: Record<string, unknown>): number | undefined {
  const thread = m.message_thread_id
  return m.is_topic_message === true && typeof thread === 'number' && thread > 0
    ? thread
    : undefined
}

export interface TelegramBotDeps {
  fetch: Fetch
  /** Something you wrote, with the tab it is about when it answers a message about one. */
  onIncoming(msg: TelegramIncoming): void
  log(message: string): void
  /** Topics per session, when the bot has Threaded Mode on. */
  topics?: TelegramTopics
  now?(): number
  /** Waits, but no longer than until `signal` aborts. */
  sleep?(ms: number, signal: AbortSignal): Promise<void>
}

interface Config {
  token: string
  chatId: string
}

const defaultSleep = (ms: number, signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => (clearTimeout(timer), resolve()), { once: true })
  })

export class TelegramBot {
  private config: Config | null = null
  private controller: AbortController | null = null
  /** Bot messages sent this run, and the tab each one is about ('' for none). */
  private messages = new Map<number, string>()
  /** The chat that last wrote to the bot: Settings' Find can't poll while this does. */
  private lastChat: { id: string; name: string } | null = null
  private lastError = ''

  constructor(private readonly deps: TelegramBotDeps) {}

  /** Polls while remote control is on and set up, following changes to the settings. */
  sync(settings: Settings): void {
    const { telegramEnabled, telegramRemote, telegramBotToken, telegramChatId } = settings
    const want =
      telegramEnabled &&
      telegramRemote &&
      TELEGRAM_BOT_TOKEN.test(telegramBotToken) &&
      TELEGRAM_PRIVATE_CHAT.test(telegramChatId)
        ? { token: telegramBotToken, chatId: telegramChatId }
        : null
    const was = this.config
    if (was?.token === want?.token && was?.chatId === want?.chatId) return
    this.stop()
    // Switched off: the commands leave Telegram's menu too.
    if (was && !want) void setTelegramCommands(this.deps.fetch, was.token, false)
    this.config = want
    this.messages.clear()
    if (!want) return
    const controller = new AbortController()
    this.controller = controller
    void this.poll(want, controller.signal)
  }

  get running(): boolean {
    return this.config !== null
  }

  stop(): void {
    this.controller?.abort()
    this.controller = null
  }

  /** The chat that last wrote to the bot while this polled, for Settings' Find. */
  chatFor(token: string): { id: string; name: string } | null {
    return this.config?.token === token ? this.lastChat : null
  }

  /** A message sent to your chat elsewhere (a notification) that replies and buttons may refer to. */
  remember(messageId: number, key: string): void {
    this.messages.delete(messageId)
    this.messages.set(messageId, key)
    while (this.messages.size > MAX_REMEMBERED) {
      this.messages.delete(this.messages.keys().next().value!)
    }
  }

  /** Sends it: its id, and the topic it went in. */
  async send(msg: TelegramOutgoing): Promise<TelegramSent> {
    const config = this.config
    if (!config) return { messageId: null }
    // A message about a tab goes in its topic, made now if need be; else where it says.
    const topic = msg.topic
      ? await this.deps.topics?.threadFor(config.token, config.chatId, msg.key, msg.topic)
      : undefined
    const thread = topic ?? msg.thread
    const res = await sendTelegram(this.deps.fetch, config.token, config.chatId, { ...msg, thread })
    if (!res.ok) {
      this.deps.log(`Telegram message not sent: ${res.error}`)
      return { messageId: null }
    }
    if (res.threadGone && thread !== undefined) {
      this.deps.topics?.gone(topic === undefined ? undefined : msg.key, thread)
    }
    const where = thread !== undefined && !res.threadGone ? { thread } : {}
    if (res.messageId === undefined) return { messageId: null, ...where }
    // A long reply takes several messages: a reply to any of them goes to its tab.
    for (const id of res.messageIds ?? [res.messageId]) this.remember(id, msg.key ?? '')
    return { messageId: res.messageId, ...where }
  }

  /** Only the bot's own messages from this run can be changed. */
  async edit(messageId: number, msg: TelegramMessage | null): Promise<void> {
    const config = this.config
    if (!config || !this.messages.has(messageId)) return
    const res = await editTelegram(this.deps.fetch, config.token, config.chatId, messageId, msg)
    if (!res.ok) this.deps.log(`Telegram message not changed: ${res.error}`)
  }

  async answerButton(callbackId: string, text?: string): Promise<void> {
    const config = this.config
    if (!config) return
    const res = await answerButton(this.deps.fetch, config.token, callbackId, text)
    if (!res.ok) this.deps.log(`Telegram button not answered: ${res.error}`)
  }

  private async poll(config: Config, signal: AbortSignal): Promise<void> {
    const { fetch } = this.deps
    const now = this.deps.now ?? Date.now
    const sleep = this.deps.sleep ?? defaultSleep
    const since = now()
    void setTelegramCommands(fetch, config.token, true).then((res) => {
      if (!res.ok) this.deps.log(`Telegram commands not set: ${res.error}`)
    })
    // What was written while the app was closed is dropped: offset -1 returns only the last
    // update, and confirming it forgets everything before.
    let offset = 0
    const backlog = await getTelegramUpdates(fetch, config.token, -1, 0, signal)
    if (backlog.ok) offset = nextOffset(backlog.updates, offset)
    let retry = RETRY_MIN_MS
    while (!signal.aborted) {
      const res = await getTelegramUpdates(fetch, config.token, offset, POLL_SECONDS, signal)
      if (signal.aborted) return
      if (!res.ok) {
        // 409: another copy of the app (or a webhook) reads this bot's updates.
        if (res.error !== this.lastError) this.deps.log(`Telegram polling: ${res.error}`)
        this.lastError = res.error
        await sleep(retry, signal)
        retry = Math.min(retry * 2, RETRY_MAX_MS)
        continue
      }
      this.lastError = ''
      retry = RETRY_MIN_MS
      for (const update of res.updates) {
        offset = nextOffset([update], offset)
        this.lastChat = latestChat([update]) ?? this.lastChat
        const msg = toIncoming(update, config.chatId, since)
        if (msg) this.deliver(msg)
      }
    }
  }

  /** Adds the tab the message answers. A button on a message from an earlier run is dead. */
  private deliver(msg: TelegramIncoming): void {
    if (msg.kind === 'button') {
      if (!this.messages.has(msg.messageId)) {
        void this.answerButton(msg.callbackId, 'This message is from before ClaudeHelper restarted')
        return
      }
      const key = this.messages.get(msg.messageId)
      this.deps.onIncoming(key ? { ...msg, key } : msg)
      return
    }
    const key = msg.replyTo === undefined ? undefined : this.messages.get(msg.replyTo)
    this.deps.onIncoming(key ? { ...msg, key } : msg)
  }
}

function nextOffset(updates: unknown[], offset: number): number {
  for (const u of updates) {
    const id = (u as { update_id?: unknown } | null)?.update_id
    if (typeof id === 'number' && id + 1 > offset) offset = id + 1
  }
  return offset
}
