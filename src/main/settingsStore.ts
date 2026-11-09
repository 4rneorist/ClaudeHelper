import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import path from 'path'
import {
  HEX_COLOR,
  SOUND_NAMES,
  TELEGRAM_ALWAYS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  PICTURE_FILE,
  PICTURE_FITS,
  THEME_SETTINGS,
  type PictureFit,
  type Settings
} from '../shared/ipc'
import {
  DEFAULT_NOTES_WIDTH,
  MAX_NOTES_WIDTH,
  MAX_TITLE_LENGTH,
  MIN_NOTES_WIDTH
} from '../shared/uiState'

export const MAX_RECENT = 15
/** Below this the picture would hardly show. */
export const MIN_PICTURE_STRENGTH = 5

/** A picture file's full path, as a terminal's background takes it. */
export function isPicturePath(file: string): boolean {
  return file.length <= 1024 && path.isAbsolute(file) && PICTURE_FILE.test(file)
}
export const MIN_FONT_SIZE = 8
export const MAX_FONT_SIZE = 32
export const MAX_REMINDER_MINUTES = 60
export const MAX_AWAY_MINUTES = 60

/** Keeps the bot token unreadable in the settings file (Electron's safeStorage in the app). */
export interface SecretCipher {
  encrypt(plain: string): string
  decrypt(stored: string): string
}

/** How an encrypted token starts in the settings file. */
const ENCRYPTED = 'enc:'

export const DEFAULT_SETTINGS: Settings = {
  claudePath: '',
  fontSize: 14,
  theme: 'system',
  terminalPicture: '',
  terminalPictureStrength: 25,
  terminalPictureFit: 'fill',
  experimentalConptyDll: false,
  restoreSession: true,
  lazyRestore: true,
  notifyWhenWaiting: true,
  soundOnAttention: true,
  finishedSound: 'chime',
  askingSound: 'rise',
  soundVolume: 70,
  reminderMinutes: 5,
  mutedFolders: [],
  jiraEnabled: false,
  jiraUrl: '',
  telegramEnabled: false,
  telegramBotToken: '',
  telegramChatId: '',
  telegramAwayMinutes: 5,
  telegramRemote: false,
  bookmarksOpen: false,
  notesWidth: DEFAULT_NOTES_WIDTH,
  recentFolders: [],
  folderColors: {},
  folderTitles: {}
}

function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  // Windows and default macOS filesystems are case-insensitive.
  return platform === 'linux' ? a === b : a.toLowerCase() === b.toLowerCase()
}

function cleanTitle(title: string): string {
  return title.trim().slice(0, MAX_TITLE_LENGTH)
}

const MAX_URL_LENGTH = 500

