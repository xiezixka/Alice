import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_LAUNCH_ARG,
  buildRelaunchArgs,
  getBackgroundLaunchPresentation,
  hasValidBackgroundListeningPrerequisites,
  isBackgroundListeningActive,
  shouldKeepWindowHiddenForSecondInstance,
} from '../../electron/main/backgroundLaunch'

const validBackgroundSettings = {
  backgroundListeningEnabled: true,
  sttProvider: 'local',
  localSttEnabled: true,
  localSttWakeWord: 'alice',
  onboardingCompleted: true,
  macSilentModeEnabled: true,
}

describe('background launch argument policy', () => {
  it('preserves unrelated relaunch arguments and adds one background flag', () => {
    expect(
      buildRelaunchArgs(
        [
          '/Applications/Alice.app/Contents/MacOS/Alice',
          '--inspect',
          BACKGROUND_LAUNCH_ARG,
        ],
        true
      )
    ).toEqual([
      '/Applications/Alice.app/Contents/MacOS/Alice',
      '--inspect',
      BACKGROUND_LAUNCH_ARG,
    ])
  })

  it('removes a stale background flag when the setting is disabled', () => {
    expect(
      buildRelaunchArgs(['alice.asar', BACKGROUND_LAUNCH_ARG, '--dev'], false)
    ).toEqual(['alice.asar', '--dev'])
  })

  it('does not reveal the window for a duplicate background launch', () => {
    expect(
      shouldKeepWindowHiddenForSecondInstance(
        ['alice', BACKGROUND_LAUNCH_ARG],
        true
      )
    ).toBe(true)
    expect(
      shouldKeepWindowHiddenForSecondInstance(
        ['alice', BACKGROUND_LAUNCH_ARG],
        false
      )
    ).toBe(false)
  })

  it('reveals the window for a normal manual duplicate launch', () => {
    expect(shouldKeepWindowHiddenForSecondInstance(['alice'], true)).toBe(false)
  })

  it('requires local STT, an enabled local listener, and a valid wake word', () => {
    expect(
      hasValidBackgroundListeningPrerequisites(validBackgroundSettings)
    ).toBe(true)
    expect(
      hasValidBackgroundListeningPrerequisites({
        ...validBackgroundSettings,
        sttProvider: 'openai',
      })
    ).toBe(false)
    expect(
      hasValidBackgroundListeningPrerequisites({
        ...validBackgroundSettings,
        localSttWakeWord: '',
      })
    ).toBe(false)
  })

  it('keeps onboarding and invalid configurations visible', () => {
    expect(isBackgroundListeningActive(validBackgroundSettings)).toBe(true)
    expect(
      isBackgroundListeningActive({
        ...validBackgroundSettings,
        onboardingCompleted: false,
      })
    ).toBe(false)
    expect(
      getBackgroundLaunchPresentation(
        { ...validBackgroundSettings, onboardingCompleted: false },
        'darwin'
      )
    ).toEqual({ launchInBackground: false, silentIsland: false })
    expect(
      getBackgroundLaunchPresentation(
        { ...validBackgroundSettings, localSttEnabled: false },
        'darwin'
      )
    ).toEqual({ launchInBackground: false, silentIsland: false })
  })

  it('shows a normal macOS window when silent-island mode is disabled', () => {
    expect(
      getBackgroundLaunchPresentation(
        { ...validBackgroundSettings, macSilentModeEnabled: false },
        'darwin'
      )
    ).toEqual({ launchInBackground: true, silentIsland: false })
  })

  it('fails closed for malformed silent-island values while preserving legacy defaults', () => {
    expect(
      getBackgroundLaunchPresentation(
        {
          ...validBackgroundSettings,
          macSilentModeEnabled: 'false' as unknown as boolean,
        },
        'darwin'
      )
    ).toEqual({ launchInBackground: true, silentIsland: false })
    expect(
      getBackgroundLaunchPresentation(
        { ...validBackgroundSettings, macSilentModeEnabled: undefined },
        'darwin'
      )
    ).toEqual({ launchInBackground: true, silentIsland: true })
  })

  it('keeps the legacy hidden login-item behaviour on other platforms', () => {
    expect(
      getBackgroundLaunchPresentation(validBackgroundSettings, 'win32')
    ).toEqual({ launchInBackground: true, silentIsland: false })
    expect(
      getBackgroundLaunchPresentation(validBackgroundSettings, 'linux')
    ).toEqual({ launchInBackground: true, silentIsland: false })
  })
})
