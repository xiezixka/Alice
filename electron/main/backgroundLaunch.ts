/**
 * Command-line helpers for the optional background-listening launch mode.
 *
 * Keep these functions independent from Electron so the restart/second-instance
 * policy can be regression-tested without starting an Electron process.
 */
export const BACKGROUND_LAUNCH_ARG = '--alice-background'

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
