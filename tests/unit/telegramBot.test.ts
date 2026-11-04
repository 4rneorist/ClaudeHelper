import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/settingsStore'
import type { Fetch } from '../../src/main/telegram'
import { TelegramBot, toIncoming } from '../../src/main/telegramBot'
import { TelegramTopics } from '../../src/main/telegramTopics'
import { TOPIC_COLORS, type Settings, type TelegramIncoming } from '../../src/shared/ipc'

const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345'
const OWNER = '42'
const NOW = Date.UTC(2026, 10, 2, 12, 0, 0)
const secs = (ms: number): number => Math.floor(ms / 1000)

const me = { id: 42, is_bot: false, first_name: 'Ann' }
const myChat = { id: 42, type: 'private', first_name: 'Ann' }

function message(text: string, extra: object = {}): object {
  return { message_id: 10, date: secs(NOW), chat: myChat, from: me, text, ...extra }
}

describe('toIncoming', () => {
  it('reads commands, with their arguments and the bot name some clients add', () => {
    expect(toIncoming({ message: message('/prompt@my_bot 3 run the tests') }, OWNER, NOW)).toEqual({
      kind: 'command',
      command: 'prompt',
      args: '3 run the tests',
      messageId: 10
    })
    expect(toIncoming({ message: message('/Chats') }, OWNER, NOW)).toEqual({
      kind: 'command',
      command: 'chats',
      args: '',
      messageId: 10
    })
  })

  it('reads text, with the message it replies to', () => {
    const reply = message('  fix it\nplease ', { reply_to_message: { message_id: 7 } })
    expect(toIncoming({ message: reply }, OWNER, NOW)).toEqual({
      kind: 'text',
      text: 'fix it\nplease',
      messageId: 10,
      replyTo: 7
    })
  })

  it('obeys only your own private chat with the bot', () => {
    const stranger = { id: 99, is_bot: false, first_name: 'Eve' }
    const fromStranger = message('/chats', { from: stranger, chat: { ...myChat, id: 99 } })
    const inGroup = message('/chats', { chat: { id: -100, type: 'group', title: 'Team' } })
    const intoMyChat = message('/chats', { from: stranger })
    for (const m of [fromStranger, inGroup, intoMyChat]) {
      expect(toIncoming({ message: m }, OWNER, NOW)).toBeNull()
    }
    expect(toIncoming({ edited_message: message('/chats') }, OWNER, NOW)).toBeNull()
    expect(toIncoming({ channel_post: message('/chats') }, OWNER, NOW)).toBeNull()
  })

  it('drops what was written before the app started', () => {
    const old = message('/prompt 1 rm -rf', { date: secs(NOW - 10 * 60_000) })
    expect(toIncoming({ message: old }, OWNER, NOW)).toBeNull()
  })

  it('reads a button press from you on a message in your chat', () => {
    const press = {
      id: 'cb1',
      from: me,
      data: 'a:q1:2',
      message: { message_id: 5, chat: myChat, date: secs(NOW) }
    }
    expect(toIncoming({ callback_query: press }, OWNER, NOW)).toEqual({
      kind: 'button',
      data: 'a:q1:2',
      messageId: 5,
      callbackId: 'cb1'
    })
    const byStranger = { ...press, from: { id: 99, first_name: 'Eve' } }
    expect(toIncoming({ callback_query: byStranger }, OWNER, NOW)).toBeNull()
  })
})

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status })

/**
 * A fake Bot API. Each getUpdates takes the next answer from `polls` (an array of updates, or an
 * HTTP status for an error); once they run out it waits, as a long poll does, until stopped.
 */
/** A request to the fake API: the method and its JSON body. */
interface Call {
  method: string
  body: Record<string, unknown>
}

