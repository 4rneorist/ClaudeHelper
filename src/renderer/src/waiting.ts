import type { WaitingSummary } from '../../shared/ipc'
import { samePath } from '../../shared/paths'
import { leaves } from './layout'
import type { State, TerminalState } from './store'

// Which sessions wait for you: one that asks (red), seen or not, and one that finished while you
// were elsewhere (yellow) until you look at it. An idle session you have seen doesn't wait;
// otherwise nearly every tab would. Muted sessions never count. Pure, for unit tests.

export type WaitKind = 'asking' | 'finished'

type View = Pick<State, 'workspaces' | 'terminals' | 'settings' | 'appInfo'>

export function waitingKind(t: TerminalState): WaitKind | null {
  if (t.status !== 'running') return null
  if (t.activity === 'asking') return 'asking'
  return t.attention === 'finished' ? 'finished' : null
}

export function isFolderMuted(state: Pick<View, 'settings' | 'appInfo'>, cwd: string): boolean {
  const platform = state.appInfo?.platform ?? ''
  return (state.settings?.mutedFolders ?? []).some((f) => samePath(f, cwd, platform))
}

/** Muted itself, or in a muted folder. */
export function isMuted(state: View, t: TerminalState): boolean {
  return !!t.muted || isFolderMuted(state, t.cwd)
}

/** Terminal keys in the order their tabs show: folders, sub-tabs, panes. */
function inTabOrder(state: View): string[] {
  return state.workspaces.flatMap((w) => w.subTabs.flatMap((s) => leaves(s.layout)))
}

/** Waiting terminals, asking ones first, each kind in tab order. */
export function waitingTerminals(state: View, kind?: WaitKind): string[] {
  const keys = inTabOrder(state).filter((key) => {
    const t = state.terminals[key]
    const waits = t && waitingKind(t)
    return waits && (!kind || waits === kind) && !isMuted(state, t)
  })
  const ofKind = (k: WaitKind): string[] =>
    keys.filter((key) => waitingKind(state.terminals[key]) === k)
  return [...ofKind('asking'), ...ofKind('finished')]
}

/** The waiting terminal after `current` (asking ones first), wrapping around; null if none. */
export function nextWaiting(state: View, current: string | null, kind?: WaitKind): string | null {
  const waiting = waitingTerminals(state, kind)
  if (waiting.length === 0) return null
  const at = current ? waiting.indexOf(current) : -1
  return waiting[(at + 1) % waiting.length]
}

export function waitingSummary(state: View): WaitingSummary {
  const live = Object.values(state.terminals).filter((t) => !isMuted(state, t))
  return {
    asking: live.filter((t) => waitingKind(t) === 'asking').length,
    finished: live.filter((t) => waitingKind(t) === 'finished').length,
    working: live.filter((t) => t.status === 'running' && t.activity === 'working').length
  }
}

/** Reminders while Claude keeps asking unseen: every `minutes`, at most this many times. */
export const MAX_REMINDERS = 3

/** Whether to remind again, given when it started asking and when it was last reminded. */
export function reminderDue(
  since: number,
  last: number | undefined,
  count: number,
  now: number,
  minutes: number
): boolean {
  return minutes > 0 && count < MAX_REMINDERS && now - (last ?? since) >= minutes * 60_000
}
