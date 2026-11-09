import { execFileSync } from 'child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { listItems, saveItem } from '../../src/main/claudeConfig'
import {
  checkMarketplaceRequest,
  checkMcpSave,
  checkMemoryRef,
  checkSettingsPatch
} from '../../src/main/claudeConfigChecks'
import {
  globalConfigFile,
  listMcp,
  parseMcpStatus,
  saveMcp,
  sameFolder
} from '../../src/main/claudeMcp'
import { listMemory, memoryPath, saveMemory } from '../../src/main/claudeMemory'
import {
  claudeRunner,
  cmdLine,
  marketplaceArgs,
  parseMarketplaces,
  runMarketplaceAction,
  type RunClaude,
  type RunResult
} from '../../src/main/claudePlugins'
import {
  keybindingsProblem,
  patchSettings,
  readKeybindings,
  readSettingsFile,
  saveKeybindings
} from '../../src/main/claudeSettings'
import { describe as describeItem } from '../../src/shared/frontmatter'

let dir: string
let user: string
let folder: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'claude-config-more-'))
  user = path.join(dir, 'home', '.claude')
  folder = path.join(dir, 'my project')
  mkdirSync(user, { recursive: true })
  mkdirSync(folder, { recursive: true })
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (file: string, text: string): void => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}
const read = (file: string): string => readFileSync(file, 'utf8')

function fake(...answers: Partial<RunResult>[]): RunClaude & { calls: string[][] } {
  const calls: string[][] = []
  const run: RunClaude = async (args) => {
    calls.push(args)
    return { code: 0, stdout: '', stderr: '', ...answers.shift() }
  }
  return Object.assign(run, { calls })
}

describe('commands and output styles', () => {
  it('lists commands in subfolders, describing one by its first line when it has no frontmatter', async () => {
    write(path.join(user, 'commands', 'fix.md'), '# Fix the issue\n\nFix $ARGUMENTS.')
    write(path.join(user, 'commands', 'team', 'deploy.md'), '---\ndescription: Deploys\n---\nGo')
    const items = await listItems('command', 'user', user)
    expect(items.map((i) => [i.name, i.description, i.problem])).toEqual([
      ['fix', 'Fix the issue', undefined],
      ['team/deploy', 'Deploys', undefined]
    ])
  })

  it('creates one in a subfolder, but not with a bad folder name', async () => {
    const ref = { kind: 'command' as const, scope: 'user' as const, name: 'team/review' }
    expect(await saveItem(ref, user, 'x')).toEqual({ ok: true })
    expect(read(path.join(user, 'commands', 'team', 'review.md'))).toBe('x')
    expect(await saveItem({ ...ref, name: 'Team/review' }, user, 'x')).toMatchObject({ ok: false })
    const style = { kind: 'outputStyle' as const, scope: 'user' as const, name: 'a/b' }
    expect(await saveItem(style, user, 'x')).toMatchObject({ ok: false })
  })

  it('tells an output style by the name in its frontmatter', async () => {
    write(
      path.join(user, 'output-styles', 'teacher.md'),
      '---\nname: Teacher\ndescription: Explains\n---\n'
    )
    expect((await listItems('outputStyle', 'user', user))[0]).toMatchObject({
      name: 'teacher',
      title: 'Teacher',
      description: 'Explains'
    })
    expect(describeItem('no frontmatter', false)).toEqual({ description: 'no frontmatter' })
  })
})

