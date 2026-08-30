/**
 * Command-line helpers for the optional background-listening launch mode.
 *
 * Keep these functions independent from Electron so the restart/second-instance
 * policy can be regression-tested without starting an Electron process.
 */
import { isValidWakeWord } from '../../src/composables/wakeWordConfig'

export const BACKGROUND_LAUNCH_ARG = '--alice-background'

/** The subset of persisted settings needed by native background-launch policy. */
export interface BackgroundListeningSettingsLike {
  backgroundListeningEnabled?: boolean
  sttProvider?: string
  localSttEnabled?: boolean
  localSttWakeWord?: unknown
  onboardingCompleted?: boolean
  macSilentModeEnabled?: boolean
}

/**
 * Return whether the persisted settings can actually start the local
 * wake-word listener.  The renderer applies the same invariant when it
 * validates settings; keeping a native copy prevents a malformed/legacy JSON
 * file from launching a permanently hidden window with no usable listener.
 */
export function hasValidBackgroundListeningPrerequisites(
  settings: BackgroundListeningSettingsLike | null | undefined
): boolean {
  return (
    settings?.sttProvider === 'local' &&
    settings.localSttEnabled === true &&
    isValidWakeWord(settings.localSttWakeWord)
  )
}

/**
 * Effective background-listening preference after validating persisted
 * settings. This predicate is useful for configuration/UI checks; native
 * runtime actions should call `isBackgroundListeningActive`, which also
 * requires completed onboarding.
 */
export function isBackgroundListeningEnabled(
  settings: BackgroundListeningSettingsLike | null | undefined
): boolean {
  return (
    settings?.backgroundListeningEnabled === true &&
    hasValidBackgroundListeningPrerequisites(settings)
  )
}

/**
 * Background listening is only active after onboarding has completed.  Native
 * tray/close/relaunch paths use this stricter predicate so a malformed legacy
 * file cannot hide the onboarding window or strand the user in the tray.
 */
export function isBackgroundListeningActive(
  settings: BackgroundListeningSettingsLike | null | undefined
): boolean {
  return (
    settings?.onboardingCompleted === true &&
    isBackgroundListeningEnabled(settings)
  )
}

export interface BackgroundLaunchPresentation {
  /** Whether the login-item window should start hidden at all. */
  launchInBackground: boolean
  /** Whether a hidden macOS launch may reveal the compact silent island. */
  silentIsland: boolean
}

/**
 * Resolve the native startup presentation from raw settings.  Invalid or
 * incomplete settings deliberately fall back to a visible window so the user
 * can repair configuration instead of being left with no UI.
 */
export function getBackgroundLaunchPresentation(
  settings: BackgroundListeningSettingsLike | null | undefined,
  platform: string | undefined
): BackgroundLaunchPresentation {
  const launchInBackground = isBackgroundListeningActive(settings)
  // Missing is a backwards-compatible opt-in default; any malformed value
  // is fail-closed and keeps the full window visible so the user can repair
  // the configuration instead of being stranded in a hidden launch.
  const silentModeEnabled =
    settings?.macSilentModeEnabled === undefined
      ? true
      : settings.macSilentModeEnabled === true
  const silentIsland =
    launchInBackground && platform === 'darwin' && silentModeEnabled

  return { launchInBackground, silentIsland }
}

/**
 * Build the arguments for `app.relaunch` while preserving every unrelated
 * argument from the current process. Electron expects the executable/app path
 * to remain in this array (callers should pass `process.argv.slice(1)`).
 *
 * The flag is treated as a singleton: stale copies are removed before the
 * desired state is appended. This matters when a user turns background
 * listening off and then changes another setting that triggers a restart.
 */
export function buildRelaunchArgs(
  processArgs: readonly string[],
  backgroundListeningEnabled: boolean
): string[] {
  const preservedArgs = processArgs.filter(
    argument => argument !== BACKGROUND_LAUNCH_ARG
  )

  return backgroundListeningEnabled
    ? [...preservedArgs, BACKGROUND_LAUNCH_ARG]
    : [...preservedArgs]
}

/**
 * Login-item launches include the background flag. If an already-running
 * Alice instance receives that duplicate launch, keep its window hidden when
 * the persisted setting still enables background listening. A manual launch
 * (without the flag) must continue to reveal/focus the existing window.
 */
export function shouldKeepWindowHiddenForSecondInstance(
  commandLine: readonly string[],
  backgroundListeningEnabled: boolean
): boolean {
  return (
    backgroundListeningEnabled && commandLine.includes(BACKGROUND_LAUNCH_ARG)
  )
}