function fakeApi(polls: (object[] | number)[]): Fetch & { calls: Call[] } {
  const calls: Call[] = []
  let nextId = 100
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    const method = url.split('/').pop()!
    calls.push({ method, body: JSON.parse(String(init.body)) })
    if (method === 'getUpdates') {
      const next = polls.shift()
      if (next === undefined) {
        await new Promise((_, reject) =>
          init.signal!.addEventListener('abort', () => reject(new Error('aborted')))
        )
      }
      if (typeof next === 'number') return json({ ok: false, description: 'Conflict' }, next)
      return json({ ok: true, result: next })
    }
    if (method === 'sendMessage') return json({ ok: true, result: { message_id: nextId++ } })
    return json({ ok: true, result: true })
  }
  return Object.assign(fn, { calls })
}

const settings = (patch: Partial<Settings> = {}): Settings => ({
  ...DEFAULT_SETTINGS,
  telegramEnabled: true,
  telegramBotToken: TOKEN,
  telegramChatId: OWNER,
  telegramRemote: true,
  ...patch
})

function startBot(
  polls: (object[] | number)[],
  patch: Partial<Settings> = {}
): {
  api: ReturnType<typeof fakeApi>
  bot: TelegramBot
  incoming: TelegramIncoming[]
  slept: number[]
} {
  const api = fakeApi(polls)
  const incoming: TelegramIncoming[] = []
  const slept: number[] = []
  const bot = new TelegramBot({
    fetch: api,
    onIncoming: (msg) => incoming.push(msg),
    log: () => {},
    now: () => NOW,
    sleep: async (ms) => void slept.push(ms)
  })
  bot.sync(settings(patch))
  return { api, bot, incoming, slept }
}

const polled = (api: { calls: Call[] }): Record<string, unknown>[] =>
  api.calls.filter((c) => c.method === 'getUpdates').map((c) => c.body)

describe('TelegramBot', () => {
  it('runs only with remote control on, set up, and your own chat', () => {
    for (const patch of [
      { telegramRemote: false },
      { telegramEnabled: false },
      { telegramChatId: '@channel' },
      { telegramChatId: '-100123' }
    ]) {
      const { api, bot } = startBot([], patch)
      expect(bot.running).toBe(false)
      expect(api.calls).toHaveLength(0)
    }
  })

  it('skips what was waiting at start, then passes on what comes', async () => {
    const backlog = [{ update_id: 5, message: message('/prompt 1 old') }]
    const fresh = [{ update_id: 6, message: message('/chats') }]
    const { api, bot, incoming } = startBot([backlog, fresh])
    await vi.waitFor(() => expect(incoming).toHaveLength(1))
    expect(incoming[0]).toMatchObject({ kind: 'command', command: 'chats' })
    expect(polled(api).map((b) => b.offset)).toEqual([-1, 6, 7])
    expect(api.calls.some((c) => c.method === 'setMyCommands')).toBe(true)
    bot.stop()
  })

  it('knows which tab a reply or a button is about', async () => {
    const reply = {
      update_id: 2,
      message: message('go on', { reply_to_message: { message_id: 100 } })
    }
    const press = {
      update_id: 3,
      callback_query: {
        id: 'cb',
        from: me,
        data: 'r:50',
        message: { message_id: 100, chat: myChat }
      }
    }
    const { bot, incoming } = startBot([[], [reply, press]])
    // A notification about term-7 went out as message 100 (before the poll's answers arrive).
    bot.remember(100, 'term-7')
    await vi.waitFor(() => expect(incoming).toHaveLength(2))
    expect(incoming.map((m) => m.key)).toEqual(['term-7', 'term-7'])
    bot.stop()
  })

  it('remembers what it sends, so only its own messages can be changed', async () => {
    const { api, bot } = startBot([[]])
    expect(await bot.send({ text: 'Screen', key: 'term-7' })).toEqual({ messageId: 100 })
    await bot.edit(100, { text: 'Screen again' })
    await bot.edit(55, { text: 'Not mine' })
    expect(api.calls.filter((c) => c.method === 'editMessageText')).toHaveLength(1)
    bot.stop()
  })

  it('turns down buttons on messages it did not send in this run', async () => {
    const press = {
      update_id: 3,
      callback_query: {
        id: 'cb',
        from: me,
        data: 'a:q:1',
        message: { message_id: 55, chat: myChat }
      }
    }
    const { api, bot, incoming } = startBot([[], [press]])
    await vi.waitFor(() =>
      expect(api.calls.some((c) => c.method === 'answerCallbackQuery')).toBe(true)
    )
    expect(incoming).toHaveLength(0)
    expect(api.calls.find((c) => c.method === 'answerCallbackQuery')!.body.text).toMatch(
      /restarted/
    )
    bot.stop()
  })

  it('waits longer after each failed poll', async () => {
    const { bot, slept, incoming } = startBot([
      [],
      409,
      409,
      502,
      [{ update_id: 1, message: message('/help') }]
    ])
    await vi.waitFor(() => expect(incoming).toHaveLength(1))
    expect(slept).toEqual([5000, 10000, 20000])
    bot.stop()
  })

  it('stops, and takes the commands out of the menu, when switched off', async () => {
    const { api, bot } = startBot([[]])
    await vi.waitFor(() => expect(polled(api)).toHaveLength(2))
    bot.sync(settings({ telegramRemote: false }))
    expect(bot.running).toBe(false)
    await vi.waitFor(() =>
      expect(api.calls.some((c) => c.method === 'deleteMyCommands')).toBe(true)
    )
    expect(await bot.send({ text: 'x' })).toEqual({ messageId: null })
  })
})

