import { screen, type BrowserWindow, type Rectangle } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'fs'
import path from 'path'

export interface WindowState {
  bounds: Rectangle
  maximized: boolean
}

const MIN_VISIBLE = 100

/** Saved bounds, if they still fit on a connected display (monitors change between runs). */
export function loadWindowState(file: string): WindowState | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<WindowState>
    const b = raw.bounds
    if (!b || ![b.x, b.y, b.width, b.height].every((n) => typeof n === 'number')) return null
    const area = screen.getDisplayMatching(b).workArea
    const visibleX = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x)
    const visibleY = Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y)
    if (visibleX < MIN_VISIBLE || visibleY < MIN_VISIBLE) return null
    return { bounds: b, maximized: raw.maximized === true }
  } catch {
    return null
  }
}

export function saveWindowState(file: string, win: BrowserWindow): void {
  try {
    const state: WindowState = { bounds: win.getNormalBounds(), maximized: win.isMaximized() }
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify(state), 'utf8')
  } catch {
    // Best effort.
  }
}
