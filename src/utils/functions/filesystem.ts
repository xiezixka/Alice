import type {
  DesktopActionArgs,
  DesktopObservationResponse,
  DesktopReplyArgs,
} from '../../types/desktop'

interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

export interface OpenPathArgs {
  target: string
}

export interface ListDirectoryArgs {
  path: string
}

export interface ExecuteCommandArgs {
  command: string
}

export interface FindFilesArgs {
  path: string
  query?: string
  maxResults?: number
  maxDepth?: number
  includeHidden?: boolean
}

export interface FileOperation {
  action: 'move' | 'copy' | 'rename'
  source: string
  destination: string
}

function requireDesktopAPI() {
  if (typeof window === 'undefined' || !window.desktopAPI) {
    throw new Error('Electron 桌面桥接不可用，此功能只能在桌面应用中使用。')
  }
  return window.desktopAPI
}

export async function open_path(args: OpenPathArgs): Promise<FunctionResult> {
  console.log(`Invoking open_path with target: ${args.target}`)

  try {
    if (typeof window === 'undefined' || !window.aliceIPC?.invoke) {
      return {
        success: false,
        error: 'Electron IPC 桥接不可用，此功能只能在桌面应用中使用。',
      }
    }

    const result = await window.aliceIPC.invoke('electron:open-path', args)
    console.log('Main process response for open_path:', result)

    if (result.success) {
      return { success: true, data: { message: result.message } }
    } else {
      return { success: false, error: result.message }
    }
  } catch (error) {
    console.error('Error invoking electron:open-path:', error)
    return {
      success: false,
      error: `打开路径失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}

export async function list_directory(
  args: ListDirectoryArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().listDirectory(args.path)
    if (result.success) {
      return { success: true, data: result.files }
    } else {
      return { success: false, error: result.error }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function execute_command(
  args: ExecuteCommandArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().executeCommand(args.command)
    if (result.success) {
      return { success: true, data: result.output }
    } else {
      return { success: false, error: result.error }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function list_directory_detailed(args: {
  path: string
}): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().listDirectoryDetailed(args.path)
    return result.success
      ? { success: true, data: result.entries || [] }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function find_files(args: FindFilesArgs): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().findFiles(args)
    return result.success
      ? { success: true, data: result }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function organize_files(args: {
  operations: FileOperation[]
  dryRun?: boolean
}): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().applyFileOperations(args)
    return result.success
      ? { success: true, data: result }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function undo_file_organization(args: {
  operationId: string
}): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().undoFileOperations(
      args.operationId
    )
    return result.success
      ? { success: true, data: result }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktop_capabilities(): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().getCapabilities()
    return { success: true, data: result }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Normalize the slightly different response shapes emitted by old and new
 * desktop bridges.  New bridges return observation metadata plus a nested
 * `screenshot`; older capture bridges return the screenshot fields directly.
 * Keeping one shape here lets the visual-output extractor attach pixels to
 * the current model turn without persisting them in chat history.
 */
function normalizeDesktopObservationData(
  data: Record<string, any>,
  fallbackMessage: string
): Record<string, any> {
  const directScreenshot =
    data.screenshot ||
    (typeof data.imageDataUrl === 'string' ? { ...data } : null)
  const hasObservationMetadata =
    Boolean(data.observationId) ||
    Boolean(data.observedAt) ||
    Boolean(data.expiresAt) ||
    Boolean(data.context) ||
    Boolean(data.displayBounds) ||
    Boolean(data.imageWidth) ||
    Boolean(data.imageHeight)

  // Preserve the historical `{ message, screenshot }` shape for an old
  // bridge that only returns image dimensions.  New bridges retain all
  // observation metadata while still nesting the pixels under screenshot.
  if (
    !hasObservationMetadata &&
    !data.screenshot &&
    typeof data.imageDataUrl === 'string'
  ) {
    return {
      message:
        typeof data.message === 'string' && data.message.trim()
          ? data.message
          : fallbackMessage,
      screenshot: directScreenshot,
    }
  }

  // Never leave a direct imageDataUrl at the top level.  The conversation
  // visual extractor removes pixels from `screenshot`; keeping a duplicate
  // top-level field would otherwise persist the screenshot in history.
  const {
    screenshot: _nestedScreenshot,
    imageDataUrl: _pixels,
    ...metadata
  } = data
  return {
    ...metadata,
    message:
      typeof data.message === 'string' && data.message.trim()
        ? data.message
        : fallbackMessage,
    ...(directScreenshot ? { screenshot: directScreenshot } : {}),
  }
}

/**
 * Captures a short-lived, context-bound observation token and the matching
 * screenshot.  Mutating desktop actions use the returned observationId to
 * ensure the foreground window and display have not changed since this read.
 */
export async function desktop_observe(): Promise<FunctionResult> {
  try {
    const desktopAPI = requireDesktopAPI()
    const observeScreen = (
      desktopAPI as unknown as {
        observeScreen?: () => Promise<DesktopObservationResponse>
      }
    ).observeScreen
    if (typeof observeScreen !== 'function') {
      return {
        success: false,
        error: '当前桌面桥接不支持安全观察令牌，请重启或更新 Alice 后重试。',
      }
    }

    const result = await observeScreen()
    if (!result.success || !result.data) {
      return { success: false, error: result.error || '屏幕观察失败。' }
    }

    return {
      success: true,
      data: normalizeDesktopObservationData(
        result.data,
        '已观察当前屏幕并生成短期观察令牌，供视觉模型分析。'
      ),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function capture_desktop_screen(): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().captureScreen()
    if (!result.success || !result.data) {
      return { success: false, error: result.error || '屏幕读取失败。' }
    }

    // The data URL is intentionally returned only to the current tool call.
    // The conversation layer strips it before adding the tool message to history.
    return {
      success: true,
      data: normalizeDesktopObservationData(
        result.data,
        '已捕获当前屏幕截图，供视觉模型分析。'
      ),
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktop_action(
  args: DesktopActionArgs
): Promise<FunctionResult> {
  try {
    const result = await requireDesktopAPI().runAction(args)
    return result.success
      ? { success: true, data: result }
      : { success: false, error: result.error }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

/**
 * Send a reply in the already-open chat that the model just inspected.
 *
 * This is intentionally separate from the generic desktop_action tool: the
 * main process can show one confirmation containing the exact recipient and
 * body, then type and send as one token-bound operation.  It never discovers
 * or opens a background chat account.
 */
export async function desktop_reply_message(
  args: DesktopReplyArgs
): Promise<FunctionResult> {
  try {
    const desktopAPI = requireDesktopAPI() as typeof window.desktopAPI & {
      replyMessage?: (request: DesktopReplyArgs) => Promise<any>
    }
    if (typeof desktopAPI.replyMessage !== 'function') {
      return {
        success: false,
        error: '当前桌面桥接不支持安全的聊天回复，请重启或更新 Alice 后重试。',
      }
    }
    const result = await desktopAPI.replyMessage(args)
    return result.success
      ? { success: true, data: result }
      : { success: false, error: result.error || '发送聊天回复失败。' }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}
