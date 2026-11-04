import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isProgram, resolveFileLink, type FileLinkDeps } from '../../src/main/fileLinks'

const file = { dir: false, mode: 0o100644 }

describe('isProgram', () => {
  const win = (name: string): boolean => isProgram(name, file, 'win32', '.COM;.EXE;.XYZ')

  it('takes programs and scripts on Windows for programs, PATHEXT included', () => {
    for (const name of ['setup.exe', 'run.BAT', 'x.cmd', 'a.ps1', 'b.js', 'c.vbs', 'd.msi']) {
      expect(win(name)).toBe(true)
    }
    expect(win('e.lnk')).toBe(true)
    expect(win('tool.xyz')).toBe(true)
    for (const name of [
      'head.png',
      'README.md',
      'store.ts',
      'page.html',
      'data.json',
      'Makefile'
    ]) {
      expect(win(name)).toBe(false)
    }
  })

  it('takes anything executable on macOS and Linux for a program, and app bundles', () => {
    expect(isProgram('build', { dir: false, mode: 0o100755 }, 'linux')).toBe(true)
    expect(isProgram('notes.txt', file, 'linux')).toBe(false)
    expect(isProgram('src', { dir: true, mode: 0o40755 }, 'linux')).toBe(false)
    expect(isProgram('Mail.app', { dir: true, mode: 0o40755 }, 'darwin')).toBe(true)
    expect(isProgram('install.command', file, 'darwin')).toBe(true)
    expect(isProgram('app.desktop', file, 'linux')).toBe(true)
  })
})

describe('resolveFileLink', () => {
  let dir: string
  let deps: FileLinkDeps

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'claude-helper-links-'))
    mkdirSync(path.join(dir, 'notes'))
    writeFileSync(path.join(dir, 'notes', 'todo.md'), '')
    writeFileSync(path.join(dir, 'run.cmd'), '')
    deps = { platform: 'win32', homedir: dir, pathext: '' }
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('finds a path relative to the folder, absolute or under ~', async () => {
    const todo = path.join(dir, 'notes', 'todo.md')
    expect(await resolveFileLink(dir, 'notes/todo.md', deps)).toEqual({ path: todo, kind: 'file' })
    expect(await resolveFileLink('/elsewhere', todo, deps)).toEqual({ path: todo, kind: 'file' })
    expect(await resolveFileLink('/elsewhere', '~/notes/todo.md', deps)).toEqual({
      path: todo,
      kind: 'file'
    })
  })

  it('tells folders and programs apart, and ignores what is not there', async () => {
    expect(await resolveFileLink(dir, './notes/', deps)).toMatchObject({ kind: 'folder' })
    expect(await resolveFileLink(dir, 'run.cmd', deps)).toMatchObject({ kind: 'program' })
    expect(await resolveFileLink(dir, 'notes/missing.md', deps)).toBeNull()
    expect(await resolveFileLink(dir, 'e.g', deps)).toBeNull()
  })
})
