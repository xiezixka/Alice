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

/**
 * Build a PowerShell script that injects Unicode text through Win32
 * SendInput. WScript.Shell.SendKeys (used for shortcuts) is layout/ANSI based
 * and silently drops many Chinese characters and emoji. The text is passed as
 * UTF-8 base64 so user input can never become PowerShell source code.
 *
 * Newlines, tabs, and backspaces are emitted as virtual-key events because a
 * KEYEVENTF_UNICODE event for those control characters is not interpreted
 * consistently by native Windows controls.
 */
export function buildWindowsUnicodeTypeScript(text: string): string {
  const encodedText = Buffer.from(text, 'utf8').toString('base64')
  return `Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class AliceUnicodeInput
{
    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT
    {
        public uint type;
        public InputUnion U;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public UIntPtr dwExtraInfo;
    }

    private const uint INPUT_KEYBOARD = 1;
    private const uint KEYEVENTF_KEYUP = 0x0002;
    private const uint KEYEVENTF_UNICODE = 0x0004;

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] inputs, int size);

    private static void SendKeyboardEvent(
        ushort virtualKey,
        ushort scanCode,
        uint flags
    )
    {
        var input = new INPUT
        {
            type = INPUT_KEYBOARD,
            U = new InputUnion
            {
                ki = new KEYBDINPUT
                {
                    wVk = virtualKey,
                    wScan = scanCode,
                    dwFlags = flags,
                    time = 0,
                    dwExtraInfo = UIntPtr.Zero,
                },
            },
        };
        if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(INPUT))) != 1)
        {
            throw new Win32Exception(Marshal.GetLastWin32Error());
        }
    }

    private static void SendUnicode(char value)
    {
        SendKeyboardEvent(0, value, KEYEVENTF_UNICODE);
        SendKeyboardEvent(0, value, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
    }

    private static void SendVirtualKey(ushort value)
    {
        SendKeyboardEvent(value, 0, 0);
        SendKeyboardEvent(value, 0, KEYEVENTF_KEYUP);
    }

    public static void TypeText(string text)
    {
        if (text == null) return;
        for (var index = 0; index < text.Length; index++)
        {
            var value = text[index];
            if (value == '\\r')
            {
                if (index + 1 < text.Length && text[index + 1] == '\\n') index++;
                SendVirtualKey(0x000D);
            }
            else if (value == '\\n')
            {
                SendVirtualKey(0x000D);
            }
            else if (value == '\\t')
            {
                SendVirtualKey(0x0009);
            }
            else if (value == '\\b')
            {
                SendVirtualKey(0x0008);
            }
            else
            {
                SendUnicode(value);
            }
        }
    }
}
'@
$aliceText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedText}'))
[AliceUnicodeInput]::TypeText($aliceText)`
}

/**
 * Keep generated PowerShell commands comfortably below Windows' command-line
 * length limit. Array.from() splits by Unicode code point, so an emoji's
 * surrogate pair is never separated between chunks.
 */
export const WINDOWS_UNICODE_INPUT_CHUNK_SIZE = 2000

export function splitWindowsUnicodeInput(text: string): string[] {
  const codePoints = Array.from(text)
  if (codePoints.length === 0) return ['']
  const chunks: string[] = []
  for (
    let index = 0;
    index < codePoints.length;
    index += WINDOWS_UNICODE_INPUT_CHUNK_SIZE
  ) {
    chunks.push(
      codePoints.slice(index, index + WINDOWS_UNICODE_INPUT_CHUNK_SIZE).join('')
    )
  }
  return chunks
}