describe('memory files', () => {
  const places = (): { userDir: string; folder: string } => ({ userDir: user, folder })

  it('lists the CLAUDE.md files there or not, and the rules and notes there are', async () => {
    write(path.join(user, 'rules', 'style', 'tabs.md'), 'tabs')
    write(path.join(folder, 'CLAUDE.md'), 'project')
    write(path.join(folder, '.claude', 'rules', 'tests.md'), 'tests')
    const notes = path.join(user, 'projects', folder.replace(/[^a-zA-Z0-9]/g, '-'), 'memory')
    write(path.join(notes, 'MEMORY.md'), '- [x](x.md)')
    const files = await listMemory(places())
    expect(files.map((f) => [f.area, f.name, f.exists])).toEqual([
      ['user', undefined, false],
      ['userRule', 'style/tabs', true],
      ['project', undefined, true],
      ['local', undefined, false],
      ['projectRule', 'tests', true],
      ['note', 'MEMORY', true]
    ])
    expect(files[5].path).toBe(path.join(notes, 'MEMORY.md'))
    expect(await listMemory({ userDir: user })).toHaveLength(2)
  })

  it('creates a file, refuses one changed meanwhile, and renames a rule', async () => {
    const claude = { area: 'local' as const, folder }
    expect(await saveMemory(claude, places(), 'mine', null)).toEqual({ ok: true })
    expect(read(path.join(folder, 'CLAUDE.local.md'))).toBe('mine')
    expect(await saveMemory(claude, places(), 'again', null)).toMatchObject({
      ok: false,
      error: /changed outside/
    })
    expect(await saveMemory(claude, places(), 'again', 'mine')).toEqual({ ok: true })

    const rule = { area: 'projectRule' as const, folder, name: 'tests' }
    expect(await saveMemory(rule, places(), 'a', null)).toEqual({ ok: true })
    expect(await saveMemory(rule, places(), 'b', null)).toMatchObject({ ok: false })
    const renamed = { ...rule, name: 'testing' }
    expect(await saveMemory(renamed, places(), 'c', 'a', 'tests')).toEqual({ ok: true })
    expect(read(path.join(folder, '.claude', 'rules', 'testing.md'))).toBe('c')
  })

  it('points nowhere for names that climb out, or project files without a folder', () => {
    expect(memoryPath({ area: 'userRule', name: '../settings' }, places())).toBeNull()
    expect(memoryPath({ area: 'note', name: 'a/b' }, places())).toBeNull()
    expect(memoryPath({ area: 'project' }, { userDir: user })).toBeNull()
    expect(checkMemoryRef({ area: 'project' })).toBeNull()
    expect(checkMemoryRef({ area: 'user', folder })).toEqual({ area: 'user' })
    expect(checkMemoryRef({ area: 'projectRule', folder, name: 'x' })).toEqual({
      area: 'projectRule',
      folder,
      name: 'x'
    })
  })
})

describe('settings files', () => {
  const file = (): string => path.join(user, 'settings.json')

  it('reads only the settings it edits', async () => {
    write(file(), JSON.stringify({ model: 'opus', hooks: {}, permissions: { allow: ['Read'] } }))
    expect(await readSettingsFile('user', file())).toEqual({
      scope: 'user',
      path: file(),
      values: { model: 'opus', permissions: { allow: ['Read'] } }
    })
  })

  it('sets and removes settings, keeping the rest, unless they changed meanwhile', async () => {
    write(file(), JSON.stringify({ model: 'opus', theme: 'dark' }))
    expect(
      await patchSettings(file(), { model: null, env: { A: '1' } }, { model: 'opus', env: null })
    ).toEqual({ ok: true })
    expect(JSON.parse(read(file()))).toEqual({ theme: 'dark', env: { A: '1' } })
    expect(await patchSettings(file(), { env: null }, { env: { A: '2' } })).toMatchObject({
      ok: false,
      error: /changed outside/
    })
  })

  it('takes only settings it knows, in their shapes', () => {
    const patch = (set: object): unknown => checkSettingsPatch({ scope: 'user', set, before: {} })
    expect(patch({ model: ' opus ' })).toMatchObject({ set: { model: 'opus' } })
    expect(patch({ theme: 'dark' })).toBeNull()
    expect(patch({ env: { 'BAD NAME': 'x' } })).toBeNull()
    expect(patch({ permissions: { allow: ['Bash(npm *)'], defaultMode: 'plan' } })).toBeTruthy()
    expect(patch({ permissions: { allow: 'Bash' } })).toBeNull()
    expect(patch({ permissions: { defaultMode: 'yolo' } })).toBeNull()
    expect(patch({ statusLine: { type: 'command', command: '' } })).toBeNull()
    expect(patch({ statusLine: null })).toMatchObject({ set: { statusLine: null } })
    expect(checkSettingsPatch({ scope: 'local', set: { model: 'x' }, before: {} })).toBeNull()
  })
})

describe('keybindings', () => {
  const file = (): string => path.join(user, 'keybindings.json')
  const good = JSON.stringify({ bindings: [{ context: 'Chat', bindings: { 'ctrl+e': null } }] })

  it('reads none, saves, and refuses a file changed meanwhile', async () => {
    expect(await readKeybindings(file())).toEqual({ path: file(), text: null })
    expect(await saveKeybindings(file(), good, null)).toEqual({ ok: true })
    expect((await readKeybindings(file())).text).toBe(good + '\n')
    expect(await saveKeybindings(file(), good, null)).toMatchObject({ ok: false })
  })

  it('says what is wrong with a file', () => {
    expect(keybindingsProblem(good)).toBeNull()
    expect(keybindingsProblem('{')).toBeTruthy()
    expect(keybindingsProblem('{}')).toMatch(/bindings/)
    expect(keybindingsProblem('{"bindings":[{"context":"Chat","bindings":{"x":1}}]}')).toMatch(
      /name or null/
    )
  })
})

