const MAC_MODIFIERS: Record<string, string> = {
  cmd: 'command down',
  command: 'command down',
  meta: 'command down',
  win: 'command down',
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
}

const MAC_KEY_CODES: Record<string, number> = {
  return: 36,
  enter: 36,
  tab: 48,
  space: 49,
  backspace: 51,
  delete: 51,
  esc: 53,
  escape: 53,
  left: 123,
  arrowleft: 123,
  right: 124,
  arrowright: 124,
  down: 125,
  arrowdown: 125,
  up: 126,
  arrowup: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
}

const XDOTOOL_MODIFIERS: Record<string, string> = {
  cmd: 'super',
  command: 'super',
  meta: 'super',
  win: 'super',
  ctrl: 'ctrl',
  control: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
}

const WINDOWS_MODIFIERS: Record<string, string> = {
  ctrl: '^',
  control: '^',
  alt: '%',
  option: '%',
  shift: '+',
}

const WINDOWS_SPECIAL_KEYS: Record<string, string> = {
  return: '{ENTER}',
  enter: '{ENTER}',
  tab: '{TAB}',
  space: ' ',
  backspace: '{BACKSPACE}',
  delete: '{DEL}',
  esc: '{ESC}',
  escape: '{ESC}',
  left: '{LEFT}',
  arrowleft: '{LEFT}',
  right: '{RIGHT}',
  arrowright: '{RIGHT}',
  up: '{UP}',
  arrowup: '{UP}',
  down: '{DOWN}',
  arrowdown: '{DOWN}',
  home: '{HOME}',
  end: '{END}',
  pageup: '{PGUP}',
  pagedown: '{PGDN}',
}

function splitHotkey(rawKeys: string): string[] {
  return rawKeys
    .toLowerCase()
    .split(/[+\s]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

export function buildAppleScriptHotkey(rawKeys: string): string {
  const parts = splitHotkey(rawKeys)
  const modifiers = parts
    .slice(0, -1)
    .map(key => MAC_MODIFIERS[key])
    .filter(Boolean)
  const key = parts[parts.length - 1] || ''
  const using = modifiers.length ? ` using {${modifiers.join(', ')}}` : ''
  const keyCode = MAC_KEY_CODES[key]
  const press = Number.isFinite(keyCode)
    ? `key code ${keyCode}`
    : `keystroke "${escapeAppleScript(key)}"`
  return `tell application "System Events" to ${press}${using}`
}

export function buildXdotoolHotkey(rawKeys: string): string {
  return splitHotkey(rawKeys)
    .map((part, index, parts) => {
      if (index < parts.length - 1) return XDOTOOL_MODIFIERS[part] || part
      return part === 'return' || part === 'enter' ? 'Return' : part
    })
    .join('+')
}

export function buildWindowsSendKeys(rawKeys: string): string {
  const parts = splitHotkey(rawKeys)
  const key = parts.pop() || ''
  const prefix = parts.map(part => WINDOWS_MODIFIERS[part] || '').join('')
  const keyToken =
    WINDOWS_SPECIAL_KEYS[key] ||
    (key.length === 1 ? key : `{${key.toUpperCase()}}`)
  return `${prefix}${keyToken}`
}
