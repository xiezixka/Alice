export interface WakeWordMatch {
  hasWakeWord: boolean
  command: string
}

const WAKE_WORD_BOUNDARY = /[A-Za-z0-9]/

function normalizeForMatching(value: string): string {
  return value.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim()
}

function isBoundary(character: string | undefined): boolean {
  return !character || !WAKE_WORD_BOUNDARY.test(character)
}

function cleanCommand(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/^[\s,，。.!！?？:：;；、、]+/u, '')
    .trim()
}

/**
 * Parse a local-STT transcript without sending the wake word itself to the
 * assistant. The matching string is normalized for full-width punctuation,
 * whitespace, and case, while the returned command keeps the user's text.
 *
 * `sessionActive` is used for the short follow-up window after a wake word has
 * already been detected (for example: “Alice” → “打开日历”).
 */
export function parseWakeWord(
  transcription: string,
  wakeWord: string,
  sessionActive = false
): WakeWordMatch {
  const original = typeof transcription === 'string' ? transcription : ''
  const normalizedTranscript = normalizeForMatching(original)
  const normalizedWakeWord = normalizeForMatching(wakeWord)

  if (!normalizedTranscript) {
    return { hasWakeWord: false, command: '' }
  }
  if (!normalizedWakeWord) {
    return { hasWakeWord: true, command: original.trim() }
  }
  if (sessionActive) {
    return { hasWakeWord: true, command: cleanCommand(original) }
  }

  const candidates = [
    `hey ${normalizedWakeWord}`,
    `ok ${normalizedWakeWord}`,
    normalizedWakeWord,
  ]

  for (const candidate of candidates) {
    let searchFrom = 0
    while (searchFrom < normalizedTranscript.length) {
      const index = normalizedTranscript.indexOf(candidate, searchFrom)
      if (index === -1) break

      const end = index + candidate.length
      if (
        isBoundary(normalizedTranscript[index - 1]) &&
        isBoundary(normalizedTranscript[end])
      ) {
        // Candidate and original text have the same character positions for
        // the common ASCII wake words. For full-width input, use the
        // normalized transcript as a safe, deterministic fallback.
        const command = cleanCommand(
          original.length === normalizedTranscript.length
            ? original.slice(end)
            : normalizedTranscript.slice(end)
        )
        return { hasWakeWord: true, command }
      }
      searchFrom = index + Math.max(candidate.length, 1)
    }
  }

  return { hasWakeWord: false, command: '' }
}
