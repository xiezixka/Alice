import { describe, expect, it } from 'vitest'
import {
  MAX_WAKE_WORD_CODE_POINTS,
  normalizeWakeWord,
  validateWakeWord,
} from '../wakeWordConfig'

describe('wake word configuration', () => {
  it('normalizes Unicode form and surrounding/internal whitespace', () => {
    expect(normalizeWakeWord('  Hey　Computer\n')).toBe('Hey Computer')
    expect(validateWakeWord('  小助手  ').value).toBe('小助手')
  })

  it('accepts Chinese, English, and mixed phrases', () => {
    expect(validateWakeWord('小助手').valid).toBe(true)
    expect(validateWakeWord('Hey, Alice').valid).toBe(true)
    expect(validateWakeWord('助手 2').valid).toBe(true)
  })

  it('rejects empty, punctuation-only, and control-character values', () => {
    expect(validateWakeWord('').valid).toBe(false)
    expect(validateWakeWord('   ').valid).toBe(false)
    expect(validateWakeWord('！！！').valid).toBe(false)
    expect(validateWakeWord('Alice\n打开日历').valid).toBe(false)
  })

  it('rejects unreasonably long phrases', () => {
    expect(validateWakeWord('a'.repeat(MAX_WAKE_WORD_CODE_POINTS + 1))).toEqual(
      expect.objectContaining({ valid: false })
    )
    expect(validateWakeWord('a'.repeat(MAX_WAKE_WORD_CODE_POINTS)).valid).toBe(
      true
    )
  })
})
