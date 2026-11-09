import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CLAUDE_LOGIN_SHELL } from '../../../../shared/claudeConfig'
import { folderChoices } from '../../claudeConfig'
import { AccountPane } from './AccountPane'
import { forgetExtras } from './extras'
import { useStore, workspaceTitle } from '../../store'
import { HooksPane } from './HooksPane'
import { ItemsPane } from './ItemsPane'
import { KeybindingsPane } from './KeybindingsPane'
import { MarketplacesPane } from './MarketplacesPane'
import { McpPane } from './McpPane'
import { MemoryPane } from './MemoryPane'
import { PluginsPane } from './PluginsPane'
import { PermissionsPane, SettingsPane } from './SettingsPanes'
import { GuardContext, useGuard, useLoad, type Guard } from './guard'

type Tab =
  | 'skills'
  | 'commands'
  | 'agents'
  | 'outputStyles'
  | 'hooks'
  | 'mcp'
  | 'plugins'
  | 'marketplaces'
  | 'memory'
  | 'permissions'
  | 'settings'
  | 'keybindings'
  | 'account'

/** The sections, in groups. */
const TABS: { group: string; items: { id: Tab; label: string }[] }[] = [
  {
    group: 'Teach',
    items: [
      { id: 'skills', label: 'Skills' },
      { id: 'commands', label: 'Commands' },
      { id: 'agents', label: 'Agents' },
      { id: 'outputStyles', label: 'Output styles' },
      { id: 'memory', label: 'Memory' }
    ]
  },
  {
    group: 'Connect',
    items: [
      { id: 'mcp', label: 'MCP servers' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'marketplaces', label: 'Marketplaces' }
    ]
  },
  {
    group: 'Control',
    items: [
      { id: 'hooks', label: 'Hooks' },
      { id: 'permissions', label: 'Permissions' },
      { id: 'settings', label: 'Settings' },
      { id: 'keybindings', label: 'Keybindings' }
    ]
  },
  {
    group: 'claude.ai',
    items: [{ id: 'account', label: 'Account' }]
  }
]

/**
 * The "Claude Code" window: skills, commands, agents, output styles, memory, MCP servers,
 * plugins, marketplaces, hooks, permissions, settings and keybindings (yours, or a folder's). It
 * asks before unsaved changes are thrown away.
 */
export function ClaudeConfigDialog(): React.JSX.Element {
  const open = useStore((s) => s.claudeConfigOpen)
  const setOpen = useStore((s) => s.setClaudeConfigOpen)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const dirty = useRef(false)
  const guard = useMemo<Guard>(
    () => ({
      setDirty: (d) => {
        dirty.current = d
      },
      leave: async () => {
        if (!dirty.current) return true
        const ok = await window.api.confirm({
          message: 'Throw away your changes?',
          detail: 'What you changed here is not saved.',
          okLabel: 'Throw away'
        })
        if (ok) dirty.current = false
        return ok
      }
    }),
    []
  )

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    else if (!open && dialog.open) dialog.close()
  }, [open])

  const tryClose = async (): Promise<void> => {
    if (await guard.leave()) setOpen(false)
  }

  // Each opening asks plugins anew (one may have been installed meanwhile).
  useEffect(() => {
    if (open) forgetExtras()
  }, [open])

  return (
    <dialog
      ref={dialogRef}
      className="claude-config"
      aria-labelledby="claude-config-title"
      onCancel={(e) => {
        // Escape: asks first when something isn't saved.
        e.preventDefault()
        void tryClose()
      }}
      onClose={() => setOpen(false)}
    >
      <GuardContext.Provider value={guard}>
        {open && <ClaudeConfig onClose={() => void tryClose()} />}
      </GuardContext.Provider>
    </dialog>
  )
}

