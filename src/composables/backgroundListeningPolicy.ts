/**
 * Configuration requirements for the always-on local wake-word listener.
 * Keeping this predicate independent from Vue/Electron lets the settings
 * loader and the settings UI enforce the same privacy invariant:
 * backgroundListeningEnabled can only be true when local STT + a wake word
 * are configured.
 */
import { isValidWakeWord } from './wakeWordConfig'

export interface BackgroundListeningConfig {
  sttProvider?: string
  localSttEnabled?: boolean
  localSttWakeWord?: string | null
  backgroundListeningEnabled?: boolean
}

export function hasBackgroundListeningPrerequisites(
  config: BackgroundListeningConfig
): boolean {
  return (
    config.sttProvider === 'local' &&
    config.localSttEnabled === true &&
    isValidWakeWord(config.localSttWakeWord)
  )
}

export function shouldDisableBackgroundListening(
  config: BackgroundListeningConfig
): boolean {
  return (
    config.backgroundListeningEnabled === true &&
    !hasBackgroundListeningPrerequisites(config)
  )
}
