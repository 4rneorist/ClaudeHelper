import type { Dirent } from 'fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import path from 'path'
import {
  ITEM_DEPTH,
  isNewName,
  MAX_ITEM_NAME,
  MAX_ITEM_TEXT,
  sameJson,
  type ClaudeItem,
  type ClaudeItemRef,
  type ConfigResult,
  type HookEntry,
  type HookFile,
  type HookHandler,
  type HookScope,
  type ItemKind,
  type ItemScope
} from '../shared/claudeConfig'
import { describe } from '../shared/frontmatter'

/**
 * Skills, commands, agents, output styles and hooks as Claude Code keeps them:
 *   skills         <root>/skills/<name>/SKILL.md   (plus any files next to it)
 *   commands       <root>/commands/<name>.md       (subfolders too: /folder:name)
 *   agents         <root>/agents/<name>.md         (subfolders too)
 *   output styles  <root>/output-styles/<name>.md
 *   hooks          "hooks" in settings.json (user, project) or .claude/settings.local.json
 * where <root> is your Claude folder (~/.claude) or a project's .claude folder.
 */

const DIRS: Record<ItemKind, string> = {
  skill: 'skills',
  agent: 'agents',
  command: 'commands',
  outputStyle: 'output-styles'
}

export const ITEM_NOUNS: Record<ItemKind, string> = {
  skill: 'skill',
  agent: 'agent',
  command: 'command',
  outputStyle: 'output style'
}

export interface ConfigPlaces {
  /** Your Claude folder (CLAUDE_CONFIG_DIR or ~/.claude). */
  userDir: string
  /** The project folder, for the project's own skills, agents and hooks. */
  folder?: string
}

export function rootOf(scope: ItemScope, places: ConfigPlaces): string | null {
  if (scope === 'user') return places.userDir
  return places.folder ? path.join(places.folder, '.claude') : null
}

export function itemsDir(kind: ItemKind, root: string): string {
  return path.join(root, DIRS[kind])
}

/** One part of a name: a plain file name that can't climb out of its folder. */
function isNamePart(part: string): boolean {
  return (
    part.length > 0 &&
    part.length <= 128 &&
    // eslint-disable-next-line no-control-regex
    !/[\\/:*?"<>|\u0000-\u001f]/.test(part) &&
    part !== '.' &&
    part !== '..' &&
    part === part.trim() &&
    !part.endsWith('.')
  )
}

/** A name that can be read or changed: a skill is one folder, an agent may sit in subfolders. */
export function isItemName(kind: ItemKind, name: unknown): name is string {
  if (typeof name !== 'string') return false
  const parts = name.split('/')
  return parts.length <= ITEM_DEPTH[kind] && parts.every(isNamePart)
}

/** A name a new (or renamed) one can get. */
export function isNewItemName(kind: ItemKind, name: string): boolean {
  return isNewName(name, ITEM_DEPTH[kind])
}

/** What is deleted or renamed: a skill's folder, an agent's file. */
function itemPath(kind: ItemKind, dir: string, name: string): string {
  const p = path.join(dir, ...name.split('/'))
  return kind === 'skill' ? p : p + '.md'
}

/** The file that holds it: SKILL.md, or the agent's file. */
export function itemFile(kind: ItemKind, dir: string, name: string): string {
  const p = itemPath(kind, dir, name)
  return kind === 'skill' ? path.join(p, 'SKILL.md') : p
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

/** A byte order mark some editors put at the start. */
const BOM = new RegExp('^\\uFEFF')

async function readText(file: string): Promise<string | null> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_ITEM_TEXT) return null
    return (await readFile(file, 'utf8')).replace(BOM, '').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The skills or agents in one place, sorted by name. */
export async function listItems(
  kind: ItemKind,
  scope: ItemScope,
  root: string,
  folder?: string
): Promise<ClaudeItem[]> {
  const dir = itemsDir(kind, root)
  const found: { name: string; file: string }[] = []
  if (kind === 'skill') {
    for (const entry of await entriesOf(dir)) {
      // "synced" holds claude.ai's skills, which are managed there.
      if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'synced') continue
      if (!isItemName(kind, entry.name)) continue
      const file = itemFile(kind, dir, entry.name)
      if (await exists(file)) found.push({ name: entry.name, file })
    }
  } else {
    const walk = async (sub: string[]): Promise<void> => {
      for (const entry of await entriesOf(path.join(dir, ...sub))) {
        if (entry.name.startsWith('.')) continue
        if (entry.isDirectory() && sub.length < ITEM_DEPTH[kind] - 1)
          await walk([...sub, entry.name])
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
          const name = [...sub, entry.name.slice(0, -3)].join('/')
          if (isItemName(kind, name)) found.push({ name, file: itemFile(kind, dir, name) })
        }
      }
    }
    await walk([])
  }
  const items = await Promise.all(
    found.map(async ({ name, file }): Promise<ClaudeItem> => {
      const text = await readText(file)
      const about =
        text === null
          ? { description: '', problem: "Can't be read" }
          : describe(text, kind === 'skill' || kind === 'agent')
      return {
        kind,
        scope,
        ...(scope === 'project' && folder ? { folder } : {}),
        name,
        path: file,
        ...about
      }
    })
  )
  return items.sort((a, b) => a.name.localeCompare(b.name))
}

