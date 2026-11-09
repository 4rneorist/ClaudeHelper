import type { Status } from './guard'

/** Small parts of the "Claude Code" window. */

/** A small turning circle: something is on its way. */
export function Spinner(): React.JSX.Element {
  return <span className="cc-spinner" aria-hidden="true" />
}

/** What the window is waiting for, with a spinner. */
export function Loading({
  text,
  className = 'cc-empty'
}: {
  text: string
  className?: string
}): React.JSX.Element {
  return (
    <p className={`muted cc-loading ${className}`} role="status">
      <Spinner />
      {text}
    </p>
  )
}

export function StatusLine({ status }: { status: Status | null }): React.JSX.Element | null {
  if (!status) return null
  return (
    <p className={status.ok ? 'cc-status telegram-ok' : 'cc-status field-error'} role="status">
      {status.text}
    </p>
  )
}

export function DocsLink({
  href,
  children
}: {
  href: string
  children: string
}): React.JSX.Element {
  return (
    <a
      className="cc-docs"
      href={href}
      onClick={(e) => {
        e.preventDefault()
        window.api.openExternal(href)
      }}
    >
      {children} ↗
    </a>
  )
}

export function PuzzleIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M2 5h3a1.5 1.5 0 1 1 3 0h3v3a1.5 1.5 0 1 1 0 3v3H2z" />
    </svg>
  )
}
