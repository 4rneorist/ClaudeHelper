import type { Dirent } from 'fs'
import { readdir, readFile, stat } from 'fs/promises'
import path from 'path'
import {
  type AuthResult,
  type AuthStatus,
  type ExtrasList,
  type ItemKind,
  type OrgPolicies,
  type ReadOnlyHook,
  type ReadOnlyItem
} from '../shared/claudeConfig'
import { describe } from '../shared/frontmatter'
import { hooksIn } from './claudeConfig'
import { failure, LIST_TIMEOUT_MS, type RunClaude } from './claudePlugins'

/**
 * What comes from elsewhere, to show (not change): the skills your claude.ai account syncs, what
 * the plugins you use bring (skills, commands, agents, output styles, hooks), your account, and
 * what your organization has set.
 */

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

/** One file at most this big is shown; the rest is cut. */
const MAX_TEXT = 256 * 1024
const BOM = new RegExp('^\\uFEFF')

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    const info = await stat(file)
    if (!info.isFile()) return null
    const text = (await readFile(file, 'utf8')).replace(BOM, '').replace(/\r\n/g, '\n')
    return text.length > MAX_TEXT ? text.slice(0, MAX_TEXT) + '\n…' : text
  } catch {
    return null
  }
}

async function readJson(file: string): Promise<unknown> {
  const text = await readText(file)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

/** A path inside a folder; null when it would lead out of it. */
function inside(root: string, rel: string): string | null {
  const p = path.resolve(root, rel)
  const r = path.resolve(root)
  return p === r || p.startsWith(r + path.sep) ? p : null
}

async function item(
  kind: ItemKind,
  file: string,
  name: string,
  from: { source: 'claude.ai' | 'plugin'; plugin?: string }
): Promise<ReadOnlyItem | null> {
  const text = await readText(file)
  if (text === null) return null
  const { description } = describe(text, kind === 'skill' || kind === 'agent')
  return { kind, ...from, name, description, path: file, text }
}

/** Skills: folders with a SKILL.md. */
async function skillsIn(
  dir: string,
  from: { source: 'claude.ai' | 'plugin'; plugin?: string },
  depth = 1
): Promise<ReadOnlyItem[]> {
  const out: ReadOnlyItem[] = []
  for (const entry of await entriesOf(dir)) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue
    const sub = path.join(dir, entry.name)
    const found = await item('skill', path.join(sub, 'SKILL.md'), entry.name, from)
    if (found) out.push(found)
    else if (depth > 1) out.push(...(await skillsIn(sub, from, depth - 1)))
  }
  return out
}

/** Markdown files (in subfolders too, for commands and agents), named by their path. */
async function filesIn(
  kind: ItemKind,
  dir: string,
  from: { source: 'claude.ai' | 'plugin'; plugin?: string }
): Promise<ReadOnlyItem[]> {
  const out: ReadOnlyItem[] = []
  const walk = async (sub: string[]): Promise<void> => {
    for (const entry of await entriesOf(path.join(dir, ...sub))) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && kind !== 'outputStyle' && sub.length < 2) {
        await walk([...sub, entry.name])
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const name = [...sub, entry.name.slice(0, -3)].join('/')
        const found = await item(kind, path.join(dir, ...sub, entry.name), name, from)
        if (found) out.push(found)
      }
    }
  }
  await walk([])
  return out
}

/** The skills claude.ai syncs to this computer: <claude folder>/skills/synced/<account>/<skill>. */
export function listSyncedSkills(userDir: string): Promise<ReadOnlyItem[]> {
  return skillsIn(path.join(userDir, 'skills', 'synced'), { source: 'claude.ai' }, 2)
}

const COMPONENTS: { kind: ItemKind; dir: string; key: string }[] = [
  { kind: 'skill', dir: 'skills', key: 'skills' },
  { kind: 'command', dir: 'commands', key: 'commands' },
  { kind: 'agent', dir: 'agents', key: 'agents' },
  { kind: 'outputStyle', dir: 'output-styles', key: 'outputStyles' }
]

const asList = (v: unknown): string[] =>
  typeof v === 'string' ? [v] : Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []

/**
 * What a plugin brings: its default folders (skills/, commands/, agents/, output-styles/,
 * hooks/hooks.json) and any others its .claude-plugin/plugin.json names.
 */
export async function pluginParts(
  plugin: string,
  root: string
): Promise<{ items: ReadOnlyItem[]; hooks: ReadOnlyHook[] }> {
  const manifest = await readJson(path.join(root, '.claude-plugin', 'plugin.json'))
  const m = isObject(manifest) ? manifest : {}
  const from = { source: 'plugin' as const, plugin }
  const items: ReadOnlyItem[] = []
  for (const c of COMPONENTS) {
    const places = [c.dir, ...asList(m[c.key])]
    const seen = new Set<string>()
    for (const rel of places) {
      const p = inside(root, rel)
      if (!p || seen.has(p)) continue
      seen.add(p)
      if (p.toLowerCase().endsWith('.md')) {
        const found = await item(c.kind, p, path.basename(p, '.md'), from)
        if (found) items.push(found)
      } else if (c.kind === 'skill') {
        items.push(...(await skillsIn(p, from)))
      } else {
        items.push(...(await filesIn(c.kind, p, from)))
      }
    }
  }
  // Each name once (a folder named twice in the manifest).
  const unique = items.filter(
    (it, i) => items.findIndex((o) => o.kind === it.kind && o.path === it.path) === i
  )

  const hooks: ReadOnlyHook[] = []
  const hookSources: { file: string; data: unknown }[] = []
  const defaultFile = path.join(root, 'hooks', 'hooks.json')
  hookSources.push({ file: defaultFile, data: await readJson(defaultFile) })
  for (const h of Array.isArray(m.hooks) ? m.hooks : [m.hooks]) {
    if (typeof h === 'string') {
      const p = inside(root, h)
      if (p && p !== defaultFile) hookSources.push({ file: p, data: await readJson(p) })
    } else if (isObject(h)) {
      hookSources.push({ file: path.join(root, '.claude-plugin', 'plugin.json'), data: h })
    }
  }
  for (const { file, data } of hookSources) {
    if (!isObject(data)) continue
    // { hooks: {...} } as in settings, or the events themselves.
    const wrapped = isObject(data.hooks) ? data : { hooks: data }
    for (const e of hooksIn(wrapped, 'user')) {
      hooks.push({ plugin, event: e.event, matcher: e.matcher, handler: e.handler, path: file })
    }
  }
  return { items: unique, hooks }
}

