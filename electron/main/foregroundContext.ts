/**
 * Comparison helpers for the foreground window identity used by desktop
 * observation tokens.
 *
 * App names and window titles are useful compatibility fallbacks, but they
 * are not unique (two documents can have the same title).  When a native
 * bridge supplies a window id/handle, both observations must carry the same
 * id; if only one side has an id we fail closed rather than silently falling
 * back to a weaker title comparison.
 */

export interface ForegroundContextIdentity {
  readonly foregroundApp?: string
  readonly windowTitle?: string
  readonly windowId?: string | number
}

function normalize(value: string | number | undefined): string {
  if (value === undefined) return ''
  return String(value).normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

/** Return whether two foreground observations identify the same window. */
export function sameForegroundContext(
  first: ForegroundContextIdentity,
  second: ForegroundContextIdentity
): boolean {
  if (
    normalize(first.foregroundApp) !== normalize(second.foregroundApp) ||
    normalize(first.windowTitle) !== normalize(second.windowTitle)
  ) {
    return false
  }

  const firstWindowId = normalize(first.windowId)
  const secondWindowId = normalize(second.windowId)
  if (firstWindowId || secondWindowId) {
    // A missing id is not equivalent to a known id. This protects against a
    // transient native lookup failure weakening an otherwise strong binding.
    return Boolean(
      firstWindowId && secondWindowId && firstWindowId === secondWindowId
    )
  }

  // Legacy/limited bridges may expose only app/title; preserve that behavior
  // when neither observation has a native window identifier.
  return true
}
