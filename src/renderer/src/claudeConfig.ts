import type {
  AvailablePlugin,
  HookHandler,
  HookScope,
  InstalledPlugin,
  ItemScope,
  PluginScope
} from '../../shared/claudeConfig'
import type { Workspace } from './store'

/** Helpers for the "Claude Code" window (skills, agents, hooks, plugins). */

export const ITEM_SCOPE_LABELS: Record<ItemScope, string> = {
  user: 'Global',
  project: 'This folder'
}

export const HOOK_SCOPE_LABELS: Record<HookScope, string> = {
  user: 'Global',
  project: 'This folder, shared',
  local: 'This folder, only me'
}

export const HOOK_SCOPE_FILES: Record<HookScope, string> = {
  user: 'settings.json in your Claude folder, for every project',
  project: '.claude/settings.json, committed with the project',
  local: '.claude/settings.local.json, not committed'
}

export const PLUGIN_SCOPE_LABELS: Record<string, string> = {
  user: 'Global',
  project: 'Folder, shared',
  local: 'Folder, only me',
  managed: 'Managed',
  synced: 'From claude.ai'
}

export const PLUGIN_SCOPE_HINTS: Record<PluginScope, string> = {
  user: 'for every project',
  project: 'this folder, committed in .claude/settings.json',
  local: 'this folder, only for you (.claude/settings.local.json)'
}

export interface FolderChoice {
  path: string
  label: string
}

/** The open folders, once each; the active one is the default. */
export function folderChoices(
  workspaces: Workspace[],
  active: string,
  label: (ws: Workspace) => string = (ws) => ws.title
): { choices: FolderChoice[]; current: string | null } {
  const choices: FolderChoice[] = []
  for (const ws of workspaces) {
    if (!ws.cwd || choices.some((c) => c.path === ws.cwd)) continue
    choices.push({ path: ws.cwd, label: label(ws) })
  }
  const current = workspaces.find((w) => w.key === active)?.cwd ?? choices[0]?.path ?? null
  return { choices, current }
}

/** A plugin as the list shows it: what the marketplace says, and where it is installed. */
export interface PluginRow {
  id: string
  name: string
  marketplace: string
  description: string
  installCount?: number
  url?: string
  version?: string
  installs: InstalledPlugin[]
}

export function pluginRows(
  installed: InstalledPlugin[],
  available: AvailablePlugin[]
): PluginRow[] {
  const rows = new Map<string, PluginRow>()
  for (const a of available) {
    rows.set(a.id, { ...a, installs: [] })
  }
  for (const i of installed) {
    let row = rows.get(i.id)
    if (!row) {
      const [name, marketplace = ''] = i.id.split('@')
      row = { id: i.id, name, marketplace, description: '', installs: [] }
      rows.set(i.id, row)
    }
    row.installs.push(i)
  }
  return [...rows.values()]
}

/**
 * The plugins to list: installed ones first, then by name; only those whose name, marketplace or
 * description has every word searched for.
 */
export function filterPlugins(
  rows: PluginRow[],
  query: string,
  installedOnly: boolean
): PluginRow[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  return rows
    .filter((r) => !installedOnly || r.installs.length > 0)
    .filter((r) => {
      const hay = `${r.name} ${r.marketplace} ${r.description}`.toLowerCase()
      return words.every((w) => hay.includes(w))
    })
    .sort(
      (a, b) =>
        Number(b.installs.length > 0) - Number(a.installs.length > 0) ||
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
        a.id.localeCompare(b.id)
    )
}