export function readItem(kind: ItemKind, root: string, name: string): Promise<string | null> {
  return readText(itemFile(kind, itemsDir(kind, root), name))
}

/**
 * Creates or changes a skill or agent; a changed name renames its folder or file first. Never
 * writes over another one.
 */
export async function saveItem(
  ref: ClaudeItemRef,
  root: string,
  text: string,
  from?: string
): Promise<ConfigResult> {
  const { kind, name } = ref
  const what = ITEM_NOUNS[kind]
  if (text.length > MAX_ITEM_TEXT) return { ok: false, error: 'It is too long' }
  const dir = itemsDir(kind, root)
  const renamed = from !== undefined && from !== name
  if ((from === undefined || renamed) && !isNewItemName(kind, name)) {
    return {
      ok: false,
      error: `Name it with lowercase letters, digits and hyphens (up to ${MAX_ITEM_NAME})`
    }
  }
  const target = itemPath(kind, dir, name)
  try {
    if ((from === undefined || renamed) && (await exists(target))) {
      return { ok: false, error: `There is already a ${what} named "${name}" here` }
    }
    if (renamed) {
      const source = itemPath(kind, dir, from)
      if (!(await exists(source))) return { ok: false, error: `"${from}" is no longer there` }
      await mkdir(path.dirname(target), { recursive: true })
      await rename(source, target)
    }
    const file = itemFile(kind, dir, name)
    await mkdir(path.dirname(file), { recursive: true })
    await writeFile(file, text, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

/** Moves a skill's folder or an agent's file to the trash. */
export async function deleteItem(
  kind: ItemKind,
  root: string,
  name: string,
  trash: (p: string) => Promise<void>
): Promise<ConfigResult> {
  const target = itemPath(kind, itemsDir(kind, root), name)
  if (!(await exists(target))) return { ok: false, error: 'It is no longer there' }
  try {
    await trash(target)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

// ---- hooks ----

export function hooksFile(scope: HookScope, places: ConfigPlaces): string | null {
  if (scope === 'user') return path.join(places.userDir, 'settings.json')
  if (!places.folder) return null
  const name = scope === 'project' ? 'settings.json' : 'settings.local.json'
  return path.join(places.folder, '.claude', name)
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)

/** A settings file as an object; {} when there is none. Throws when it isn't one. */
export async function readSettings(file: string): Promise<Json> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw err
  }
  if (text.trim() === '') return {}
  const data: unknown = JSON.parse(text.replace(BOM, ''))
  if (!isObject(data)) throw new Error('It is not a settings object')
  return data
}

/** Written next to it and then moved over it, so a reader never sees half a file. */
export async function writeSettings(file: string, data: Json): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true })
  const temp = `${file}.${process.pid}.tmp`
  await writeFile(temp, JSON.stringify(data, null, 2) + '\n', 'utf8')
  await rename(temp, file)
}

export function hooksIn(data: Json, scope: HookScope): HookEntry[] {
  const out: HookEntry[] = []
  if (!isObject(data.hooks)) return out
  for (const [event, groups] of Object.entries(data.hooks)) {
    if (!Array.isArray(groups)) continue
    groups.forEach((group: unknown, g) => {
      if (!isObject(group) || !Array.isArray(group.hooks)) return
      const matcher = typeof group.matcher === 'string' ? group.matcher : ''
      group.hooks.forEach((handler: unknown, index) => {
        if (isObject(handler) && typeof handler.type === 'string') {
          out.push({ scope, event, matcher, group: g, index, handler: handler as HookHandler })
        }
      })
    })
  }
  return out
}

