interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

interface ManageClipboardArgs {
  action: 'read' | 'write'
  content?: string
}

export async function manage_clipboard(
  args: ManageClipboardArgs
): Promise<FunctionResult> {
  console.log(`Invoking clipboard action: ${args.action}`)

  try {
    if (typeof window === 'undefined' || !window.aliceIPC?.invoke) {
      return {
        success: false,
        error:
          'Electron IPC 桥接不可用，此功能只能在桌面应用中使用。',
      }
    }

    if (args.action !== 'read' && args.action !== 'write') {
      return {
        success: false,
        error: '剪贴板操作无效，必须是“read”或“write”。',
      }
    }

    if (
      args.action === 'write' &&
      (args.content === undefined || args.content === null)
    ) {
      return {
        success: false,
        error: '写入剪贴板时必须提供内容。',
      }
    }

    const result = await window.aliceIPC.invoke(
      'electron:manage-clipboard',
      args
    )
    console.log('Main process response for clipboard operation:', result)

    if (result.success) {
      if (args.action === 'read' && result.data !== undefined) {
        return {
          success: true,
          data: result.data,
        }
      }

      return {
        success: true,
        data: { message: result.message },
      }
    } else {
      return {
        success: false,
        error: result.message,
      }
    }
  } catch (error) {
    console.error('Error during clipboard operation:', error)
    return {
      success: false,
      error: `执行剪贴板操作失败：${error instanceof Error ? error.message : '未知错误'}`,
    }
  }
}
