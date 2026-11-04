import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/main/settingsStore'
import {
  attentionMessage,
  createTopic,
  getBotInfo,
  renameTopic,
  editTelegram,
  findTelegramChat,
  messageHtml,
  sendTelegram,
  shouldSendTelegram,
  telegramText,
  type Fetch,
  type IdleState,
  type TelegramMoment
} from '../../src/main/telegram'
import { TELEGRAM_ALWAYS, type Settings } from '../../src/shared/ipc'

const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345'

/** Answers every request with this status and JSON body, and records what was asked. */
function fakeFetch(status: number, body: unknown): Fetch & { calls: [string, RequestInit][] } {
  const calls: [string, RequestInit][] = []
  const fn = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push([url, init])
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  return Object.assign(fn, { calls })
}

const failing =
  (err: Error): Fetch =>
  async () => {
    throw err
  }

describe('telegramText', () => {
  it('starts with what happened, then where, with the conversation below', () => {
    const where = { source: 'app › Claude 2', topic: 'Fix it' }
    expect(telegramText({ event: 'finished', ...where })).toBe('✅ IDLE: app › Claude 2\nFix it')
    expect(telegramText({ event: 'asking', ...where })).toBe(
      '🔔 NEED YOUR ATTENTION: app › Claude 2\nFix it'
    )
    expect(telegramText({ event: 'reminder', ...where })).toBe(
      '⏰ STILL NEEDS YOUR ATTENTION: app › Claude 2\nFix it'
    )
  })

  it('is one line while the conversation has no title', () => {
    expect(telegramText({ event: 'asking', source: 'app › Claude 2', topic: '' })).toBe(
      '🔔 NEED YOUR ATTENTION: app › Claude 2'
    )
  })
})

describe('shouldSendTelegram', () => {
  const settings = (patch: Partial<Settings> = {}): Settings => ({
    ...DEFAULT_SETTINGS,
    telegramEnabled: true,
    telegramBotToken: TOKEN,
    telegramChatId: '42',
    ...patch
  })
  const moment = (
    patch: Partial<TelegramMoment> & { idle?: IdleState } = {}
  ): TelegramMoment & {
    asked: number[]
  } => {
    const asked: number[] = []
    return {
      focused: false,
      seen: false,
      ...patch,
      idleState: (seconds) => {
        asked.push(seconds)
        return patch.idle ?? 'active'
      },
      asked
    }
  }

  it('sends nothing unless switched on and set up', () => {
    const away = moment({ idle: 'locked' })
    expect(shouldSendTelegram(settings({ telegramEnabled: false }), away)).toBe(false)
    expect(shouldSendTelegram(settings({ telegramBotToken: '' }), away)).toBe(false)
    expect(shouldSendTelegram(settings({ telegramChatId: '' }), away)).toBe(false)
    expect(shouldSendTelegram(settings(), away)).toBe(true)
  })

  it('in "every time" mode, sends every call, also from the session in front of you', () => {
    const always = settings({ telegramAwayMinutes: TELEGRAM_ALWAYS })
    const active = moment({ focused: true, seen: true, idle: 'active' })
    expect(shouldSendTelegram(always, active)).toBe(true)
    expect(shouldSendTelegram(always, moment())).toBe(true)
    expect(active.asked).toEqual([])
    expect(shouldSendTelegram({ ...always, telegramEnabled: false }, active)).toBe(false)
  })

  it('in background mode, sends whenever the window is in the background', () => {
    const always = settings({ telegramAwayMinutes: 0 })
    expect(shouldSendTelegram(always, moment())).toBe(true)
    expect(shouldSendTelegram(always, moment({ focused: true }))).toBe(false)
    expect(shouldSendTelegram(always, moment({ focused: true, seen: true }))).toBe(false)
  })

  it('in away mode, sends only after that long without input, or when locked', () => {
    const away = settings({ telegramAwayMinutes: 10 })
    const active = moment({ idle: 'active' })
    expect(shouldSendTelegram(away, active)).toBe(false)
    expect(active.asked).toEqual([600])
    expect(shouldSendTelegram(away, moment({ idle: 'idle' }))).toBe(true)
    expect(shouldSendTelegram(away, moment({ idle: 'locked' }))).toBe(true)
    // Some Linux desktops can't tell: a message too many beats a missed one.
    expect(shouldSendTelegram(away, moment({ idle: 'unknown' }))).toBe(true)
  })

  it('in away mode, also tells about the session you had in front of you', () => {
    const away = settings({ telegramAwayMinutes: 5 })
    expect(shouldSendTelegram(away, moment({ focused: true, seen: true, idle: 'idle' }))).toBe(true)
  })
})

