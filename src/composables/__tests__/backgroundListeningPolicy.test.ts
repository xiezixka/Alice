import { describe, expect, it } from 'vitest'
import {
  hasBackgroundListeningPrerequisites,
  shouldDisableBackgroundListening,
} from '../backgroundListeningPolicy'

describe('background listening policy', () => {
  it('requires local STT, enabled wake words, and a non-empty wake word', () => {
    expect(
      hasBackgroundListeningPrerequisites({
        sttProvider: 'local',
        localSttEnabled: true,
        localSttWakeWord: 'alice',
      })
    ).toBe(true)

    expect(
      hasBackgroundListeningPrerequisites({
        sttProvider: 'groq',
        localSttEnabled: true,
        localSttWakeWord: 'alice',
      })
    ).toBe(false)
    expect(
      hasBackgroundListeningPrerequisites({
        sttProvider: 'local',
        localSttEnabled: false,
        localSttWakeWord: 'alice',
      })
    ).toBe(false)
    expect(
      hasBackgroundListeningPrerequisites({
        sttProvider: 'local',
        localSttEnabled: true,
        localSttWakeWord: '  ',
      })
    ).toBe(false)
    expect(
      hasBackgroundListeningPrerequisites({
        sttProvider: 'local',
        localSttEnabled: true,
        localSttWakeWord: '！！！',
      })
    ).toBe(false)
  })

  it('only asks to disable an already-enabled invalid background session', () => {
    expect(
      shouldDisableBackgroundListening({
        backgroundListeningEnabled: false,
        sttProvider: 'groq',
        localSttEnabled: false,
        localSttWakeWord: '',
      })
    ).toBe(false)
    expect(
      shouldDisableBackgroundListening({
        backgroundListeningEnabled: true,
        sttProvider: 'groq',
        localSttEnabled: true,
        localSttWakeWord: 'alice',
      })
    ).toBe(true)
    expect(
      shouldDisableBackgroundListening({
        backgroundListeningEnabled: true,
        sttProvider: 'local',
        localSttEnabled: true,
        localSttWakeWord: 'alice',
      })
    ).toBe(false)
  })
})
