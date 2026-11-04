import type { ITheme } from '@xterm/xterm'

export const darkTheme: ITheme = {
  background: '#161618',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#161618',
  selectionBackground: '#3f3f4680',
  black: '#1e1e22',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#facc15',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#22d3ee',
  white: '#d4d4d8',
  brightBlack: '#71717a',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#67e8f9',
  brightWhite: '#fafafa'
}

export const lightTheme: ITheme = {
  background: '#fbfbfa',
  foreground: '#27272a',
  cursor: '#27272a',
  cursorAccent: '#fbfbfa',
  selectionBackground: '#a1a1aa60',
  black: '#27272a',
  red: '#dc2626',
  green: '#15803d',
  yellow: '#a16207',
  blue: '#1d4ed8',
  magenta: '#9333ea',
  cyan: '#0e7490',
  white: '#d4d4d8',
  brightBlack: '#71717a',
  brightRed: '#ef4444',
  brightGreen: '#16a34a',
  brightYellow: '#ca8a04',
  brightBlue: '#2563eb',
  brightMagenta: '#a855f7',
  brightCyan: '#0891b2',
  brightWhite: '#fafafa'
}

/**
 * How far text has to stand out from its background. Claude Code colours diffs and code with
 * exact colours for the theme it is set to, so on the other one some text all but disappears
 * (near-white on the light theme). xterm darkens or lightens such text until it stands out this
 * much. Light: the usual readable minimum (WCAG AA). Dark: lower, so its own grey text stays as
 * it is and only what is close to invisible changes.
 */
export function minimumContrastFor(theme: ITheme | undefined): number {
  return theme === lightTheme ? 4.5 : 3
}

/** Search highlights: every match, and the one you are on. Opaque, as decorations need. */
export function searchDecorations(theme: ITheme | undefined): {
  matchBackground: string
  matchOverviewRuler: string
  activeMatchBackground: string
  activeMatchColorOverviewRuler: string
} {
  return theme === lightTheme
    ? {
        matchBackground: '#fde68a',
        matchOverviewRuler: '#ca8a04',
        activeMatchBackground: '#fdba74',
        activeMatchColorOverviewRuler: '#ea580c'
      }
    : {
        matchBackground: '#5c4a06',
        matchOverviewRuler: '#facc15',
        activeMatchBackground: '#9a3412',
        activeMatchColorOverviewRuler: '#fb923c'
      }
}

/** The brief highlight on a message you jumped to. */
export function promptFlashColor(theme: ITheme | undefined): string {
  return theme === lightTheme ? '#dbeafe' : '#1e3a5f'
}

export function fontFamilyFor(platform: string): string {
  switch (platform) {
    case 'win32':
      return '"Cascadia Mono", "Cascadia Code", Consolas, "Courier New", monospace'
    case 'darwin':
      return 'Menlo, "SF Mono", Monaco, monospace'
    default:
      return '"DejaVu Sans Mono", "Ubuntu Mono", "Liberation Mono", "Noto Sans Mono", monospace'
  }
}