describe('sendTelegram', () => {
  it('posts the text to the chat through the Bot API', async () => {
    const fetch = fakeFetch(200, { ok: true, result: { message_id: 1 } })
    expect(await sendTelegram(fetch, TOKEN, '42', { text: 'Hello' })).toEqual({
      ok: true,
      messageId: 1,
      messageIds: [1]
    })
    const [url, init] = fetch.calls[0]
    expect(url).toBe(`https://api.telegram.org/bot${TOKEN}/sendMessage`)
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({
      chat_id: '42',
      text: 'Hello',
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true }
    })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('sends a long reply in several messages: the first answers, the last has the buttons', async () => {
    let id = 0
    const calls: Record<string, unknown>[] = []
    const fetch: Fetch = async (_url, init) => {
      calls.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ ok: true, result: { message_id: ++id } }))
    }
    const markdown = Array.from({ length: 120 }, (_, i) => `Line ${i}: ${'word '.repeat(10)}`)
    const res = await sendTelegram(fetch, TOKEN, '42', {
      text: '✅ IDLE: app › Claude 1',
      markdown: markdown.join('\n'),
      replyTo: 7,
      buttons: [[{ label: 'More', data: 'm' }]]
    })
    expect(res).toEqual({ ok: true, messageId: 2, messageIds: [1, 2] })
    expect(calls).toHaveLength(2)
    expect(calls[0].text).toMatch(/^✅ IDLE: app › Claude 1\n\nLine 0:/)
    expect(calls[0].reply_parameters).toEqual({ message_id: 7, allow_sending_without_reply: true })
    expect(calls[0].reply_markup).toBeUndefined()
    expect(calls[1].reply_parameters).toBeUndefined()
    expect(calls[1].reply_markup).toEqual({
      inline_keyboard: [[{ text: 'More', callback_data: 'm' }]]
    })
    expect(String(calls[1].text)).toMatch(/Line 119: /)
  })

  it('sends formatting Telegram rejects as plain text', async () => {
    const calls: Record<string, unknown>[] = []
    const fetch: Fetch = async (_url, init) => {
      const body = JSON.parse(String(init.body))
      calls.push(body)
      return body.parse_mode
        ? new Response(
            JSON.stringify({ ok: false, description: "Bad Request: can't parse entities" }),
            { status: 400 }
          )
        : new Response(JSON.stringify({ ok: true, result: { message_id: 3 } }))
    }
    const res = await sendTelegram(fetch, TOKEN, '42', { text: 'Done', markdown: '**a < b**' })
    expect(res).toEqual({ ok: true, messageId: 3, messageIds: [3] })
    expect(calls[1]).toMatchObject({ text: 'Done\n\na < b' })
    expect(calls[1].parse_mode).toBeUndefined()
  })

  it('makes no request with a token or chat ID that cannot work', async () => {
    const fetch = fakeFetch(200, { ok: true })
    expect((await sendTelegram(fetch, '123:abc/../getMe', '42', { text: 'x' })).ok).toBe(false)
    expect((await sendTelegram(fetch, TOKEN, 'my chat', { text: 'x' })).ok).toBe(false)
    expect(fetch.calls).toHaveLength(0)
  })

  it.each([
    [401, { ok: false, description: 'Unauthorized' }, /Wrong bot token/],
    [404, { ok: false, description: 'Not Found' }, /Wrong bot token/],
    [400, { ok: false, description: 'Bad Request: chat not found' }, /press Start/],
    [403, { ok: false, description: 'Forbidden: bot was blocked by the user' }, /unblock/],
    [429, { ok: false, description: 'Too Many Requests: retry after 5' }, /wait/],
    [400, { ok: false, description: 'Bad Request: message is too long' }, /message is too long/],
    [502, '<html>Bad Gateway</html>', /HTTP 502/]
  ])('explains HTTP %i in words', async (status, body, expected) => {
    const res = await sendTelegram(fakeFetch(status, body), TOKEN, '42', { text: 'x' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error).toMatch(expected)
  })

  it('tells a timeout from no connection, and never shows the token', async () => {
    const timeout = Object.assign(new Error(`timed out ${TOKEN}`), { name: 'TimeoutError' })
    const offline = new TypeError(`fetch failed for https://api.telegram.org/bot${TOKEN}/x`)
    const late = await sendTelegram(failing(timeout), TOKEN, '42', { text: 'x' })
    const down = await sendTelegram(failing(offline), TOKEN, '42', { text: 'x' })
    expect(late).toEqual({ ok: false, error: expect.stringMatching(/in time/) })
    expect(down).toEqual({ ok: false, error: expect.stringMatching(/Couldn't reach/) })
    const echoed = await sendTelegram(
      fakeFetch(400, { ok: false, description: `bad ${TOKEN}` }),
      TOKEN,
      '42',
      { text: 'x' }
    )
    for (const res of [late, down, echoed]) expect(JSON.stringify(res)).not.toContain(TOKEN)
  })
})

describe('findTelegramChat', () => {
  const update = (field: string, chat: object): object => ({ update_id: 1, [field]: { chat } })

  it('finds the chat that last wrote to the bot', async () => {
    const fetch = fakeFetch(200, {
      ok: true,
      result: [
        update('message', { id: 1, type: 'private', first_name: 'Old' }),
        update('message', { id: 777, type: 'private', first_name: 'Ann', last_name: 'Lee' })
      ]
    })
    expect(await findTelegramChat(fetch, TOKEN)).toEqual({
      ok: true,
      chatId: '777',
      chatName: 'Ann Lee'
    })
    expect(fetch.calls[0][0]).toBe(`https://api.telegram.org/bot${TOKEN}/getUpdates`)
  })

  it('finds a group or channel by its title, with its negative ID', async () => {
    const group = fakeFetch(200, {
      ok: true,
      result: [update('my_chat_member', { id: -1001234567890, type: 'group', title: 'Team' })]
    })
    expect(await findTelegramChat(group, TOKEN)).toEqual({
      ok: true,
      chatId: '-1001234567890',
      chatName: 'Team'
    })
  })

  it('asks you to press Start when the bot has heard from no one', async () => {
    const res = await findTelegramChat(fakeFetch(200, { ok: true, result: [] }), TOKEN)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/press Start/) })
  })

  it("says why when the bot's chats can't be read", async () => {
    const webhook = fakeFetch(409, { ok: false, description: 'Conflict: webhook is active' })
    expect(await findTelegramChat(webhook, TOKEN)).toEqual({
      ok: false,
      error: expect.stringMatching(/webhook/)
    })
    const fetch = fakeFetch(200, { ok: true, result: [] })
    expect((await findTelegramChat(fetch, 'nope')).ok).toBe(false)
    expect(fetch.calls).toHaveLength(0)
  })
})

