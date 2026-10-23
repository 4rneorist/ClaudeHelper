import { useCallback, useEffect, useRef, useState } from 'react'
import { notificationSource, notificationText } from '../attention'
import { formatAgo } from '../constants'
import { useStore, type AppNotification } from '../store'

/** How long a toast stays: an answer Claude waits for gets longer. */
const TOAST_MS = { finished: 6000, asking: 12000 }

/** A bell, crossed out when muted or with Do not disturb on. */
export function BellIcon({
  off = false,
  size = 15
}: {
  off?: boolean
  size?: number
}): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M4 11.25V7a4 4 0 0 1 8 0v4.25l1.25 1.25H2.75z" />
      <path d="M6.5 14a1.5 1.5 0 0 0 3 0" />
      {off && <path d="M2 2l12 12" />}
    </svg>
  )
}

/** The bell at the right of the top bar: unread count, and the list of what happened. */
export function NotificationBell(): React.JSX.Element {
  const notifications = useStore((s) => s.notifications)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const close = useCallback(() => setAnchor(null), [])
  const doNotDisturb = useStore((s) => s.doNotDisturb)
  const unread = notifications.filter((n) => !n.read)
  const urgent = unread.some((n) => n.kind === 'asking')

  return (
    <>
      <button
        className="icon-button bell"
        aria-label={unread.length ? `Notifications, ${unread.length} unread` : 'Notifications'}
        title={doNotDisturb ? 'Notifications (Do not disturb is on)' : 'Notifications'}
        aria-expanded={!!anchor}
        // Keeps the open list from closing on mousedown, so the click toggles it.
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
      >
        <BellIcon off={doNotDisturb} />
        {unread.length > 0 && (
          <span className={`bell-count ${urgent ? 'asking' : 'finished'}`}>
            {unread.length > 9 ? '9+' : unread.length}
          </span>
        )}
      </button>
      {anchor && <NotificationList anchor={anchor} onClose={close} />}
    </>
  )
}

function NotificationList({
  anchor,
  onClose
}: {
  anchor: DOMRect
  onClose(): void
}): React.JSX.Element {
  const notifications = useStore((s) => s.notifications)
  const markNotificationsRead = useStore((s) => s.markNotificationsRead)
  const clearNotifications = useStore((s) => s.clearNotifications)
  const doNotDisturb = useStore((s) => s.doNotDisturb)
  const setDoNotDisturb = useStore((s) => s.setDoNotDisturb)
  const ref = useRef<HTMLDivElement>(null)
  // Keeps "2 min ago" current while the list is open.
  const [, setTick] = useState(0)

  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(timer)
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="notification-list"
      role="dialog"
      aria-label="Notifications"
      style={{ top: anchor.bottom + 4, right: Math.max(8, window.innerWidth - anchor.right) }}
    >
      <header>
        <strong>Notifications</strong>
        <button
          className="link-button"
          disabled={!notifications.some((n) => !n.read)}
          onClick={() => markNotificationsRead()}
        >
          Mark all read
        </button>
        <button
          className="link-button"
          disabled={notifications.length === 0}
          onClick={clearNotifications}
        >
          Clear
        </button>
      </header>
      <label className="dnd-switch">
        <input
          type="checkbox"
          checked={doNotDisturb}
          onChange={(e) => setDoNotDisturb(e.target.checked)}
        />
        <span>
          Do not disturb
          <small>No sounds, toasts or notifications until you switch it off or restart</small>
        </span>
      </label>
      {notifications.length === 0 ? (
        <p className="notification-empty">
          Nothing yet. When a session finishes or needs your answer while you are elsewhere, it
          shows up here.
        </p>
      ) : (
        <ul>
          {notifications.map((n) => (
            <li key={n.id}>
              <NotificationItem notification={n} onOpen={onClose} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** One entry: where it came from, what happened, when. Opens that session. */
function NotificationItem({
  notification: n,
  onOpen
}: {
  notification: AppNotification
  onOpen(): void
}): React.JSX.Element {
  const open = useStore((s) => !!s.terminals[n.key])
  const revealTerminal = useStore((s) => s.revealTerminal)
  const markNotificationsRead = useStore((s) => s.markNotificationsRead)

  return (
    <button
      className={`notification ${n.kind} ${n.read ? '' : 'unread'}`}
      disabled={!open}
      title={open ? 'Open this session' : 'This session has been closed'}
      onClick={() => {
        revealTerminal(n.key)
        markNotificationsRead(n.key)
        onOpen()
      }}
    >
      <span className={`status-dot ${n.kind === 'asking' ? 'asking' : 'idle'}`} />
      <span className="notification-body">
        <span className="notification-source">
          {notificationSource(n)}
          {!open && <span className="muted"> (closed)</span>}
          {n.muted && <span className="muted"> (muted)</span>}
        </span>
        <span className="notification-text">{notificationText(n)}</span>
      </span>
      <span className="notification-when">{formatAgo(n.at)}</span>
    </button>
  )
}

/** The latest notifications, bottom right, for a few seconds each. */
export function Toasts(): React.JSX.Element | null {
  const toasts = useStore((s) => s.toasts)
  const notifications = useStore((s) => s.notifications)
  const shown = toasts
    .map((id) => notifications.find((n) => n.id === id))
    .filter((n): n is AppNotification => !!n)
  if (shown.length === 0) return null
  return (
    <div className="toasts" role="status" aria-live="polite">
      {shown.map((n) => (
        <Toast key={n.id} notification={n} />
      ))}
    </div>
  )
}

function Toast({ notification: n }: { notification: AppNotification }): React.JSX.Element {
  const revealTerminal = useStore((s) => s.revealTerminal)
  const dismissToast = useStore((s) => s.dismissToast)

  useEffect(() => {
    const timer = setTimeout(() => dismissToast(n.id), TOAST_MS[n.kind])
    return () => clearTimeout(timer)
  }, [n.id, n.kind, dismissToast])

  return (
    <div className={`toast ${n.kind}`}>
      <button
        className="toast-open"
        title="Open this session"
        onClick={() => {
          revealTerminal(n.key)
          dismissToast(n.id)
        }}
      >
        <span className={`status-dot ${n.kind === 'asking' ? 'asking' : 'idle'}`} />
        <span className="notification-body">
          <span className="notification-source">{notificationSource(n)}</span>
          <span className="notification-text">{notificationText(n)}</span>
        </span>
      </button>
      <button className="toast-close" aria-label="Dismiss" onClick={() => dismissToast(n.id)}>
        ×
      </button>
    </div>
  )
}
