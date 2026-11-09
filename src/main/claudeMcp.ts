import { readFile } from 'fs/promises'
import path from 'path'
import {
  type ConfigResult,
  type McpList,
  type McpRemoveRequest,
  type McpSaveRequest,
  type McpScope,
  type McpServer,
  type McpState,
  type McpStatus,
  type McpStatusList
} from '../shared/claudeConfig'
import { failure, LIST_TIMEOUT_MS, type RunClaude } from './claudePlugins'

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

function stateOf(text: string): McpState {
  if (/connected/i.test(text) && !/fail|not connected/i.test(text)) return 'connected'
  if (/auth/i.test(text)) return 'auth'
  if (/fail|error/i.test(text)) return 'failed'
  if (/pending|approv/i.test(text)) return 'pending'
  return 'other'
}

/**
 * `claude mcp list`: a line a server, "<name>: <url or command> [(HTTP)] - <✔ Connected | ! Needs
 * authentication | ✘ Failed to connect | ⏸ Pending approval>".
 */
export function parseMcpStatus(stdout: string): McpStatus[] {
  const out: McpStatus[] = []
  for (const raw of stdout.replace(ANSI, '').split(/\r?\n/)) {
    const line = raw.trim()
    const colon = line.indexOf(': ')
    const dash = line.lastIndexOf(' - ')
    if (colon <= 0 || dash <= colon) continue
    const name = line.slice(0, colon)
    const target = line
      .slice(colon + 2, dash)
      .replace(/\s+\((?:HTTP|SSE|stdio|WS)\)$/i, '')
      .trim()
    const text = line
      .slice(dash + 3)
      .replace(/^[^\p{L}]+/u, '')
      .trim()
    const source = name.startsWith('claude.ai ')
      ? 'claude.ai'
      : name.startsWith('plugin:')
        ? 'plugin'
        : 'config'
    out.push({ name, source, target, state: stateOf(text), text })
  }
  return out
}

/** Asks Claude Code how its servers are; it connects to each, so this takes a while. */
export async function mcpStatus(run: RunClaude, cwd: string): Promise<McpStatusList> {
  const res = await run(['mcp', 'list'], { cwd, timeoutMs: 2 * LIST_TIMEOUT_MS })
  if (res.code !== 0) return { ok: false, error: failure(res) }
  return { ok: true, servers: parseMcpStatus(res.stdout) }
}

/**
 * MCP servers. They are read from where Claude Code keeps them:
 *   user     "mcpServers" in ~/.claude.json (in CLAUDE_CONFIG_DIR when that is set)
 *   local    "projects"[<folder>]."mcpServers" in the same file (yours, for one folder)
 *   project  "mcpServers" in <folder>/.mcp.json (committed with the project)
 * and changed only through `claude mcp`, since Claude Code itself keeps writing ~/.claude.json.
 */

export function globalConfigFile(env: NodeJS.ProcessEnv, homedir: string): string {
  return env.CLAUDE_CONFIG_DIR
    ? path.join(env.CLAUDE_CONFIG_DIR, '.claude.json')
    : path.join(homedir, '.claude.json')
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

async function readJson(file: string): Promise<Json | null> {
  try {
    const data: unknown = JSON.parse(
      (await readFile(file, 'utf8')).replace(new RegExp('^\\uFEFF'), '')
    )
    return isObject(data) ? data : null
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

/** Claude Code's key for a folder in ~/.claude.json, written with either slash. */
export function sameFolder(a: string, b: string, platform: NodeJS.Platform): boolean {
  const norm = (p: string): string => {
    const s = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return platform === 'win32' ? s.toLowerCase() : s
  }
  return norm(a) === norm(b)
}

function serversOf(v: unknown, scope: McpScope): McpServer[] {
  if (!isObject(v)) return []
  return Object.entries(v)
    .filter(([, config]) => isObject(config))
    .map(([name, config]) => ({ name, scope, config: config as Json }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function listMcp(
  globalFile: string,
  folder: string | undefined,
  platform: NodeJS.Platform
): Promise<McpList> {
  const projectFile = folder ? path.join(folder, '.mcp.json') : null
  const files = { user: globalFile, local: folder ? globalFile : null, project: projectFile }
  const servers: McpServer[] = []
  const errors: string[] = []
  try {
    const global = await readJson(globalFile)
    servers.push(...serversOf(global?.mcpServers, 'user'))
    if (folder && isObject(global?.projects)) {
      const key = Object.keys(global.projects).find((k) => sameFolder(k, folder, platform))
      const entry = key ? global.projects[key] : undefined
      if (isObject(entry)) servers.push(...serversOf(entry.mcpServers, 'local'))
    }
  } catch (err) {
    errors.push(`${globalFile}: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (projectFile) {
    try {
      servers.push(...serversOf((await readJson(projectFile))?.mcpServers, 'project'))
    } catch (err) {
      errors.push(`${projectFile}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  return { servers, files, ...(errors.length ? { error: errors.join('\n') } : {}) }
}

async function add(run: RunClaude, cwd: string, req: McpSaveRequest): Promise<ConfigResult> {
  const res = await run(
    ['mcp', 'add-json', req.name, JSON.stringify(req.config), '--scope', req.scope],
    { cwd, timeoutMs: LIST_TIMEOUT_MS }
  )
  return res.code === 0 ? { ok: true } : { ok: false, error: failure(res) }
}

async function remove(
  run: RunClaude,
  cwd: string,
  name: string,
  scope: McpScope
): Promise<ConfigResult> {
  const res = await run(['mcp', 'remove', name, '--scope', scope], {
    cwd,
    timeoutMs: LIST_TIMEOUT_MS
  })
  return res.code === 0 ? { ok: true } : { ok: false, error: failure(res) }
}

export function removeMcp(
  run: RunClaude,
  cwd: string,
  req: McpRemoveRequest
): Promise<ConfigResult> {
  return remove(run, cwd, req.name, req.scope)
}

/**
 * Adds a server, or changes one: `claude mcp` has no "change", so the old one is removed and the
 * new one added (and the old one put back if that fails).
 */
export async function saveMcp(
  run: RunClaude,
  cwd: string,
  req: McpSaveRequest,
  previous?: Json
): Promise<ConfigResult> {
  const { original } = req
  if (!original) return add(run, cwd, req)
  const same = original.name === req.name && original.scope === req.scope
  if (!same) {
    // Added under its new name or place first, so a failure leaves the old one as it was.
    const added = await add(run, cwd, req)
    if (!added.ok) return added
    return remove(run, cwd, original.name, original.scope)
  }
  const removed = await remove(run, cwd, original.name, original.scope)
  if (!removed.ok) return removed
  const added = await add(run, cwd, req)
  if (!added.ok && previous) await add(run, cwd, { ...req, config: previous })
  return added
}
