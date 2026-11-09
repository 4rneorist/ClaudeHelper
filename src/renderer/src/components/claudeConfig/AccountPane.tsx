import { useCallback, useState } from 'react'
import type { AuthStatus, OrgPolicies } from '../../../../shared/claudeConfig'
import { useLoad } from './guard'
import { DocsLink, Loading, StatusLine } from './shared'
import type { Status } from './guard'

/** Claude Code's names for what an organization can allow, in words. */
const RESTRICTIONS: Record<string, string> = {
  allow_quick_web_setup: 'Quick setup of Claude Code on the web',
  allow_connector_file_downloads: 'Downloading files through connectors',
  enforce_web_search_mcp_isolation: 'Web search kept apart from MCP tools',
  allow_remote_control: 'Remote Control (driving a session from claude.ai or your phone)',
  allow_remote_sessions: 'Cloud sessions on claude.ai/code'
}

const DEFAULTS: Record<string, string> = {
  remote_control_at_startup: 'Remote Control on when a session starts'
}

const PLANS: Record<string, string> = {
  pro: 'Pro',
  max: 'Max',
  team: 'Team',
  enterprise: 'Enterprise',
  free: 'Free'
}

/** "allow_some_thing" as "Allow some thing", for names this app doesn't know. */
function words(key: string): string {
  const s = key.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function when(iso: string | undefined): string | null {
  if (!iso) return null
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  const days = Math.round((at.getTime() - Date.now()) / 86_400_000)
  const date = at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
  if (days < 0) return `${date} (over)`
  return days === 0 ? `${date} (today)` : `${date} (in ${days} day${days === 1 ? '' : 's'})`
}

/** Who Claude Code is logged in as, and what your organization has set. */
export function AccountPane({ onLogin }: { onLogin: (() => void) | null }): React.JSX.Element {
  const loadAuth = useCallback(() => window.api.authStatus(), [])
  const { data: auth, loading, reload } = useLoad(loadAuth)
  const loadPolicies = useCallback(() => window.api.orgPolicies(), [])
  const { data: policies, reload: reloadPolicies } = useLoad(loadPolicies)
  const [status, setStatus] = useState<Status | null>(null)
  const [busy, setBusy] = useState(false)

  const logout = async (): Promise<void> => {
    const ok = await window.api.confirm({
      message: 'Log Claude Code out?',
      detail: 'Running sessions stop working until you log in again.',
      okLabel: 'Log out'
    })
    if (!ok) return
    setBusy(true)
    const res = await window.api.logout()
    setBusy(false)
    setStatus(res.ok ? { ok: true, text: 'Logged out' } : { ok: false, text: res.error })
    reload()
  }

  const a: AuthStatus | null = auth?.ok ? auth.status : null
  return (
    <div className="cc-editor cc-wide">
      <header className="cc-editor-head">
        <div>
          <h3>Account</h3>
          <small className="muted">What Claude Code gets from claude.ai</small>
        </div>
        <span className="cc-grow" />
        <button
          className="icon-button"
          aria-label="Reload"
          title="Ask again"
          onClick={() => {
            reload()
            reloadPolicies()
          }}
        >
          ↻
        </button>
      </header>
      <div className="cc-fields">
        <section className="cc-card">
          {!auth ? (
            <Loading text="Asking Claude Code…" className="" />
          ) : !auth.ok ? (
            <p className="field-error">{auth.error}</p>
          ) : a?.loggedIn ? (
            <dl className="cc-facts">
              <dt>Logged in as</dt>
              <dd>{a.email ?? 'Unknown'}</dd>
              {a.orgName && (
                <>
                  <dt>Organization</dt>
                  <dd>{a.orgName}</dd>
                </>
              )}
              {a.subscriptionType && (
                <>
                  <dt>Plan</dt>
                  <dd>{PLANS[a.subscriptionType] ?? a.subscriptionType}</dd>
                </>
              )}
              <dt>Through</dt>
              <dd>
                {a.authMethod === 'claude.ai'
                  ? 'Your claude.ai account'
                  : (a.authMethod ?? 'Unknown')}
                {a.apiProvider && a.apiProvider !== 'firstParty' ? ` (${a.apiProvider})` : ''}
              </dd>
              {when(a.loginExpiresAt) && (
                <>
                  <dt>Login ends</dt>
                  <dd>{when(a.loginExpiresAt)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p>Claude Code isn&apos;t logged in: sessions will ask you to log in.</p>
          )}
          <div className="row">
            <button
              type="button"
              className={a?.loggedIn ? 'secondary' : 'primary'}
              disabled={!onLogin || busy}
              onClick={() => onLogin?.()}
              title={onLogin ? undefined : 'Open a folder first: login runs in a tab there'}
            >
              {a?.loggedIn ? 'Log in again' : 'Log in'}
            </button>
            {a?.loggedIn && (
              <button
                type="button"
                className="secondary danger"
                disabled={busy || loading}
                onClick={() => void logout()}
              >
                Log out
              </button>
            )}
            <StatusLine status={status} />
          </div>
          <small className="muted">
            Log in runs <code>claude auth login</code> in a new tab: your browser opens, and the tab
            says when it is done. Then press ↻ here.
          </small>
        </section>

        <Organization policies={policies} />
      </div>
    </div>
  )
}

function Organization({ policies }: { policies: OrgPolicies | null }): React.JSX.Element {
  if (!policies) return <Loading text="Reading your organization’s rules…" className="" />
  const fetched = policies.syncedAt
    ? new Date(policies.syncedAt).toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short'
      })
    : null
  const nothing =
    !policies.known &&
    !policies.remoteSettings &&
    !policies.managedSettings &&
    policies.restrictions.length === 0
  return (
    <section className="cc-card">
      <h4>Set by your organization</h4>
      {nothing ? (
        <p className="muted">
          Nothing: Claude Code hasn&apos;t had any rules from an organization (a personal account
          has none).
        </p>
      ) : (
        <>
          {policies.monitoringNotice && <p className="cc-notice">{policies.monitoringNotice}</p>}
          {policies.restrictions.length > 0 && (
            <ul className="cc-policies">
              {policies.restrictions.map((r) => (
                <li key={r.key} title={r.key}>
                  {r.key.startsWith('enforce_') ? (
                    // A rule the organization makes Claude Code follow, or not.
                    <span className={`cc-badge${r.allowed ? ' on' : ''}`}>
                      {r.allowed ? 'enforced' : 'not enforced'}
                    </span>
                  ) : (
                    <span className={`cc-badge${r.allowed ? ' on' : ' bad'}`}>
                      {r.allowed ? 'allowed' : 'not allowed'}
                    </span>
                  )}
                  {RESTRICTIONS[r.key] ?? words(r.key)}
                </li>
              ))}
            </ul>
          )}
          {Object.keys(policies.defaults).length > 0 && (
            <ul className="cc-policies">
              {Object.entries(policies.defaults).map(([key, value]) => (
                <li key={key} title={key}>
                  <span className="cc-badge">
                    {typeof value === 'boolean' ? (value ? 'on' : 'off') : String(value)}
                  </span>
                  {DEFAULTS[key] ?? words(key)} (by default)
                </li>
              ))}
            </ul>
          )}
          {policies.complianceTaints.length > 0 && (
            <p className="small">Compliance: {policies.complianceTaints.join(', ')}</p>
          )}
          <h4>Settings it sends</h4>
          {policies.remoteSettings ? (
            <pre className="cc-details">{JSON.stringify(policies.remoteSettings, null, 2)}</pre>
          ) : (
            <p className="muted small">None: your own settings apply.</p>
          )}
          {policies.managedSettings && (
            <>
              <h4>Managed settings on this computer</h4>
              <small className="muted cc-path">{policies.managedSettings.path}</small>
              <pre className="cc-details">
                {JSON.stringify(policies.managedSettings.data, null, 2)}
              </pre>
            </>
          )}
          <p className="muted small">
            These win over your own settings, and can&apos;t be changed here.
            {fetched && ` Last fetched ${fetched}.`}
          </p>
        </>
      )}
      <DocsLink href="https://code.claude.com/docs/en/settings">About managed settings</DocsLink>
    </section>
  )
}
