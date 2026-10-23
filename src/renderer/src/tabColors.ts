import { findByPath } from '../../shared/paths'

/**
 * The swatches offered for folder and session tabs; any other #rrggbb can be picked as a custom
 * color.
 * All dark enough for a white title on the active tab.
 */
export const TAB_COLORS = [
  { name: 'Red', value: '#dc2626' },
  { name: 'Orange', value: '#c2410c' },
  { name: 'Yellow', value: '#a16207' },
  { name: 'Green', value: '#15803d' },
  { name: 'Teal', value: '#0f766e' },
  { name: 'Blue', value: '#2563eb' },
  { name: 'Indigo', value: '#4f46e5' },
  { name: 'Purple', value: '#9333ea' },
  { name: 'Pink', value: '#be185d' },
  { name: 'Gray', value: '#64748b' }
] as const

/** Backgrounds of the bars tabs sit on (main.css), which inactive colored tabs blend into. */
const BARS = {
  /** Folder tabs: .tabbar, --bg-elev. */
  folder: { dark: '#242428', light: '#f1f1ef' },
  /** Session tabs: .subtabbar, --term-bg in dark and --bg in light. */
  session: { dark: '#161618', light: '#fbfbfa' }
}
/** How much of the folder's own color an inactive tab shows. */
const INACTIVE_SHARE = 0.55

export function findFolderColor(
  colors: Record<string, string> | undefined,
  cwd: string,
  platform: string
): string | null {
  return findByPath(colors, cwd, platform)
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(channels: number[]): string {
  return `#${channels.map((c) => Math.round(c).toString(16).padStart(2, '0')).join('')}`
}

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Black or white, whichever reads better on the background. */
export function readableTextColor(background: string): string {
  return contrastRatio(background, '#000000') >= contrastRatio(background, '#ffffff')
    ? '#000000'
    : '#ffffff'
}

/** Background and title color of a folder or session tab with a color of its own. */
export function tabColors(
  color: string,
  theme: 'dark' | 'light',
  active: boolean,
  kind: keyof typeof BARS = 'folder'
): { background: string; text: string } {
  const bar = rgb(BARS[kind][theme])
  const background = active
    ? color
    : toHex(rgb(color).map((c, i) => c * INACTIVE_SHARE + bar[i] * (1 - INACTIVE_SHARE)))
  return { background, text: readableTextColor(background) }
}
