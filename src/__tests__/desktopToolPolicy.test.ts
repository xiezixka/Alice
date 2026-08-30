import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  buildWindowsUnicodeTypeScript,
  splitWindowsUnicodeInput,
  WINDOWS_UNICODE_INPUT_CHUNK_SIZE,
} from '../../electron/main/desktopHotkeys'
import { isAssistantToolEnabled } from '../utils/assistantTools'
import { executeFunction } from '../utils/functionCaller'
import { desktop_reply_message } from '../utils/functions/filesystem'

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

  it('blocks screen capture for an enabled text-only model', async () => {
    const captureScreen = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { captureScreen } }

    const result = await executeFunction(
      'capture_desktop_screen',
      {},
      {
        assistantTools: ['capture_desktop_screen'],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash',
      }
    )

    expect(result).toContain('当前模型不支持视觉输入')
    expect(captureScreen).not.toHaveBeenCalled()
  })

  it('blocks desktop observations for an enabled text-only model', async () => {
    const observeScreen = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { observeScreen } }

    const result = await executeFunction(
      'desktop_observe',
      {},
      {
        assistantTools: ['desktop_observe'],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash',
      }
    )

    expect(result).toContain('当前模型不支持视觉输入')
    expect(observeScreen).not.toHaveBeenCalled()
  })

  it('blocks open-chat replies for an enabled text-only model', async () => {
    const replyMessage = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { replyMessage } }

    const result = await executeFunction(
      'desktop_reply_message',
      {
        observationId: 'obs-1',
        recipient: '小王',
        body: '明天见',
      },
      {
        assistantTools: [
          'desktop_reply_message',
          'desktop_observe',
          'desktop_action',
        ],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash',
      }
    )

    expect(result).toContain('当前模型不支持视觉输入')
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('allows screen capture for a configured vision model', async () => {
    const captureScreen = vi.fn().mockResolvedValue({
      success: true,
      data: {
        imageDataUrl: 'data:image/jpeg;base64,abc',
        width: 1,
        height: 1,
      },
    })
    ;(globalThis as any).window = { desktopAPI: { captureScreen } }

    const result = await executeFunction(
      'capture_desktop_screen',
      {},
      {
        assistantTools: ['capture_desktop_screen'],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash-vision-exp',
      }
    )

    expect(result).toContain('供视觉模型分析')
    expect(captureScreen).toHaveBeenCalledTimes(1)
  })

  it('normalizes a legacy direct capture frame without duplicating pixels', async () => {
    const captureScreen = vi.fn().mockResolvedValue({
      success: true,
      data: {
        imageDataUrl: 'data:image/jpeg;base64,legacy',
        width: 800,
        height: 500,
        displayId: 'primary',
      },
    })
    ;(globalThis as any).window = { desktopAPI: { captureScreen } }

    const result = await executeFunction(
      'capture_desktop_screen',
      {},
      {
        assistantTools: ['capture_desktop_screen'],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash-vision-exp',
      }
    )

    const payload = JSON.parse(result) as Record<string, any>
    expect(payload.imageDataUrl).toBeUndefined()
    expect(payload.screenshot.imageDataUrl).toBe(
      'data:image/jpeg;base64,legacy'
    )
  })

  it('returns an observation token and screenshot to a vision model', async () => {
    const observeScreen = vi.fn().mockResolvedValue({
      success: true,
      data: {
        message: 'observed',
        observationId: 'obs-test-1',
        observedAt: '2026-08-30T12:00:00.000Z',
        expiresAt: '2026-08-30T12:00:30.000Z',
        context: { displayId: '1', scaleFactor: 2 },
        screenshot: {
          imageDataUrl: 'data:image/jpeg;base64,abc',
          width: 1600,
          height: 1000,
          imageWidth: 1600,
          imageHeight: 1000,
          displayId: '1',
          coordinateSpace: 'image-pixels',
        },
      },
    })
    ;(globalThis as any).window = { desktopAPI: { observeScreen } }

    const result = await executeFunction(
      'desktop_observe',
      {},
      {
        assistantTools: ['desktop_observe'],
        aiProvider: 'deepseek',
        assistantModel: 'deepseek-v4-flash-vision-exp',
      }
    )

    expect(result).toContain('obs-test-1')
    expect(result).toContain('data:image/jpeg;base64,abc')
    const payload = JSON.parse(result) as Record<string, any>
    expect(payload.imageDataUrl).toBeUndefined()
    expect(payload.screenshot.imageDataUrl).toBe('data:image/jpeg;base64,abc')
    expect(observeScreen).toHaveBeenCalledTimes(1)
  })

  it('executes an enabled atomic chat reply through the desktop bridge', async () => {
    const replyMessage = vi.fn().mockResolvedValue({
      success: true,
      action: 'reply_message',
      recipient: '小王',
      sent: true,
      message: '已发送',
    })
    ;(globalThis as any).window = { desktopAPI: { replyMessage } }

    const result = await executeFunction(
      'desktop_reply_message',
      {
        observationId: 'obs-1',
        recipient: '小王',
        body: '明天见',
      },
      {
        assistantTools: [
          'desktop_reply_message',
          'desktop_observe',
          'desktop_action',
        ],
      }
    )

    expect(result).toContain('reply_message')
    expect(replyMessage).toHaveBeenCalledWith({
      observationId: 'obs-1',
      recipient: '小王',
      body: '明天见',
    })
  })

  it('blocks the atomic chat reply when its underlying tools are disabled', async () => {
    const replyMessage = vi.fn()
    ;(globalThis as any).window = { desktopAPI: { replyMessage } }

    const result = await executeFunction(
      'desktop_reply_message',
      {
        observationId: 'obs-1',
        recipient: '小王',
        body: '明天见',
      },
      { assistantTools: ['desktop_reply_message'] }
    )

    expect(result).toContain('工具当前未启用')
    expect(replyMessage).not.toHaveBeenCalled()
  })

  it('preserves partial reply metadata returned by the desktop bridge', async () => {
    const bridgeResult = {
      success: false,
      action: 'reply_message',
      recipient: '小王',
      typed: true,
      sent: false,
      error: '正文已输入，但发送前窗口发生变化。',
    }
    const replyMessage = vi.fn().mockResolvedValue(bridgeResult)
    ;(globalThis as any).window = { desktopAPI: { replyMessage } }

    const result = await desktop_reply_message({
      observationId: 'obs-1',
      recipient: '小王',
      body: '明天见',
    })

    expect(result).toEqual({
      success: false,
      error: bridgeResult.error,
      data: bridgeResult,
    })
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
    const settings = {
      assistantTools: ['desktop_observe', 'desktop_action', 'find_files'],
    }

    expect(isAssistantToolEnabled('desktop_observe', settings)).toBe(true)
    expect(isAssistantToolEnabled('desktop_action', settings)).toBe(true)
    expect(isAssistantToolEnabled('organize_files', settings)).toBe(false)
  })

  it('requires observation and action tools for the atomic chat reply tool', () => {
    expect(
      isAssistantToolEnabled('desktop_reply_message', {
        assistantTools: ['desktop_reply_message'],
      })
    ).toBe(false)
    expect(
      isAssistantToolEnabled('desktop_reply_message', {
        assistantTools: ['desktop_reply_message', 'desktop_observe'],
      })
    ).toBe(false)
    expect(
      isAssistantToolEnabled('desktop_reply_message', {
        assistantTools: [
          'desktop_reply_message',
          'desktop_observe',
          'desktop_action',
        ],
      })
    ).toBe(true)
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
