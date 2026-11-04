import { statSync } from 'fs'
import path from 'path'
import {
  LAUNCH_MODES,
  TOPIC_COLORS,
  type ClaudeQuestion,
  type ContextMenuRequest,
  type SendTarget,
  type LaunchMode,
  type StartSessionRequest,
  type TelegramOutgoing,
  type TopicRef,
  type TerminalSpec
} from '../shared/ipc'
import { SESSION_ID } from './claudeSessions'

export const MAX_DIMENSION = 1000

export function isDimension(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= MAX_DIMENSION
}

export function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory()
  } catch {
    return false
  }
}

export type StartRequestCheck =
  | { ok: true; req: StartSessionRequest }
  | { ok: false; code: 'INVALID_REQUEST' | 'INVALID_CWD'; error: string }

/** Rebuilds the spec from known fields only, so nothing unexpected reaches the command line. */
export function checkSpec(input: unknown): TerminalSpec | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (raw.kind === 'shell') {
    return typeof raw.shellId === 'string' && /^[a-z0-9-]{1,32}$/.test(raw.shellId)
      ? { kind: 'shell', shellId: raw.shellId }
      : null
  }
  if (raw.kind !== 'claude') return null
  if (typeof raw.mode !== 'string' || !(LAUNCH_MODES as readonly string[]).includes(raw.mode)) {
    return null
  }
  const mode = raw.mode as LaunchMode
  const isId = (v: unknown): v is string => typeof v === 'string' && SESSION_ID.test(v)
  if (raw.resumeId !== undefined) {
    return isId(raw.resumeId) && mode === 'resume' && raw.sessionId === undefined
      ? { kind: 'claude', mode, resumeId: raw.resumeId }
      : null
  }
  if (raw.sessionId !== undefined) {
    return isId(raw.sessionId) && mode === 'new'
      ? { kind: 'claude', mode, sessionId: raw.sessionId }
      : null
  }
  return { kind: 'claude', mode }
}

export function checkStartRequest(
  input: unknown,
  dirExists: (p: string) => boolean = isDirectory
): StartRequestCheck {
  if (!input || typeof input !== 'object') {
    return { ok: false, code: 'INVALID_REQUEST', error: 'Malformed request' }
  }
  const raw = input as Record<string, unknown>
  const spec = checkSpec(raw.spec)
  if (!spec) return { ok: false, code: 'INVALID_REQUEST', error: 'Unknown terminal type' }
  if (!isDimension(raw.cols) || !isDimension(raw.rows)) {
    return { ok: false, code: 'INVALID_REQUEST', error: 'Invalid terminal size' }
  }
  if (typeof raw.cwd !== 'string' || !path.isAbsolute(raw.cwd) || !dirExists(raw.cwd)) {
    return { ok: false, code: 'INVALID_CWD', error: `Not a folder: ${String(raw.cwd)}` }
  }
  return {
    ok: true,
    req: { cwd: path.resolve(raw.cwd), spec, cols: raw.cols, rows: raw.rows }
  }
}

export function isAbsoluteFolderPath(p: unknown): p is string {
  return typeof p === 'string' && path.isAbsolute(p)
}

