import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildWindowsUnicodeTypeScript,
  splitWindowsUnicodeInput,
  WINDOWS_UNICODE_INPUT_CHUNK_SIZE,
} from '../../electron/main/desktopHotkeys'
import { isAssistantToolEnabled } from '../utils/assistantTools'
import { executeFunction } from '../utils/functionCaller'

const customToolSnapshot = (overrides: Record<string, unknown> = {}) => ({
  tools: [
    {
      id: 'custom-1',
      name: 'my_custom_file_tool',
      description: 'test custom tool',
      parameters: { type: 'object', properties: {} },
      enabled: true,
      isValid: true,
      errors: [],
      handler: {
        type: 'script',
        entry: 'custom-tool-scripts/test.js',
      },
      ...overrides,
    },
  ],
  diagnostics: [],
  filePath: '/tmp/custom-tools.json',
  lastModified: Date.now(),
})

describe('execution-time tool policy', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
    delete (globalThis as any).window
  })

  it('blocks a disabled desktop action before invoking the desktop bridge', async () => {
    const runAction = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { runAction } }

    const result = await executeFunction(
      'desktop_action',
      { action: 'open_app', target: '日历' },
      { assistantTools: [] }
    )

    expect(result).toContain('工具当前未启用')
    expect(runAction).not.toHaveBeenCalled()
  })

  it('falls back to the active settings store when no snapshot is supplied', async () => {
    const { useSettingsStore } = await import('../stores/settingsStore')
    const settingsStore = useSettingsStore()
    settingsStore.updateSetting('assistantTools', [])
    const runAction = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { runAction } }

    const result = await executeFunction('desktop_action', {
      action: 'open_app',
      target: '日历',
    })

    expect(result).toContain('工具当前未启用')
    expect(runAction).not.toHaveBeenCalled()
  })

  it('executes an enabled and valid custom tool, but never a disabled one', async () => {
    const execute = vi.fn().mockResolvedValue({
      success: true,
      data: { success: true, data: { message: 'ok' } },
    })
    const list = vi
      .fn()
      .mockResolvedValue({ success: true, data: customToolSnapshot() })
    ;(globalThis as any).window = {
      customToolsAPI: { list, execute },
    }

    const enabledResult = await executeFunction(
      'my_custom_file_tool',
      {},
      { assistantTools: [] }
    )
    expect(enabledResult).toContain('message')
    expect(execute).toHaveBeenCalledTimes(1)

    setActivePinia(createPinia())
    list.mockResolvedValue({
      success: true,
      data: customToolSnapshot({ enabled: false }),
    })
    const disabledResult = await executeFunction(
      'my_custom_file_tool',
      {},
      { assistantTools: [] }
    )
    expect(disabledResult).toContain('当前未启用')
    expect(execute).toHaveBeenCalledTimes(1)
  })
})

describe('desktop tool execution policy', () => {
  it('allows a configured predefined tool and blocks a disabled one', () => {
    const settings = { assistantTools: ['desktop_action', 'find_files'] }

    expect(isAssistantToolEnabled('desktop_action', settings)).toBe(true)
    expect(isAssistantToolEnabled('organize_files', settings)).toBe(false)
  })

  it('fails closed when the predefined tool list is malformed', () => {
    expect(
      isAssistantToolEnabled('send_email', { assistantTools: 'send_email' })
    ).toBe(false)
    expect(isAssistantToolEnabled('send_email', { assistantTools: null })).toBe(
      false
    )
  })

  it('keeps custom tool names independent from predefined settings', () => {
    expect(
      isAssistantToolEnabled('my_custom_file_tool', {
        assistantTools: [],
      })
    ).toBe(true)
    expect(isAssistantToolEnabled('desktop_action', undefined)).toBe(true)
  })
})

describe('Windows Unicode desktop typing', () => {
  it('encodes Chinese, emoji, and control characters outside PowerShell source', () => {
    const text = '请打开日历 😀\n第二行'
    const script = buildWindowsUnicodeTypeScript(text)
    const encoded = Buffer.from(text, 'utf8').toString('base64')

    expect(script).toContain('KEYEVENTF_UNICODE')
    expect(script).toContain('[AliceUnicodeInput]::TypeText($aliceText)')
    expect(script).toContain(encoded)
    expect(script).not.toContain(text)
  })

  it('splits long text by code point without breaking surrogate pairs', () => {
    const text = `${'中'.repeat(WINDOWS_UNICODE_INPUT_CHUNK_SIZE)}😀尾`
    const chunks = splitWindowsUnicodeInput(text)

    expect(chunks).toHaveLength(2)
    expect(chunks.join('')).toBe(text)
    expect(chunks[0].endsWith('\uD83D')).toBe(false)
    expect(chunks[1].startsWith('\uDE00')).toBe(false)
  })
})
