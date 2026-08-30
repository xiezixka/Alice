/**
 * Validation and normalization for user-configured wake words.
 *
 * Wake words are matched against local Whisper transcripts, so a value that
 * contains only punctuation, control characters, or an unbounded amount of
 * text cannot be a useful trigger. Keeping this policy in a small pure module
 * lets settings migration, the settings UI, the background-listening guard,
 * and the transcript parser agree on the same contract.
 */
export const DEFAULT_WAKE_WORD = 'alice'
export const MAX_WAKE_WORD_CODE_POINTS = 40

const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/u
const WORD_CHARACTER = /[\p{L}\p{N}]/u

export interface WakeWordValidationResult {
  value: string
  valid: boolean
  error: string | null
}

/** Normalize harmless formatting differences without changing the phrase. */
export function normalizeWakeWord(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
}

/** Validate a wake word/phrase before it can be persisted or used for wake. */
export function validateWakeWord(value: unknown): WakeWordValidationResult {
  const rawValue = typeof value === 'string' ? value : ''
  const normalized = normalizeWakeWord(rawValue)

  if (CONTROL_CHARACTER.test(rawValue)) {
    return {
      value: normalized,
      valid: false,
      error: '唤醒词不能包含换行或控制字符。',
    }
  }

  if (!normalized) {
    return {
      value: normalized,
      valid: false,
      error: '请输入唤醒词，或关闭“启用唤醒词”。',
    }
  }

  if ([...normalized].length > MAX_WAKE_WORD_CODE_POINTS) {
    return {
      value: normalized,
      valid: false,
      error: `唤醒词不能超过 ${MAX_WAKE_WORD_CODE_POINTS} 个字符。`,
    }
  }

  if (!WORD_CHARACTER.test(normalized)) {
    return {
      value: normalized,
      valid: false,
      error: '唤醒词至少要包含一个中文、字母或数字。',
    }
  }

  return { value: normalized, valid: true, error: null }
}

export function isValidWakeWord(value: unknown): boolean {
  return validateWakeWord(value).valid
}
