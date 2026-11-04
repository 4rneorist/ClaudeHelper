import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_SETTINGS,
  MAX_AWAY_MINUTES,
  MAX_RECENT,
  SettingsStore,
  type SecretCipher
} from '../../src/main/settingsStore'
import { TELEGRAM_ALWAYS } from '../../src/shared/ipc'

describe('SettingsStore', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-helper-'))
    file = path.join(dir, 'nested', 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('starts from defaults when no file exists', () => {
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('persists updates across instances', () => {
    new SettingsStore(file).update({ fontSize: 18, theme: 'dark' })
    const reloaded = new SettingsStore(file).get()
    expect(reloaded.fontSize).toBe(18)
    expect(reloaded.theme).toBe('dark')
  })

  it('rejects invalid values and clamps font size', () => {
    const store = new SettingsStore(file)
    const s = store.update({ fontSize: 500, theme: 'neon', experimentalConptyDll: 'yes', extra: 1 })
    expect(s.fontSize).toBe(32)
    expect(s.theme).toBe(DEFAULT_SETTINGS.theme)
    expect(s.experimentalConptyDll).toBe(DEFAULT_SETTINGS.experimentalConptyDll)
    expect(s).not.toHaveProperty('extra')
  })

  it('resumes restored tabs lazily unless switched off', () => {
    const store = new SettingsStore(file)
    expect(store.get().lazyRestore).toBe(true)
    expect(store.update({ lazyRestore: 'no' }).lazyRestore).toBe(true)
    expect(store.update({ lazyRestore: false }).lazyRestore).toBe(false)
  })

  it('shows no Jira ticket until switched on, and keeps only http(s) ticket URLs', () => {
    const store = new SettingsStore(file)
    expect(store.get()).toMatchObject({ jiraEnabled: false, jiraUrl: '' })
    const url = 'https://acme.atlassian.net/browse/{key}'
    expect(store.update({ jiraEnabled: true, jiraUrl: `  ${url} ` })).toMatchObject({
      jiraEnabled: true,
      jiraUrl: url
    })
    expect(store.update({ jiraUrl: 'javascript:alert(1)//{key}' }).jiraUrl).toBe(url)
    expect(store.update({ jiraUrl: 'not a url' }).jiraUrl).toBe(url)
    expect(store.update({ jiraUrl: '' }).jiraUrl).toBe('')
  })

  it('does not let update() overwrite recent folders', () => {
    const store = new SettingsStore(file)
    store.addRecent('/a')
    expect(store.update({ recentFolders: ['/evil'] }).recentFolders).toEqual(['/a'])
  })

  it('keeps recent folders most-recent-first, deduplicated and capped', () => {
    const store = new SettingsStore(file, 'linux')
    for (let i = 0; i < MAX_RECENT + 5; i++) store.addRecent(`/p${i}`)
    store.addRecent('/p10')
    const recent = store.get().recentFolders
    expect(recent).toHaveLength(MAX_RECENT)
    expect(recent[0]).toBe('/p10')
    expect(recent.filter((f) => f === '/p10')).toHaveLength(1)
  })

  it('treats paths case-insensitively on Windows', () => {
    const store = new SettingsStore(file, 'win32')
    store.addRecent('C:\\Projects\\App')
    store.addRecent('c:\\projects\\app')
    expect(store.get().recentFolders).toEqual(['c:\\projects\\app'])
    store.removeRecent('C:\\PROJECTS\\APP')
    expect(store.get().recentFolders).toEqual([])
  })

  it('saves a color per folder', () => {
    new SettingsStore(file, 'linux').setFolderColor('/a', '#2563EB')
    expect(new SettingsStore(file, 'linux').get().folderColors).toEqual({ '/a': '#2563eb' })
  })

  it('removes a folder color when set to null', () => {
    const store = new SettingsStore(file, 'linux')
    store.setFolderColor('/a', '#2563eb')
    store.setFolderColor('/b', '#16a34a')
    expect(store.setFolderColor('/a', null).folderColors).toEqual({ '/b': '#16a34a' })
  })

  it('treats folder color paths case-insensitively on Windows', () => {
    const store = new SettingsStore(file, 'win32')
    store.setFolderColor('C:\\Projects\\App', '#111111')
    store.setFolderColor('c:\\projects\\app', '#222222')
    expect(store.get().folderColors).toEqual({ 'c:\\projects\\app': '#222222' })
    expect(store.setFolderColor('C:\\PROJECTS\\APP', null).folderColors).toEqual({})
  })

  it('ignores colors that are not #rrggbb', () => {
    const store = new SettingsStore(file, 'linux')
    store.setFolderColor('/a', '#2563eb')
    for (const bad of ['red', '#12345', 'url(x)', '#2563eb; color: red']) {
      expect(store.setFolderColor('/a', bad).folderColors).toEqual({ '/a': '#2563eb' })
    }
  })

  it('does not let update() overwrite folder colors', () => {
    const store = new SettingsStore(file, 'linux')
    store.setFolderColor('/a', '#111111')
    expect(store.update({ folderColors: { '/b': '#222222' } }).folderColors).toEqual({
      '/a': '#111111'
    })
  })

  it('drops invalid folder colors from the settings file', () => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({ folderColors: { '/a': '#ABCDEF', '/b': 'nope', '': '#111111', '/c': 5 } })
    )
    expect(new SettingsStore(file).get().folderColors).toEqual({ '/a': '#abcdef' })
  })

  it('saves a title per folder, trimmed, and clears it with null or a blank title', () => {
    const store = new SettingsStore(file, 'win32')
    store.setFolderTitle('C:\\Projects\\App', '  Frontend  ')
    store.setFolderTitle('C:\\Projects\\Api', 'Backend')
    expect(new SettingsStore(file, 'win32').get().folderTitles).toEqual({
      'C:\\Projects\\App': 'Frontend',
      'C:\\Projects\\Api': 'Backend'
    })
    expect(store.setFolderTitle('c:\\projects\\app', '   ').folderTitles).toEqual({
      'C:\\Projects\\Api': 'Backend'
    })
    expect(store.setFolderTitle('C:\\Projects\\Api', null).folderTitles).toEqual({})
  })

  it('cuts long folder titles and drops invalid ones from the settings file', () => {
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(
      file,
      JSON.stringify({ folderTitles: { '/a': 'x'.repeat(200), '/b': '  ', '/c': 5, '': 'y' } })
    )
    expect(new SettingsStore(file).get().folderTitles).toEqual({ '/a': 'x'.repeat(80) })
  })

  it('does not let update() overwrite folder titles', () => {
    const store = new SettingsStore(file, 'linux')
    store.setFolderTitle('/a', 'Mine')
    expect(store.update({ folderTitles: { '/b': 'Other' } }).folderTitles).toEqual({ '/a': 'Mine' })
  })

  it('notifies when a session needs you unless switched off', () => {
    const store = new SettingsStore(file, 'linux')
    expect(store.get().notifyWhenWaiting).toBe(true)
    store.update({ notifyWhenWaiting: 'no' })
    expect(store.get().notifyWhenWaiting).toBe(true)
    store.update({ notifyWhenWaiting: false })
    expect(new SettingsStore(file, 'linux').get().notifyWhenWaiting).toBe(false)
  })

  it('keeps sound choices, volume and reminder in range', () => {
    const store = new SettingsStore(file, 'linux')
    expect(store.get()).toMatchObject({
      finishedSound: 'chime',
      askingSound: 'rise',
      soundVolume: 70,
      reminderMinutes: 5
    })
    store.update({
      finishedSound: 'bell',
      askingSound: 'nope',
      soundVolume: 250,
      reminderMinutes: -3
    })
    expect(new SettingsStore(file, 'linux').get()).toMatchObject({
      finishedSound: 'bell',
      askingSound: 'rise',
      soundVolume: 100,
      reminderMinutes: 0
    })
  })

  it('mutes and unmutes folders, and update() leaves them alone', () => {
    const store = new SettingsStore(file, 'win32')
    store.setFolderMuted('C:\\Projects\\App', true)
    store.setFolderMuted('C:\\Projects\\Api', true)
    expect(store.setFolderMuted('c:\\projects\\app', false).mutedFolders).toEqual([
      'C:\\Projects\\Api'
    ])
    expect(store.update({ mutedFolders: [] }).mutedFolders).toEqual(['C:\\Projects\\Api'])
    expect(new SettingsStore(file, 'win32').get().mutedFolders).toEqual(['C:\\Projects\\Api'])
  })

  const TOKEN = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345'
  // Stands in for safeStorage: reversible, but not the token itself.
  const cipher: SecretCipher = {
    encrypt: (plain) => `x${Buffer.from(plain).toString('hex')}`,
    decrypt: (stored) => {
      if (!stored.startsWith('x')) throw new Error('not ours')
      return Buffer.from(stored.slice(1), 'hex').toString()
    }
  }

  it('takes a background picture only as a picture file by its full path', () => {
    const store = new SettingsStore(file)
    expect(store.get()).toMatchObject({
      terminalPicture: '',
      terminalPictureStrength: 25,
      terminalPictureFit: 'fill'
    })
    const picture = path.join(dir, 'sea view.JPG')
    expect(store.update({ terminalPicture: ` ${picture} ` }).terminalPicture).toBe(picture)
    expect(store.update({ terminalPicture: 'sea.png' }).terminalPicture).toBe(picture)
    expect(store.update({ terminalPicture: path.join(dir, 'run.exe') }).terminalPicture).toBe(
      picture
    )
    expect(store.update({ terminalPicture: '' }).terminalPicture).toBe('')
    expect(store.update({ terminalPictureStrength: 1 }).terminalPictureStrength).toBe(5)
    expect(store.update({ terminalPictureStrength: 250 }).terminalPictureStrength).toBe(100)
    expect(store.update({ terminalPictureFit: 'tile' }).terminalPictureFit).toBe('tile')
    expect(store.update({ terminalPictureFit: 'zoom' }).terminalPictureFit).toBe('tile')
  })

  it('keeps Telegram off until switched on, and only a usable token and chat ID', () => {
    const store = new SettingsStore(file, 'linux')
    expect(store.get()).toMatchObject({
      telegramEnabled: false,
      telegramBotToken: '',
      telegramChatId: '',
      telegramAwayMinutes: 5,
      telegramRemote: false
    })
    expect(store.update({ telegramRemote: 'yes' }).telegramRemote).toBe(false)
    expect(store.update({ telegramRemote: true }).telegramRemote).toBe(true)
    const s = store.update({
      telegramEnabled: true,
      telegramBotToken: ` ${TOKEN} `,
      telegramChatId: ' -1001234567890 ',
      telegramAwayMinutes: 500
    })
    expect(s).toMatchObject({
      telegramEnabled: true,
      telegramBotToken: TOKEN,
      telegramChatId: '-1001234567890',
      telegramAwayMinutes: MAX_AWAY_MINUTES
    })
    // A token goes into the Bot API's URL path: nothing else gets in.
    expect(store.update({ telegramBotToken: '123:abc/../x' }).telegramBotToken).toBe(TOKEN)
    expect(store.update({ telegramChatId: 'my chat' }).telegramChatId).toBe('-1001234567890')
    expect(store.update({ telegramChatId: '@my_channel' }).telegramChatId).toBe('@my_channel')
    expect(store.update({ telegramAwayMinutes: 0 }).telegramAwayMinutes).toBe(0)
    expect(store.update({ telegramAwayMinutes: -5 }).telegramAwayMinutes).toBe(TELEGRAM_ALWAYS)
    expect(store.update({ telegramBotToken: '', telegramChatId: '' })).toMatchObject({
      telegramBotToken: '',
      telegramChatId: ''
    })
  })

  it('encrypts the bot token in the settings file', () => {
    new SettingsStore(file, 'linux', cipher).update({ telegramBotToken: TOKEN })
    const onDisk = readFileSync(file, 'utf8')
    expect(onDisk).not.toContain(TOKEN)
    expect(JSON.parse(onDisk).telegramBotToken).toMatch(/^enc:x/)
    expect(new SettingsStore(file, 'linux', cipher).get().telegramBotToken).toBe(TOKEN)
  })

  it('leaves no token in the file without one, and keeps it plain without a cipher', () => {
    new SettingsStore(file, 'linux', cipher).update({ fontSize: 15 })
    expect(JSON.parse(readFileSync(file, 'utf8')).telegramBotToken).toBe('')

    new SettingsStore(file, 'linux').update({ telegramBotToken: TOKEN })
    expect(JSON.parse(readFileSync(file, 'utf8')).telegramBotToken).toBe(TOKEN)
    // A plain token from before still loads when encryption becomes available.
    expect(new SettingsStore(file, 'linux', cipher).get().telegramBotToken).toBe(TOKEN)
  })

  it("drops a token that can't be decrypted, keeping the other settings", () => {
    mkdirSync(path.dirname(file), { recursive: true })
    const encrypted = { fontSize: 18, telegramBotToken: 'enc:garbage' }
    writeFileSync(file, JSON.stringify(encrypted))
    expect(new SettingsStore(file, 'linux', cipher).get()).toMatchObject({
      fontSize: 18,
      telegramBotToken: ''
    })
    // Encrypted elsewhere, and no way to decrypt here.
    expect(new SettingsStore(file, 'linux').get().telegramBotToken).toBe('')
  })

  it('recovers from a corrupt settings file', () => {
    const store = new SettingsStore(file)
    store.update({ fontSize: 20 })
    writeFileSync(file, '{ not json')
    expect(new SettingsStore(file).get()).toEqual(DEFAULT_SETTINGS)
  })

  it('writes readable JSON', () => {
    new SettingsStore(file).update({ fontSize: 16 })
    expect(JSON.parse(readFileSync(file, 'utf8')).fontSize).toBe(16)
  })
})
