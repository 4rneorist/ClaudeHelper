import { useContext, useEffect, useRef } from 'react'
import {
  bookmarkText,
  closeTerminal,
  runShortcut,
  sendTargets,
  sendToTerminal,
  snipInto
} from '../actions'
import { useStore, type TerminalState } from '../store'
import { darkTheme, lightTheme } from '../terminal/themes'
import { ensureTerminal } from '../terminal/TerminalSession'
import { pictureStyle, useTerminalPicture } from '../terminalPicture'
import { ThemeContext } from '../themeContext'
import { SearchBar } from './SearchBar'

interface Props {
  terminal: TerminalState
  /** On screen (its workspace and sub-tab are the active ones). */
  visible: boolean
}

export function TerminalView({ terminal: t, visible }: Props): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)
  const appInfo = useStore((s) => s.appInfo)!
  const fontSize = useStore((s) => s.settings?.fontSize ?? 14)
  const restartTerminal = useStore((s) => s.restartTerminal)
  const wakeTerminal = useStore((s) => s.wakeTerminal)
  const setSettingsOpen = useStore((s) => s.setSettingsOpen)
  const theme = useContext(ThemeContext) === 'dark' ? darkTheme : lightTheme

  const session = ensureTerminal(t.key, {
    platform: appInfo.platform,
    windowsBuild: appInfo.windowsBuild,
    fontSize,
    theme,
    domRenderer: appInfo.e2e,
    onShortcut: runShortcut,
    sendTargets,
    onSend: sendToTerminal,
    onSnip: (key) => void snipInto(key),
    onBookmark: bookmarkText
  })

  useEffect(() => {
    const host = hostRef.current!
    session.attach(host)
    const observer = new ResizeObserver(() => session.scheduleFit())
    observer.observe(host)
    return () => {
      observer.disconnect()
      session.detach(host)
    }
  }, [session])

  // A restored terminal starts once it is first shown, at the size it is shown at.
  useEffect(() => {
    if (t.status === 'dormant' && visible) wakeTerminal(t.key)
  }, [wakeTerminal, t.key, t.status, visible])

  useEffect(() => {
    if (t.status === 'starting') void session.start(t.attempt, t.cwd, t.spec)
  }, [session, t.attempt, t.status, t.cwd, t.spec])

  useEffect(() => {
    if (visible) session.fit()
  }, [session, visible])

  const picture = useTerminalPicture()
  const seeThrough = picture !== null
  useEffect(
    () => session.setAppearance(fontSize, theme, seeThrough),
    [session, fontSize, theme, seeThrough]
  )

  const what = t.spec.kind === 'claude' ? 'Claude' : t.title

  return (
    <div
      className={picture ? 'terminal-pane with-picture' : 'terminal-pane'}
      style={picture ? pictureStyle(picture, theme.background ?? '#000000') : undefined}
    >
      <div className="terminal-host" ref={hostRef} />
      {t.search !== undefined && <SearchBar terminal={t.key} request={t.search} />}
      {t.status === 'exited' && (
        <div className="terminal-overlay" role="status">
          <span>
            {what} exited with code {t.exitCode}.
          </span>
          <button className="primary" onClick={() => restartTerminal(t.key)}>
            Restart
          </button>
          <button className="secondary" onClick={() => void closeTerminal(t.key)}>
            Close
          </button>
        </div>
      )}
      {t.status === 'error' && (
        <div className="terminal-overlay error" role="alert">
          <span>{t.error}</span>
          {t.errorCode === 'CLAUDE_NOT_FOUND' ? (
            <button className="primary" onClick={() => setSettingsOpen(true)}>
              Open settings
            </button>
          ) : (
            <button className="primary" onClick={() => restartTerminal(t.key)}>
              Retry
            </button>
          )}
          <button className="secondary" onClick={() => void closeTerminal(t.key)}>
            Close
          </button>
        </div>
      )}
    </div>
  )
}
