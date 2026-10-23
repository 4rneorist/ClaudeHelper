import { statSync } from 'fs'
import path from 'path'
import {
  LAUNCH_MODES,
  type LaunchMode,
  type StartSessionRequest,
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
