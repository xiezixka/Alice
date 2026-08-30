import { describe, expect, it } from 'vitest'
import {
  matchesDesktopReplyContext,
  parseDesktopReplyRequest,
} from '../desktopReply'

describe('desktop reply request validation', () => {
  it('normalizes a valid request and defaults to Enter', () => {
    const result = parseDesktopReplyRequest({
      observationId: ' obs-1 ',
      recipient: '  小王  ',
      body: '第一行\n第二行',
    })

    expect(result).toEqual({
      success: true,
      request: {
        observationId: 'obs-1',
        recipient: '小王',
        body: '第一行\n第二行',
        sendShortcut: 'ENTER',
      },
    })
  })

  it('accepts explicit shortcut aliases but rejects arbitrary hotkeys', () => {
    expect(
      parseDesktopReplyRequest({
        observationId: 'obs-1',
        recipient: '小王',
        body: '好',
        sendShortcut: ' command + enter ',
      })
    ).toEqual({
      success: true,
      request: {
        observationId: 'obs-1',
        recipient: '小王',
        body: '好',
        sendShortcut: 'CMD+ENTER',
      },
    })

    const rejected = parseDesktopReplyRequest({
      observationId: 'obs-1',
      recipient: '小王',
      body: '好',
      sendShortcut: 'CMD+ALT+DELETE',
    })
    expect(rejected.success).toBe(false)
    if (!rejected.success) expect(rejected.error).toContain('sendShortcut')
  })

  it('rejects missing token, ambiguous recipient, and NUL input', () => {
    expect(parseDesktopReplyRequest({ recipient: '小王', body: '好' })).toEqual(
      {
        success: false,
        error: '桌面回复必须携带 desktop_observe 返回的 observationId。',
      }
    )
    expect(
      parseDesktopReplyRequest({
        observationId: 'obs-1',
        recipient: '小\n王',
        body: '好',
      }).success
    ).toBe(false)
    expect(
      parseDesktopReplyRequest({
        observationId: 'obs-1',
        recipient: '小王',
        body: '好\u0000',
      }).success
    ).toBe(false)
  })

  it('rejects empty and overlong bodies', () => {
    expect(
      parseDesktopReplyRequest({
        observationId: 'obs-1',
        recipient: '小王',
        body: '   ',
      }).success
    ).toBe(false)
    expect(
      parseDesktopReplyRequest({
        observationId: 'obs-1',
        recipient: '小王',
        body: 'a'.repeat(10_001),
      }).success
    ).toBe(false)
  })
})

describe('desktop reply context binding', () => {
  it('matches localized app/window hints case-insensitively', () => {
    expect(
      matchesDesktopReplyContext(
        { expectedApp: '微信', expectedWindowTitle: '小王' },
        { foregroundApp: 'WeChat', windowTitle: '小王 - 微信' }
      )
    ).toBe(false)

    expect(
      matchesDesktopReplyContext(
        { expectedApp: 'WeChat', expectedWindowTitle: '小王' },
        { foregroundApp: 'WeChat Helper', windowTitle: '小王 - 微信' }
      )
    ).toBe(true)
  })

  it('does not require optional hints when omitted', () => {
    expect(
      matchesDesktopReplyContext(
        {},
        { foregroundApp: undefined, windowTitle: undefined }
      )
    ).toBe(true)
  })
})
