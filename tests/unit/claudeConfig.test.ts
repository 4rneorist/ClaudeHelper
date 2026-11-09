import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  deleteHook,
  deleteItem,
  hooksFile,
  isItemName,
  listHookFile,
  listItems,
  readItem,
  saveHook,
  saveItem
} from '../../src/main/claudeConfig'
import type { HookEntry } from '../../src/shared/claudeConfig'

let dir: string
let root: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'claude-config-'))
  root = path.join(dir, '.claude')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  const file = path.join(root, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}

describe('skills and agents', () => {
  it('lists skills with SKILL.md, leaving out claude.ai synced ones', async () => {
    write('skills/review/SKILL.md', '---\nname: review\ndescription: Reviews code\n---\nBody')
    write('skills/broken/SKILL.md', '# no frontmatter')
    write('skills/empty-folder/notes.md', 'not a skill')
    write('skills/synced/abc/SKILL.md', '---\ndescription: synced\n---\n')
    const items = await listItems('skill', 'user', root)
    expect(items.map((i) => [i.name, i.description, i.problem])).toEqual([
      ['broken', '', 'No frontmatter (the --- block at the top)'],
      ['review', 'Reviews code', undefined]
    ])
    expect(items[1].path).toBe(path.join(root, 'skills', 'review', 'SKILL.md'))
  })

  it('lists agents in subfolders too, with the project folder on project ones', async () => {
    write('agents/reviewer.md', '---\nname: reviewer\ndescription: Reviews\n---\n')
    write('agents/team/tester.md', '---\nname: tester\ndescription: Tests\n---\n')
    write('agents/readme.txt', 'not an agent')
    const items = await listItems('agent', 'project', root, dir)
    expect(items.map((i) => i.name)).toEqual(['reviewer', 'team/tester'])
    expect(items[0]).toMatchObject({ scope: 'project', folder: dir })
  })

  it('creates one, refusing a taken or invalid name', async () => {
    const ref = { kind: 'skill' as const, scope: 'user' as const, name: 'notes' }
    expect(await saveItem(ref, root, 'one')).toEqual({ ok: true })
    expect(await readItem('skill', root, 'notes')).toBe('one')
    expect(await saveItem(ref, root, 'two')).toMatchObject({ ok: false, error: /already/ })
    expect(await saveItem({ ...ref, name: 'Bad Name' }, root, 'x')).toMatchObject({ ok: false })
    expect(await readItem('skill', root, 'notes')).toBe('one')
  })

  it('renames with its folder, keeping the files next to SKILL.md', async () => {
    write('skills/old/SKILL.md', 'text')
    write('skills/old/scripts/run.sh', 'echo')
    const ref = { kind: 'skill' as const, scope: 'user' as const, name: 'new-name' }
    expect(await saveItem(ref, root, 'changed', 'old')).toEqual({ ok: true })
    expect(existsSync(path.join(root, 'skills', 'old'))).toBe(false)
    expect(readFileSync(path.join(root, 'skills', 'new-name', 'scripts', 'run.sh'), 'utf8')).toBe(
      'echo'
    )
    expect(await readItem('skill', root, 'new-name')).toBe('changed')
  })

  it('changes an agent in place, and reads it with plain line ends', async () => {
    write('agents/team/tester.md', 'a\r\nb')
    expect(await readItem('agent', root, 'team/tester')).toBe('a\nb')
    const ref = { kind: 'agent' as const, scope: 'user' as const, name: 'team/tester' }
    expect(await saveItem(ref, root, 'c', 'team/tester')).toEqual({ ok: true })
    expect(readFileSync(path.join(root, 'agents', 'team', 'tester.md'), 'utf8')).toBe('c')
  })

  it('moves a skill folder or an agent file to the trash', async () => {
    write('skills/gone/SKILL.md', 'x')
    write('agents/old.md', 'x')
    const trashed: string[] = []
    const trash = async (p: string): Promise<void> => {
      trashed.push(p)
      rmSync(p, { recursive: true })
    }
    expect(await deleteItem('skill', root, 'gone', trash)).toEqual({ ok: true })
    expect(await deleteItem('agent', root, 'old', trash)).toEqual({ ok: true })
    expect(trashed).toEqual([
      path.join(root, 'skills', 'gone'),
      path.join(root, 'agents', 'old.md')
    ])
    expect(await deleteItem('agent', root, 'old', trash)).toMatchObject({ ok: false })
  })

  it('accepts only names that stay in their folder', () => {
    expect(isItemName('skill', 'review')).toBe(true)
    expect(isItemName('agent', 'team/tester')).toBe(true)
    for (const bad of ['..', '../x', 'a\\b', 'a/b', '', 'x.', ' x', 'a:b', 'C:']) {
      expect(isItemName('skill', bad)).toBe(false)
    }
    expect(isItemName('agent', 'a/../b')).toBe(false)
    expect(isItemName('agent', 'a/b/c/d')).toBe(false)
  })
})

