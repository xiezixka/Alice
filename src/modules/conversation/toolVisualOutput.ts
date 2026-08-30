export interface ToolVisualOutput {
  imageUrl: string
  detail: 'low' | 'high' | 'auto'
  contextText: string
}

interface ScreenshotPayload {
  imageDataUrl?: unknown
  detail?: unknown
}

interface ToolResultPayload {
  message?: unknown
  screenshot?: ScreenshotPayload
  /** Legacy desktop bridges sometimes put the pixels directly on the result. */
  imageDataUrl?: unknown
  [key: string]: unknown
}

const DATA_URL_PATTERN =
  /^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i
const MAX_DATA_URL_LENGTH = 8_000_000

/**
 * Pulls a screenshot out of a function result without persisting its pixels in
 * chat history. The returned text remains safe to show to a non-vision model.
 */
export function extractToolVisualOutput(content: string): {
  text: string
  visual?: ToolVisualOutput
} {
  if (typeof content !== 'string' || content.length === 0) {
    return { text: content }
  }

  let payload: ToolResultPayload
  try {
    payload = JSON.parse(content) as ToolResultPayload
  } catch {
    return { text: content }
  }

  const legacyImageDataUrl = payload.imageDataUrl
  const screenshotPayload =
    payload.screenshot ||
    (typeof legacyImageDataUrl === 'string'
      ? (payload as ScreenshotPayload)
      : undefined)
  const imageDataUrl = screenshotPayload?.imageDataUrl
  if (
    typeof imageDataUrl !== 'string' ||
    imageDataUrl.length > MAX_DATA_URL_LENGTH ||
    !DATA_URL_PATTERN.test(imageDataUrl)
  ) {
    return { text: content }
  }

  // Drop both the canonical nested pixels and any legacy top-level duplicate
  // before serializing the text that is persisted in conversation history.
  const { screenshot, imageDataUrl: _legacyPixels, ...rest } = payload
  const screenshotMetadata = screenshot
    ? { ...screenshot, imageDataUrl: undefined }
    : undefined
  if (screenshotMetadata) delete screenshotMetadata.imageDataUrl

  const text = JSON.stringify({
    ...rest,
    ...(screenshotMetadata ? { screenshot: screenshotMetadata } : {}),
  })
  const contextText =
    typeof payload.message === 'string' && payload.message.trim()
      ? payload.message.trim()
      : '已捕获当前屏幕截图，供视觉模型分析。'
  const detail =
    screenshotPayload?.detail === 'low' || screenshotPayload?.detail === 'auto'
      ? screenshotPayload.detail
      : 'high'

  return {
    text,
    visual: { imageUrl: imageDataUrl, detail, contextText },
  }
}
