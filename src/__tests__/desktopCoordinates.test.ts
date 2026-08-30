import { describe, expect, it } from 'vitest'
import {
  DesktopCoordinateError,
  isImagePointWithinBounds,
  mapDisplayPointToNative,
  mapImagePoint,
  mapImagePointToDisplay,
  mapImagePointToNative,
} from '../../electron/main/desktopCoordinates'

describe('desktop coordinate mapping', () => {
  it('maps a down-scaled image point to display and native spaces', () => {
    const result = mapImagePoint({
      point: { x: 50, y: 25 },
      imageSize: { width: 100, height: 50 },
      displayBounds: { x: -1920, y: 40, width: 1920, height: 1080 },
      scaleFactor: 2,
    })

    expect(result.normalizedPoint).toEqual({ x: 0.5, y: 0.5 })
    expect(result.displayPoint).toEqual({ x: -960, y: 580 })
    expect(result.nativePoint).toEqual({ x: -1920, y: 1160 })
    expect(result.nativeScale).toEqual({ x: 2, y: 2 })
  })

  it('supports the flat image metadata shape used by desktopManager', () => {
    expect(
      mapImagePointToDisplay({
        x: 800,
        y: 500,
        imageWidth: 1600,
        imageHeight: 1000,
        displayBounds: { x: 100, y: 50, width: 3200, height: 2000 },
      })
    ).toEqual({ x: 1700, y: 1050 })
  })

  it('uses explicit native bounds when the native origin is not a scaled display origin', () => {
    const input = {
      point: { x: 25, y: 75 },
      imageSize: { width: 100, height: 100 },
      displayBounds: { x: 100, y: 200, width: 800, height: 600 },
      nativeBounds: { x: 10, y: 20, width: 1600, height: 1200 },
    }

    expect(mapImagePointToDisplay(input)).toEqual({ x: 300, y: 650 })
    expect(mapImagePointToNative(input)).toEqual({ x: 410, y: 920 })

    const result = mapImagePoint(input)
    expect(result.nativeScale).toEqual({ x: 2, y: 2 })
  })

  it('keeps an exact image edge inside the addressable display pixel', () => {
    const result = mapImagePoint({
      point: { x: 100, y: 50 },
      imageSize: { width: 100, height: 50 },
      displayBounds: { x: 10, y: 20, width: 800, height: 600 },
      nativeBounds: { x: 10, y: 20, width: 800, height: 600 },
    })

    expect(result.displayPoint).toEqual({ x: 809, y: 619 })
    expect(result.nativePoint).toEqual({ x: 809, y: 619 })
  })

  it('rejects points outside the image by default', () => {
    expect(() =>
      mapImagePoint({
        point: { x: -0.01, y: 10 },
        imageSize: { width: 100, height: 100 },
        displayBounds: { x: 0, y: 0, width: 1000, height: 800 },
      })
    ).toThrowError(
      expect.objectContaining<Partial<DesktopCoordinateError>>({
        name: 'DesktopCoordinateError',
        code: 'out-of-bounds',
      })
    )

    expect(() =>
      mapImagePoint({
        point: { x: 101, y: 10 },
        imageSize: { width: 100, height: 100 },
        displayBounds: { x: 0, y: 0, width: 1000, height: 800 },
      })
    ).toThrow('outside')
  })

  it('supports explicit clamping for slightly inaccurate model coordinates', () => {
    const result = mapImagePoint({
      point: { x: -5, y: 110 },
      imageSize: { width: 100, height: 100 },
      displayBounds: { x: 0, y: 0, width: 1000, height: 800 },
      boundary: 'clamp',
    })

    expect(result.imagePoint).toEqual({ x: 0, y: 100 })
    expect(result.displayPoint).toEqual({ x: 0, y: 799 })
  })

  it('rejects malformed dimensions, scale factors, and boundary modes', () => {
    const base = {
      point: { x: 1, y: 1 },
      imageSize: { width: 100, height: 100 },
      displayBounds: { x: 0, y: 0, width: 100, height: 100 },
    }

    expect(() =>
      mapImagePoint({ ...base, imageSize: { width: 0, height: 100 } })
    ).toThrow('greater than zero')
    expect(() => mapImagePoint({ ...base, scaleFactor: Number.NaN })).toThrow(
      'finite number'
    )
    expect(() =>
      mapImagePoint({ ...base, boundary: 'snap' as 'reject' })
    ).toThrow('boundary')
    expect(() =>
      mapImagePoint({
        ...base,
        nativeBounds: { x: 0.2, y: 0.2, width: 0.25, height: 0.25 },
      })
    ).toThrow('integer pointer coordinate')
  })

  it('converts display DIPs to the native coordinate space per platform', () => {
    expect(
      mapDisplayPointToNative({
        x: 400,
        y: 300,
        scaleFactor: 2,
        platform: 'win32',
      })
    ).toEqual({ x: 800, y: 600 })

    expect(
      mapDisplayPointToNative({
        x: 400,
        y: 300,
        scaleFactor: 2,
        platform: 'darwin',
      })
    ).toEqual({ x: 400, y: 300 })

    expect(() =>
      mapDisplayPointToNative({
        x: 101,
        y: 50,
        scaleFactor: 1,
        platform: 'linux',
        displayBounds: { x: 0, y: 0, width: 100, height: 100 },
      })
    ).toThrowError(expect.objectContaining({ code: 'out-of-bounds' }))
  })

  it('accepts negative multi-monitor origins and rounds fractional results safely', () => {
    const result = mapImagePoint({
      point: { x: 1, y: 1 },
      imageSize: { width: 3, height: 3 },
      displayBounds: { x: -500.5, y: -300.5, width: 10, height: 10 },
      nativeBounds: { x: -1000.5, y: -600.5, width: 20, height: 20 },
    })

    expect(result.displayPoint.x).toBeGreaterThanOrEqual(-500)
    expect(result.displayPoint.x).toBeLessThanOrEqual(-491)
    expect(result.displayPoint.y).toBeGreaterThanOrEqual(-300)
    expect(result.displayPoint.y).toBeLessThanOrEqual(-291)
    expect(result.nativePoint.x).toBeGreaterThanOrEqual(-1000)
    expect(result.nativePoint.x).toBeLessThanOrEqual(-981)
  })

  it('provides a non-throwing image boundary predicate', () => {
    expect(
      isImagePointWithinBounds({ x: 0, y: 100 }, { width: 100, height: 100 })
    ).toBe(true)
    expect(
      isImagePointWithinBounds(
        { x: 100.01, y: 50 },
        { width: 100, height: 100 }
      )
    ).toBe(false)
    expect(
      isImagePointWithinBounds({ x: 1, y: 1 }, { width: 0, height: 100 })
    ).toBe(false)
  })
})
