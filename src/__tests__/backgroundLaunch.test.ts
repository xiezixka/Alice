import { describe, expect, it } from 'vitest'
import {
  BACKGROUND_LAUNCH_ARG,
  buildRelaunchArgs,
  shouldKeepWindowHiddenForSecondInstance,
} from '../../electron/main/backgroundLaunch'

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
})
