import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  lastJson,
  listPlugins,
  parsePluginList,
  pluginArgs,
  runPluginAction,
  type RunClaude,
  type RunResult
} from '../../src/main/claudePlugins'
import {
  checkFolder,
  checkHookChange,
  checkItemRef,
  checkPluginRequest,
  checkSaveItem
} from '../../src/main/claudeConfigChecks'

/** A fake `claude` that answers with what it is given, and remembers how it was asked. */
function fake(
  ...answers: Partial<RunResult>[]
): RunClaude & { calls: { args: string[]; cwd: string }[] } {
  const calls: { args: string[]; cwd: string }[] = []
  const run: RunClaude = async (args, { cwd }) => {
    calls.push({ args, cwd })
    return { code: 0, stdout: '', stderr: '', ...answers.shift() }
  }
  return Object.assign(run, { calls })
}

const LIST = {
  installed: [
    {
      id: 'context7@official',
      version: 'a1ec',
      scope: 'user',
      enabled: true,
      installPath: 'C:\\x',
      mcpServers: { context7: { type: 'http' } }
    },
    {
      id: 'mine@local',
      scope: 'project',
      enabled: false,
      projectPath: 'C:\\work\\app',
      errors: ['Marketplace local not found']
    },
    { scope: 'user' }
  ],
  available: [
    {
      pluginId: 'context7@official',
      name: 'context7',
      description: 'Docs',
      marketplaceName: 'official',
      source: { source: 'url', url: 'https://github.com/upstash/context7.git' },
      installCount: 1234
    },
    {
      pluginId: 'gh@official',
      name: 'gh',
      description: 'GitHub',
      marketplaceName: 'official',
      source: { source: 'github', repo: 'cli/gh-plugin' }
    },
    { pluginId: 'local@official', source: './plugins/local', homepage: 'javascript:alert(1)' }
  ]
}

describe('parsePluginList', () => {
  it('reads installs and what the marketplaces offer, dropping what it cannot use', () => {
    const list = parsePluginList(JSON.stringify(LIST))
    expect(list).toEqual({
      ok: true,
      installed: [
        {
          id: 'context7@official',
          version: 'a1ec',
          scope: 'user',
          enabled: true,
          errors: [],
          mcpServers: ['context7']
        },
        {
          id: 'mine@local',
          scope: 'project',
          enabled: false,
          projectPath: 'C:\\work\\app',
          errors: ['Marketplace local not found'],
          mcpServers: []
        }
      ],
      available: [
        {
          id: 'context7@official',
          name: 'context7',
          description: 'Docs',
          marketplace: 'official',
          installCount: 1234,
          url: 'https://github.com/upstash/context7'
        },
        {
          id: 'gh@official',
          name: 'gh',
          description: 'GitHub',
          marketplace: 'official',
          url: 'https://github.com/cli/gh-plugin'
        },
        { id: 'local@official', name: 'local', description: '', marketplace: 'official' }
      ]
    })
  })

  it('takes a plain list of installs too, and says when it is not JSON', () => {
    expect(parsePluginList('[]')).toEqual({ ok: true, installed: [], available: [] })
    expect(parsePluginList('oops')).toMatchObject({ ok: false })
  })
})

describe('listPlugins', () => {
  it('asks in the folder, and passes on what went wrong', async () => {
    const run = fake({ stdout: '[]' }, { code: 1, stderr: 'line\n✘ Not logged in' })
    expect(await listPlugins(run, 'C:\\work')).toMatchObject({ ok: true })
    expect(run.calls[0]).toEqual({
      args: ['plugin', 'list', '--json', '--available'],
      cwd: 'C:\\work'
    })
    expect(await listPlugins(run, 'C:\\work')).toEqual({ ok: false, error: 'line\nNot logged in' })
  })
})