describe('messageHtml', () => {
  it('escapes everything, and shows the block monospace below the text', () => {
    expect(messageHtml({ text: 'a <b> & c' })).toBe('a &lt;b&gt; &amp; c')
    expect(messageHtml({ text: 'Screen', pre: 'if (a < b) {}' })).toBe(
      'Screen\n<pre>if (a &lt; b) {}</pre>'
    )
  })

  it('cuts the start of a block that is too long, keeping its end', () => {
    const html = messageHtml({ text: 'Head', pre: `${'x'.repeat(5000)}END` })
    const shown = html.replace(/<\/?pre>/g, '')
    expect(shown.length).toBe(4096)
    expect(shown).toMatch(/^Head\n…x+END$/)
  })
})

describe('sendTelegram with buttons', () => {
  it('sends buttons, a reply, or a forced reply box', async () => {
    const fetch = fakeFetch(200, { ok: true, result: { message_id: 9 } })
    await sendTelegram(fetch, TOKEN, '42', {
      text: 'Pick',
      replyTo: 5,
      buttons: [[{ label: '1. Yes', data: 'a:x:1' }]]
    })
    await sendTelegram(fetch, TOKEN, '42', { text: 'Name?', forceReply: true, buttons: [] })
    const [withButtons, forced] = fetch.calls.map(([, init]) => JSON.parse(String(init.body)))
    expect(withButtons.reply_markup).toEqual({
      inline_keyboard: [[{ text: '1. Yes', callback_data: 'a:x:1' }]]
    })
    expect(withButtons.reply_parameters).toEqual({
      message_id: 5,
      allow_sending_without_reply: true
    })
    expect(forced.reply_markup).toEqual({ force_reply: true })
  })
})

