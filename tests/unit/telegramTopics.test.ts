import { describe, expect, it } from 'vitest'
import type { Fetch } from '../../src/main/telegram'
import { TelegramTopics } from '../../src/main/telegramTopics'
import { TOPIC_COLORS } from '../../src/shared/ipc'

const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345'
const CHAT = '42'
const ref = { name: 'app › Claude 1', color: TOPIC_COLORS[0] }

/** A fake Bot API: getMe says whether topics are on; createForumTopic hands out threads. */
function fakeApi(
  topics: boolean
): Fetch & { calls: { method: string; body: Record<string, unknown> }[] } {
  const calls: { method: string; body: Record<string, unknown> }[] = []
  let thread = 500
  const fn: Fetch = async (url, init) => {
    const method = url.split('/').pop()!
    calls.push({ method, body: JSON.parse(String(init.body)) })
    const result =
      method === 'getMe'
        ? { id: 1, is_bot: true, has_topics_enabled: topics }
        : method === 'createForumTopic'
          ? { message_thread_id: thread++, name: 'x', icon_color: 0 }
          : true
    return new Response(JSON.stringify({ ok: true, result }))
  }
  return Object.assign(fn, { calls })
}

function topicsWith(
  on: boolean,
  now = { t: 0 }
): {
  api: ReturnType<typeof fakeApi>
  topics: TelegramTopics
  events: [string, number | null][]
  logs: string[]
  now: { t: number }
} {
  const api = fakeApi(on)
  const events: [string, number | null][] = []
  const logs: string[] = []
  const topics = new TelegramTopics({
    fetch: api,
    onTopic: (key, thread) => events.push([key, thread]),
    log: (m) => logs.push(m),
    now: () => now.t
  })
  return { api, topics, events, logs, now }
}

describe('TelegramTopics', () => {
  it("makes a tab's topic once, the first time something about it is sent", async () => {
    const { api, topics, events } = topicsWith(true)
    const [a, b] = await Promise.all([
      topics.threadFor(TOKEN, CHAT, 'term-1', ref),
      topics.threadFor(TOKEN, CHAT, 'term-1', ref)
    ])
    expect([a, b]).toEqual([500, 500])
    // The renderer may not know it yet: it is still the one.
    expect(await topics.threadFor(TOKEN, CHAT, 'term-1', ref)).toBe(500)
    expect(await topics.threadFor(TOKEN, CHAT, 'term-2', ref)).toBe(501)
    expect(api.calls.filter((c) => c.method === 'createForumTopic')).toHaveLength(2)
    expect(api.calls.find((c) => c.method === 'createForumTopic')!.body).toEqual({
      chat_id: CHAT,
      name: 'app › Claude 1',
      icon_color: TOPIC_COLORS[0]
    })
    expect(events).toEqual([
      ['term-1', 500],
      ['term-2', 501]
    ])
  })

  it('uses the topic a tab already has, and asks Telegram about Threaded Mode only now and then', async () => {
    const { api, topics, now } = topicsWith(true)
    expect(await topics.threadFor(TOKEN, CHAT, 'term-1', { ...ref, thread: 77 })).toBe(77)
    await topics.threadFor(TOKEN, CHAT, 'term-1', { ...ref, thread: 77 })
    expect(api.calls.filter((c) => c.method === 'getMe')).toHaveLength(1)
    now.t += 11 * 60_000
    await topics.threadFor(TOKEN, CHAT, 'term-1', { ...ref, thread: 77 })
    expect(api.calls.filter((c) => c.method === 'getMe')).toHaveLength(2)
    expect(api.calls.some((c) => c.method === 'createForumTopic')).toBe(false)
  })

  it('uses the main chat without Threaded Mode, a group, or a message about no tab', async () => {
    expect(await topicsWith(false).topics.threadFor(TOKEN, CHAT, 'term-1', ref)).toBeUndefined()
    const { topics, api } = topicsWith(true)
    expect(await topics.threadFor(TOKEN, '-100123', 'term-1', ref)).toBeUndefined()
    expect(await topics.threadFor(TOKEN, CHAT, 'term-1', undefined)).toBeUndefined()
    expect(api.calls).toHaveLength(0)
  })

  it('gives a tab whose topic was deleted a new one next time', async () => {
    const { topics, events, now } = topicsWith(true)
    await topics.threadFor(TOKEN, CHAT, 'term-1', ref)
    now.t += 60 * 60_000
    topics.gone('term-1', 500)
    expect(events.at(-1)).toEqual(['term-1', null])
    expect(await topics.threadFor(TOKEN, CHAT, 'term-1', ref)).toBe(501)
  })

  it("stops making topics when one just made can't be written to", async () => {
    const { topics, logs } = topicsWith(true)
    await topics.threadFor(TOKEN, CHAT, 'term-1', ref)
    topics.gone('term-1', 500)
    expect(logs.join()).toMatch(/main chat until ClaudeHelper restarts/)
    expect(await topics.threadFor(TOKEN, CHAT, 'term-1', ref)).toBeUndefined()
  })
})
