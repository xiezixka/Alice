import path from 'node:path'

/**
 * The renderer only needs microphone access for local VAD.  Keep the media
 * permission policy in a small, dependency-free module so it can be tested
 * without starting Electron.
 */
export interface MediaPermissionContext {
  permission: string
  mediaType?: string
  mediaTypes?: string[]
  isMainFrame?: boolean
  requestingOrigin?: string
  requestingUrl?: string
  currentUrl: string
  rendererIndexPath?: string
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null
  try {
    return new URL(value)
  } catch {
    return null
  }
}

function normalizedFilePath(value: string): string | null {
  const parsed = parseUrl(value)
  if (!parsed || parsed.protocol !== 'file:') return null

  try {
    // URL.pathname is slash-separated on every platform. Convert the drive
    // prefix emitted by Windows file URLs before handing it to path.normalize.
    let pathname = decodeURIComponent(parsed.pathname)
    if (/^\/[A-Za-z]:\//.test(pathname)) pathname = pathname.slice(1)
    return path.resolve(path.normalize(pathname))
  } catch {
    return null
  }
}

function isSameOrigin(a: URL, b: URL): boolean {
  return a.protocol === b.protocol && a.host === b.host
}

/**
 * Accept only the app's own renderer URL. In production this is the bundled
 * file:// index.html; in development it is a loopback Vite origin. External
 * pages and arbitrary file URLs must never receive media permission.
 */
export function isTrustedAliceRendererUrl(
  candidateUrl: string | undefined,
  currentUrl: string,
  rendererIndexPath?: string
): boolean {
  const current = parseUrl(currentUrl)
  const candidate = parseUrl(candidateUrl || currentUrl)
  if (!current || !candidate) return false

  if (current.protocol === 'file:') {
    if (candidate.protocol !== 'file:') return false
    const candidatePath = normalizedFilePath(candidate.href)
    if (!candidatePath) return false
    if (rendererIndexPath) {
      return candidatePath === path.resolve(rendererIndexPath)
    }
    const currentPath = normalizedFilePath(current.href)
    return currentPath !== null && candidatePath === currentPath
  }

  if (
    (current.protocol === 'http:' || current.protocol === 'https:') &&
    LOOPBACK_HOSTS.has(current.hostname.toLowerCase())
  ) {
    return isSameOrigin(candidate, current)
  }

  return false
}

function hasTrustedOrigin(context: MediaPermissionContext): boolean {
  if (
    !isTrustedAliceRendererUrl(
      context.requestingUrl,
      context.currentUrl,
      context.rendererIndexPath
    )
  ) {
    return false
  }

  // Permission checks expose an origin separately. For file:// Chromium may
  // report an opaque "null" origin; the URL/path check above is authoritative
  // in that case. HTTP(S) renderers must match exactly.
  const requestingOrigin = context.requestingOrigin?.trim()
  if (!requestingOrigin || requestingOrigin === 'null') return true

  const current = parseUrl(context.currentUrl)
  const origin = parseUrl(requestingOrigin)
  if (!current || !origin) {
    return requestingOrigin === 'file:' || requestingOrigin === 'file://'
  }
  if (current.protocol === 'file:') {
    return origin.protocol === 'file:'
  }
  return isSameOrigin(origin, current)
}

/** Whether a permission check is specifically for microphone audio. */
export function shouldAllowMicrophonePermissionCheck(
  context: MediaPermissionContext
): boolean {
  return (
    context.permission === 'media' &&
    context.mediaType === 'audio' &&
    context.isMainFrame === true &&
    hasTrustedOrigin(context)
  )
}

/** Whether a permission request contains audio only (never camera/video). */
export function shouldAllowMicrophonePermissionRequest(
  context: MediaPermissionContext
): boolean {
  const mediaTypes = context.mediaTypes || []
  return (
    context.permission === 'media' &&
    context.isMainFrame === true &&
    mediaTypes.length > 0 &&
    mediaTypes.every(type => type === 'audio') &&
    hasTrustedOrigin(context)
  )
}