describe('editTelegram', () => {
  it('changes the text and buttons, or only takes the buttons away', async () => {
    const fetch = fakeFetch(200, { ok: true, result: true })
    await editTelegram(fetch, TOKEN, '42', 7, { text: 'New' })
    await editTelegram(fetch, TOKEN, '42', 7, null)
    expect(fetch.calls.map(([url]) => url.split('/').pop())).toEqual([
      'editMessageText',
      'editMessageReplyMarkup'
    ])
    const [text, markup] = fetch.calls.map(([, init]) => JSON.parse(String(init.body)))
    expect(text).toMatchObject({
      message_id: 7,
      text: 'New',
      reply_markup: { inline_keyboard: [] }
    })
    expect(markup).toEqual({ chat_id: '42', message_id: 7, reply_markup: { inline_keyboard: [] } })
  })

  it('takes a refresh that changed nothing as done', async () => {
    const same = fakeFetch(400, {
      ok: false,
      description: 'Bad Request: message is not modified: specified new message content is the same'
    })
    expect(await editTelegram(same, TOKEN, '42', 7, { text: 'Same' })).toEqual({ ok: true })
  })
})

describe('attentionMessage', () => {
  const req = {
    key: 'term-1',
    title: 'ClaudeHelper · app › Claude 1',
    body: 'Claude needs your answer',
    event: 'asking' as const,
    source: 'app › Claude 1',
    topic: 'Tests'
  }
  const question = {
    id: 'q1',
    text: 'Bash(npm test)\nDo you want to proceed?\n  1. Yes\n  2. No',
    options: [
      { n: 1, label: 'Yes' },
      { n: 2, label: 'No' }
    ],
    multi: false,
    freeText: null
  }

  it('is the text alone without a question', () => {
    expect(attentionMessage(req)).toEqual({ text: '🔔 NEED YOUR ATTENTION: app › Claude 1\nTests' })
  })

  it('shows the question with a button per option, which names the question', () => {
    expect(attentionMessage({ ...req, question })).toEqual({
      text: '🔔 NEED YOUR ATTENTION: app › Claude 1\nTests',
      pre: question.text,
      buttons: [[{ label: '1. Yes', data: 'a:q1:1' }], [{ label: '2. No', data: 'a:q1:2' }]]
    })
  })

  it('invites your own words when the question takes them', () => {
    const msg = attentionMessage({ ...req, question: { ...question, freeText: 2 } })
    expect(msg.text).toMatch(/reply to this message in your own words/)
  })

  it('asks for the numbers of a question that takes several answers, without buttons', () => {
    const msg = attentionMessage({ ...req, question: { ...question, multi: true } })
    expect(msg.buttons).toBeUndefined()
    expect(msg.text).toMatch(/reply to this message with their numbers/)
    expect(msg.pre).toBe(question.text)
  })

  it('makes a table in the question fit a phone', () => {
    const text = 'Plan:\n┌───┬───┐\n│ a │ b │\n└───┴───┘\nProceed?\n  1. Yes\n  2. No'
    const msg = attentionMessage({ ...req, question: { ...question, text } })
    expect(msg.pre).toBe('Plan:\n\na │ b\n\nProceed?\n  1. Yes\n  2. No')
  })
})

