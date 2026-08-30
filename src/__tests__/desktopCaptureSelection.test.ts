import { describe, expect, it } from 'vitest'
import { selectPrimaryCaptureSource } from '../../electron/main/desktopCaptureSelection'

describe('desktop capture source selection', () => {
  it('selects the source matching the primary display id regardless of order', () => {
    const secondary = { display_id: 'secondary', name: 'Screen 2' }
    const primary = { display_id: 'primary', name: 'Screen 1' }

    expect(selectPrimaryCaptureSource([secondary, primary], 'primary')).toEqual(
      { source: primary, reason: 'matched' }
    )
  })

  it('allows a single source when Electron cannot provide a display id', () => {
    const source = { display_id: '', name: 'Entire Screen' }

    expect(selectPrimaryCaptureSource([source], 'primary')).toEqual({
      source,
      reason: 'single-source-without-display-id',
    })
  })

  it('fails closed when multiple sources cannot be mapped to the primary display', () => {
    const sources = [
      { display_id: 'secondary', name: 'Screen 2' },
      { display_id: '', name: 'Screen 1' },
    ]

    expect(selectPrimaryCaptureSource(sources, 'primary')).toEqual({
      reason: 'no-matching-source',
    })
  })

  it('does not treat a non-empty mismatched source as the primary display', () => {
    const source = { display_id: 'secondary', name: 'Screen 2' }

    expect(selectPrimaryCaptureSource([source], 'primary')).toEqual({
      reason: 'no-matching-source',
    })
  })
})
