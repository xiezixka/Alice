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
    throw new Error(
      'Electron 桌面桥接不可用，此功能只能在桌面应用中使用。'
    )
  }
  return window.desktopAPI
}

export async function open_path(args: OpenPathArgs): Promise<FunctionResult> {
  console.log(`Invoking open_path with target: ${args.target}`)

  try {
    if (typeof window === 'undefined' || !window.aliceIPC?.invoke) {
      return {
        success: false,
        error:
          'Electron IPC 桥接不可用，此功能只能在桌面应用中使用。',
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
      data: {
        message: '已捕获当前屏幕截图，供视觉模型分析。',
        screenshot: result.data,
      },
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function desktop_action(
  args: Record<string, any>
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
