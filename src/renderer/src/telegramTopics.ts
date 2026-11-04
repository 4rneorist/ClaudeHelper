import type { TopicRef } from '../../shared/ipc'
import { useStore } from './store'
import { chatList, topicColor, topicName } from './telegramChats'

// A topic per Claude session in your Telegram chat with the bot (when the bot has Threaded Mode
// on): main makes it the first time something about the session is sent, and says which thread
// it is; the tab keeps it, saved with the layout. Here: the name and colour it is made with, its
// name following the tab's, and a last word in it when the tab closes.

/** A tab's topic, as main needs it to post there; undefined for a tab that isn't a Claude chat. */
export function topicRef(key: string): TopicRef | undefined {
  const state = useStore.getState()
  const chat = chatList(state).find((c) => c.key === key)
  if (!chat) return undefined
  const thread = state.terminals[key]?.telegramTopic
  return { name: topicName(chat), color: topicColor(chat.folder), ...(thread ? { thread } : {}) }
}

/** Renaming waits for the typing to stop. */
const RENAME_MS = 1500

let started = false

export function startTelegramTopics(): void {
  if (started) return
  started = true
  window.api.onTelegramTopic((key, thread) => {
    const store = useStore.getState()
    if (store.terminals[key]) store.patchTerminal(key, { telegramTopic: thread ?? undefined })
  })
  /** Each topic's name as last made or set, by thread. */
  const names = new Map<number, string>()
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  useStore.subscribe((state, prev) => {
    if (
      state.terminals === prev.terminals &&
      state.workspaces === prev.workspaces &&
      state.settings === prev.settings
    ) {
      return
    }
    // A closed tab: a last word in its topic.
    for (const t of Object.values(prev.terminals)) {
      if (!t.telegramTopic || state.terminals[t.key]) continue
      names.delete(t.telegramTopic)
      void window.api.sendTelegram({
        text: '⏹ This tab was closed in ClaudeHelper. /chats lists the open ones; /newchat opens a new one.',
        thread: t.telegramTopic
      })
    }
    if (!Object.values(state.terminals).some((t) => t.telegramTopic)) return
    // A renamed tab or folder: its topic follows.
    for (const chat of chatList(state)) {
      const thread = state.terminals[chat.key]?.telegramTopic
      if (!thread) continue
      const name = topicName(chat)
      const had = names.get(thread)
      names.set(thread, name)
      if (had === undefined || had === name) continue
      clearTimeout(timers.get(thread))
      timers.set(
        thread,
        setTimeout(() => {
          timers.delete(thread)
          window.api.renameTelegramTopic(thread, name)
        }, RENAME_MS)
      )
    }
  })
}
