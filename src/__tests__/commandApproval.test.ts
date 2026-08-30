import { describe, expect, it } from 'vitest'
import {
  commandNameKey,
  hasShellOperators,
  isCommandNameApproved,
  normalizeApprovedCommandNames,
  normalizeCommandName,
} from '../utils/commandApproval'

describe('command approval helpers', () => {
  it('normalizes quoted executable paths for approval', () => {
    expect(normalizeCommandName('/usr/bin/ls -la')).toBe('ls')
    expect(
      normalizeCommandName('"C:\\Windows\\System32\\WHOAMI.exe" /all')
    ).toBe('WHOAMI.exe')
    expect(normalizeCommandName("'~/bin/custom-tool' --version")).toBe(
      'custom-tool'
    )
  })

  it('compares executable names case-insensitively', () => {
    expect(commandNameKey('PowerShell.exe')).toBe('powershell.exe')
    expect(
      isCommandNameApproved('POWERSHELL.EXE -NoProfile', ['powershell.exe'])
    ).toBe(true)
    expect(isCommandNameApproved('python script.py', ['node'])).toBe(false)
  })

  it('detects shell composition but ignores quoted punctuation', () => {
    expect(hasShellOperators('ls -la')).toBe(false)
    expect(hasShellOperators('echo "a;b|c"')).toBe(false)
    expect(hasShellOperators('ls; rm -rf /')).toBe(true)
    expect(hasShellOperators('cat file.txt | grep secret')).toBe(true)
    expect(hasShellOperators('echo $(whoami)')).toBe(true)
    expect(hasShellOperators('printf "ok" > result.txt')).toBe(true)
    expect(hasShellOperators('echo `whoami`')).toBe(true)
  })

  it('normalizes and bounds persisted approval names', () => {
    expect(
      normalizeApprovedCommandNames([
        'ls -la',
        '/bin/LS',
        '',
        null,
        'dir',
        'DIR',
      ])
    ).toEqual(['ls', 'dir'])

    expect(normalizeApprovedCommandNames(['one', 'two', 'three'], 2)).toEqual([
      'one',
      'two',
    ])
  })

  it('does not let an approved executable inherit through shell operators', () => {
    const command = 'ls; rm -rf /'
    expect(isCommandNameApproved(command, ['ls'])).toBe(false)
    expect(hasShellOperators(command)).toBe(true)
  })
})
