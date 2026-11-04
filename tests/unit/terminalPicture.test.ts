import { describe, expect, it } from 'vitest'
import { pictureStyle, withAlpha } from '../../src/renderer/src/terminalPicture'

describe('withAlpha', () => {
  it('makes a hex colour see-through', () => {
    expect(withAlpha('#161618', 0.75)).toBe('rgba(22, 22, 24, 0.75)')
    expect(withAlpha('#fbfbfa', 1 / 3)).toBe('rgba(251, 251, 250, 0.33)')
  })
})

describe('pictureStyle', () => {
  it('lays the theme background over the picture, as thick as the picture is faint', () => {
    expect(pictureStyle({ url: 'blob:x', strength: 30, fit: 'fill' }, '#161618')).toEqual({
      backgroundImage:
        'linear-gradient(rgba(22, 22, 24, 0.7), rgba(22, 22, 24, 0.7)), url("blob:x")',
      backgroundSize: 'auto, cover',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'center'
    })
  })

  it('fits, stretches or tiles it', () => {
    const style = (fit: 'fit' | 'stretch' | 'tile'): object =>
      pictureStyle({ url: 'blob:x', strength: 100, fit }, '#000000')
    expect(style('fit')).toMatchObject({ backgroundSize: 'auto, contain' })
    expect(style('stretch')).toMatchObject({ backgroundSize: 'auto, 100% 100%' })
    expect(style('tile')).toMatchObject({
      backgroundSize: 'auto, auto',
      backgroundRepeat: 'repeat'
    })
  })
})
