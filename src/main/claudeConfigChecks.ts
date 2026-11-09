import {
  ENV_NAME,
  MARKETPLACE_NAME,
  MAX_RULE,
  MAX_RULES,
  MAX_SETTINGS_TEXT,
  MAX_SOURCE,
  MCP_NAME,
  MCP_SCOPES,
  MEMORY_AREAS,
  NAMED_AREAS,
  PERMISSION_LISTS,
  PERMISSION_MODES,
  SETTINGS_KEYS,
  type KeybindingsSave,
  type MarketplaceRequest,
  type McpRemoveRequest,
  type McpSaveRequest,
  type MemoryRef,
  type SaveMemoryRequest,
  type SettingsKey,
  type SettingsPatch,
  HOOK_EVENT,
  HOOK_SCOPES,
  HOOK_TYPES,
  ITEM_KINDS,
  ITEM_SCOPES,
  MAX_HOOK_JSON,
  MAX_ITEM_TEXT,
  MAX_MATCHER,
  PLUGIN_ACTIONS,
  PLUGIN_ID,
  PLUGIN_SCOPES,
  type ClaudeItemRef,
  type HookChange,
  type HookEntry,
  type HookHandler,
  type HookScope,
  type PluginActionRequest,
  type SaveItemRequest
} from '../shared/claudeConfig'
import { isItemName } from './claudeConfig'
import { isAbsoluteFolderPath, isDirectory } from './validation'

/**
 * Requests from the "Claude Code" window, rebuilt from known fields. Main works out every path
 * itself from a scope, an existing project folder and a plain name.
 */

type Json = Record<string, unknown>
const isObject = (v: unknown): v is Json => v !== null && typeof v === 'object' && !Array.isArray(v)
const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (list as readonly string[]).includes(v)

/** A project folder that exists; undefined for none, null when it isn't one. */
export function checkFolder(input: unknown): string | undefined | null {
  if (input === undefined || input === null) return undefined
  return isAbsoluteFolderPath(input) && isDirectory(input) ? input : null
}

export function checkItemRef(input: unknown): ClaudeItemRef | null {
  if (!isObject(input)) return null
  const { kind, scope, name } = input
  if (!oneOf(ITEM_KINDS, kind)) return null
  if (!oneOf(ITEM_SCOPES, scope) || !isItemName(kind, name)) return null
  if (scope === 'user') return { kind, scope, name }
  const folder = checkFolder(input.folder)
  return folder ? { kind, scope, folder, name } : null
}

export function checkSaveItem(input: unknown): SaveItemRequest | null {
  if (!isObject(input)) return null
  const ref = checkItemRef(input.ref)
  if (!ref || typeof input.text !== 'string' || input.text.length > MAX_ITEM_TEXT) return null
  if (input.from === undefined) return { ref, text: input.text }
  return isItemName(ref.kind, input.from) ? { ref, text: input.text, from: input.from } : null
}

/** A handler that can be written: a known type, plain JSON, not too big. */
function checkHandler(input: unknown): HookHandler | null {
  if (!isObject(input) || !oneOf(HOOK_TYPES, input.type)) return null
  try {
    const json = JSON.stringify(input)
    return json.length <= MAX_HOOK_JSON ? (JSON.parse(json) as HookHandler) : null
  } catch {
    return null
  }
}

const isIndex = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 10_000

/** A hook as it was listed; its handler may be of any type (it is only compared). */
export function checkHookEntry(input: unknown): HookEntry | null {
  if (!isObject(input) || !oneOf(HOOK_SCOPES, input.scope)) return null
  const { event, matcher, group, index, handler } = input
  if (typeof event !== 'string' || !HOOK_EVENT.test(event)) return null
  if (typeof matcher !== 'string' || matcher.length > MAX_MATCHER) return null
  if (!isIndex(group) || !isIndex(index)) return null
  if (!isObject(handler) || typeof handler.type !== 'string') return null
  return {
    scope: input.scope as HookScope,
    event,
    matcher,
    group,
    index,
    handler: handler as HookHandler
  }
}

