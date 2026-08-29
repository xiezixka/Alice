import { describe, expect, it } from 'vitest'
import { extractToolVisualOutput } from '../toolVisualOutput'

const screenshot = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ=='

describe('extractToolVisualOutput', () => {
  it('strips screenshot pixels from the persisted tool text', () => {
    const result = extractToolVisualOutput(
      JSON.stringify({
        message: '已捕获当前屏幕截图。',
        screenshot: {
          imageDataUrl: screenshot,
          width: 800,
          height: 500,
        },
      })
    )

    expect(result.visual).toMatchObject({
      imageUrl: screenshot,
      detail: 'high',
      contextText: '已捕获当前屏幕截图。',
    })
    expect(result.text).not.toContain(screenshot)
    expect(result.text).toContain('800')
  })

  it('ignores malformed or oversized image data', () => {
    const result = extractToolVisualOutput(
      JSON.stringify({ screenshot: { imageDataUrl: 'not-an-image' } })
    )
    expect(result.visual).toBeUndefined()
    expect(result.text).toContain('not-an-image')
  })
})