/** The plugins Claude Code uses in this folder, and where each one is on disk. */
function enabledPlugins(stdout: string): { id: string; installPath: string }[] {
  let data: unknown
  try {
    data = JSON.parse(stdout)
  } catch {
    return []
  }
  const list = Array.isArray(data) ? data : isObject(data) ? data.installed : []
  const out: { id: string; installPath: string }[] = []
  for (const raw of Array.isArray(list) ? list : []) {
    if (!isObject(raw) || raw.enabled !== true) continue
    if (typeof raw.id !== 'string' || typeof raw.installPath !== 'string') continue
    if (!path.isAbsolute(raw.installPath)) continue
    if (!out.some((p) => p.installPath === raw.installPath)) {
      out.push({ id: raw.id, installPath: raw.installPath })
    }
  }
  return out
}

/** Synced skills, and what the plugins enabled in this folder bring. */
export async function listExtras(
  run: RunClaude | null,
  cwd: string,
  userDir: string
): Promise<ExtrasList> {
  const items = await listSyncedSkills(userDir)
  const hooks: ReadOnlyHook[] = []
  if (!run) return { items, hooks, error: 'Could not find the claude executable' }
  const res = await run(['plugin', 'list', '--json'], { cwd, timeoutMs: LIST_TIMEOUT_MS })
  if (res.code !== 0) return { items, hooks, error: failure(res) }
  for (const plugin of enabledPlugins(res.stdout)) {
    const name = plugin.id.split('@')[0]
    const parts = await pluginParts(name, plugin.installPath)
    items.push(...parts.items)
    hooks.push(...parts.hooks)
  }
  return { items, hooks }
}

// ---- your account ----

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

export function parseAuthStatus(stdout: string): AuthStatus | null {
  let data: unknown
  try {
    data = JSON.parse(stdout.trim())
  } catch {
    return null
  }
  if (!isObject(data) || typeof data.loggedIn !== 'boolean') return null
  const out: AuthStatus = { loggedIn: data.loggedIn }
  for (const key of [
    'authMethod',
    'email',
    'orgName',
    'subscriptionType',
    'loginExpiresAt',
    'apiProvider'
  ] as const) {
    const v = str(data[key])
    if (v) out[key] = v
  }
  return out
}

export async function authStatus(run: RunClaude, cwd: string): Promise<AuthResult> {
  const res = await run(['auth', 'status', '--json'], { cwd, timeoutMs: LIST_TIMEOUT_MS })
  // Logged out, it may exit with an error and still say so.
  const status = parseAuthStatus(res.stdout)
  return status ? { ok: true, status } : { ok: false, error: failure(res) }
}

export async function logout(run: RunClaude, cwd: string): Promise<AuthResult> {
  const res = await run(['auth', 'logout'], { cwd, timeoutMs: LIST_TIMEOUT_MS })
  if (res.code !== 0) return { ok: false, error: failure(res) }
  return authStatus(run, cwd)
}

// ---- what your organization has set ----

/** Where an administrator puts settings on this computer. */
export function managedSettingsPath(platform: NodeJS.Platform): string {
  if (platform === 'win32') return 'C:\\Program Files\\ClaudeCode\\managed-settings.json'
  if (platform === 'darwin') return '/Library/Application Support/ClaudeCode/managed-settings.json'
  return '/etc/claude-code/managed-settings.json'
}

/**
 * Your organization's rules (policy-limits.json), the settings it sends (remote-settings.json),
 * and an administrator's managed-settings.json on this computer.
 */
export async function orgPolicies(
  userDir: string,
  platform: NodeJS.Platform
): Promise<OrgPolicies> {
  const limits = await readJson(path.join(userDir, 'policy-limits.json'))
  const remote = await readJson(path.join(userDir, 'remote-settings.json'))
  const syncedAt = Number(await readText(path.join(userDir, 'remote-settings.json.synced-at')))
  const managedPath = managedSettingsPath(platform)
  const managed = await readJson(managedPath)
  const l = isObject(limits) ? limits : {}
  const restrictions = isObject(l.restrictions)
    ? Object.entries(l.restrictions)
        .filter(([, v]) => isObject(v) && typeof v.allowed === 'boolean')
        .map(([key, v]) => ({ key, allowed: (v as Json).allowed as boolean }))
    : []
  return {
    restrictions,
    defaults: isObject(l.defaults) ? l.defaults : {},
    monitoringNotice: typeof l.monitoring_notice === 'string' ? l.monitoring_notice : null,
    complianceTaints: asList(l.compliance_taints),
    remoteSettings: isObject(remote) && Object.keys(remote).length > 0 ? remote : null,
    managedSettings: isObject(managed) ? { path: managedPath, data: managed } : null,
    ...(Number.isFinite(syncedAt) && syncedAt > 0 ? { syncedAt } : {}),
    known: limits !== null
  }
}
