import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  { label: string; onSelect: () => void; hint?: string } | { header: string } | { separator: true }

interface Props {
  label: React.ReactNode
  title: string
  items: MenuItem[]
  className?: string
}

/** A button that opens a small menu below it. Positioned fixed so tab bars can't clip it. */
export function DropdownMenu({ label, title, items, className }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    if (!open || !buttonRef.current || !menuRef.current) return
    const b = buttonRef.current.getBoundingClientRect()
    const width = menuRef.current.offsetWidth
    setPos({
      top: b.bottom + 4,
      left: Math.max(8, Math.min(b.left, window.innerWidth - width - 8))
    })
    menuRef.current.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      const target = e.target as Node
      if (!menuRef.current?.contains(target) && !buttonRef.current?.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false)
        buttonRef.current?.focus()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('blur', () => setOpen(false), { once: true })
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const onMenuKey = (e: React.KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const buttons = [
      ...(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
    ]
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    const next =
      buttons[(index + (e.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]
    next?.focus()
  }

  return (
    <>
      <button
        ref={buttonRef}
        className={className}
        title={title}
        aria-label={title}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {label}
      </button>
      {open && (
        <div
          ref={menuRef}
          className="dropdown"
          role="menu"
          aria-label={title}
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
          onKeyDown={onMenuKey}
        >
          {items.map((item, i) => {
            if ('separator' in item) return <div key={i} className="dropdown-separator" />
            if ('header' in item) {
              return (
                <div key={i} className="dropdown-header">
                  {item.header}
                </div>
              )
            }
            return (
              <button
                key={i}
                role="menuitem"
                className="dropdown-item"
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span>{item.label}</span>
                {item.hint && <span className="dropdown-hint">{item.hint}</span>}
              </button>
            )
          })}
        </div>
      )}
    </>
  )
}
