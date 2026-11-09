import { describe, expect, it } from 'vitest'
import {
  filterPlugins,
  folderChoices,
  hookSummary,
  mcpConfig,
  mcpForm,
  mcpSummary,
  mcpTransport,
  pluginRows,
  shortCount,
  timeoutValue,
  withField,
  withType
} from '../../src/renderer/src/claudeConfig'
import {
  bindingProblem,
  bindingsText,
  parseBindings
} from '../../src/renderer/src/keybindingCatalog'
import type { Workspace } from '../../src/renderer/src/store'

const ws = (key: string, cwd: string | null, title = key): Workspace =>
  ({ key, cwd, title }) as unknown as Workspace

describe('folderChoices', () => {
  it('lists each open folder once, the active one first picked', () => {
    const { choices, current } = folderChoices(
      [ws('a', 'C:\\a', 'A'), ws('s', null), ws('b', 'C:\\b', 'B'), ws('a2', 'C:\\a')],
      'b'
    )
    expect(choices).toEqual([
      { path: 'C:\\a', label: 'A' },
      { path: 'C:\\b', label: 'B' }
    ])
    expect(current).toBe('C:\\b')
    expect(folderChoices([ws('s', null)], 's')).toEqual({ choices: [], current: null })
    expect(folderChoices([ws('a', 'C:\\a')], 'start').current).toBe('C:\\a')
  })
})

describe('plugins in the list', () => {
  const rows = pluginRows(
    [
      { id: 'b@m', scope: 'user', enabled: true, errors: [], mcpServers: [] },
      { id: 'mine@local', scope: 'local', enabled: true, errors: [], mcpServers: [] }
    ],
    [
      { id: 'a@m', name: 'alpha', description: 'Formats code', marketplace: 'm', installCount: 50 },
      { id: 'b@m', name: 'beta', description: 'Reviews code', marketplace: 'm', installCount: 5 },
      { id: 'c@m', name: 'gamma', description: 'Deploys', marketplace: 'm', installCount: 900 }
    ]
  )

  it('joins installs to what the marketplace says, keeping ones it does not list', () => {
    expect(rows.map((r) => [r.id, r.installs.length])).toEqual([
      ['a@m', 0],
      ['b@m', 1],
      ['c@m', 0],
      ['mine@local', 1]
    ])
    expect(rows[3]).toMatchObject({ name: 'mine', marketplace: 'local' })
  })

  it('shows installed first, then by name, matching every word', () => {
    // gamma has the most installs, but the name decides.
    expect(filterPlugins(rows, '', false).map((r) => r.name)).toEqual([
      'beta',
      'mine',
      'alpha',
      'gamma'
    ])
    expect(filterPlugins(rows, '', true).map((r) => r.name)).toEqual(['beta', 'mine'])
    expect(filterPlugins(rows, 'CODE re', false).map((r) => r.name)).toEqual(['beta'])
  })

  it('counts short', () => {
    expect([999, 1000, 12_345, 2_500_000].map(shortCount)).toEqual(['999', '1k', '12.3k', '2.5M'])
  })
})

describe('hook handlers', () => {
  it('sums one up in a line', () => {
    expect(hookSummary({ type: 'command', command: 'node  a.js\n--x' })).toBe('node a.js --x')
    expect(hookSummary({ type: 'command', args: ['node', 'b.js'] })).toBe('node b.js')
    expect(hookSummary({ type: 'http', url: 'https://x' })).toBe('https://x')
    expect(hookSummary({ type: 'mcp_tool', server: 's', tool: 't' })).toBe('s › t')
    expect(hookSummary({ type: 'prompt', prompt: 'Is it done?' })).toBe('Is it done?')
    expect(hookSummary({ type: 'agent' })).toBe('(agent)')
  })

  it('drops an emptied field, and the fields of the old type on a change of type', () => {
    expect(withField({ type: 'command', command: 'x', timeout: 5 }, 'timeout', undefined)).toEqual({
      type: 'command',
      command: 'x'
    })
    expect(
      withType(
        { type: 'command', command: 'x', async: true, timeout: 5, if: 'Bash(git *)' },
        'prompt'
      )
    ).toEqual({
      type: 'prompt',
      timeout: 5,
      if: 'Bash(git *)'
    })
  })

  it('reads a timeout only when it is a positive number', () => {
    expect(['30', '', ' ', '-1', 'x', '1.5'].map(timeoutValue)).toEqual([
      30,
      undefined,
      undefined,
      undefined,
      undefined,
      1.5
    ])
  })
})

describe('MCP server form', () => {
  it('shows a stdio server as lines and puts it back the same', () => {
    const config = {
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'server'],
      env: { TOKEN: 'a=b' },
      timeout: 30
    }
    const form = mcpForm(config)
    expect(form).toMatchObject({ transport: 'stdio', args: '-y\nserver', env: 'TOKEN=a=b' })
    expect(form.extra).toEqual({ timeout: 30 })
    expect(mcpConfig(form)).toEqual(config)
  })

  it('reads a server without a type by what it has, and headers by their colon', () => {
    expect(mcpTransport({ url: 'https://x' })).toBe('http')
    expect(mcpTransport({ command: 'x' })).toBe('stdio')
    const form = {
      ...mcpForm({ type: 'http', url: 'https://x' }),
      headers: 'Authorization: Bearer a:b\n\n'
    }
    expect(mcpConfig(form)).toEqual({
      type: 'http',
      url: 'https://x',
      headers: { Authorization: 'Bearer a:b' }
    })
    expect(mcpSummary({ command: 'npx', args: ['-y', 's'] })).toBe('npx -y s')
  })
})

describe('keybindings table', () => {
  it('reads blocks as rows and writes them back by context', () => {
    const parsed = parseBindings(
      JSON.stringify({
        $schema: 'x',
        bindings: [
          { context: 'Chat', bindings: { 'ctrl+e': 'chat:externalEditor', 'ctrl+s': null } },
          { context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } }
        ]
      })
    )!
    expect(parsed.rows).toEqual([
      { context: 'Chat', key: 'ctrl+e', action: 'chat:externalEditor' },
      { context: 'Chat', key: 'ctrl+s', action: null },
      { context: 'Global', key: 'ctrl+t', action: 'app:toggleTodos' }
    ])
    const rows = [...parsed.rows, { context: 'Chat', key: 'meta+g', action: 'command:compact' }]
    const out = JSON.parse(bindingsText({ ...parsed, rows }))
    expect(out.$schema).toBe('x')
    expect(out.bindings).toEqual([
      {
        context: 'Chat',
        bindings: { 'ctrl+e': 'chat:externalEditor', 'ctrl+s': null, 'meta+g': 'command:compact' }
      },
      { context: 'Global', bindings: { 'ctrl+t': 'app:toggleTodos' } }
    ])
    expect(parseBindings(null)).toEqual({ rows: [], extra: {} })
    expect(parseBindings('[1]')).toBeNull()
  })

  it('marks reserved keys, the same key twice, and spaces next to +', () => {
    const rows = [
      { context: 'Chat', key: 'ctrl+c', action: 'chat:cancel' },
      { context: 'Chat', key: 'ctrl+e', action: 'a' },
      { context: 'Chat', key: 'CTRL+E', action: 'b' },
      { context: 'Global', key: 'ctrl+e', action: 'c' },
      { context: 'Chat', key: 'ctrl+ k', action: 'd' }
    ]
    expect(rows.map((_, i) => bindingProblem(rows, i))).toEqual([
      expect.stringMatching(/changed/),
      null,
      expect.stringMatching(/already/),
      null,
      expect.stringMatching(/spaces/)
    ])
  })
})
