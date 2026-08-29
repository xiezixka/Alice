import { describe, expect, it } from 'vitest'
import {
  buildAppleScriptHotkey,
  buildWindowsSendKeys,
  buildXdotoolHotkey,
} from '../../../electron/main/desktopHotkeys'

describe('cross-platform desktop hotkeys', () => {
  it('builds macOS character shortcuts with normalized modifiers', () => {
    expect(buildAppleScriptHotkey('CMD+SHIFT+L')).toBe(
      'tell application "System Events" to keystroke "l" using {command down, shift down}'
    )
  })

  it('uses macOS key codes for non-character keys', () => {
    expect(buildAppleScriptHotkey('CMD+ENTER')).toBe(
      'tell application "System Events" to key code 36 using {command down}'
    )
    expect(buildAppleScriptHotkey('SPACE')).toBe(
      'tell application "System Events" to key code 49'
    )
  })

  it('normalizes xdotool aliases for Linux', () => {
    expect(buildXdotoolHotkey('CMD+SHIFT+L')).toBe('super+shift+l')
    expect(buildXdotoolHotkey('CTRL+ENTER')).toBe('ctrl+Return')
  })

  it('builds Windows SendKeys syntax for modifiers and special keys', () => {
    expect(buildWindowsSendKeys('CTRL+V')).toBe('^v')
    expect(buildWindowsSendKeys('ALT+ENTER')).toBe('%{ENTER}')
    expect(buildWindowsSendKeys('SHIFT+TAB')).toBe('+{TAB}')
  })
})
