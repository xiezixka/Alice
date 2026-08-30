/**
 * Select the screen-capture source that corresponds to a Display returned by
 * Electron's `screen` module.
 *
 * `desktopCapturer` is allowed to return sources in an arbitrary order.  A
 * positional fallback (for example, `sources[0]`) is unsafe when more than
 * one monitor is connected because the pixels could then be paired with the
 * wrong display bounds and observation token.  The only compatibility case
 * we can safely infer is a single source whose `display_id` is unavailable.
 */

export interface DesktopCaptureSourceIdentity {
  readonly display_id?: string | number | null
}

export type DesktopCaptureSourceSelectionReason =
  'matched' | 'single-source-without-display-id' | 'no-matching-source'

export interface DesktopCaptureSourceSelection<T> {
  readonly source?: T
  readonly reason: DesktopCaptureSourceSelectionReason
}

function normalizeDisplayId(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number') return ''
  return String(value).trim()
}

/**
 * Select a source for the requested display without guessing across monitors.
 */
export function selectPrimaryCaptureSource<
  T extends DesktopCaptureSourceIdentity,
>(
  sources: readonly T[],
  primaryDisplayId: string | number
): DesktopCaptureSourceSelection<T> {
  const expectedId = normalizeDisplayId(primaryDisplayId)
  if (expectedId) {
    const matched = sources.find(
      source => normalizeDisplayId(source.display_id) === expectedId
    )
    if (matched) return { source: matched, reason: 'matched' }
  }

  // Electron documents that display_id can be empty on platforms where the
  // native identifier is unavailable.  If there is exactly one screen source,
  // treating it as the primary display is unambiguous; with multiple sources
  // we must fail closed instead of guessing.
  if (sources.length === 1 && !normalizeDisplayId(sources[0]?.display_id)) {
    return {
      source: sources[0],
      reason: 'single-source-without-display-id',
    }
  }

  return { reason: 'no-matching-source' }
}
