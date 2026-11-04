import type { AttentionRequest } from '../../shared/ipc'
import { playSound } from './sounds'
import {
  locate,
  useStore,
  workspaceTitle,
  type AppNotification,
  type Attention,
  type TerminalState
} from './store'
import { conversationTitle } from './terminal/claudeActivity'
import { topicRef } from './telegramTopics'
import { getTerminal } from './terminal/TerminalSession'
import { isMuted, reminderDue, waitingSummary } from './waiting'

// Whenever a session finishes or asks for your answer, a sound for each, even in the session you
// are looking at. When you weren't looking: a toast and an entry in the notification list (the
// bell), and an OS notification with a flashing taskbar button (main only shows those while the
// window is in the background). A muted session, or Do not disturb, only gets the list entry. The taskbar button and the dock / launcher badge
// show what waits; a session that keeps asking unseen is reminded of every few minutes. Main also
// sends these calls to Telegram when that is set up, and the ones you were looking at too: you
// may have walked away from the screen.

export const ATTENTION_LABELS: Record<Attention, string> = {
  finished: 'Claude finished',
  asking: 'Claude needs your answer'
}

/** "Claude needs your answer: Fix the login bug". */
export function notificationText(n: Pick<AppNotification, 'kind' | 'topic' | 'reminder'>): string {
  const label = n.reminder ? 'Still waiting for your answer' : ATTENTION_LABELS[n.kind]
  return n.topic ? `${label}: ${n.topic}` : label
}

/** Where it came from: "my project › Claude 2". */
export function notificationSource(n: Pick<AppNotification, 'tab' | 'folder'>): string {
  return n.folder ? `${n.folder} › ${n.tab}` : n.tab
}

/** How often to check whether a session that keeps asking is due a reminder. */
const REMINDER_CHECK_MS = 30_000

/** Per terminal: how many reminders it has had for the current question, and the last one. */
const reminders = new Map<string, { count: number; at?: number }>()

let started = false

export function startAttention(): void {
  if (started) return
  started = true
  let summary = ''
  useStore.subscribe((state, prev) => {
    if (state.terminals === prev.terminals && state.settings === prev.settings) return
    for (const t of Object.values(state.terminals)) {
      const before = prev.terminals[t.key]
      // Every finish or question sounds, even in the session you are looking at.
      if (t.lastCall && t.lastCall !== before?.lastCall) {
        sound(t, t.lastCall.kind)
        if (t.lastCall.seen) callSeen(t, t.lastCall.kind)
      }
      if (t.attention !== before?.attention) reminders.delete(t.key)
      if (t.attention && t.attention !== before?.attention) call(t, t.attention)
    }
    // The taskbar button and the badge: what waits, and whether anything works.
    const next = waitingSummary(state)
    const json = JSON.stringify(next)
    if (json !== summary) {
      summary = json
      window.api.setAttentionSummary(next)
    }
  })
  setInterval(remind, REMINDER_CHECK_MS)
  window.api.onAttentionFocus((key) => useStore.getState().revealTerminal(key))
}

function remind(): void {
  const { terminals, settings } = useStore.getState()
  const now = Date.now()
  for (const t of Object.values(terminals)) {
    if (t.attention !== 'asking' || t.attentionSince === undefined) continue
    const done = reminders.get(t.key) ?? { count: 0 }
    if (!reminderDue(t.attentionSince, done.at, done.count, now, settings?.reminderMinutes ?? 0)) {
      continue
    }
    reminders.set(t.key, { count: done.count + 1, at: now })
    sound(t, 'asking')
    call(t, 'asking', true)
  }
}

/** The sound for a finish or a question, unless sounds are off, it is muted, or Do not disturb. */
function sound(t: TerminalState, kind: Attention): void {
  const state = useStore.getState()
  const { settings } = state
  if (!settings?.soundOnAttention || state.doNotDisturb || isMuted(state, t)) return
  playSound(kind === 'asking' ? settings.askingSound : settings.finishedSound, settings.soundVolume)
}

/** The toast, the list entry and the OS notification for a session you weren't looking at. */
function call(t: TerminalState, kind: Attention, reminder = false): void {
  const state = useStore.getState()
  const note = noteFor(t, kind, reminder)

  // It always goes in the list; muted sessions and Do not disturb stay silent.
  const quiet = note.muted || state.doNotDisturb
  state.notify(note, { toast: !quiet })
  if (quiet) return
  window.api.notifyAttention(attentionRequest(note))
}

/** A call in the pane you have focused: only for Telegram, in case you have walked away. */
function callSeen(t: TerminalState, kind: Attention): void {
  const note = noteFor(t, kind, false)
  if (note.muted || useStore.getState().doNotDisturb) return
  window.api.notifyAttention({ ...attentionRequest(note), seen: true })
}

/** What the bell list keeps of a call. */
type Note = Omit<AppNotification, 'id' | 'read'>

/** Where a call comes from ("my project › Claude 2") and the conversation's title, or ''. */
export function callPlace(t: TerminalState): { source: string; topic: string } {
  const note = noteFor(t, 'finished', false)
  return { source: notificationSource(note), topic: note.topic }
}

function noteFor(t: TerminalState, kind: Attention, reminder: boolean): Note {
  const state = useStore.getState()
  const { workspaces, settings, appInfo } = state
  const where = locate(workspaces, t.key)
  const folder = where
    ? workspaceTitle(where.workspace, settings?.folderTitles, appInfo?.platform ?? '')
    : ''
  // Claude names the conversation in its title; "Claude Code" until it has a topic.
  const named = t.termTitle ? conversationTitle(t.termTitle) : ''
  const topic = named === 'Claude Code' ? '' : named
  const muted = isMuted(state, t)
  return { key: t.key, kind, tab: t.title, folder, topic, at: Date.now(), reminder, muted }
}

function attentionRequest(note: Note): AttentionRequest {
  const source = notificationSource(note)
  const req: AttentionRequest = {
    key: note.key,
    title: `ClaudeHelper · ${source}`,
    body: notificationText(note),
    event: note.reminder ? 'reminder' : note.kind,
    source,
    topic: note.topic
  }
  const state = useStore.getState()
  // With remote control, Telegram shows the question with a button per option.
  if (note.kind === 'asking' && state.settings?.telegramRemote) {
    const question = getTerminal(note.key)?.question()
    if (question) req.question = question
  }
  // A chat driven from Telegram gets its questions and whole reply there from remote control.
  if (!note.reminder && state.terminals[note.key]?.telegramReply) req.skipTelegram = true
  // Its topic in Telegram, when the bot has topics.
  if (state.settings?.telegramEnabled) {
    const topic = topicRef(note.key)
    if (topic) req.telegramTopic = topic
  }
  return req
}