describe('topics', () => {
  it('reads which topic a message or a button press is in', () => {
    const inTopic = message('go on', { message_thread_id: 77, is_topic_message: true })
    expect(toIncoming({ message: inTopic }, OWNER, NOW)).toEqual({
      kind: 'text',
      text: 'go on',
      messageId: 10,
      thread: 77
    })
    // A thread id without is_topic_message (a reply chain) is not a topic.
    const notTopic = message('go on', { message_thread_id: 77 })
    expect(toIncoming({ message: notTopic }, OWNER, NOW)).not.toHaveProperty('thread')
    const press = {
      id: 'cb1',
      from: me,
      data: 'g:term-1',
      message: { message_id: 5, chat: myChat, message_thread_id: 77, is_topic_message: true }
    }
    expect(toIncoming({ callback_query: press }, OWNER, NOW)).toMatchObject({ thread: 77 })
  })

  it("sends a message about a tab into the tab's topic, made the first time", async () => {
    const api = fakeApi([[]])
    const base = api as Fetch
    // getMe and createForumTopic answers on top of the fake API.
    const withTopics: Fetch = async (url, init) => {
      const method = url.split('/').pop()
      if (method === 'getMe') {
        api.calls.push({ method, body: {} })
        return json({ ok: true, result: { id: 1, is_bot: true, has_topics_enabled: true } })
      }
      if (method === 'createForumTopic') {
        api.calls.push({ method, body: JSON.parse(String(init.body)) })
        return json({ ok: true, result: { message_thread_id: 900 } })
      }
      return base(url, init)
    }
    const made: [string, number | null][] = []
    const topics = new TelegramTopics({
      fetch: withTopics,
      onTopic: (key, thread) => made.push([key, thread]),
      log: () => {}
    })
    const bot = new TelegramBot({
      fetch: withTopics,
      onIncoming: () => {},
      log: () => {},
      topics,
      now: () => NOW,
      sleep: async () => {}
    })
    bot.sync(settings())
    const topic = { name: 'app › Claude 1', color: TOPIC_COLORS[1] }
    expect(await bot.send({ text: '✅ IDLE', key: 'term-1', topic })).toMatchObject({ thread: 900 })
    // An answer where you wrote: no topic made for it.
    await bot.send({ text: '📨 Sent', key: 'term-1', thread: 33 })
    const sent = api.calls.filter((c) => c.method === 'sendMessage').map((c) => c.body)
    expect(sent.map((b) => b.message_thread_id)).toEqual([900, 33])
    expect(made).toEqual([['term-1', 900]])
    bot.stop()
  })
})
