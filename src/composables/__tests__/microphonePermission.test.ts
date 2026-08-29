import { describe, expect, it } from 'vitest'
import {
  isBlockedMicrophonePermissionStatus,
  isMicrophonePermissionError,
} from '../microphonePermission'

describe('microphone permission helpers', () => {
  it('blocks denied and restricted native permission states', () => {
    expect(isBlockedMicrophonePermissionStatus('denied')).toBe(true)
    expect(isBlockedMicrophonePermissionStatus('restricted')).toBe(true)
    expect(isBlockedMicrophonePermissionStatus('not-determined')).toBe(false)
    expect(isBlockedMicrophonePermissionStatus('unknown')).toBe(false)
  })

  it('recognizes browser and native microphone permission errors', () => {
    expect(
      isMicrophonePermissionError({
        name: 'NotAllowedError',
        message: 'Permission denied',
      })
    ).toBe(true)
    expect(
      isMicrophonePermissionError('Microphone permission not granted')
    ).toBe(true)
    expect(isMicrophonePermissionError('麦克风权限被拒绝')).toBe(true)
  })

  it('does not treat unrelated device or VAD failures as permission denial', () => {
    expect(isMicrophonePermissionError('No microphone device found')).toBe(
      false
    )
    expect(isMicrophonePermissionError('VAD model failed to load')).toBe(false)
    expect(isMicrophonePermissionError(new Error('Audio device is busy'))).toBe(
      false
    )
  })
})