export async function listHookFile(scope: HookScope, file: string): Promise<HookFile> {
  try {
    return { scope, path: file, hooks: hooksIn(await readSettings(file), scope) }
  } catch (err) {
    return { scope, path: file, error: errorText(err), hooks: [] }
  }
}

/** The groups of one event, as an array it can change. */
function groupsOf(data: Json, event: string): Json[] {
  if (!isObject(data.hooks)) data.hooks = {}
  const hooks = data.hooks as Json
  if (!Array.isArray(hooks[event])) hooks[event] = []
  return hooks[event] as Json[]
}

/** The hook as it was read, if it is still there unchanged. */
function locate(data: Json, entry: HookEntry): { list: unknown[]; group: Json } | null {
  const groups = isObject(data.hooks) ? data.hooks[entry.event] : undefined
  const group = Array.isArray(groups) ? groups[entry.group] : undefined
  if (!isObject(group) || !Array.isArray(group.hooks)) return null
  if ((typeof group.matcher === 'string' ? group.matcher : '') !== entry.matcher) return null
  return sameJson(group.hooks[entry.index], entry.handler) ? { list: group.hooks, group } : null
}

/** Removes empty groups, events and the hooks object itself. */
function tidy(data: Json): void {
  if (!isObject(data.hooks)) return
  const hooks = data.hooks
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue
    const kept = groups.filter(
      (g) => !(isObject(g) && Array.isArray(g.hooks) && g.hooks.length === 0)
    )
    if (kept.length === 0) delete hooks[event]
    else hooks[event] = kept
  }
  if (Object.keys(hooks).length === 0) delete data.hooks
}

/** Adds a handler to the event's group with this matcher (a new group if there is none). */
export function addHook(data: Json, event: string, matcher: string, handler: HookHandler): void {
  const groups = groupsOf(data, event)
  const group = groups.find(
    (g) =>
      isObject(g) &&
      Array.isArray(g.hooks) &&
      (typeof g.matcher === 'string' ? g.matcher : '') === matcher
  )
  if (group) (group.hooks as unknown[]).push(handler)
  else groups.push(matcher ? { matcher, hooks: [handler] } : { hooks: [handler] })
}

const CHANGED = 'This hook was changed outside the app meanwhile. Reload to see it as it is now.'

/** Takes a hook out; false when it isn't there as it was read. */
export function removeHook(data: Json, entry: HookEntry): boolean {
  const found = locate(data, entry)
  if (!found) return false
  found.list.splice(entry.index, 1)
  tidy(data)
  return true
}

/**
 * Changes a hook where it is (same file, event and matcher), or moves it; adds a new one when
 * there is no original.
 */
export async function saveHook(
  file: string,
  change: { event: string; matcher: string; handler: HookHandler },
  original?: { file: string; entry: HookEntry }
): Promise<ConfigResult> {
  try {
    const data = await readSettings(file)
    if (original && original.file === file) {
      const { entry } = original
      if (entry.event === change.event && entry.matcher === change.matcher) {
        const found = locate(data, entry)
        if (!found) return { ok: false, error: CHANGED }
        found.list[entry.index] = change.handler
      } else {
        if (!removeHook(data, entry)) return { ok: false, error: CHANGED }
        addHook(data, change.event, change.matcher, change.handler)
      }
      await writeSettings(file, data)
      return { ok: true }
    }
    // A new hook, or one moved to another file: checked there before anything is written.
    let from: Json | null = null
    if (original) {
      from = await readSettings(original.file)
      if (!removeHook(from, original.entry)) return { ok: false, error: CHANGED }
    }
    addHook(data, change.event, change.matcher, change.handler)
    await writeSettings(file, data)
    if (original && from) await writeSettings(original.file, from)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}

export async function deleteHook(file: string, entry: HookEntry): Promise<ConfigResult> {
  try {
    const data = await readSettings(file)
    if (!removeHook(data, entry)) return { ok: false, error: CHANGED }
    await writeSettings(file, data)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: errorText(err) }
  }
}
