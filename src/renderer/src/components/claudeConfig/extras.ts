import type { ExtrasList, ReadOnlyItem } from '../../../../shared/claudeConfig'

/**
 * What comes from claude.ai and plugins, asked once a minute at most: each section shows its
 * part, and asking means running `claude plugin list`.
 */
const cache = new Map<string, { at: number; promise: Promise<ExtrasList> }>()
const FRESH_MS = 60_000

export function loadExtras(folder: string | null): Promise<ExtrasList> {
  const key = folder ?? ''
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.promise
  const promise = window.api.claudeExtras(folder)
  cache.set(key, { at: Date.now(), promise })
  return promise
}

/** Asked again next time (after a reload, or a plugin change). */
export function forgetExtras(): void {
  cache.clear()
}

/** How Claude Code names it: a plugin's skill is plugin:skill. */
export function readOnlyName(item: ReadOnlyItem): string {
  const name = item.name.split('/').join(':')
  return item.plugin && item.kind !== 'outputStyle' ? `${item.plugin}:${name}` : name
}
