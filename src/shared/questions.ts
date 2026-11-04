import type { AttentionEvent, AttentionRequest, ClaudeQuestion, TelegramButton } from './ipc'

// How Telegram words a call (what happened, where), and offers a question Claude asks: a button
// per option, or for one that takes several answers, a reply with their numbers. Used for
// notifications (main) and for what remote control sends (renderer).

/** Upper case and an emoji, so a phone's notification says at a glance what happened. */
const EVENT_LABELS: Record<AttentionEvent, string> = {
  finished: '✅ IDLE',
  asking: '🔔 NEED YOUR ATTENTION',
  reminder: '⏰ STILL NEEDS YOUR ATTENTION'
}

/** "🔔 NEED YOUR ATTENTION: my project › Claude 2", then the conversation's title if it has one. */
export function telegramText(req: Pick<AttentionRequest, 'event' | 'source' | 'topic'>): string {
  const head = `${EVENT_LABELS[req.event]}: ${req.source}`
  return req.topic ? `${head}\n${req.topic}` : head
}

const MAX_BUTTON_LABEL = 60

/** A button's text, cut to fit. */
export function buttonLabel(text: string): string {
  return text.length > MAX_BUTTON_LABEL ? `${text.slice(0, MAX_BUTTON_LABEL - 1)}…` : text
}

/** One per option; none for a question that takes several answers (they are replied with). */
export function questionButtons(q: ClaudeQuestion): TelegramButton[][] {
  if (q.multi) return []
  return q.options.map((o) => [
    { label: buttonLabel(`${o.n}. ${o.label}`), data: `a:${q.id}:${o.n}` }
  ])
}

/** What to do with it, beyond tapping a button; '' when that is all. */
export function questionHint(q: ClaudeQuestion): string {
  if (q.multi) {
    const tick =
      'Several answers can be ticked: reply to this message with their numbers, like 1 3.'
    return q.freeText === null
      ? tick
      : `${tick} Your own words go after a colon: 1 3: something else.`
  }
  if (q.freeText !== null) return 'Tap an answer, or reply to this message in your own words.'
  return ''
}