describe('hooks', () => {
  const places = (): { userDir: string; folder: string } => ({ userDir: root, folder: dir })
  const settings = (): string => hooksFile('user', places())!
  const local = (): string => hooksFile('local', places())!
  const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8'))
  const command = (c: string): { type: string; command: string } => ({
    type: 'command',
    command: c
  })

  const SETTINGS = {
    model: 'opus',
    hooks: {
      PreToolUse: [
        { matcher: 'Bash', hooks: [command('guard'), command('log')] },
        { matcher: 'Edit|Write', hooks: [command('fmt')] }
      ],
      Stop: [{ hooks: [command('beep')] }]
    }
  }

  const entry = async (file: string, c: string): Promise<HookEntry> => {
    const listed = await listHookFile('user', file)
    return listed.hooks.find((h) => h.handler.command === c)!
  }

  it('knows where each scope keeps them', () => {
    expect(hooksFile('user', places())).toBe(path.join(root, 'settings.json'))
    expect(hooksFile('project', places())).toBe(path.join(dir, '.claude', 'settings.json'))
    expect(hooksFile('local', places())).toBe(path.join(dir, '.claude', 'settings.local.json'))
    expect(hooksFile('local', { userDir: root })).toBeNull()
  })

  it('lists every handler with where it is', async () => {
    write('settings.json', JSON.stringify(SETTINGS))
    const listed = await listHookFile('user', settings())
    expect(
      listed.hooks.map((h) => [h.event, h.matcher, h.group, h.index, h.handler.command])
    ).toEqual([
      ['PreToolUse', 'Bash', 0, 0, 'guard'],
      ['PreToolUse', 'Bash', 0, 1, 'log'],
      ['PreToolUse', 'Edit|Write', 1, 0, 'fmt'],
      ['Stop', '', 0, 0, 'beep']
    ])
  })

  it("leaves a file it can't read alone", async () => {
    write('settings.json', '{ broken')
    const listed = await listHookFile('user', settings())
    expect(listed.error).toBeTruthy()
    expect(
      await saveHook(settings(), { event: 'Stop', matcher: '', handler: command('x') })
    ).toMatchObject({
      ok: false
    })
    expect(readFileSync(settings(), 'utf8')).toBe('{ broken')
  })

  it('adds a new hook to the group with its matcher, creating the file if needed', async () => {
    expect(
      await saveHook(local(), { event: 'Stop', matcher: '', handler: command('one') })
    ).toEqual({ ok: true })
    expect(json(local())).toEqual({ hooks: { Stop: [{ hooks: [command('one')] }] } })
    write('settings.json', JSON.stringify(SETTINGS))
    await saveHook(settings(), { event: 'PreToolUse', matcher: 'Bash', handler: command('new') })
    const data = json(settings()) as typeof SETTINGS
    expect(data.hooks.PreToolUse[0].hooks.map((h) => h.command)).toEqual(['guard', 'log', 'new'])
    expect(data.model).toBe('opus')
  })

  it('changes a hook where it is, or moves it to another event or file', async () => {
    write('settings.json', JSON.stringify(SETTINGS))
    const log = await entry(settings(), 'log')
    await saveHook(
      settings(),
      { event: 'PreToolUse', matcher: 'Bash', handler: command('log2') },
      { file: settings(), entry: log }
    )
    let data = json(settings()) as typeof SETTINGS
    expect(data.hooks.PreToolUse[0].hooks.map((h) => h.command)).toEqual(['guard', 'log2'])

    const fmt = await entry(settings(), 'fmt')
    await saveHook(
      settings(),
      { event: 'PostToolUse', matcher: 'Edit', handler: command('fmt') },
      { file: settings(), entry: fmt }
    )
    data = json(settings()) as typeof SETTINGS
    expect(data.hooks.PreToolUse).toHaveLength(1)
    expect(data.hooks).toMatchObject({
      PostToolUse: [{ matcher: 'Edit', hooks: [command('fmt')] }]
    })

    const beep = await entry(settings(), 'beep')
    await saveHook(
      local(),
      { event: 'Stop', matcher: '', handler: command('beep') },
      { file: settings(), entry: beep }
    )
    expect(json(settings()).hooks).not.toHaveProperty('Stop')
    expect(json(local())).toEqual({ hooks: { Stop: [{ hooks: [command('beep')] }] } })
  })

  it('refuses to change or delete a hook that was changed meanwhile', async () => {
    write('settings.json', JSON.stringify(SETTINGS))
    const guard = await entry(settings(), 'guard')
    const changed = structuredClone(SETTINGS)
    changed.hooks.PreToolUse[0].hooks[0] = command('someone else')
    write('settings.json', JSON.stringify(changed))
    const res = await saveHook(
      settings(),
      { event: 'PreToolUse', matcher: 'Bash', handler: command('mine') },
      { file: settings(), entry: guard }
    )
    expect(res).toMatchObject({ ok: false, error: /changed outside/ })
    expect(await deleteHook(settings(), guard)).toMatchObject({ ok: false })
  })

  it('deletes a hook and the groups and events it leaves empty', async () => {
    write(
      'settings.json',
      JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [command('beep')] }] } })
    )
    expect(await deleteHook(settings(), await entry(settings(), 'beep'))).toEqual({ ok: true })
    expect(json(settings())).toEqual({ model: 'opus' })
  })
})
