import { describe, expect, it } from 'vitest'
import {
  TAB_COLORS,
  contrastRatio,
  findFolderColor,
  readableTextColor,
  tabColors
} from '../../src/renderer/src/tabColors'

describe('findFolderColor', () => {
  const colors = { 'C:\\Projects\\App': '#2563eb', '/home/me/app': '#16a34a' }

  it('finds a folder color case-insensitively on Windows', () => {
    expect(findFolderColor(colors, 'c:\\projects\\app\\', 'win32')).toBe('#2563eb')
  })

  it('matches the exact path on Linux', () => {
    expect(findFolderColor(colors, '/home/me/app', 'linux')).toBe('#16a34a')
    expect(findFolderColor(colors, '/home/me/App', 'linux')).toBeNull()
  })

  it('returns null for a folder without a color', () => {
    expect(findFolderColor(colors, 'C:\\Projects\\Other', 'win32')).toBeNull()
    expect(findFolderColor(undefined, 'C:\\Projects\\App', 'win32')).toBeNull()
  })
})

describe('readableTextColor', () => {
  it('uses dark text on a light color', () => {
    expect(readableTextColor('#facc15')).toBe('#000000')
  })

  it('uses white text on a dark color', () => {
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff')
  })
})

describe('tabColors', () => {
  it('shows the chosen color as-is on the active tab', () => {
    expect(tabColors('#2563eb', 'dark', true).background).toBe('#2563eb')
  })

  it('blends inactive tabs toward the tab bar, so the active one stands out', () => {
    // 55% of the color over the tab bar (--bg-elev).
    expect(tabColors('#2563eb', 'dark', false).background).toBe('#254793')
    expect(tabColors('#2563eb', 'light', false).background).toBe('#81a3ed')
  })

  it('blends inactive session tabs toward the session tab bar instead', () => {
    // --term-bg in dark, --bg in light.
    expect(tabColors('#2563eb', 'dark', false, 'session').background).toBe('#1e408c')
    expect(tabColors('#2563eb', 'light', false, 'session').background).toBe('#85a7f2')
    expect(tabColors('#2563eb', 'light', true, 'session').background).toBe('#2563eb')
  })

  it('keeps the title readable on every preset, active or not, in both themes', () => {
    for (const { value } of TAB_COLORS) {
      for (const theme of ['dark', 'light'] as const) {
        for (const active of [true, false]) {
          const { background, text } = tabColors(value, theme, active)
          expect(contrastRatio(background, text), `${value} ${theme} ${active}`).toBeGreaterThan(
            4.5
          )
        }
      }
    }
  })

  it('gives every preset a white title on the active tab', () => {
    for (const { value } of TAB_COLORS) {
      expect(tabColors(value, 'dark', true).text, value).toBe('#ffffff')
    }
  })
})
