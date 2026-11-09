import type { Dirent } from 'fs'
import { mkdir, readdir, readFile, rename, stat, writeFile } from 'fs/promises'
import path from 'path'
import {
  MAX_ITEM_TEXT,
  NAMED_AREAS,
  type ConfigResult,
  type MemoryArea,
  type MemoryFile,
  type MemoryRef
} from '../shared/claudeConfig'
import { isItemName, isNewItemName } from './claudeConfig'
import { projectDirName } from './claudeSessions'

/**
 * Memory files: what Claude reads at the start of every session (CLAUDE.md, rules) and the notes
 * it keeps itself about a project (auto memory).
 */

export interface MemoryPlaces {
  /** Your Claude folder (CLAUDE_CONFIG_DIR or ~/.claude). */
  userDir: string
  folder?: string
}

/** Where a named area's files are; null when it needs a folder and has none. */
export function memoryDir(area: MemoryArea, places: MemoryPlaces): string | null {
  const { userDir, folder } = places
  if (area === 'userRule') return path.join(userDir, 'rules')
  if (!folder) return null
  if (area === 'projectRule') return path.join(folder, '.claude', 'rules')
  if (area === 'note') return path.join(userDir, 'projects', projectDirName(folder), 'memory')
  return null
}

/** The file a ref points at; null when it can't point anywhere. */
export function memoryPath(ref: MemoryRef, places: MemoryPlaces): string | null {
  const { userDir, folder } = places
  if (NAMED_AREAS.includes(ref.area)) {
    const dir = memoryDir(ref.area, places)
    // Notes sit side by side; rules may be in subfolders.
    const kind = ref.area === 'note' ? 'skill' : 'agent'
    if (!dir || !isItemName(kind, ref.name)) return null
    return path.join(dir, ...ref.name.split('/')) + '.md'
  }
  if (ref.area === 'user') return path.join(userDir, 'CLAUDE.md')
  if (!folder) return null
  if (ref.area === 'project') return path.join(folder, 'CLAUDE.md')
  if (ref.area === 'projectDot') return path.join(folder, '.claude', 'CLAUDE.md')
  if (ref.area === 'local') return path.join(folder, 'CLAUDE.local.md')
  return null
}

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile()
  } catch {
    return false
  }
}

async function entriesOf(dir: string): Promise<Dirent[]> {
  try {
    return await readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/** The .md files in a folder (and two levels of subfolders for rules), by name. */
async function namedFiles(area: MemoryArea, dir: string): Promise<string[]> {
  const names: string[] = []
  const walk = async (sub: string[]): Promise<void> => {
    for (const entry of await entriesOf(path.join(dir, ...sub))) {
      if (entry.name.startsWith('.')) continue
      if (entry.isDirectory() && area !== 'note' && sub.length < 2) {
        await walk([...sub, entry.name])
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        names.push([...sub, entry.name.slice(0, -3)].join('/'))
      }
    }
  }
  await walk([])
  return names.sort((a, b) => a.localeCompare(b))
}

/**
 * Every memory file for your Claude folder and the project: CLAUDE.md files whether they exist or
 * not (saving creates one), and the rules and notes there are.
 */
export async function listMemory(places: MemoryPlaces): Promise<MemoryFile[]> {
  const { folder } = places
  const out: MemoryFile[] = []
  const add = async (ref: MemoryRef, always: boolean): Promise<void> => {
    const p = memoryPath(ref, places)
    if (!p) return
    const exists = await isFile(p)
    if (exists || always) out.push({ ...ref, ...(folder ? { folder } : {}), path: p, exists })
  }
  const named = async (area: MemoryArea): Promise<void> => {
    const dir = memoryDir(area, places)
    if (!dir) return
    for (const name of await namedFiles(area, dir)) await add({ area, name }, false)
  }
  await add({ area: 'user' }, true)
  await named('userRule')
  if (folder) {
    // .claude/CLAUDE.md only when it is there: the folder's own CLAUDE.md is the usual place.
    await add({ area: 'project' }, true)
    await add({ area: 'projectDot' }, false)
    await add({ area: 'local' }, true)
    await named('projectRule')
    await named('note')
  }
  return out
}

/** A byte order mark some editors put at the start. */
const BOM = new RegExp('^\\uFEFF')

export async function readMemory(file: string): Promise<string | null> {
  try {
    const info = await stat(file)
    if (!info.isFile() || info.size > MAX_ITEM_TEXT) return null
    return (await readFile(file, 'utf8')).replace(BOM, '').replace(/\r\n/g, '\n')
  } catch {
    return null
  }
}

const CHANGED = 'It was changed outside the app meanwhile. Reload to see it as it is now.'

/**
 * Writes a memory file, creating its folder; a rule given a new name is moved first. Refuses
 * when the file changed since it was read (`before`), or a new one would replace another.
 */
export async function saveMemory(
  ref: MemoryRef,
  places: MemoryPlaces,
  text: string,
  before: string | null,
  from?: string
): Promise<ConfigResult> {
  const file = memoryPath(ref, places)
  if (!file) return { ok: false, error: 'Invalid request' }
  if (text.length > MAX_ITEM_TEXT) return { ok: false, error: 'It is too long' }
  const named = NAMED_AREAS.includes(ref.area)
  const renamed = named && from !== undefined && from !== ref.name
  try {
    if (named && (from === undefined || renamed)) {
      if (!isNewItemName(ref.area === 'note' ? 'skill' : 'agent', ref.name ?? '')) {
        return { ok: false, error: 'Name it with lowercase letters, digits and hyphens' }
      }
      if (await isFile(file)) return { ok: false, error: `There is already a "${ref.name}" here` }
    }
    const source = renamed ? memoryPath({ ...ref, name: from }, places) : file
    if (!source) return { ok: false, error: 'Invalid request' }
    const current = await readMemory(source)
    if (current !== before && !(before === null && current === null)) {
      return { ok: false, error: CHANGED }
    }
    await mkdir(path.dirname(file), { recursive: true })
    if (renamed) await rename(source, file)
    await writeFile(file, text, 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