export function checkHookChange(input: unknown): HookChange | null {
  if (!isObject(input) || !oneOf(HOOK_SCOPES, input.scope)) return null
  const { event, matcher } = input
  if (typeof event !== 'string' || !HOOK_EVENT.test(event)) return null
  if (typeof matcher !== 'string' || matcher.length > MAX_MATCHER) return null
  const handler = checkHandler(input.handler)
  if (!handler) return null
  const original = input.original === undefined ? undefined : checkHookEntry(input.original)
  if (original === null) return null
  const folder = checkFolder(input.folder)
  if (folder === null) return null
  const scopes = [input.scope, ...(original ? [original.scope] : [])]
  // The project's files need its folder.
  if (!folder && scopes.some((s) => s !== 'user')) return null
  return {
    ...(folder ? { folder } : {}),
    scope: input.scope as HookScope,
    event,
    matcher: matcher.trim(),
    handler,
    ...(original ? { original } : {})
  }
}

export function checkPluginRequest(input: unknown): PluginActionRequest | null {
  if (!isObject(input)) return null
  const { action, id, scope, acceptCommand } = input
  if (!oneOf(PLUGIN_ACTIONS, action) || !oneOf(PLUGIN_SCOPES, scope)) return null
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) return null
  if (
    acceptCommand !== undefined &&
    !(typeof acceptCommand === 'string' && /^[a-f0-9]{64}$/i.test(acceptCommand))
  ) {
    return null
  }
  const folder = checkFolder(input.folder)
  if (folder === null || (scope !== 'user' && !folder)) return null
  return {
    action,
    id,
    scope,
    ...(folder ? { folder } : {}),
    ...(typeof acceptCommand === 'string' ? { acceptCommand } : {})
  }
}

// ---- memory, MCP, settings, marketplaces, keybindings ----

/** Plain JSON within a size, as a copy; null when it isn't. */
function json(v: unknown, max = MAX_HOOK_JSON): unknown {
  try {
    const text = JSON.stringify(v)
    return text !== undefined && text.length <= max ? JSON.parse(text) : null
  } catch {
    return null
  }
}

export function checkMemoryRef(input: unknown): MemoryRef | null {
  if (!isObject(input) || !oneOf(MEMORY_AREAS, input.area)) return null
  const area = input.area
  const folder = checkFolder(input.folder)
  if (folder === null) return null
  const needsFolder = area !== 'user' && area !== 'userRule'
  if (needsFolder && !folder) return null
  const named = NAMED_AREAS.includes(area)
  if (named && !isItemName(area === 'note' ? 'skill' : 'agent', input.name)) return null
  return {
    area,
    ...(needsFolder && folder ? { folder } : {}),
    ...(named ? { name: input.name as string } : {})
  }
}

export function checkSaveMemory(input: unknown): SaveMemoryRequest | null {
  if (!isObject(input)) return null
  const ref = checkMemoryRef(input.ref)
  const { text, before, from } = input
  if (!ref || typeof text !== 'string' || text.length > MAX_ITEM_TEXT) return null
  if (before !== null && typeof before !== 'string') return null
  if (from !== undefined && !isItemName('agent', from)) return null
  return { ref, text, before: before as string | null, ...(from !== undefined ? { from } : {}) }
}

export function checkMcpSave(input: unknown): McpSaveRequest | null {
  if (!isObject(input) || !oneOf(MCP_SCOPES, input.scope)) return null
  const { name, original } = input
  if (typeof name !== 'string' || !MCP_NAME.test(name)) return null
  const config = json(input.config)
  if (!isObject(config)) return null
  if (typeof config.command !== 'string' && typeof config.url !== 'string') return null
  const folder = checkFolder(input.folder)
  if (folder === null) return null
  let from: McpSaveRequest['original']
  if (original !== undefined) {
    if (!isObject(original) || !oneOf(MCP_SCOPES, original.scope)) return null
    if (typeof original.name !== 'string' || !MCP_NAME.test(original.name)) return null
    from = { name: original.name, scope: original.scope }
  }
  const scopes = [input.scope, ...(from ? [from.scope] : [])]
  if (!folder && scopes.some((s) => s !== 'user')) return null
  return {
    ...(folder ? { folder } : {}),
    scope: input.scope,
    name,
    config,
    ...(from ? { original: from } : {})
  }
}