describe('MCP servers', () => {
  it("reads yours, this folder's own in ~/.claude.json, and the shared .mcp.json", async () => {
    const global = path.join(dir, 'home', '.claude.json')
    write(
      global,
      JSON.stringify({
        mcpServers: { web: { type: 'http', url: 'https://x' } },
        projects: {
          [folder.replace(/\\/g, '/')]: { mcpServers: { db: { command: 'db-mcp' } } },
          '/elsewhere': { mcpServers: { other: { command: 'x' } } }
        }
      })
    )
    write(path.join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { gh: { command: 'gh' } } }))
    const list = await listMcp(global, folder, process.platform)
    expect(list.servers.map((s) => [s.scope, s.name])).toEqual([
      ['user', 'web'],
      ['local', 'db'],
      ['project', 'gh']
    ])
    expect(list.files.project).toBe(path.join(folder, '.mcp.json'))
  })

  it('finds ~/.claude.json, and folders written with either slash', () => {
    expect(globalConfigFile({}, '/home/me')).toBe(path.join('/home/me', '.claude.json'))
    expect(globalConfigFile({ CLAUDE_CONFIG_DIR: '/cfg' }, '/home/me')).toBe(
      path.join('/cfg', '.claude.json')
    )
    expect(sameFolder('C:\\Work\\App', 'c:/work/app/', 'win32')).toBe(true)
    expect(sameFolder('/work/App', '/work/app', 'linux')).toBe(false)
  })

  it('adds, changes in place (putting the old one back if that fails), and moves', async () => {
    const config = { type: 'stdio', command: 'npx', args: ['-y', 'x'] }
    const req = { scope: 'local' as const, name: 'x', config, folder }
    let run = fake()
    expect(await saveMcp(run, folder, req)).toEqual({ ok: true })
    expect(run.calls[0]).toEqual([
      'mcp',
      'add-json',
      'x',
      JSON.stringify(config),
      '--scope',
      'local'
    ])

    run = fake({}, { code: 1, stderr: 'bad' }, {})
    const original = { name: 'x', scope: 'local' as const }
    expect(await saveMcp(run, folder, { ...req, original }, { command: 'old' })).toEqual({
      ok: false,
      error: 'bad'
    })
    expect(run.calls.map((c) => c[1])).toEqual(['remove', 'add-json', 'add-json'])
    expect(run.calls[2][3]).toBe('{"command":"old"}')

    run = fake()
    await saveMcp(run, folder, { ...req, scope: 'user', original }, { command: 'old' })
    expect(run.calls.map((c) => [c[1], c[c.length - 1]])).toEqual([
      ['add-json', 'user'],
      ['remove', 'local']
    ])
  })

  it('takes servers with a command or URL, and a folder for the folder scopes', () => {
    const ok = { scope: 'user', name: 'web', config: { url: 'https://x' } }
    expect(checkMcpSave(ok)).toMatchObject({ name: 'web' })
    expect(checkMcpSave({ ...ok, config: { type: 'http' } })).toBeNull()
    expect(checkMcpSave({ ...ok, name: 'bad name' })).toBeNull()
    expect(checkMcpSave({ ...ok, scope: 'project' })).toBeNull()
    expect(checkMcpSave({ ...ok, scope: 'project', folder })).toMatchObject({ folder })
  })
})

describe('marketplaces', () => {
  it('reads the list, with a page for GitHub ones', () => {
    const list = parseMarketplaces(
      JSON.stringify([
        { name: 'official', source: 'github', repo: 'anthropics/x', installLocation: 'C:\\m' },
        { name: 'ours', source: 'url', url: 'https://git.example.com/p.git' },
        { name: 'local', source: 'directory', path: 'C:\\plugins' }
      ])
    )
    expect(list).toEqual({
      ok: true,
      items: [
        {
          name: 'official',
          source: 'anthropics/x',
          installLocation: 'C:\\m',
          url: 'https://github.com/anthropics/x'
        },
        { name: 'ours', source: 'https://git.example.com/p.git', url: 'https://git.example.com/p' },
        { name: 'local', source: 'C:\\plugins' }
      ]
    })
  })

  it('adds with a scope, removes and updates by name', async () => {
    expect(marketplaceArgs({ action: 'add', target: 'a/b', scope: 'project' })).toEqual([
      'plugin',
      'marketplace',
      'add',
      'a/b',
      '--json',
      '--scope',
      'project'
    ])
    expect(marketplaceArgs({ action: 'update', target: 'm' })).toEqual([
      'plugin',
      'marketplace',
      'update',
      'm',
      '--json'
    ])
    const run = fake(
      { stdout: '{"outcome":"ok","message":"Added"}' },
      { code: 1, stdout: '{"outcome":"failed","message":"Not found"}' }
    )
    expect(await runMarketplaceAction(run, { action: 'add', target: 'a/b' }, dir)).toEqual({
      ok: true,
      message: 'Added'
    })
    expect(await runMarketplaceAction(run, { action: 'remove', target: 'x' }, dir)).toEqual({
      ok: false,
      error: 'Not found'
    })
  })

  it('takes sources that are one plain line, and names for the rest', () => {
    expect(checkMarketplaceRequest({ action: 'add', target: 'C:\\my plugins' })).toBeTruthy()
    expect(checkMarketplaceRequest({ action: 'add', target: '--help' })).toBeNull()
    expect(checkMarketplaceRequest({ action: 'add', target: 'a"b' })).toBeNull()
    expect(checkMarketplaceRequest({ action: 'remove', target: 'a/b' })).toBeNull()
    expect(checkMarketplaceRequest({ action: 'add', target: 'a/b', scope: 'local' })).toBeNull()
  })
})