describe('topics', () => {
  type Answering = { fetch: Fetch; calls: { method: string; body: Record<string, unknown> }[] }
  const answering = (
    handler: (method: string, body: Record<string, unknown>) => Response
  ): Answering => {
    const calls: { method: string; body: Record<string, unknown> }[] = []
    const fetch: Fetch = async (url, init) => {
      const method = url.split('/').pop()!
      const body = JSON.parse(String(init.body))
      calls.push({ method, body })
      return handler(method, body)
    }
    return { fetch, calls }
  }
  const ok = (result: unknown): Response => new Response(JSON.stringify({ ok: true, result }))

  it('sends every part of a reply into its topic', async () => {
    let id = 0
    const { fetch, calls } = answering(() => ok({ message_id: ++id }))
    const markdown = Array.from({ length: 120 }, (_, i) => `Line ${i}: ${'word '.repeat(10)}`)
    await sendTelegram(fetch, TOKEN, '42', {
      text: 'IDLE',
      markdown: markdown.join('\n'),
      thread: 9
    })
    expect(calls.map((c) => c.body.message_thread_id)).toEqual([9, 9])
  })

  it("sends to the main chat when Telegram doesn't know the topic, and says so", async () => {
    const { fetch, calls } = answering((_, body) =>
      body.message_thread_id
        ? new Response(
            JSON.stringify({ ok: false, description: 'Bad Request: message thread not found' }),
            { status: 400 }
          )
        : ok({ message_id: 5 })
    )
    expect(await sendTelegram(fetch, TOKEN, '42', { text: 'IDLE', thread: 9 })).toEqual({
      ok: true,
      messageId: 5,
      messageIds: [5],
      threadGone: true
    })
    expect(calls.map((c) => c.body.message_thread_id)).toEqual([9, undefined])
  })

  it('asks whether the bot has Threaded Mode on', async () => {
    const { fetch } = answering(() => ok({ id: 1, is_bot: true, has_topics_enabled: true }))
    expect(await getBotInfo(fetch, TOKEN)).toEqual({ ok: true, topics: true })
    const off = answering(() => ok({ id: 1, is_bot: true }))
    expect(await getBotInfo(off.fetch, TOKEN)).toEqual({ ok: true, topics: false })
  })

  it('makes and renames topics', async () => {
    const { fetch, calls } = answering((method) =>
      method === 'createForumTopic' ? ok({ message_thread_id: 31, name: 'x' }) : ok(true)
    )
    expect(await createTopic(fetch, TOKEN, '42', 'app › Claude 1', 0x6fb9f0)).toEqual({
      ok: true,
      thread: 31
    })
    expect(await renameTopic(fetch, TOKEN, '42', 31, 'app › Fix login')).toEqual({ ok: true })
    expect(calls.map((c) => [c.method, c.body])).toEqual([
      ['createForumTopic', { chat_id: '42', name: 'app › Claude 1', icon_color: 0x6fb9f0 }],
      ['editForumTopic', { chat_id: '42', message_thread_id: 31, name: 'app › Fix login' }]
    ])
  })
})
