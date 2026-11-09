import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  listExtras,
  listSyncedSkills,
  orgPolicies,
  parseAuthStatus,
  pluginParts
} from '../../src/main/claudeExtras'
import type { RunClaude } from '../../src/main/claudePlugins'
import { CLAUDE_LOGIN_SHELL } from '../../src/shared/claudeConfig'
import { isLoginTab } from '../../src/renderer/src/store'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'claude-extras-'))
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const write = (rel: string, text: string): void => {
  const file = path.join(dir, rel)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, text)
}
const skill = (description: string): string =>
  `---\nname: x\ndescription: ${description}\n---\nDo it.\n`

describe('skills synced from claude.ai', () => {
  it("reads them from each account's folder", async () => {
    write('skills/synced/org_user/pdf/SKILL.md', skill('Works with PDFs'))
    write('skills/synced/org_user/docx/SKILL.md', skill('Word files'))
    write('skills/mine/SKILL.md', skill('Not synced'))
    const items = await listSyncedSkills(dir)
    expect(items.map((i) => [i.name, i.source, i.description]).sort()).toEqual([
      ['docx', 'claude.ai', 'Word files'],
      ['pdf', 'claude.ai', 'Works with PDFs']
    ])
    expect(items[0].text).toContain('Do it.')
  })
})

describe('what a plugin brings', () => {
  it('reads its default folders and hooks', async () => {
    write('p/skills/review/SKILL.md', skill('Reviews'))
    write('p/commands/deploy.md', '# Deploy it\n')
    write('p/commands/team/sync.md', '---\ndescription: Syncs\n---\n')
    write('p/agents/helper.md', '---\nname: helper\ndescription: Helps\n---\n')
    write('p/output-styles/terse.md', '---\nname: Terse\ndescription: Short\n---\n')
    write(
      'p/hooks/hooks.json',
      JSON.stringify({
        description: 'x',
        hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'start.sh' }] }] }
      })
    )
    const { items, hooks } = await pluginParts('demo', path.join(dir, 'p'))
    expect(items.map((i) => [i.kind, i.name, i.plugin, i.description])).toEqual([
      ['skill', 'review', 'demo', 'Reviews'],
      ['command', 'deploy', 'demo', 'Deploy it'],
      ['command', 'team/sync', 'demo', 'Syncs'],
      ['agent', 'helper', 'demo', 'Helps'],
      ['outputStyle', 'terse', 'demo', 'Short']
    ])
    expect(hooks).toEqual([
      {
        plugin: 'demo',
        event: 'SessionStart',
        matcher: '',
        handler: { type: 'command', command: 'start.sh' },
        path: path.join(dir, 'p', 'hooks', 'hooks.json')
      }
    ])
  })

  it('reads the folders and hooks its manifest names, but nothing outside the plugin', async () => {
    write('outside/agents/evil.md', '---\nname: evil\ndescription: x\n---\n')
    write('p/extra/agents/more.md', '---\nname: more\ndescription: More\n---\n')
    write('p/one.md', '---\nname: one\ndescription: One\n---\n')
    write(
      'p/.claude-plugin/plugin.json',
      JSON.stringify({
        name: 'demo',
        agents: ['./extra/agents', './one.md', '../outside/agents'],
        hooks: { hooks: { Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'bye' }] }] } }
      })
    )
    const { items, hooks } = await pluginParts('demo', path.join(dir, 'p'))
    expect(items.map((i) => i.name).sort()).toEqual(['more', 'one'])
    expect(hooks.map((h) => [h.event, h.handler.command])).toEqual([['Stop', 'bye']])
  })

  it('looks only at plugins enabled in the folder, each once', async () => {
    write('a/skills/s/SKILL.md', skill('From a'))
    write('b/skills/s/SKILL.md', skill('From b'))
    const list = [
      { id: 'a@m', enabled: true, installPath: path.join(dir, 'a') },
      { id: 'a@m', enabled: true, installPath: path.join(dir, 'a') },
      { id: 'b@m', enabled: false, installPath: path.join(dir, 'b') },
      { id: 'c@m', enabled: true, installPath: 'relative' }
    ]
    const run: RunClaude = async () => ({ code: 0, stdout: JSON.stringify(list), stderr: '' })
    const extras = await listExtras(run, dir, path.join(dir, 'home'))
    expect(extras.items.map((i) => [i.plugin, i.description])).toEqual([['a', 'From a']])
    const failed: RunClaude = async () => ({ code: 1, stdout: '', stderr: 'boom' })
    expect(await listExtras(failed, dir, dir)).toMatchObject({ items: [], error: 'boom' })
  })
})

describe('account and organization', () => {
  it('reads `claude auth status`', () => {
    expect(
      parseAuthStatus(
        JSON.stringify({
          loggedIn: true,
          authMethod: 'claude.ai',
          email: 'me@x.com',
          orgName: 'Org',
          subscriptionType: 'team',
          loginExpiresAt: '2026-11-08T15:05:03.077Z',
          orgId: 'not shown'
        })
      )
    ).toEqual({
      loggedIn: true,
      authMethod: 'claude.ai',
      email: 'me@x.com',
      orgName: 'Org',
      subscriptionType: 'team',
      loginExpiresAt: '2026-11-08T15:05:03.077Z'
    })
    expect(parseAuthStatus('{"loggedIn":false}')).toEqual({ loggedIn: false })
    expect(parseAuthStatus('not json')).toBeNull()
  })

  it("reads the organization's rules and the settings it sends", async () => {
    write(
      'policy-limits.json',
      JSON.stringify({
        restrictions: { allow_quick_web_setup: { allowed: false }, odd: 'x' },
        compliance_taints: [],
        monitoring_notice: null,
        defaults: { remote_control_at_startup: false }
      })
    )
    write('remote-settings.json', '{}')
    write('remote-settings.json.synced-at', '1793988061374')
    const p = await orgPolicies(dir, 'linux')
    expect(p).toMatchObject({
      restrictions: [{ key: 'allow_quick_web_setup', allowed: false }],
      defaults: { remote_control_at_startup: false },
      monitoringNotice: null,
      remoteSettings: null,
      syncedAt: 1793988061374,
      known: true
    })
    expect(await orgPolicies(path.join(dir, 'none'), 'linux')).toMatchObject({
      restrictions: [],
      known: false
    })
  })

  it('keeps a login tab out of the saved layout', () => {
    expect(isLoginTab({ spec: { kind: 'shell', shellId: CLAUDE_LOGIN_SHELL } })).toBe(true)
    expect(isLoginTab({ spec: { kind: 'shell', shellId: 'pwsh' } })).toBe(false)
    expect(isLoginTab({ spec: { kind: 'claude', mode: 'new' } })).toBe(false)
  })
})
