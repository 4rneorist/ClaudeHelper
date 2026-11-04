import { useEffect, useState, type CSSProperties } from 'react'
import type { PictureFit } from '../../shared/ipc'
import { useStore } from './store'

// The picture behind every terminal (Settings → Background picture). Main reads the file; it is
// shown from one blob: URL that all tabs share. Over it lies the theme's background, as thick as
// the picture is meant to be faint, and over that the terminal draws its text on a see-through
// background.

export interface TerminalPicture {
  url: string
  /** How much of it shows, 5–100 (%). */
  strength: number
  fit: PictureFit
}

/** The picture being shown, by the path it came from. */
let current: { path: string; url: Promise<string | null> } | null = null

function pictureUrl(path: string): Promise<string | null> {
  if (current?.path === path) return current.url
  const previous = current
  const url = window.api
    .readPicture()
    .then((p) =>
      p ? URL.createObjectURL(new Blob([new Uint8Array(p.data)], { type: p.type })) : null
    )
    .catch(() => null)
  current = { path, url }
  // The old picture goes once the tabs have moved on to the new one.
  void previous?.url.then((old) => old && setTimeout(() => URL.revokeObjectURL(old), 10_000))
  return url
}

/** The background picture as the settings have it, once it is loaded; null for none. */
export function useTerminalPicture(): TerminalPicture | null {
  const path = useStore((s) => s.settings?.terminalPicture ?? '')
  const strength = useStore((s) => s.settings?.terminalPictureStrength ?? 25)
  const fit = useStore((s) => s.settings?.terminalPictureFit ?? 'fill')
  const [loaded, setLoaded] = useState<{ path: string; url: string | null } | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    void pictureUrl(path).then((url) => {
      if (live) setLoaded({ path, url })
    })
    return () => {
      live = false
    }
  }, [path])
  const url = path && loaded?.path === path ? loaded.url : null
  return url ? { url, strength, fit } : null
}

const SIZES: Record<PictureFit, string> = {
  fill: 'cover',
  fit: 'contain',
  stretch: '100% 100%',
  tile: 'auto'
}

/** '#rrggbb' as rgba() with this opacity. */
export function withAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1, 7), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(alpha * 100) / 100})`
}

/** A terminal pane's background: the picture, and the theme's `background` over it. */
export function pictureStyle(picture: TerminalPicture, background: string): CSSProperties {
  const veil = withAlpha(background, 1 - picture.strength / 100)
  return {
    backgroundImage: `linear-gradient(${veil}, ${veil}), url("${picture.url}")`,
    backgroundSize: `auto, ${SIZES[picture.fit]}`,
    backgroundRepeat: picture.fit === 'tile' ? 'repeat' : 'no-repeat',
    backgroundPosition: 'center'
  }
}
