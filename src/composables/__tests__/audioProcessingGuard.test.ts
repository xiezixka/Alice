import { describe, expect, it } from 'vitest'
import { shouldApplyTranscriptionResult } from '../audioProcessingGuard'

describe('audio processing guard', () => {
  const current = {
    requestGeneration: 4,
    currentGeneration: 4,
    isRecordingRequested: true,
    audioState: 'PROCESSING_AUDIO',
  }

  it('accepts a result from the active recording request', () => {
    expect(shouldApplyTranscriptionResult(current)).toBe(true)
  })

  it('rejects a result after the user stops listening', () => {
    expect(
      shouldApplyTranscriptionResult({
        ...current,
        isRecordingRequested: false,
      })
    ).toBe(false)
  })

  it('rejects a stale result after a stop-and-restart cycle', () => {
    expect(
      shouldApplyTranscriptionResult({
        ...current,
        currentGeneration: 5,
      })
    ).toBe(false)
  })

  it('rejects a result when the audio state moved on', () => {
    expect(
      shouldApplyTranscriptionResult({
        ...current,
        audioState: 'LISTENING',
      })
    ).toBe(false)
  })
})
