/**
 * Shared validation for the high-level open-chat reply tool.
 *
 * The low-level `desktop_action` API is intentionally generic.  This helper
 * gives the renderer and main process one strict contract for the higher-level
 * workflow that types a reply and sends it in the already-open conversation.
 * Keeping the parser free of Electron dependencies makes the safety rules
 * straightforward to unit test on every platform.
 */

export const DESKTOP_REPLY_MAX_RECIPIENT_LENGTH = 256
export const DESKTOP_REPLY_MAX_BODY_LENGTH = 10_000
export const DESKTOP_REPLY_MAX_CONTEXT_LENGTH = 256

export const DESKTOP_REPLY_SHORTCUTS = [
  'ENTER',
  'CTRL+ENTER',
  'CMD+ENTER',
] as const

export type DesktopReplyShortcut = (typeof DESKTOP_REPLY_SHORTCUTS)[number]

export interface DesktopReplyRequest {
  observationId: string
  recipient: string
  body: string
  sendShortcut?: string
  expectedApp?: string
  expectedWindowTitle?: string
}

export interface NormalizedDesktopReplyRequest {
  observationId: string
  recipient: string
  body: string
  sendShortcut: DesktopReplyShortcut
  expectedApp?: string
  expectedWindowTitle?: string
}

export type DesktopReplyParseResult =
  | { success: true; request: NormalizedDesktopReplyRequest }
  | { success: false; error: string }

function normalizeBoundedText(
  value: unknown,
  maxLength: number,
  options: { preserveWhitespace?: boolean } = {}
): string | undefined {
  if (typeof value !== 'string') return undefined
  if (!options.preserveWhitespace && /[\u0000\r\n]/u.test(value)) {
    return undefined
  }
  const normalized = options.preserveWhitespace
    ? value.normalize('NFKC')
    : value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
  if (!normalized.trim() || normalized.length > maxLength) return undefined
  // Newlines/control characters in the recipient or expected window fields
  // could make the confirmation text ambiguous.  The message body is allowed
  // to contain newlines, but never a NUL character that native input APIs may
  // interpret inconsistently.
  if (options.preserveWhitespace && /\u0000/u.test(normalized)) {
    return undefined
  }
  return normalized
}

function normalizeShortcut(value: unknown): DesktopReplyShortcut | undefined {
  if (value === undefined) return 'ENTER'
  if (typeof value !== 'string') return undefined
  const raw = value
  const canonical = raw
    .normalize('NFKC')
    .trim()
    .toUpperCase()
    .replace(/\s+/gu, '')
    .replace(/^COMMAND\+/, 'CMD+')
    .replace(/^CONTROL\+/, 'CTRL+')
  if ((DESKTOP_REPLY_SHORTCUTS as readonly string[]).includes(canonical)) {
    return canonical as DesktopReplyShortcut
  }
  return undefined
}

/**
 * Parse and normalize a desktop reply request.
 *
 * This tool never discovers a recipient on its own.  The model must first
 * inspect the currently open conversation and provide the recipient it saw;
 * the main process then shows that value in a confirmation dialog and can
 * optionally compare it with the observed app/window context.
 */
export function parseDesktopReplyRequest(
  input: unknown
): DesktopReplyParseResult {
  if (!input || typeof input !== 'object') {
    return { success: false, error: '桌面回复参数必须是对象。' }
  }
  const value = input as Record<string, unknown>
  const observationId = normalizeBoundedText(value.observationId, 256)
  if (!observationId) {
    return {
      success: false,
      error: '桌面回复必须携带 desktop_observe 返回的 observationId。',
    }
  }

  const recipient = normalizeBoundedText(
    value.recipient,
    DESKTOP_REPLY_MAX_RECIPIENT_LENGTH
  )
  if (!recipient) {
    return {
      success: false,
      error: `回复对象不能为空，且不能超过 ${DESKTOP_REPLY_MAX_RECIPIENT_LENGTH} 个字符。`,
    }
  }

  const body = normalizeBoundedText(value.body, DESKTOP_REPLY_MAX_BODY_LENGTH, {
    preserveWhitespace: true,
  })
  if (!body || !body.trim()) {
    return {
      success: false,
      error: `回复正文不能为空，且不能超过 ${DESKTOP_REPLY_MAX_BODY_LENGTH} 个字符。`,
    }
  }

  const shortcutRaw = value.sendShortcut
  const shortcut = normalizeShortcut(shortcutRaw)
  if (!shortcut) {
    return {
      success: false,
      error: 'sendShortcut 只能是 ENTER、CTRL+ENTER 或 CMD+ENTER。',
    }
  }

  const expectedApp =
    value.expectedApp === undefined
      ? undefined
      : normalizeBoundedText(
          value.expectedApp,
          DESKTOP_REPLY_MAX_CONTEXT_LENGTH
        )
  if (value.expectedApp !== undefined && !expectedApp) {
    return {
      success: false,
      error: `expectedApp 不能为空，且不能超过 ${DESKTOP_REPLY_MAX_CONTEXT_LENGTH} 个字符。`,
    }
  }

  const expectedWindowTitle =
    value.expectedWindowTitle === undefined
      ? undefined
      : normalizeBoundedText(
          value.expectedWindowTitle,
          DESKTOP_REPLY_MAX_CONTEXT_LENGTH
        )
  if (value.expectedWindowTitle !== undefined && !expectedWindowTitle) {
    return {
      success: false,
      error: `expectedWindowTitle 不能为空，且不能超过 ${DESKTOP_REPLY_MAX_CONTEXT_LENGTH} 个字符。`,
    }
  }

  return {
    success: true,
    request: {
      observationId,
      recipient,
      body,
      sendShortcut: shortcut,
      ...(expectedApp ? { expectedApp } : {}),
      ...(expectedWindowTitle ? { expectedWindowTitle } : {}),
    },
  }
}

/** Normalize values before comparing model-provided app/window hints. */
export function normalizeDesktopReplyContext(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase()
}

/**
 * Compare an optional expected app/window hint with a foreground context.
 * Matching is deliberately substring-based because localized process names
 * often include a product suffix (for example, “WeChat Helper”).
 */
export function matchesDesktopReplyContext(
  request: Pick<
    NormalizedDesktopReplyRequest,
    'expectedApp' | 'expectedWindowTitle'
  >,
  context: { foregroundApp?: string; windowTitle?: string }
): boolean {
  const expectedApp = request.expectedApp
    ? normalizeDesktopReplyContext(request.expectedApp)
    : ''
  const expectedTitle = request.expectedWindowTitle
    ? normalizeDesktopReplyContext(request.expectedWindowTitle)
    : ''
  const actualApp = normalizeDesktopReplyContext(context.foregroundApp || '')
  const actualTitle = normalizeDesktopReplyContext(context.windowTitle || '')
  if (expectedApp && !actualApp.includes(expectedApp)) return false
  if (expectedTitle && !actualTitle.includes(expectedTitle)) return false
  return true
}