describe('plugin actions', () => {
  const req = {
    action: 'install' as const,
    id: 'gh@official',
    scope: 'project' as const,
    folder: 'C:\\w'
  }

  it('builds the command, with an accepted install command only for install and update', () => {
    expect(pluginArgs(req)).toEqual([
      'plugin',
      'install',
      'gh@official',
      '--scope',
      'project',
      '--json'
    ])
    const sha = 'a'.repeat(64)
    expect(pluginArgs({ ...req, acceptCommand: sha }).slice(-2)).toEqual(['--accept-command', sha])
    expect(pluginArgs({ ...req, action: 'uninstall', acceptCommand: sha })).not.toContain(
      '--accept-command'
    )
  })

  it('reads the JSON line among other output', () => {
    expect(lastJson('Installing…\n{"outcome":"ok"}\n')).toEqual({ outcome: 'ok' })
    expect(lastJson('{bad\nnothing')).toBeNull()
  })

  it('reports success, failure, and "already so" as done', async () => {
    const run = fake(
      { stdout: '{"outcome":"ok","message":"Successfully installed plugin: gh"}' },
      { code: 1, stdout: '{"outcome":"failed","message":"Plugin not found"}', stderr: '✘ x' },
      {
        code: 1,
        stdout: '{"outcome":"failed","message":"Already enabled","alreadyInGoalState":true}'
      },
      { code: null, error: 'It took too long' }
    )
    expect(await runPluginAction(run, req, 'C:\\w')).toEqual({
      ok: true,
      message: 'Successfully installed plugin: gh'
    })
    expect(await runPluginAction(run, req, 'C:\\w')).toEqual({
      ok: false,
      error: 'Plugin not found'
    })
    expect(await runPluginAction(run, req, 'C:\\w')).toEqual({
      ok: true,
      message: 'Already enabled'
    })
    expect(await runPluginAction(run, req, 'C:\\w')).toEqual({
      ok: false,
      error: 'It took too long'
    })
    expect(run.calls[0].cwd).toBe('C:\\w')
  })

  it('asks before running a command the marketplace installs it with', async () => {
    const sha = 'b'.repeat(64)
    const shown = JSON.stringify({
      outcome: 'failed',
      message: 'Needs confirmation',
      shownCommand: { kind: 'entry_helper', command: 'npx get-plugin', sha256: sha }
    })
    const run = fake({ code: 1, stdout: shown }, { code: 1, stdout: shown })
    expect(await runPluginAction(run, req, 'C:\\w')).toEqual({
      ok: false,
      error: 'Needs confirmation',
      confirm: { command: 'npx get-plugin', sha256: sha }
    })
    // Agreed to already: not asked again for the same command.
    expect(await runPluginAction(run, { ...req, acceptCommand: sha }, 'C:\\w')).toEqual({
      ok: false,
      error: 'Needs confirmation'
    })
  })
})

describe('checks on requests from the window', () => {
  const folder = mkdtempSync(path.join(tmpdir(), 'claude-config-checks-'))
  afterAll(() => rmSync(folder, { recursive: true, force: true }))

  it('takes only existing absolute folders', () => {
    expect(checkFolder(undefined)).toBeUndefined()
    expect(checkFolder(null)).toBeUndefined()
    expect(checkFolder(folder)).toBe(folder)
    expect(checkFolder('relative')).toBeNull()
    expect(checkFolder(path.join(folder, 'missing'))).toBeNull()
  })

  it('takes item refs with plain names, and a folder for the project ones', () => {
    expect(checkItemRef({ kind: 'skill', scope: 'user', name: 'x', folder: folder })).toEqual({
      kind: 'skill',
      scope: 'user',
      name: 'x'
    })
    expect(checkItemRef({ kind: 'agent', scope: 'project', folder, name: 'a/b' })).toEqual({
      kind: 'agent',
      scope: 'project',
      folder,
      name: 'a/b'
    })
    expect(checkItemRef({ kind: 'agent', scope: 'project', name: 'a' })).toBeNull()
    expect(checkItemRef({ kind: 'skill', scope: 'user', name: '../x' })).toBeNull()
    expect(checkItemRef({ kind: 'plugin', scope: 'user', name: 'x' })).toBeNull()
    expect(
      checkSaveItem({ ref: { kind: 'skill', scope: 'user', name: 'x' }, text: 'y', from: '..' })
    ).toBeNull()
  })

  it('takes hooks of known types, with a folder for the project files', () => {
    const change = {
      scope: 'local',
      event: 'Stop',
      matcher: ' x ',
      handler: { type: 'command', command: 'a' }
    }
    expect(checkHookChange({ ...change, folder })).toMatchObject({ folder, matcher: 'x' })
    expect(checkHookChange(change)).toBeNull()
    expect(
      checkHookChange({ ...change, folder, handler: { type: 'shell', command: 'a' } })
    ).toBeNull()
    expect(checkHookChange({ ...change, folder, event: 'Stop; rm' })).toBeNull()
    const original = {
      scope: 'project',
      event: 'Stop',
      matcher: '',
      group: 0,
      index: 0,
      handler: { type: 'x' }
    }
    expect(checkHookChange({ ...change, scope: 'user', original })).toBeNull()
    expect(checkHookChange({ ...change, scope: 'user', folder, original })).toMatchObject({
      original
    })
  })

  it('takes plugin requests with plain ids and a folder for the project scopes', () => {
    const req = { action: 'install', id: 'gh@official', scope: 'user' }
    expect(checkPluginRequest(req)).toEqual(req)
    expect(checkPluginRequest({ ...req, scope: 'project' })).toBeNull()
    expect(checkPluginRequest({ ...req, scope: 'project', folder })).toMatchObject({ folder })
    expect(checkPluginRequest({ ...req, id: 'gh & calc' })).toBeNull()
    expect(checkPluginRequest({ ...req, id: '--help' })).toBeNull()
    expect(checkPluginRequest({ ...req, action: 'marketplace' })).toBeNull()
    expect(checkPluginRequest({ ...req, acceptCommand: 'not-a-sha' })).toBeNull()
  })
})
