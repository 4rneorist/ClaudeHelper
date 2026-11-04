import { TELEGRAM_PRIVATE_CHAT, type TopicRef } from '../shared/ipc'
import { createTopic, getBotInfo, renameTopic, type Fetch } from './telegram'

// A topic per Claude session in your private chat with the bot, when the bot has Threaded Mode on
// in @BotFather. A session's topic is made the first time something about it is sent; the
// renderer keeps its thread with the tab (and its layout), so a restored tab writes there again.
// No electron import: unit tested.

/** How long a "Threaded Mode is on/off" answer from Telegram holds. */
const CHECK_MS = 10 * 60_000
/** After a failed check, ask again this soon. */
const RECHECK_MS = 60_000
/** A topic that can't be written to this soon after it was made means topics don't work. */
const FRESH_MS = 2 * 60_000

export interface TelegramTopicsDeps {
  fetch: Fetch
  /** A tab got its topic, or lost it (null): the renderer keeps it with the tab. */
  onTopic(key: string, thread: number | null): void
  log(message: string): void
  now?(): number
}

export class TelegramTopics {
  private checked: { token: string; on: boolean; until: number } | null = null
  /** Topics made but not writable: none more until the app restarts. */
  private broken = false
  private creating = new Map<string, Promise<number | null>>()
  /** Topics made this run: by tab (the renderer may not know yet), and when. */
  private byKey = new Map<string, number>()
  private madeAt = new Map<number, number>()

  constructor(private readonly deps: TelegramTopicsDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  /** Whether sessions get topics: the bot has Threaded Mode on, and they have worked so far. */
  async on(token: string): Promise<boolean> {
    if (this.broken) return false
    const now = this.now()
    if (this.checked?.token === token && now < this.checked.until) return this.checked.on
    const info = await getBotInfo(this.deps.fetch, token)
    const on = info.ok && info.topics
    this.checked = { token, on, until: now + (info.ok ? CHECK_MS : RECHECK_MS) }
    return on
  }

  /**
   * The thread a message about tab `key` goes in: its topic, made now if it has none yet;
   * undefined for the main chat (no topics, or not a private chat).
   */
  async threadFor(
    token: string,
    chatId: string,
    key: string | undefined,
    ref: TopicRef | undefined
  ): Promise<number | undefined> {
    if (!key || !ref || !TELEGRAM_PRIVATE_CHAT.test(chatId) || !(await this.on(token))) {
      return undefined
    }
    const known = ref.thread ?? this.byKey.get(key)
    if (known !== undefined) return known
    let making = this.creating.get(key)
    if (!making) {
      making = this.create(token, chatId, key, ref).finally(() => this.creating.delete(key))
      this.creating.set(key, making)
    }
    return (await making) ?? undefined
  }

  private async create(
    token: string,
    chatId: string,
    key: string,
    ref: TopicRef
  ): Promise<number | null> {
    const res = await createTopic(this.deps.fetch, token, chatId, ref.name, ref.color)
    if (!res.ok) {
      this.deps.log(`Telegram topic not made: ${res.error}`)
      // Maybe Threaded Mode was switched off: ask again next time.
      this.checked = null
      return null
    }
    this.byKey.set(key, res.thread)
    this.madeAt.set(res.thread, this.now())
    this.deps.onTopic(key, res.thread)
    return res.thread
  }

  /**
   * Telegram no longer knows `thread`, tab `key`'s topic (deleted in Telegram): the tab gets a
   * new one next time. One made moments ago means topics don't work: none until a restart.
   */
  gone(key: string | undefined, thread: number): void {
    const made = this.madeAt.get(thread)
    if (made !== undefined && this.now() - made < FRESH_MS && !this.broken) {
      this.broken = true
      this.deps.log(
        "Telegram topics: a topic just made can't be written to, so messages go to the main chat until ClaudeHelper restarts"
      )
    }
    if (key === undefined) return
    if (this.byKey.get(key) === thread) this.byKey.delete(key)
    this.deps.onTopic(key, null)
  }

  async rename(token: string, chatId: string, thread: number, name: string): Promise<void> {
    if (!TELEGRAM_PRIVATE_CHAT.test(chatId) || !(await this.on(token))) return
    const res = await renameTopic(this.deps.fetch, token, chatId, thread, name)
    if (!res.ok) this.deps.log(`Telegram topic not renamed: ${res.error}`)
  }
}
