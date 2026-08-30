import { describe, expect, it } from 'vitest'
import {
  MAC_SILENT_WINDOW_SIZE,
  getMacSilentWindowBounds,
  shouldUseMacSilentWindow,
} from '../../electron/main/macSilentWindow'

describe('macOS silent notch window policy', () => {
  it('enables the treatment by default only on macOS', () => {
    expect(shouldUseMacSilentWindow('darwin')).toBe(true)
    expect(shouldUseMacSilentWindow('win32')).toBe(false)
    expect(shouldUseMacSilentWindow('linux')).toBe(false)
    expect(shouldUseMacSilentWindow('darwin', false)).toBe(false)
  })

  it('centers the pill at the top of displays with negative origins', () => {
    expect(
      getMacSilentWindowBounds({ x: -1440, y: 0, width: 1440, height: 900 })
    ).toEqual({
      x: -1440 + (1440 - MAC_SILENT_WINDOW_SIZE.width) / 2,
      y: 4,
      width: 240,
      height: 44,
    })
  })

  it('clamps dimensions on a small virtual display', () => {
    expect(
      getMacSilentWindowBounds({ x: 10, y: 20, width: 300, height: 50 })
    ).toEqual({ x: 40, y: 24, width: 240, height: 44 })
  })
})
