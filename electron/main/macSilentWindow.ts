/**
 * Geometry and platform policy for the macOS silent (notch / Dynamic Island)
 * presentation.
 *
 * macOS does not expose a cross-version Electron API for the physical MacBook
 * camera notch.  We therefore keep the placement deterministic: center a
 * compact dark pill at the top of the display bounds.  On a display without a
 * notch this still behaves as a small, unobtrusive top-center status island.
 */

export const MAC_SILENT_WINDOW_SIZE = Object.freeze({
  width: 240,
  height: 44,
})

/** Gap above the pill so it does not touch the physical screen edge. */
export const MAC_SILENT_TOP_OFFSET = 4

export interface DisplayBoundsLike {
  x: number
  y: number
  width: number
  height: number
}

export interface SilentWindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Return whether the silent notch treatment is available on this platform.
 * A missing setting means "enabled" so existing macOS installs receive the
 * requested behaviour after upgrading; Windows/Linux remain unchanged.
 */
export function shouldUseMacSilentWindow(
  platform: string | undefined,
  enabled: boolean | undefined = true
): boolean {
  return platform === 'darwin' && enabled !== false
}

/**
 * Center the silent pill in the supplied display bounds.  The dimensions are
 * clamped to a very small display as a defensive measure for test fixtures or
 * unusual virtual displays, while preserving the requested top offset when
 * possible.
 */
export function getMacSilentWindowBounds(
  display: DisplayBoundsLike,
  size: { width?: number; height?: number } = MAC_SILENT_WINDOW_SIZE
): SilentWindowBounds {
  const displayWidth = Number.isFinite(display.width)
    ? Math.max(1, Math.round(display.width))
    : MAC_SILENT_WINDOW_SIZE.width
  const displayHeight = Number.isFinite(display.height)
    ? Math.max(1, Math.round(display.height))
    : MAC_SILENT_WINDOW_SIZE.height
  const requestedWidth = Number.isFinite(size.width)
    ? Math.max(1, Math.round(size.width as number))
    : MAC_SILENT_WINDOW_SIZE.width
  const requestedHeight = Number.isFinite(size.height)
    ? Math.max(1, Math.round(size.height as number))
    : MAC_SILENT_WINDOW_SIZE.height
  const width = Math.min(requestedWidth, displayWidth)
  const height = Math.min(requestedHeight, displayHeight)
  const x = Math.round(
    (Number.isFinite(display.x) ? display.x : 0) + (displayWidth - width) / 2
  )
  const y = Math.round(
    (Number.isFinite(display.y) ? display.y : 0) +
      Math.min(MAC_SILENT_TOP_OFFSET, Math.max(0, displayHeight - height))
  )

  return { x, y, width, height }
}
