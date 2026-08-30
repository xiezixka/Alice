/**
 * Shared command-approval helpers used by the renderer and the Electron main
 * process.  Keeping command-name extraction in one place prevents the desktop
 * command runner, scheduler, and settings UI from disagreeing about whether
 * a command has already been approved.
 */

export type CommandApprovalScope = 'once' | 'session' | 'permanent'

/**
 * Return the executable token used for command approval.
 *
 * This deliberately does not attempt to be a complete shell parser.  It only
 * handles the common quoted/path forms (`"/usr/bin/ls"`, `C:\\Windows\\...")`;
 * callers must still use `hasShellOperators` before trusting an approval for a
 * command containing shell composition.
 */
export function normalizeCommandName(command: unknown): string {
  if (typeof command !== 'string') return ''
  const trimmed = command.trim()
  if (!trimmed) return ''

  const match = trimmed.match(/^(?:"((?:\\.|[^"\\])*)"|'([^']*)'|(\S+))/u)
  const token = (match?.[1] ?? match?.[2] ?? match?.[3] ?? '').replace(
    /\\([\\"'])/g,
    '$1'
  )
  const basename = token.split(/[\\/]/u).pop() || ''
  return basename.trim()
}

/** A stable, case-insensitive key for a normalized executable name. */
export function commandNameKey(command: unknown): string {
  return normalizeCommandName(command).toLocaleLowerCase('en-US')
}

/**
 * Detect shell composition that cannot safely inherit a command-name grant.
 * Such commands still may be run after an explicit one-time confirmation, but
 * they must never bypass confirmation through a permanent/session approval.
 */
export function hasShellOperators(command: unknown): boolean {
  if (typeof command !== 'string') return false

  let quote: 'single' | 'double' | null = null
  let escaped = false
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index]
    const next = command[index + 1]

    if (escaped) {
      escaped = false
      continue
    }
    if (quote === 'double' && char === '\\') {
      escaped = true
      continue
    }
    if (quote === 'single') {
      if (char === "'") quote = null
      continue
    }
    if (quote === 'double') {
      if (char === '"') quote = null
      continue
    }
    if (char === "'") {
      quote = 'single'
      continue
    }
    if (char === '"') {
      quote = 'double'
      continue
    }

    // Newlines, command separators, pipelines, redirections, background
    // execution, command substitution, and backtick substitution all invoke
    // shell semantics beyond the approved executable token.
    if (
      char === ';' ||
      char === '|' ||
      char === '&' ||
      char === '>' ||
      char === '<' ||
      char === '`' ||
      char === '\n' ||
      char === '\r' ||
      (char === '$' && next === '(')
    ) {
      return true
    }
  }

  return false
}

/** Compare a command or executable token against a configured allowlist. */
export function isCommandNameApproved(
  command: unknown,
  approvedCommands: unknown
): boolean {
  const key = commandNameKey(command)
  if (!key || !Array.isArray(approvedCommands)) return false
  return approvedCommands.some(entry => commandNameKey(entry) === key)
}

/**
 * Normalize, de-duplicate, and bound a persisted command allowlist.  Invalid
 * entries are dropped so malformed settings cannot accidentally broaden the
 * command surface.
 */
export function normalizeApprovedCommandNames(
  commands: unknown,
  maxEntries = 200
): string[] {
  if (!Array.isArray(commands)) return []

  const normalized: string[] = []
  const seen = new Set<string>()
  for (const value of commands) {
    const name = normalizeCommandName(value)
    const key = commandNameKey(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    normalized.push(name)
    if (normalized.length >= maxEntries) break
  }
  return normalized
}