/** A ticket URL template that opens as http(s) once a key is filled in. */
function isTicketUrl(template: string): boolean {
  try {
    const { protocol } = new URL(template.replaceAll('{key}', 'MT-1'))
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

/** Keeps only valid fields from untrusted input (a settings file or an IPC payload). */
export function sanitizeSettings(input: unknown, base: Settings = DEFAULT_SETTINGS): Settings {
  const out: Settings = {
    ...base,
    recentFolders: [...base.recentFolders],
    folderColors: { ...base.folderColors },
    folderTitles: { ...base.folderTitles },
    mutedFolders: [...base.mutedFolders]
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
  const picture = typeof raw.terminalPicture === 'string' ? raw.terminalPicture.trim() : null
  if (picture === '' || (picture && isPicturePath(picture))) out.terminalPicture = picture
  const strength = raw.terminalPictureStrength
  if (typeof strength === 'number' && Number.isFinite(strength)) {
    const percent = Math.round(strength)
    out.terminalPictureStrength = Math.min(100, Math.max(MIN_PICTURE_STRENGTH, percent))
  }
  const fit = raw.terminalPictureFit
  if (typeof fit === 'string' && (PICTURE_FITS as readonly string[]).includes(fit)) {
    out.terminalPictureFit = fit as PictureFit
  }
  if (typeof raw.experimentalConptyDll === 'boolean')
    out.experimentalConptyDll = raw.experimentalConptyDll
  if (typeof raw.restoreSession === 'boolean') out.restoreSession = raw.restoreSession
  if (typeof raw.lazyRestore === 'boolean') out.lazyRestore = raw.lazyRestore
  if (typeof raw.notifyWhenWaiting === 'boolean') out.notifyWhenWaiting = raw.notifyWhenWaiting
  if (typeof raw.soundOnAttention === 'boolean') out.soundOnAttention = raw.soundOnAttention
  for (const key of ['finishedSound', 'askingSound'] as const) {
    const name = raw[key]
    if (typeof name === 'string' && (SOUND_NAMES as readonly string[]).includes(name)) {
      out[key] = name as Settings[typeof key]
    }
  }
  if (typeof raw.soundVolume === 'number' && Number.isFinite(raw.soundVolume)) {
    out.soundVolume = Math.min(100, Math.max(0, Math.round(raw.soundVolume)))
  }
  if (typeof raw.reminderMinutes === 'number' && Number.isFinite(raw.reminderMinutes)) {
    out.reminderMinutes = Math.min(
      MAX_REMINDER_MINUTES,
      Math.max(0, Math.round(raw.reminderMinutes))
    )
  }
  if (typeof raw.jiraEnabled === 'boolean') out.jiraEnabled = raw.jiraEnabled
  if (typeof raw.jiraUrl === 'string') {
    const url = raw.jiraUrl.trim()
    if (url === '' || (url.length <= MAX_URL_LENGTH && isTicketUrl(url))) out.jiraUrl = url
  }
  if (typeof raw.telegramEnabled === 'boolean') out.telegramEnabled = raw.telegramEnabled
  if (typeof raw.telegramBotToken === 'string') {
    const token = raw.telegramBotToken.trim()
    if (token === '' || TELEGRAM_BOT_TOKEN.test(token)) out.telegramBotToken = token
  }
  if (typeof raw.telegramChatId === 'string') {
    const chat = raw.telegramChatId.trim()
    if (chat === '' || TELEGRAM_CHAT_ID.test(chat)) out.telegramChatId = chat
  }
  if (typeof raw.telegramAwayMinutes === 'number' && Number.isFinite(raw.telegramAwayMinutes)) {
    out.telegramAwayMinutes = Math.min(
      MAX_AWAY_MINUTES,
      Math.max(TELEGRAM_ALWAYS, Math.round(raw.telegramAwayMinutes))
    )
  }
  if (typeof raw.telegramRemote === 'boolean') out.telegramRemote = raw.telegramRemote
  if (typeof raw.bookmarksOpen === 'boolean') out.bookmarksOpen = raw.bookmarksOpen
  if (typeof raw.notesWidth === 'number' && Number.isFinite(raw.notesWidth)) {
    out.notesWidth = Math.min(
      MAX_NOTES_WIDTH,
      Math.max(MIN_NOTES_WIDTH, Math.round(raw.notesWidth))
    )
  }
  if (Array.isArray(raw.mutedFolders)) {
    out.mutedFolders = raw.mutedFolders.filter(
      (f): f is string => typeof f === 'string' && f !== ''
    )
  }
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
  if (raw.folderTitles && typeof raw.folderTitles === 'object') {
    out.folderTitles = {}
    for (const [folder, title] of Object.entries(raw.folderTitles)) {
      const clean = typeof title === 'string' ? cleanTitle(title) : ''
      if (folder && clean) out.folderTitles[folder] = clean
    }
  }
  return out
}

export class SettingsStore {
  private settings: Settings

  /** Without a cipher (the OS offers no encryption), the bot token is saved as plain text. */
  constructor(
    private readonly filePath: string,
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly cipher?: SecretCipher
  ) {
    this.settings = this.load()
  }

  get(): Settings {
    return {
      ...this.settings,
      recentFolders: [...this.settings.recentFolders],
      folderColors: { ...this.settings.folderColors },
      folderTitles: { ...this.settings.folderTitles },
      mutedFolders: [...this.settings.mutedFolders]
    }
  }

  /**
   * Recent folders and per-folder colors, titles and muting are managed through their own
   * methods, not patched wholesale.
   */
  update(patch: unknown): Settings {
    const { recentFolders, folderColors, folderTitles, mutedFolders } = this.settings
    this.settings = {
      ...sanitizeSettings(patch, this.settings),
      recentFolders,
      folderColors,
      folderTitles,
      mutedFolders
    }
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

  /** null or a blank title goes back to the folder's name. */
  setFolderTitle(folder: string, title: string | null): Settings {
    const clean = title === null ? '' : cleanTitle(title)
    const folderTitles = Object.fromEntries(
      Object.entries(this.settings.folderTitles).filter(
        ([f]) => !samePath(f, folder, this.platform)
      )
    )
    if (clean) folderTitles[folder] = clean
    this.settings.folderTitles = folderTitles
    this.save()
    return this.get()
  }

  setFolderMuted(folder: string, muted: boolean): Settings {
    const rest = this.settings.mutedFolders.filter((f) => !samePath(f, folder, this.platform))
    this.settings.mutedFolders = muted ? [...rest, folder] : rest
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
      const raw: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (raw && typeof raw === 'object' && 'telegramBotToken' in raw) {
        raw.telegramBotToken = this.revealToken(raw.telegramBotToken)
      }
      return sanitizeSettings(raw)
    } catch {
      return sanitizeSettings(undefined)
    }
  }

  /** A token that can't be decrypted (another user, another machine) is dropped. */
  private revealToken(stored: unknown): unknown {
    if (typeof stored !== 'string' || !stored.startsWith(ENCRYPTED)) return stored
    try {
      return this.cipher ? this.cipher.decrypt(stored.slice(ENCRYPTED.length)) : ''
    } catch {
      return ''
    }
  }

  /** Only a set token touches the cipher, so the macOS keychain isn't asked without Telegram. */
  private hideToken(token: string): string {
    if (!token || !this.cipher) return token
    try {
      return ENCRYPTED + this.cipher.encrypt(token)
    } catch {
      return token
    }
  }

  private save(): void {
    mkdirSync(path.dirname(this.filePath), { recursive: true })
    const onDisk = {
      ...this.settings,
      telegramBotToken: this.hideToken(this.settings.telegramBotToken)
    }
    // Write-then-rename so a crash mid-write can't leave a truncated settings file.
    const tmp = `${this.filePath}.tmp`
    writeFileSync(tmp, JSON.stringify(onDisk, null, 2), 'utf8')
    renameSync(tmp, this.filePath)
  }
}
