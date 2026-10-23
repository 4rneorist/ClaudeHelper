import { open, readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import { StringDecoder } from 'string_decoder'
import type { PastSession } from '../shared/ipc'
import { samePath } from '../shared/paths'

// Claude Code stores each conversation as <config>/projects/<encoded cwd>/<session id>.jsonl.
// We only read what the session list needs: the first real prompt (near the start of the file)
// and the latest title (rewritten as the conversation goes on, so read from the end).

export const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const HEAD_CHUNK = 256 * 1024
const HEAD_LIMIT = 4 * 1024 * 1024
const TAIL_BYTES = 512 * 1024

export function claudeConfigDir(env: NodeJS.ProcessEnv, homedir: string): string {
  return env.CLAUDE_CONFIG_DIR || path.join(homedir, '.claude')
}

/** Claude Code's folder naming: every non-alphanumeric character becomes "-". */
export function projectDirName(cwd: string): string {
  return cwd.replace(/[^a-zA-Z0-9]/g, '-')
}

interface ParsedLine {
  type?: string
  isSidechain?: boolean
  isMeta?: boolean
  cwd?: string
  aiTitle?: string
  agentName?: string
  message?: { content?: unknown }
}

function parseLine(line: string): ParsedLine | null {
  if (!line.startsWith('{')) return null
  try {
    return JSON.parse(line) as ParsedLine
  } catch {
    return null
  }
}

/** Pasted blocks are stored inline; show a placeholder instead of their markup and contents. */
const PASTED = /<pasted_content[^>]*>[\s\S]*?(<\/pasted_content>|$)/g

/** Wrappers Claude Code stores as user messages that aren't something the user typed. */
const NOT_A_PROMPT = /^<(command-|local-command|system-reminder|bash-|task-notification)/

export function promptText(record: ParsedLine): string | null {
  if (record.type !== 'user' || record.isSidechain || record.isMeta) return null
  const content = record.message?.content
  let text: string | undefined
  if (typeof content === 'string') text = content
  else if (Array.isArray(content)) {
    const block = content.find(
      (b): b is { type: 'text'; text: string } =>
        !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'text'
    )
    text = block?.text
  }
  const trimmed = text?.trim()
  if (!trimmed || NOT_A_PROMPT.test(trimmed)) return null
  return trimmed.replace(PASTED, '[pasted text]').replace(/\s+/g, ' ').trim()
}

export interface HeadInfo {
  firstPrompt: string | null
  cwd: string | null
}

/** Scans complete lines for the first real prompt and the folder the session started in. */
export function scanHead(lines: string[]): HeadInfo {
  let cwd: string | null = null
  for (const line of lines) {
    const record = parseLine(line)
    if (!record) continue
    if (!cwd && typeof record.cwd === 'string') cwd = record.cwd
    const prompt = promptText(record)
    if (prompt) return { firstPrompt: prompt, cwd: cwd ?? record.cwd ?? null }
  }
  return { firstPrompt: null, cwd }
}

/** Latest titles, scanning from the end. */
export function scanTitles(lines: string[]): { aiTitle?: string; agentName?: string } {
  const found: { aiTitle?: string; agentName?: string } = {}
  for (let i = lines.length - 1; i >= 0 && !(found.aiTitle && found.agentName); i--) {
    const line = lines[i]
    if (!line.includes('"ai-title"') && !line.includes('"agent-name"')) continue
    const record = parseLine(line)
    if (record?.type === 'ai-title' && record.aiTitle && !found.aiTitle)
      found.aiTitle = record.aiTitle
    if (record?.type === 'agent-name' && record.agentName && !found.agentName) {
      found.agentName = record.agentName
    }
  }
  return found
}

async function readHead(file: string): Promise<HeadInfo & { lines: string[] }> {
  const handle = await open(file, 'r')
  try {
    const decoder = new StringDecoder('utf8') // keeps multi-byte characters intact across chunks
    let text = ''
    let offset = 0
    const lines: string[] = []
    while (offset < HEAD_LIMIT) {
      const buffer = Buffer.alloc(HEAD_CHUNK)
      const { bytesRead } = await handle.read(buffer, 0, HEAD_CHUNK, offset)
      if (bytesRead === 0) break
      offset += bytesRead
      text += decoder.write(buffer.subarray(0, bytesRead))
      const parts = text.split('\n')
      text = bytesRead < HEAD_CHUNK ? '' : (parts.pop() ?? '') // keep the partial last line
      lines.push(...parts)
      const head = scanHead(lines)
      if (head.firstPrompt) return { ...head, lines }
      if (bytesRead < HEAD_CHUNK) break
    }
    return { ...scanHead(lines), lines }
  } finally {
    await handle.close()
  }
}

async function readTailLines(file: string, size: number): Promise<string[]> {
  const handle = await open(file, 'r')
  try {
    const length = Math.min(size, TAIL_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, size - length)
    const lines = buffer.toString('utf8').split('\n')
    if (length < size) lines.shift() // first line is probably cut off
    return lines
  } finally {
    await handle.close()
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export async function listPastSessions(
  cwd: string,
  opts: { configDir: string; limit: number; platform: NodeJS.Platform }
): Promise<PastSession[]> {
  const dir = path.join(opts.configDir, 'projects', projectDirName(cwd))
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith('.jsonl'))
  } catch {
    return []
  }

  const files = (
    await Promise.all(
      names
        .map((name) => ({ name, id: name.slice(0, -'.jsonl'.length) }))
        .filter(({ id }) => SESSION_ID.test(id))
        .map(async ({ name, id }) => {
          try {
            const s = await stat(path.join(dir, name))
            return s.isFile()
              ? { id, file: path.join(dir, name), mtime: s.mtimeMs, size: s.size }
              : null
          } catch {
            return null
          }
        })
    )
  )
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .sort((a, b) => b.mtime - a.mtime)

  const sessions: PastSession[] = []
  for (const f of files) {
    if (sessions.length >= opts.limit) break
    try {
      const head = await readHead(f.file)
      // Different folders can encode to the same directory name; trust the recorded cwd.
      if (head.cwd && !samePath(head.cwd, cwd, opts.platform)) continue
      const titles = scanTitles(await readTailLines(f.file, f.size))
      const headTitles = titles.aiTitle || titles.agentName ? titles : scanTitles(head.lines)
      if (!head.firstPrompt && !headTitles.aiTitle && !headTitles.agentName) continue // empty session
      sessions.push({
        id: f.id,
        title: truncate(
          headTitles.aiTitle || headTitles.agentName || head.firstPrompt || 'Untitled session',
          80
        ),
        firstPrompt: head.firstPrompt ? truncate(head.firstPrompt, 200) : null,
        lastActive: f.mtime
      })
    } catch {
      // Unreadable or being written; skip it.
    }
  }
  return sessions
}

export function transcriptPath(configDir: string, cwd: string, sessionId: string): string {
  return path.join(configDir, 'projects', projectDirName(cwd), `${sessionId}.jsonl`)
}

/** One running claude process, from Claude Code's registry in <config>/sessions/<pid>.json. */
export interface RunningSession {
  pid: number
  sessionId: string
  cwd: string
  startedAt: number
}

/**
 * Claude Code keeps a small file per running interactive process, recording which conversation
 * it has open (it changes after /clear or /resume). This is internal to Claude Code, so it is read
 * defensively: anything unexpected is ignored.
 */
export async function readRunningSessions(configDir: string): Promise<RunningSession[]> {
  const dir = path.join(configDir, 'sessions')
  let names: string[]
  try {
    names = (await readdir(dir)).filter((n) => /^\d+\.json$/.test(n))
  } catch {
    return []
  }
  const entries = await Promise.all(
    names.map(async (name) => {
      try {
        const raw = JSON.parse(await readFile(path.join(dir, name), 'utf8')) as Record<
          string,
          unknown
        >
        if (
          typeof raw.pid === 'number' &&
          typeof raw.sessionId === 'string' &&
          SESSION_ID.test(raw.sessionId) &&
          typeof raw.cwd === 'string'
        ) {
          return {
            pid: raw.pid,
            sessionId: raw.sessionId,
            cwd: raw.cwd,
            startedAt: typeof raw.startedAt === 'number' ? raw.startedAt : 0
          }
        }
      } catch {
        // Being written or not ours to understand.
      }
      return null
    })
  )
  return entries.filter((e): e is RunningSession => e !== null)
}

export interface TerminalProcess {
  key: string
  pid: number
  cwd: string
  startedAt: number
  /** The conversation we launched it with, if any (new with --session-id, or resumed). */
  knownSessionId?: string
}

/**
 * Which conversation each of our claude processes has open. Matches by pid first. When claude
 * runs under a wrapper (e.g. an npm .cmd shim, so our pid is the wrapper's), a process still on
 * the conversation we launched it with claims that entry by id; only the rest fall back to the
 * registry entry in the same folder that started closest after our process did.
 */
export function matchRunningSessions(
  terminals: TerminalProcess[],
  running: RunningSession[],
  platform: NodeJS.Platform
): Record<string, string> {
  const result: Record<string, string> = {}
  const claimed = new Set<number>()
  const claim = (t: TerminalProcess, r: RunningSession | undefined): void => {
    if (!r || claimed.has(r.pid) || result[t.key]) return
    result[t.key] = r.sessionId
    claimed.add(r.pid)
  }
  const byPid = new Map(running.map((r) => [r.pid, r]))
  for (const t of terminals) claim(t, byPid.get(t.pid))
  for (const t of terminals) {
    if (!t.knownSessionId) continue
    claim(
      t,
      running.find(
        (r) =>
          !claimed.has(r.pid) &&
          r.sessionId === t.knownSessionId &&
          samePath(r.cwd, t.cwd, platform) &&
          r.startedAt >= t.startedAt - 2000
      )
    )
  }
  for (const t of terminals) {
    if (result[t.key]) continue
    const candidates = running
      .filter(
        (r) =>
          !claimed.has(r.pid) &&
          samePath(r.cwd, t.cwd, platform) &&
          r.startedAt >= t.startedAt - 2000 &&
          r.startedAt <= t.startedAt + 60_000
      )
      .sort((a, b) => a.startedAt - b.startedAt)
    if (candidates[0]) {
      result[t.key] = candidates[0].sessionId
      claimed.add(candidates[0].pid)
    }
  }
  return result
}
