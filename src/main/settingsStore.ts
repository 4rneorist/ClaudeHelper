import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import { HEX_COLOR, THEME_SETTINGS, type Settings } from '../shared/ipc'

export const MAX_RECENT = 15
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32

export const DEFAULT_SETTINGS: Settings = {
  claudePath: '',
  fontSize: 14,
  theme: 'system',
  experimentalConptyDll: false,
  restoreSession: true,
  recentFolders: [],
  folderColors: {}
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  // Windows and default macOS filesystems are case-insensitive.
  return platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

/** Keeps only valid fields from untrusted input (a settings file or an IPC payload). */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = {
    ...base,
    recentFolders: [...base.recentFolders],
    folderColors: { ...base.folderColors }
  }
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  if (typeof raw.claudePath === 'string') out.claudePath = raw.claudePath.trim()
  if (typeof raw.fontSize === 'number' && Number.isFinite(raw.fontSize)) {
    out.fontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(raw.fontSize)))
  }
  if (typeof raw.theme === 'string' && (THEME_SETTINGS as readonly string[]).includes(raw.theme)) {
    out.theme = raw.theme as Settings['theme']
  }
  if (typeof raw.experimentalConptyDll === 'boolean')
    out.experimentalConptyDll = raw.experimentalConptyDll
  if (typeof raw.restoreSession === 'boolean') out.restoreSession = raw.restoreSession
  if (Array.isArray(raw.recentFolders)) {
    out.recentFolders = raw.recentFolders
      .filter((f): f is string => typeof f === 'string' && f.length > 0)
      .slice(0, MAX_RECENT)
  }
  if (raw.folderColors && typeof raw.folderColors === 'object') {
    out.folderColors = {}
    for (const [folder, color] of Object.entries(raw.folderColors)) {
      if (folder && typeof color === 'string' && HEX_COLOR.test(color)) {
        out.folderColors[folder] = color.toLowerCase()
      }
    }
  }
  return out
}

export class SettingsStore {
  private settings: Settings

  constructor(
    private readonly filePath: string,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.settings = this.load()
  }

  get(): Settings {
    return {
      ...this.settings,
      recentFolders: [...this.settings.recentFolders],
      folderColors: { ...this.settings.folderColors }
    }
  }

  /**
   * Recent folders and folder colors are managed through their own methods, not patched
   * wholesale.
   */
  update(patch: unknown): Settings {
    const { recentFolders, folderColors } = this.settings
    this.settings = { ...sanitizeSettings(patch, this.settings), recentFolders, folderColors }
    this.save()
    return this.get()
  }

  /** null clears the color. Anything but #rrggbb is ignored. */
  setFolderColor(folder: string, color: string | null): Settings {
    if (color !== null && !HEX_COLOR.test(color)) return this.get()
    const folderColors = Object.fromEntries(
      Object.entries(this.settings.folderColors).filter(
        ([f]) => !samePath(f, folder, this.platform)
      )
    )
    if (color !== null) folderColors[folder] = color.toLowerCase()
    this.settings.folderColors = folderColors
    this.save()
    return this.get()
  }

  addRecent(folder: string): Settings {
    const rest = this.settings.recentFolders.filter((f) => !samePath(f, folder, this.platform))
    this.settings.recentFolders = [folder, ...rest].slice(0, MAX_RECENT)
    this.save()
    return this.get()
  }

  removeRecent(folder: string): Settings {
    this.settings.recentFolders = this.settings.recentFolders.filter(
      (f) => !samePath(f, folder, this.platform)
    )
    this.save()
    return this.get()
  }

  private load(): Settings {
    try {
      return sanitizeSettings(JSON.parse(readFileSync(this.filePath, 'utf8')))
    } catch {
      return sanitizeSettings(undefined)
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    // Write-then-rename so a crash mid-write can't leave a truncated settings file.
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }
}
