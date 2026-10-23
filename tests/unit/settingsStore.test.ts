import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, MAX_RECENT, SettingsStore } from '../../src/main/settingsStore'

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
