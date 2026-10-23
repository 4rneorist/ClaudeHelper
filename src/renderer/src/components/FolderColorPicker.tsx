import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useStore } from '../store'
import { TAB_COLORS } from '../tabColors'

interface Props {
  folder: string
  title: string
  current: string | null
  /** The folder tab it opens below. */
  anchor: DOMRect
  onClose(): void
}

/** Swatches, a custom color and "No color" for one folder's tab. Opens on right-click. */
export function FolderColorPicker({
  folder,
  title,
  current,
  anchor,
  onClose
}: Props): React.JSX.Element {
  const setFolderColor = useStore((s) => s.setFolderColor)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const customRef = useRef<HTMLInputElement>(null)

  const choose = (color: string | null): void => {
    onClose()
    void setFolderColor(folder, color)
  }

  useLayoutEffect(() => {
    if (!ref.current) return
    const width = ref.current.offsetWidth
    setPos({
      top: anchor.bottom + 4,
      left: Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))
    })
    ref.current.querySelector<HTMLButtonElement>('.swatch')?.focus()
  }, [anchor])

  useEffect(() => {
    // No close on window blur, unlike menus: the OS color dialog of "Custom…" takes the focus.
    const onDown = (e: MouseEvent): void => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    // "change" fires once the color dialog closes; React's onChange would fire on every drag step.
    const input = customRef.current
    const onCustom = (): void => {
      onClose()
      if (input) void setFolderColor(folder, input.value)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    input?.addEventListener('change', onCustom)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      input?.removeEventListener('change', onCustom)
    }
  }, [folder, onClose, setFolderColor])

  return (
    <div
      ref={ref}
      className="color-picker"
      role="dialog"
      aria-label={`Tab color for ${title}`}
      style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
    >
      <div className="color-picker-swatches">
        {TAB_COLORS.map((c) => (
          <button
            key={c.value}
            className="swatch"
            style={{ backgroundColor: c.value }}
            title={c.name}
            aria-label={c.name}
            aria-pressed={current === c.value}
            onClick={() => choose(c.value)}
          />
        ))}
      </div>
      <div className="color-picker-row">
        <label className="color-picker-custom">
          <input
            ref={customRef}
            type="color"
            aria-label="Custom color"
            defaultValue={current ?? TAB_COLORS[5].value}
          />
          Custom…
        </label>
        <button className="color-picker-none" disabled={!current} onClick={() => choose(null)}>
          No color
        </button>
      </div>
    </div>
  )
}