/** "12.3k" for a count. */
export function shortCount(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`
  return String(n)
}

/** A hook's handler in a line: its command, prompt, URL or tool. */
export function hookSummary(handler: HookHandler): string {
  const pick = (k: string): string | undefined =>
    typeof handler[k] === 'string' ? (handler[k] as string) : undefined
  const text =
    handler.type === 'command'
      ? (pick('command') ?? (Array.isArray(handler.args) ? handler.args.join(' ') : undefined))
      : handler.type === 'http'
        ? pick('url')
        : handler.type === 'mcp_tool'
          ? [pick('server'), pick('tool')].filter(Boolean).join(' › ')
          : pick('prompt')
  return (text ?? '').replace(/\s+/g, ' ').trim() || `(${handler.type})`
}

/** The handler with a field set, or removed when it is empty. */
export function withField(handler: HookHandler, key: string, value: unknown): HookHandler {
  const next: HookHandler = { ...handler }
  if (value === undefined || value === '') delete next[key]
  else next[key] = value
  return next
}

/** Fields that belong to one type of handler, dropped when the type changes. */
const TYPE_FIELDS: Record<string, string[]> = {
  command: ['command', 'args', 'shell', 'async', 'asyncRewake'],
  http: ['url', 'headers', 'allowedEnvVars'],
  mcp_tool: ['server', 'tool', 'input'],
  prompt: ['prompt', 'model'],
  agent: ['prompt', 'model']
}

export function withType(handler: HookHandler, type: string): HookHandler {
  const keep = new Set(TYPE_FIELDS[type] ?? [])
  const next: HookHandler = { type }
  for (const [k, v] of Object.entries(handler)) {
    if (k === 'type') continue
    const ownedByOther = Object.values(TYPE_FIELDS).some((fields) => fields.includes(k))
    if (!ownedByOther || keep.has(k)) next[k] = v
  }
  return next
}

/** The timeout field as seconds, or undefined when it is empty or not a number. */
export function timeoutValue(text: string): number | undefined {
  const n = Number(text)
  return text.trim() !== '' && Number.isFinite(n) && n > 0 ? n : undefined
}

// ---- MCP servers ----

export const MCP_SCOPE_LABELS: Record<string, string> = {
  user: 'Global',
  project: 'This folder, shared',
  local: 'This folder, only me'
}

export const MCP_SCOPE_FILES: Record<string, string> = {
  user: 'In your ~/.claude.json, for every project',
  project: 'In the folder’s .mcp.json, committed with it',
  local: 'In your ~/.claude.json, only for this folder'
}

/** An MCP server's settings as the form shows them. */
export interface McpForm {
  transport: string
  command: string
  /** One argument a line. */
  args: string
  /** KEY=value a line. */
  env: string
  url: string
  /** Name: value a line. */
  headers: string
  /** Everything else it has (timeouts, OAuth…), kept as it is. */
  extra: Record<string, unknown>
}

const FORM_KEYS = ['type', 'command', 'args', 'env', 'url', 'headers']

export function mcpTransport(config: Record<string, unknown>): string {
  if (typeof config.type === 'string') return config.type
  return typeof config.url === 'string' ? 'http' : 'stdio'
}

const strings = (v: unknown): Record<string, string> =>
  v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(
        Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string')
      )
    : {}

export function mcpForm(config: Record<string, unknown>): McpForm {
  const extra = Object.fromEntries(Object.entries(config).filter(([k]) => !FORM_KEYS.includes(k)))
  return {
    transport: mcpTransport(config),
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.map(String).join('\n') : '',
    env: Object.entries(strings(config.env))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    url: typeof config.url === 'string' ? config.url : '',
    headers: Object.entries(strings(config.headers))
      .map(([k, v]) => `${k}: ${v}`)
      .join('\n'),
    extra
  }
}

/** Lines "KEY<sep>value" as an object; blank lines are skipped, the rest kept as typed. */
function pairs(text: string, sep: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    const at = line.indexOf(sep)
    if (at <= 0) out[line.trim()] = ''
    else out[line.slice(0, at).trim()] = line.slice(at + sep.length).trim()
  }
  return out
}

export function mcpConfig(form: McpForm): Record<string, unknown> {
  if (form.transport === 'stdio') {
    const args = form.args.split('\n').filter((a) => a.trim() !== '')
    const env = pairs(form.env, '=')
    return {
      type: 'stdio',
      command: form.command.trim(),
      ...(args.length ? { args } : {}),
      ...(Object.keys(env).length ? { env } : {}),
      ...form.extra
    }
  }
  const headers = pairs(form.headers, ':')
  return {
    type: form.transport,
    url: form.url.trim(),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...form.extra
  }
}

/** A server in a line: its command and arguments, or its URL. */
export function mcpSummary(config: Record<string, unknown>): string {
  if (typeof config.url === 'string') return config.url
  const args = Array.isArray(config.args) ? config.args.map(String) : []
  return [typeof config.command === 'string' ? config.command : '', ...args].join(' ').trim()
}