describe('running a .cmd shim', () => {
  it('escapes what cmd.exe would change, twice: the shim reads its arguments again', () => {
    const line = cmdLine('C:\\Program Files\\npm\\claude.cmd', ['a b', 'a&b'])
    expect(line).toBe('"C:\\Program^ Files\\npm\\claude.cmd ^^^"a^^^ b^^^" ^^^"a^^^&b^^^""')
  })

  it.runIf(process.platform === 'win32')(
    'hands JSON, spaces and special characters to the program as they are',
    async () => {
      const echo = path.join(dir, 'echo.js')
      writeFileSync(echo, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
      const shim = path.join(dir, 'my claude.cmd')
      writeFileSync(shim, `@"${process.execPath}" "%~dp0echo.js" %*\r\n`)
      const args = ['mcp', '{"a":"b & c","d":"100%"}', 'with space', 'a^b', '"quoted"', 'x\\']
      const res = await claudeRunner(
        shim,
        process.env,
        'win32'
      )(args, {
        cwd: dir,
        timeoutMs: 20_000
      })
      expect(JSON.parse(res.stdout)).toEqual(args)
      // execFileSync is here only to show node itself is runnable in this environment.
      expect(execFileSync(process.execPath, ['-e', 'process.stdout.write("1")']).toString()).toBe(
        '1'
      )
    }
  )
})

describe('claude mcp list', () => {
  it('reads each server, where it comes from and how it is', () => {
    const out = [
      'Checking MCP server health…',
      '',
      'claude.ai Gmail: https://gmailmcp.googleapis.com/mcp/v1 - ✔ Connected',
      'claude.ai Slack: https://mcp.slack.com/mcp - ! Needs authentication',
      'plugin:context7:context7: https://mcp.context7.com/mcp?client=claude-code-plugin (HTTP) - ✔ Connected',
      'plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected',
      'db: node db-mcp.js --mode a - b - ✘ Failed to connect',
      'shared: npx shared-mcp - ⏸ Pending approval',
      '\u001b[32mweb\u001b[0m: https://x.dev/mcp (HTTP) - ✔ Connected'
    ].join('\n')
    expect(parseMcpStatus(out)).toEqual([
      {
        name: 'claude.ai Gmail',
        source: 'claude.ai',
        target: 'https://gmailmcp.googleapis.com/mcp/v1',
        state: 'connected',
        text: 'Connected'
      },
      {
        name: 'claude.ai Slack',
        source: 'claude.ai',
        target: 'https://mcp.slack.com/mcp',
        state: 'auth',
        text: 'Needs authentication'
      },
      {
        name: 'plugin:context7:context7',
        source: 'plugin',
        target: 'https://mcp.context7.com/mcp?client=claude-code-plugin',
        state: 'connected',
        text: 'Connected'
      },
      {
        name: 'plugin:playwright:playwright',
        source: 'plugin',
        target: 'npx @playwright/mcp@latest',
        state: 'connected',
        text: 'Connected'
      },
      {
        name: 'db',
        source: 'config',
        target: 'node db-mcp.js --mode a - b',
        state: 'failed',
        text: 'Failed to connect'
      },
      {
        name: 'shared',
        source: 'config',
        target: 'npx shared-mcp',
        state: 'pending',
        text: 'Pending approval'
      },
      {
        name: 'web',
        source: 'config',
        target: 'https://x.dev/mcp',
        state: 'connected',
        text: 'Connected'
      }
    ])
  })
})
