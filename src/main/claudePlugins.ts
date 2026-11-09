import { execFile } from 'child_process'
import {
  type AvailablePlugin,
  type InstalledPlugin,
  type Marketplace,
  type MarketplaceList,
  type MarketplaceRequest,
  type PluginActionRequest,
  type PluginActionResult,
  type PluginList
} from '../shared/claudeConfig'
import { getEnvValue } from './claudeResolver'

/** Plugins are managed through Claude Code's own CLI: `claude plugin …`. */
export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** It didn't start, or was stopped after too long. */
  error?: string
}

export type RunClaude = (
  args: string[],
  opts: { cwd: string; timeoutMs: number }
) => Promise<RunResult>

export const LIST_TIMEOUT_MS = 60_000
/** Installing clones the plugin, which can take a while. */
export const ACTION_TIMEOUT_MS = 5 * 60_000

/** cmd.exe's special characters, escaped with ^ (the way cross-spawn does it). */
const CMD_META = /([()\][%!^"`<>&|;, *?])/g

/**
 * One argument for a .cmd shim run through cmd.exe: quoted for the program's own parser, then
 * with cmd's special characters escaped, so JSON, spaces, & or % arrive as they are.
 */
export function cmdArgument(arg: string, doubleEscape: boolean): string {
  // Backslashes before a quote are doubled and the quote escaped; so are those at the end.
  let a = arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')
  a = `"${a}"`.replace(CMD_META, '^$1')
  return doubleEscape ? a.replace(CMD_META, '^$1') : a
}

/** The cmd.exe /c line that runs a .cmd shim with these arguments. */
export function cmdLine(executable: string, args: string[]): string {
  // A shim hands its arguments on with %*, so cmd reads them a second time.
  const line = [executable.replace(CMD_META, '^$1'), ...args.map((a) => cmdArgument(a, true))]
  return `"${line.join(' ')}"`
}

/** Runs claude without a terminal; a .cmd shim (npm install) goes through cmd.exe. */
export function claudeRunner(
  executable: string,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): RunClaude {
  return (args, { cwd, timeoutMs }) =>
    new Promise((resolve) => {
      const shim = platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
      const file = shim ? getEnvValue(env, 'ComSpec') || 'cmd.exe' : executable
      const argv = shim ? ['/d', '/s', '/c', cmdLine(executable, args)] : args
      const child = execFile(
        file,
        argv,
        {
          cwd,
          env,
          timeout: timeoutMs,
          maxBuffer: 64 * 1024 * 1024,
          windowsHide: true,
          windowsVerbatimArguments: shim
        },
        (error, stdout, stderr) => {
          const failed = error && typeof error.code !== 'number'
          resolve({
            code: error ? (typeof error.code === 'number' ? error.code : null) : 0,
            stdout: String(stdout),
            stderr: String(stderr),
            ...(failed ? { error: error.killed ? 'It took too long' : error.message } : {})
          })
        }
      )
      // Nothing to answer: it must not wait for input.
      child.stdin?.end()
    })
}

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g

/** What went wrong, from its error output (the last few lines). */
export function failure(res: RunResult): string {
  if (res.error) return res.error
  const lines = (res.stderr || res.stdout).replace(ANSI, '').trim().split(/\r?\n/)
  const last = lines.slice(-4).map((line) => line.replace(/^✘\s*/, ''))
  return last.join('\n').trim() || `claude exited with ${res.code}`
}

/** Where a plugin comes from, as a page you can open. */
function sourceUrl(source: unknown): string | undefined {
  if (!isObject(source)) return undefined
  if (source.source === 'github' && typeof source.repo === 'string') {
    return `https://github.com/${source.repo}`
  }
  const url = text(source.url)
  return url && /^https:\/\//.test(url) ? url.replace(/\.git$/, '') : undefined
}

function installedOf(raw: unknown): InstalledPlugin | null {
  if (!isObject(raw) || typeof raw.id !== 'string' || typeof raw.scope !== 'string') return null
  return {
    id: raw.id,
    ...(text(raw.version) ? { version: text(raw.version) } : {}),
    scope: raw.scope,
    enabled: raw.enabled === true,
    ...(text(raw.projectPath) ? { projectPath: text(raw.projectPath) } : {}),
    errors: Array.isArray(raw.errors) ? raw.errors.filter((e) => typeof e === 'string') : [],
    mcpServers: isObject(raw.mcpServers) ? Object.keys(raw.mcpServers) : []
  }
}

function availableOf(raw: unknown): AvailablePlugin | null {
  if (!isObject(raw) || typeof raw.pluginId !== 'string') return null
  const url = text(raw.homepage) ?? sourceUrl(raw.source)
  return {
    id: raw.pluginId,
    name: text(raw.name) ?? raw.pluginId.split('@')[0],
    description: text(raw.description) ?? '',
    marketplace: text(raw.marketplaceName) ?? raw.pluginId.split('@')[1] ?? '',
    ...(text(raw.version) ? { version: text(raw.version) } : {}),
    ...(typeof raw.installCount === 'number' ? { installCount: raw.installCount } : {}),
    ...(url && /^https:\/\//.test(url) ? { url } : {})
  }
}

/** `claude plugin list --json --available`: what is installed, and what the marketplaces offer. */
export function parsePluginList(stdout: string): PluginList {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return { ok: false, error: "Claude Code's plugin list couldn't be read" }
  }
  const raw = isObject(data) ? data : { installed: data, available: [] }
  const list = <T>(v: unknown, of: (x: unknown) => T | null): T[] =>
    Array.isArray(v) ? v.map(of).filter((x): x is T => x !== null) : []
  return {
    ok: true,
    installed: list(raw.installed, installedOf),
    available: list(raw.available, availableOf)
  }
}

export async function listPlugins(run: RunClaude, cwd: string): Promise<PluginList> {
  const res = await run(['plugin', 'list', '--json', '--available'], {
    cwd,
    timeoutMs: LIST_TIMEOUT_MS
  })
  if (res.code !== 0) return { ok: false, error: failure(res) }
  return parsePluginList(res.stdout)
}

/** `claude plugin details`: what a plugin brings (skills, agents, hooks…) and what it costs. */
export async function pluginDetails(run: RunClaude, id: string, cwd: string): Promise<string> {
  const res = await run(['plugin', 'details', id], { cwd, timeoutMs: LIST_TIMEOUT_MS })
  return res.code === 0 ? res.stdout.replace(ANSI, '').trimEnd() : failure(res)
}

export function pluginArgs(req: PluginActionRequest): string[] {
  const args = ['plugin', req.action, req.id, '--scope', req.scope, '--json']
  if (req.acceptCommand && (req.action === 'install' || req.action === 'update')) {
    args.push('--accept-command', req.acceptCommand)
  }
  return args
}

/** The last line of output that is a JSON object: the --json result. */
export function lastJson(stdout: string): Json | null {
  const lines = stdout.trim().split('\n').reverse()
  for (const line of lines) {
    const t = line.trim()
    if (!t.startsWith('{')) continue
    try {
      const v: unknown = JSON.parse(t)
      if (isObject(v)) return v
    } catch {
      // not this line
    }
  }
  return null
}

function shownCommand(v: unknown): { command: string; sha256: string } | undefined {
  if (!isObject(v) || typeof v.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(v.sha256)) {
    return undefined
  }
  const command = Array.isArray(v.command) ? v.command.join(' ') : text(v.command)
  const archive = text(v.archiveUrl)
  const shown = [command, archive && `(fetches ${archive})`].filter(Boolean).join('\n')
  return { command: shown || JSON.stringify(v), sha256: v.sha256 }
}

export async function runPluginAction(
  run: RunClaude,
  req: PluginActionRequest,
  cwd: string
): Promise<PluginActionResult> {
  const res = await run(pluginArgs(req), { cwd, timeoutMs: ACTION_TIMEOUT_MS })
  const json = lastJson(res.stdout)
  const message = text(json?.message)?.replace(ANSI, '')
  if (json?.outcome === 'ok' || (res.code === 0 && !json)) {
    return { ok: true, message: message ?? 'Done' }
  }
  // Already as asked (e.g. enabling an enabled plugin): nothing to do.
  if (json?.alreadyInGoalState === true) return { ok: true, message: message ?? 'Done' }
  const confirm = shownCommand(json?.shownCommand)
  return {
    ok: false,
    error: message ?? failure(res),
    ...(confirm && confirm.sha256 !== req.acceptCommand ? { confirm } : {})
  }
}

// ---- marketplaces: where plugins come from ----

/** `claude plugin marketplace list --json`. */
export function parseMarketplaces(stdout: string): MarketplaceList {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return { ok: false, error: "Claude Code's marketplace list couldn't be read" }
  }
  if (!Array.isArray(data))
    return { ok: false, error: "Claude Code's marketplace list couldn't be read" }
  const items: Marketplace[] = []
  for (const raw of data) {
    if (!isObject(raw) || typeof raw.name !== 'string') continue
    const repo = text(raw.repo)
    const url = text(raw.url)
    const where = text(raw.path)
    const source = repo ?? url ?? where ?? text(raw.source) ?? ''
    const page = repo
      ? `https://github.com/${repo}`
      : url && /^https:\/\//.test(url)
        ? url
        : undefined
    items.push({
      name: raw.name,
      source,
      ...(text(raw.installLocation) ? { installLocation: text(raw.installLocation) } : {}),
      ...(page ? { url: page.replace(/\.git$/, '') } : {})
    })
  }
  return { ok: true, items }
}

export async function listMarketplaces(run: RunClaude, cwd: string): Promise<MarketplaceList> {
  const res = await run(['plugin', 'marketplace', 'list', '--json'], {
    cwd,
    timeoutMs: LIST_TIMEOUT_MS
  })
  return res.code === 0 ? parseMarketplaces(res.stdout) : { ok: false, error: failure(res) }
}

export function marketplaceArgs(req: MarketplaceRequest): string[] {
  const args = ['plugin', 'marketplace', req.action, req.target, '--json']
  if (req.action === 'add' && req.scope) args.push('--scope', req.scope)
  return args
}

export async function runMarketplaceAction(
  run: RunClaude,
  req: MarketplaceRequest,
  cwd: string
): Promise<PluginActionResult> {
  // Adding or updating clones the marketplace.
  const res = await run(marketplaceArgs(req), { cwd, timeoutMs: ACTION_TIMEOUT_MS })
  const json = lastJson(res.stdout)
  const message = text(json?.message)?.replace(ANSI, '')
  if (json?.outcome === 'ok' || (res.code === 0 && (!json || json.outcome === undefined))) {
    return { ok: true, message: message ?? 'Done' }
  }
  return { ok: false, error: message ?? failure(res) }
}
