import { mkdir, readFile, rename, writeFile } from 'fs/promises'
import path from 'path'
import {
  SETTINGS_KEYS,
  sameJson,
  type ConfigResult,
  type HookScope,
  type KeybindingsFile,
  type SettingsFile,
  type SettingsKey
} from '../shared/claudeConfig'
import { readSettings, writeSettings } from './claudeConfig'

/**
 * A few settings in Claude Code's settings files (permissions, model, output style, environment,
 * status line), and the keybindings file. Each change is checked against what was read, so one
 * made meanwhile (by Claude Code, say) isn't overwritten.
 */

const CHANGED = 'It was changed outside the app meanwhile. Reload to see it as it is now.'

export async function readSettingsFile(scope: HookScope, file: string): Promise<SettingsFile> {
  try {
    const data = await readSettings(file)
    const values: SettingsFile['values'] = {}
    for (const key of SETTINGS_KEYS) if (key in data) values[key] = data[key]
    return { scope, path: file, values }
  } catch (err) {
    return {
      scope,
      path: file,
      error: err instanceof Error ? err.message : String(err),
      values: {}
    }
  }
}

/** Sets (or with null removes) settings, when they are still as they were read. */
export async function patchSettings(
  file: string,
  set: Partial<Record<SettingsKey, unknown>>,
  before: Partial<Record<SettingsKey, unknown>>
): Promise<ConfigResult> {
  try {
    const data = await readSettings(file)
    for (const key of Object.keys(set) as SettingsKey[]) {
      if (!sameJson(data[key] ?? null, before[key] ?? null)) return { ok: false, error: CHANGED }
    }
    for (const [key, value] of Object.entries(set)) {
      if (value === null) delete data[key]
      else data[key] = value
    }
    await writeSettings(file, data)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---- keybindings: <claude folder>/keybindings.json ----

export function keybindingsPath(userDir: string): string {
  return path.join(userDir, 'keybindings.json')
}

export async function readKeybindings(file: string): Promise<KeybindingsFile> {
  try {
    const text = (await readFile(file, 'utf8')).replace(new RegExp('^\\uFEFF'), '')
    try {
      JSON.parse(text)
      return { path: file, text }
    } catch (err) {
      return { path: file, text, error: err instanceof Error ? err.message : String(err) }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { path: file, text: null }
    return { path: file, text: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/** The shape Claude Code reads: { bindings: [{ context, bindings: { key: action | null } }] }. */
export function keybindingsProblem(text: string): string | null {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    return err instanceof Error ? err.message : String(err)
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'It must be a JSON object'
  const blocks = (data as Record<string, unknown>).bindings
  if (!Array.isArray(blocks)) return 'It needs a "bindings" list'
  for (const block of blocks) {
    if (!block || typeof block !== 'object') return 'Each block must be an object'
    const { context, bindings } = block as Record<string, unknown>
    if (typeof context !== 'string') return 'Each block needs a "context"'
    if (!bindings || typeof bindings !== 'object' || Array.isArray(bindings)) {
      return `"${context}" needs its "bindings"`
    }
    for (const action of Object.values(bindings)) {
      if (action !== null && typeof action !== 'string') {
        return `In "${context}", an action must be a name or null`
      }
    }
  }
  return null
}

export async function saveKeybindings(
  file: string,
  text: string,
  before: string | null
): Promise<ConfigResult> {
  const problem = keybindingsProblem(text)
  if (problem) return { ok: false, error: problem }
  try {
    const current = (await readKeybindings(file)).text
    if (current !== before) return { ok: false, error: CHANGED }
    await mkdir(path.dirname(file), { recursive: true })
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, text.endsWith('\n') ? text : text + '\n', 'utf8')
    await rename(temp, file)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