export function checkMcpRemove(input: unknown): McpRemoveRequest | null {
  if (!isObject(input) || !oneOf(MCP_SCOPES, input.scope)) return null
  if (typeof input.name !== 'string' || !MCP_NAME.test(input.name)) return null
  const folder = checkFolder(input.folder)
  if (folder === null || (input.scope !== 'user' && !folder)) return null
  return { ...(folder ? { folder } : {}), scope: input.scope, name: input.name }
}

const isStrings = (v: unknown, max: number): v is string[] =>
  Array.isArray(v) &&
  v.length <= MAX_RULES &&
  v.every((s) => typeof s === 'string' && s.length > 0 && s.length <= max)

/** A value for one of the settings this window edits; undefined when it isn't one. */
function checkSettingValue(key: SettingsKey, value: unknown): unknown {
  if (value === null) return null
  if (key === 'model' || key === 'outputStyle') {
    return typeof value === 'string' && value.trim() && value.length <= 200
      ? value.trim()
      : undefined
  }
  if (key === 'env') {
    if (!isObject(value) || Object.keys(value).length > 500) return undefined
    const ok = Object.entries(value).every(
      ([k, v]) => ENV_NAME.test(k) && typeof v === 'string' && v.length <= 10_000
    )
    return ok ? { ...value } : undefined
  }
  const copy = json(value)
  if (!isObject(copy)) return undefined
  if (key === 'statusLine') {
    return copy.type === 'command' && typeof copy.command === 'string' && copy.command.trim()
      ? copy
      : undefined
  }
  // permissions
  for (const list of [...PERMISSION_LISTS, 'additionalDirectories'] as const) {
    if (list in copy && !isStrings(copy[list], MAX_RULE)) return undefined
  }
  if ('defaultMode' in copy && !oneOf(PERMISSION_MODES, copy.defaultMode)) return undefined
  return copy
}

export function checkSettingsPatch(input: unknown): SettingsPatch | null {
  if (!isObject(input) || !oneOf(HOOK_SCOPES, input.scope)) return null
  if (!isObject(input.set) || !isObject(input.before)) return null
  const folder = checkFolder(input.folder)
  if (folder === null || (input.scope !== 'user' && !folder)) return null
  const set: SettingsPatch['set'] = {}
  const before: SettingsPatch['before'] = {}
  for (const [key, value] of Object.entries(input.set)) {
    if (!oneOf(SETTINGS_KEYS, key)) return null
    const checked = checkSettingValue(key, value)
    if (checked === undefined) return null
    set[key] = checked
    before[key] = json(input.before[key] ?? null)
  }
  return Object.keys(set).length > 0
    ? { ...(folder ? { folder } : {}), scope: input.scope, set, before }
    : null
}

export function checkMarketplaceRequest(input: unknown): MarketplaceRequest | null {
  if (!isObject(input)) return null
  const { action, target, scope } = input
  if (action !== 'add' && action !== 'remove' && action !== 'update') return null
  if (typeof target !== 'string') return null
  if (action === 'add') {
    // owner/repo, a URL or a path: one line, no quotes, and not mistaken for an option.
    // eslint-disable-next-line no-control-regex
    if (!target || target.length > MAX_SOURCE || /["\u0000-\u001f]/.test(target)) return null
    if (target.startsWith('-')) return null
  } else if (!MARKETPLACE_NAME.test(target)) return null
  if (scope !== undefined && !oneOf(PLUGIN_SCOPES, scope)) return null
  const folder = checkFolder(input.folder)
  if (folder === null || (scope !== undefined && scope !== 'user' && !folder)) return null
  return {
    action,
    target: target.trim(),
    ...(action === 'add' && scope ? { scope } : {}),
    ...(folder ? { folder } : {})
  }
}

export function checkKeybindingsSave(input: unknown): KeybindingsSave | null {
  if (!isObject(input) || typeof input.text !== 'string') return null
  if (input.text.length > MAX_SETTINGS_TEXT) return null
  if (input.before !== null && typeof input.before !== 'string') return null
  return { text: input.text, before: input.before as string | null }
}
