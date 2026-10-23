import { app, nativeImage, type BrowserWindow, type NativeImage } from 'electron'
import type { WaitingSummary } from '../shared/ipc'

// What the sessions are doing, on the taskbar button, even with the window minimized: red while
// one asks for your answer, yellow while one finished and you haven't looked, a moving bar while
// any works. On Windows a dot on the icon says the same; elsewhere the dock / launcher badge
// counts the sessions waiting.

const COLORS = { asking: [239, 68, 68], finished: [245, 158, 11] } as const
const dots: Partial<Record<keyof typeof COLORS, NativeImage>> = {}

/** A 16×16 colored dot with a white ring, so it shows on light and dark taskbars. */
function dot(kind: keyof typeof COLORS): NativeImage {
  if (dots[kind]) return dots[kind]
  const size = 16
  const center = (size - 1) / 2
  const pixels = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - center, y - center)
      const [r, g, b] = d <= 5.2 ? COLORS[kind] : [255, 255, 255]
      // Soft edge; premultiplied BGRA, as createFromBitmap takes it.
      const alpha = Math.max(0, Math.min(1, 7.6 - d))
      const i = (y * size + x) * 4
      pixels[i] = Math.round(b * alpha)
      pixels[i + 1] = Math.round(g * alpha)
      pixels[i + 2] = Math.round(r * alpha)
      pixels[i + 3] = Math.round(255 * alpha)
    }
  }
  return (dots[kind] = nativeImage.createFromBitmap(pixels, { width: size, height: size }))
}

/** "2 sessions need your answer, 1 finished", for screen readers. */
function describe({ asking, finished }: WaitingSummary): string {
  const parts = [
    asking ? `${asking} ${asking === 1 ? 'session needs' : 'sessions need'} your answer` : '',
    finished ? `${finished} finished` : ''
  ]
  return parts.filter(Boolean).join(', ')
}

export function showWaiting(win: BrowserWindow, summary: WaitingSummary): void {
  if (win.isDestroyed()) return
  app.setBadgeCount(summary.asking + summary.finished)
  if (process.platform !== 'win32') return
  if (summary.asking) win.setProgressBar(1, { mode: 'error' })
  else if (summary.finished) win.setProgressBar(1, { mode: 'paused' })
  else if (summary.working) win.setProgressBar(1, { mode: 'indeterminate' })
  else win.setProgressBar(-1, { mode: 'none' })
  const kind = summary.asking ? 'asking' : summary.finished ? 'finished' : null
  win.setOverlayIcon(kind ? dot(kind) : null, describe(summary))
}