function ClaudeConfig({ onClose }: { onClose(): void }): React.JSX.Element {
  const guard = useGuard()
  const workspaces = useStore((s) => s.workspaces)
  const active = useStore((s) => s.activeWorkspace)
  const titles = useStore((s) => s.settings?.folderTitles)
  const platform = useStore((s) => s.appInfo?.platform ?? '')
  const { choices, current } = useMemo(
    () => folderChoices(workspaces, active, (ws) => workspaceTitle(ws, titles, platform)),
    [workspaces, active, titles, platform]
  )
  // Picked when it opens: the active folder tab's.
  const [folder, setFolder] = useState(current)
  const [tab, setTab] = useState<Tab>('skills')
  const shownFolder = folder && choices.some((c) => c.path === folder) ? folder : null

  const go = async (next: () => void): Promise<void> => {
    if (await guard.leave()) next()
  }

  // Who Claude Code is logged in as, in the corner.
  const loadAuth = useCallback(() => window.api.authStatus(), [])
  const { data: auth } = useLoad(loadAuth)
  const account = auth?.ok ? auth.status : null

  // Logging in runs in a tab of a folder: the one picked here, or the active one.
  const loginFolder =
    workspaces.find((w) => w.cwd && w.cwd === shownFolder) ??
    workspaces.find((w) => w.key === active && w.cwd)
  const login = loginFolder
    ? (): void => {
        void go(() => {
          useStore
            .getState()
            .addTerminal(
              loginFolder.key,
              { kind: 'shell', shellId: CLAUDE_LOGIN_SHELL },
              'Claude login'
            )
          onClose()
        })
      }
    : null

  const pane = `${tab}|${shownFolder ?? ''}`
  return (
    <div className="cc">
      <header className="cc-header">
        <h2 id="claude-config-title">Claude Code</h2>
        <span className="cc-grow" />
        {account && (
          <button
            className={`cc-account${account.loggedIn ? '' : ' out'}`}
            title="Your account"
            onClick={() => void go(() => setTab('account'))}
          >
            {account.loggedIn
              ? [account.email, account.orgName].filter(Boolean).join(' · ')
              : 'Not logged in'}
          </button>
        )}
        <label className="cc-folder" title={shownFolder ?? undefined}>
          <span>This folder</span>
          <select
            value={shownFolder ?? ''}
            disabled={choices.length === 0}
            onChange={(e) => {
              const next = e.target.value || null
              void go(() => setFolder(next))
            }}
          >
            {choices.length === 0 && <option value="">No folder open</option>}
            {choices.map((c) => (
              <option key={c.path} value={c.path}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <button className="icon-button" aria-label="Close" title="Close" onClick={onClose}>
          ✕
        </button>
      </header>
      <div className="cc-body">
        <nav
          className="cc-nav"
          role="tablist"
          aria-label="What to manage"
          aria-orientation="vertical"
        >
          {TABS.map((g) => (
            <div key={g.group} className="cc-nav-group">
              <span className="cc-nav-title">{g.group}</span>
              {g.items.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`cc-tab${tab === t.id ? ' active' : ''}`}
                  onClick={() => void go(() => setTab(t.id))}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="cc-pane">
          {tab === 'skills' && <ItemsPane key={pane} kind="skill" folder={shownFolder} />}
          {tab === 'commands' && <ItemsPane key={pane} kind="command" folder={shownFolder} />}
          {tab === 'agents' && <ItemsPane key={pane} kind="agent" folder={shownFolder} />}
          {tab === 'outputStyles' && (
            <ItemsPane key={pane} kind="outputStyle" folder={shownFolder} />
          )}
          {tab === 'memory' && <MemoryPane key={pane} folder={shownFolder} />}
          {tab === 'mcp' && <McpPane key={pane} folder={shownFolder} />}
          {tab === 'plugins' && <PluginsPane key={pane} folder={shownFolder} />}
          {tab === 'marketplaces' && <MarketplacesPane key={pane} folder={shownFolder} />}
          {tab === 'hooks' && <HooksPane key={pane} folder={shownFolder} />}
          {tab === 'permissions' && <PermissionsPane key={pane} folder={shownFolder} />}
          {tab === 'settings' && <SettingsPane key={pane} folder={shownFolder} />}
          {tab === 'keybindings' && <KeybindingsPane key={pane} />}
          {tab === 'account' && <AccountPane key={pane} onLogin={login} />}
        </div>
      </div>
    </div>
  )
}
