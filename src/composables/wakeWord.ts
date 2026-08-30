import { validateWakeWord } from './wakeWordConfig'

export interface WakeWordMatch {
  hasWakeWord: boolean
  command: string
}

const WAKE_WORD_BOUNDARY = /[A-Za-z0-9]/
const DEFAULT_ALICE_ALIASES = [
  'alice',
  '爱丽丝',
  '艾丽丝',
  '阿丽丝',
  '艾莉丝',
  // Whisper/Piper may emit traditional Chinese even when the UI language
  // is simplified Chinese. Keep both forms so a spoken wake word is not
  // dropped solely because of script variation.
  '愛麗絲',
  '艾麗絲',
  '阿麗絲',
  '艾莉絲',
  // Mixed-script variants are also common in ASR output.
  '爱丽斯',
  '愛麗斯',
  '爱麗丝',
  '爱麗斯',
  '艾丽斯',
  '艾麗斯',
  '阿丽斯',
  '阿麗斯',
  '艾莉斯',
  // A verified Piper -> Whisper sample rendered “艾莉斯” as “爱历史”.
  // Keep this narrow alias so the local wake-word path remains usable with
  // the bundled Chinese models while preserving the explicit “alice” mode.
  '爱历史',
  // Another verified Piper -> Whisper round-trip rendered “爱丽丝” as
  // “爱力私”. Keep the observed three-character variant narrow to avoid
  // turning ordinary Chinese phrases into accidental wake-ups.
  '爱力私',
  '愛力私',
  '爱丽私',
  '愛麗私',
]

/**
 * Whisper sometimes substitutes homophonic Chinese characters for the
 * three-syllable name. Keep the fuzzy matching deliberately narrow: it only
 * applies when the configured wake word is Alice and only maps characters
 * observed in the bundled Chinese STT model's output.
 */
function normalizeAliceChinese(value: string): string {
  return value
    .replace(/[愛艾埃阿]/gu, '爱')
    .replace(/[麗丽利莉历歷]/gu, '丽')
    .replace(/[絲丝斯师師思]/gu, '丝')
}

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
  const rawWakeWord = typeof wakeWord === 'string' ? wakeWord : ''
  const wakeWordValidation = validateWakeWord(rawWakeWord)
  const normalizedWakeWord = normalizeForMatching(wakeWordValidation.value)

  if (!normalizedTranscript) {
    return { hasWakeWord: false, command: '' }
  }
  // An exactly empty value is used by the push-to-talk path to mean “no
  // wake-word gate”. Whitespace/control/punctuation values are invalid and
  // must fail closed instead of accidentally enabling direct command mode.
  if (!rawWakeWord) {
    return { hasWakeWord: true, command: original.trim() }
  }
  if (!wakeWordValidation.valid || !normalizedWakeWord) {
    return { hasWakeWord: false, command: '' }
  }
  if (sessionActive) {
    return { hasWakeWord: true, command: cleanCommand(original) }
  }

  const wakeWordAliases =
    normalizedWakeWord === 'alice'
      ? Array.from(new Set(DEFAULT_ALICE_ALIASES.map(normalizeAliceChinese)))
      : [normalizedWakeWord]
  const transcriptForMatching =
    normalizedWakeWord === 'alice'
      ? normalizeAliceChinese(normalizedTranscript)
      : normalizedTranscript
  const candidates = wakeWordAliases.flatMap(alias => [
    `hey ${alias}`,
    `ok ${alias}`,
    alias,
  ])

  for (const candidate of candidates) {
    let searchFrom = 0
    while (searchFrom < transcriptForMatching.length) {
      const index = transcriptForMatching.indexOf(candidate, searchFrom)
      if (index === -1) break

      const end = index + candidate.length
      if (
        isBoundary(transcriptForMatching[index - 1]) &&
        isBoundary(transcriptForMatching[end])
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