export function isSafeExternalUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false
  try {
    const { protocol } = new URL(url)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

export const MAX_SEND_TARGETS = 50
const MAX_TARGET_LABEL = 200
const TERMINAL_KEY = /^term-\d{1,9}$/

/** Keeps only well-formed fields of a terminal's right-click menu request. */
export function checkContextMenuRequest(input: unknown): ContextMenuRequest {
  const raw = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>
  const targets: SendTarget[] = []
  for (const t of Array.isArray(raw.targets) ? raw.targets : []) {
    const { key, label } = (t ?? {}) as Record<string, unknown>
    if (typeof key !== 'string' || !TERMINAL_KEY.test(key) || typeof label !== 'string') continue
    targets.push({ key, label: label.slice(0, MAX_TARGET_LABEL) })
    if (targets.length === MAX_SEND_TARGETS) break
  }
  return { hasSelection: raw.hasSelection === true, canSnip: raw.canSnip === true, targets }
}

/** Paths looked up at once: those found in one line of a terminal. */
export const MAX_FILE_LINKS = 50
const MAX_LINK_PATH = 1024

/** A path from terminal output, as the renderer passes it. */
export function isLinkPath(p: unknown): p is string {
  return typeof p === 'string' && p.length > 0 && p.length <= MAX_LINK_PATH && !p.includes('\0')
}

/** Paths a terminal's line mentions, and the terminal's folder they are relative to. */
export function checkFileLinkRequest(
  cwd: unknown,
  paths: unknown
): { cwd: string; paths: string[] } | null {
  if (!isLinkPath(cwd) || !path.isAbsolute(cwd) || !Array.isArray(paths)) return null
  if (paths.length > MAX_FILE_LINKS || !paths.every(isLinkPath)) return null
  return { cwd, paths }
}

const MAX_TELEGRAM_TEXT = 4096
const MAX_TELEGRAM_PRE = 20_000
const MAX_TELEGRAM_MARKDOWN = 100_000
const MAX_BUTTON_ROWS = 40
export const isMessageId = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v > 0

/** A bot message from the renderer, rebuilt from known fields with their sizes capped. */
export function checkTelegramMessage(input: unknown): TelegramOutgoing | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.text !== 'string') return null
  const msg: TelegramOutgoing = { text: raw.text.slice(0, MAX_TELEGRAM_TEXT) }
  if (typeof raw.pre === 'string' && raw.pre) msg.pre = raw.pre.slice(-MAX_TELEGRAM_PRE)
  // Beyond a few messages' worth, its start is left out anyway.
  if (typeof raw.markdown === 'string') msg.markdown = raw.markdown.slice(-MAX_TELEGRAM_MARKDOWN)
  if (Array.isArray(raw.buttons)) {
    const rows = raw.buttons.slice(0, MAX_BUTTON_ROWS).map((row) =>
      (Array.isArray(row) ? row.slice(0, 8) : []).flatMap((b) => {
        const button = b as Record<string, unknown> | null
        // Telegram takes at most 64 bytes of data back from a button.
        if (typeof button?.label !== 'string' || typeof button.data !== 'string') return []
        if (!button.label || Buffer.byteLength(button.data) > 64 || !button.data) return []
        return [{ label: button.label.slice(0, 100), data: button.data }]
      })
    )
    if (rows.some((row) => row.length)) msg.buttons = rows.filter((row) => row.length)
  }
  if (isMessageId(raw.replyTo)) msg.replyTo = raw.replyTo
  if (raw.forceReply === true) msg.forceReply = true
  if (isMessageId(raw.thread)) msg.thread = raw.thread
  if (typeof raw.key === 'string' && raw.key.length <= 64) msg.key = raw.key
  const topic = checkTopicRef(raw.topic)
  if (topic && msg.key) msg.topic = topic
  return msg
}

/** Telegram's limit on a topic's name. */
export const MAX_TOPIC_NAME = 128

/** A session's topic as the renderer describes it: a name, one of Telegram's colours, a thread. */
export function checkTopicRef(input: unknown): TopicRef | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  const name = typeof raw.name === 'string' ? topicName(raw.name) : ''
  const color = raw.color
  if (!name || !TOPIC_COLORS.some((c) => c === color)) return null
  return {
    name,
    color: color as number,
    ...(isMessageId(raw.thread) ? { thread: raw.thread } : {})
  }
}

/** A topic's name, on one line and cut to fit. */
export function topicName(name: string): string {
  const line = name.replace(/\s+/g, ' ').trim()
  return line.length > MAX_TOPIC_NAME ? `${line.slice(0, MAX_TOPIC_NAME - 1)}…` : line
}

/** A question read off Claude's screen, as the renderer reports it with a call. */
export function checkQuestion(input: unknown): ClaudeQuestion | null {
  if (!input || typeof input !== 'object') return null
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || !/^[a-z0-9]{1,12}$/.test(raw.id)) return null
  if (typeof raw.text !== 'string' || !Array.isArray(raw.options)) return null
  const options = raw.options.slice(0, 20).flatMap((o) => {
    const option = o as Record<string, unknown> | null
    if (typeof option?.label !== 'string') return []
    const n = option.n
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 99) return []
    return [{ n, label: option.label.slice(0, 200) }]
  })
  if (!options.length) return null
  const freeText = options.some((o) => o.n === raw.freeText) ? (raw.freeText as number) : null
  return {
    id: raw.id,
    text: raw.text.slice(-MAX_TELEGRAM_PRE),
    options,
    multi: raw.multi === true,
    freeText
  }
}
