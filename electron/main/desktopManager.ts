import {
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  screen,
  shell,
  systemPreferences,
} from 'electron'
import fs from 'fs/promises'
import { exec, execFile } from 'child_process'
import { promisify } from 'node:util'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { isPathWithinRoot } from './securityBoundaries'
import {
  buildAppleScriptHotkey,
  buildWindowsSendKeys,
  buildXdotoolHotkey,
} from './desktopHotkeys'

const execFileAsync = promisify(execFile)

type DesktopAction =
  | { action: 'open_app'; target: string }
  | { action: 'focus_window'; app?: string; title?: string }
  | { action: 'click'; x: number; y: number; button?: 'left' | 'right' }
  | { action: 'type'; text: string }
  | { action: 'hotkey'; keys: string }

type FileOperation = {
  action: 'move' | 'copy' | 'rename'
  source: string
  destination: string
}

type SystemSettingsTarget = 'microphone' | 'screen-recording' | 'accessibility'

type AppliedFileOperation = FileOperation & { completedAt: string }

class DesktopManager {
  private static instance: DesktopManager | null = null
  private readonly approvedDirectoryRoots = new Set<string>()
  private screenCaptureApprovedForSession = false
  private readonly fileOperationHistory = new Map<
    string,
    AppliedFileOperation[]
  >()

  constructor() {
    if (DesktopManager.instance) {
      return DesktopManager.instance
    }
    DesktopManager.instance = this
    this.registerIpcHandlers()
  }

  static getInstance(): DesktopManager {
    if (!DesktopManager.instance) {
      DesktopManager.instance = new DesktopManager()
    }
    return DesktopManager.instance
  }

  private registerIpcHandlers() {
    // Remove existing handlers if they exist (important during Vite hot reload).
    for (const channel of [
      'desktop:listDirectory',
      'desktop:listDirectoryDetailed',
      'desktop:findFiles',
      'desktop:applyFileOperations',
      'desktop:undoFileOperations',
      'desktop:getCapabilities',
      'desktop:openSystemSettings',
      'desktop:captureScreen',
      'desktop:runAction',
      'desktop:executeCommand',
    ]) {
      ipcMain.removeHandler(channel)
      ipcMain.removeAllListeners(channel)
    }
    ipcMain.handle('desktop:listDirectory', async (event, dirPath) => {
      try {
        if (typeof dirPath !== 'string' || dirPath.trim().length === 0) {
          return { success: false, error: 'A directory path is required.' }
        }

        const requestedPath = await fs.realpath(dirPath.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: 'The requested path is not a directory.',
          }
        }

        const access = await this.ensureDirectoryApproved(requestedPath, event)
        if (!access.success) return access

        const files = await fs.readdir(requestedPath)
        return { success: true, files }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:listDirectoryDetailed', async (event, dirPath) => {
      try {
        if (typeof dirPath !== 'string' || dirPath.trim().length === 0) {
          return { success: false, error: 'A directory path is required.' }
        }
        const requestedPath = await fs.realpath(dirPath.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: 'The requested path is not a directory.',
          }
        }
        const access = await this.ensureDirectoryApproved(requestedPath, event)
        if (!access.success) return access
        const entries = await fs.readdir(requestedPath, { withFileTypes: true })
        const detailed = await Promise.all(
          entries.map(async entry => {
            const entryPath = path.join(requestedPath, entry.name)
            const entryStat = await fs.stat(entryPath)
            return {
              name: entry.name,
              path: entryPath,
              type: entry.isDirectory()
                ? 'directory'
                : entry.isFile()
                  ? 'file'
                  : 'other',
              size: entryStat.size,
              modifiedAt: entryStat.mtime.toISOString(),
            }
          })
        )
        return { success: true, entries: detailed }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:findFiles', async (event, args) => {
      try {
        const root = typeof args?.path === 'string' ? args.path.trim() : ''
        if (!root)
          return { success: false, error: 'A root directory path is required.' }
        const requestedPath = await fs.realpath(root)
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory())
          return { success: false, error: 'The root path is not a directory.' }
        const access = await this.ensureDirectoryApproved(requestedPath, event)
        if (!access.success) return access

        const query =
          typeof args?.query === 'string' ? args.query.trim().toLowerCase() : ''
        const maxResults = Math.min(
          Math.max(Number(args?.maxResults) || 100, 1),
          1000
        )
        const maxDepth = Math.min(Math.max(Number(args?.maxDepth) || 4, 0), 12)
        const includeHidden = args?.includeHidden === true
        const matches: Array<{
          name: string
          path: string
          type: string
          size: number
          modifiedAt: string
        }> = []

        const walk = async (current: string, depth: number): Promise<void> => {
          if (matches.length >= maxResults) return
          const entries = await fs.readdir(current, { withFileTypes: true })
          for (const entry of entries) {
            if (!includeHidden && entry.name.startsWith('.')) continue
            const entryPath = path.join(current, entry.name)
            const entryStat = await fs.stat(entryPath)
            const matchesQuery =
              !query || entry.name.toLowerCase().includes(query)
            if (matchesQuery) {
              matches.push({
                name: entry.name,
                path: entryPath,
                type: entry.isDirectory()
                  ? 'directory'
                  : entry.isFile()
                    ? 'file'
                    : 'other',
                size: entryStat.size,
                modifiedAt: entryStat.mtime.toISOString(),
              })
              if (matches.length >= maxResults) return
            }
            if (entry.isDirectory() && depth < maxDepth)
              await walk(entryPath, depth + 1)
            if (matches.length >= maxResults) return
          }
        }

        await walk(requestedPath, 0)
        return {
          success: true,
          root: requestedPath,
          query,
          truncated: matches.length >= maxResults,
          matches,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:applyFileOperations', async (event, args) => {
      let applied: AppliedFileOperation[] = []
      try {
        const operations = this.validateFileOperations(args?.operations)
        if (!operations.length)
          return {
            success: false,
            error: 'At least one file operation is required.',
          }
        for (const operation of operations) {
          const sourcePath = await fs.realpath(operation.source)
          const sourceStat = await fs.stat(sourcePath)
          if (!sourceStat.isFile() && !sourceStat.isDirectory())
            throw new Error(`Unsupported source: ${sourcePath}`)
          const destination = path.resolve(operation.destination)
          const sourceAccess = await this.ensureDirectoryApproved(
            path.dirname(sourcePath),
            event
          )
          if (!sourceAccess.success) return sourceAccess
          const destinationAccess = await this.ensureDirectoryApproved(
            path.dirname(destination),
            event
          )
          if (!destinationAccess.success) return destinationAccess
        }

        const preview = operations.map(operation => ({
          ...operation,
          source: path.resolve(operation.source),
          destination: path.resolve(operation.destination),
        }))
        if (args?.dryRun !== false) {
          return {
            success: true,
            dryRun: true,
            operations: preview,
            message: '预览完成，未修改文件。',
          }
        }

        const owner = BrowserWindow.fromWebContents(event.sender)
        const detail = preview
          .map(op => `${op.action}: ${op.source} → ${op.destination}`)
          .join('\n')
        const confirmation = owner
          ? await dialog.showMessageBox(owner, {
              type: 'warning',
              buttons: ['取消', '确认执行'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认整理文件',
              message: `Alice 将执行 ${preview.length} 个文件操作。`,
              detail:
                detail.length > 8000 ? `${detail.slice(0, 8000)}\n…` : detail,
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '确认执行'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认整理文件',
              message: `Alice 将执行 ${preview.length} 个文件操作。`,
              detail:
                detail.length > 8000 ? `${detail.slice(0, 8000)}\n…` : detail,
            })
        if (confirmation.response !== 1)
          return { success: false, error: 'File operations cancelled by user.' }

        for (const operation of preview) {
          if (await this.pathExists(operation.destination)) {
            throw new Error(
              `Destination already exists: ${operation.destination}`
            )
          }
          if (operation.action === 'copy') {
            await fs.cp(operation.source, operation.destination, {
              recursive: true,
              errorOnExist: true,
            })
          } else {
            await fs.rename(operation.source, operation.destination)
          }
          applied.push({ ...operation, completedAt: new Date().toISOString() })
        }
        const operationId = randomUUID()
        this.fileOperationHistory.set(operationId, applied)
        if (this.fileOperationHistory.size > 50) {
          const oldest = this.fileOperationHistory.keys().next().value
          if (oldest) this.fileOperationHistory.delete(oldest)
        }
        return {
          success: true,
          dryRun: false,
          operationId,
          operations: applied,
          undoAvailable: true,
        }
      } catch (error) {
        for (const operation of [...applied].reverse()) {
          try {
            if (operation.action === 'copy') {
              await fs.rm(operation.destination, {
                recursive: true,
                force: true,
              })
            } else if (
              !(await this.pathExists(operation.source)) &&
              (await this.pathExists(operation.destination))
            ) {
              await fs.rename(operation.destination, operation.source)
            }
          } catch (rollbackError) {
            console.error(
              '[DesktopManager] File operation rollback failed:',
              rollbackError
            )
          }
        }
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:undoFileOperations', async (event, args) => {
      try {
        const operationId =
          typeof args?.operationId === 'string' ? args.operationId : ''
        const operations = this.fileOperationHistory.get(operationId)
        if (!operations)
          return {
            success: false,
            error: 'Operation not found or already undone.',
          }
        const owner = BrowserWindow.fromWebContents(event.sender)
        const confirmation = owner
          ? await dialog.showMessageBox(owner, {
              type: 'warning',
              buttons: ['取消', '撤销操作'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '撤销文件整理',
              message: '确认撤销上一次文件整理操作吗？',
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '撤销操作'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '撤销文件整理',
              message: '确认撤销上一次文件整理操作吗？',
            })
        if (confirmation.response !== 1)
          return { success: false, error: 'Undo cancelled by user.' }
        for (const operation of [...operations].reverse()) {
          if (operation.action === 'copy') {
            await fs.rm(operation.destination, {
              recursive: true,
              force: false,
            })
          } else {
            if (await this.pathExists(operation.source))
              throw new Error(
                `Cannot undo because source exists: ${operation.source}`
              )
            await fs.rename(operation.destination, operation.source)
          }
        }
        this.fileOperationHistory.delete(operationId)
        return { success: true, operationId, message: '文件整理已撤销。' }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle('desktop:getCapabilities', async () =>
      this.getCapabilities()
    )

    ipcMain.handle(
      'desktop:openSystemSettings',
      async (_event, target: unknown) => {
        try {
          if (
            target !== 'microphone' &&
            target !== 'screen-recording' &&
            target !== 'accessibility'
          ) {
            return { success: false, error: '不支持的系统权限设置项。' }
          }

          const targetUrls: Partial<
            Record<
              NodeJS.Platform,
              Partial<Record<SystemSettingsTarget, string>>
            >
          > = {
            darwin: {
              microphone:
                'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
              'screen-recording':
                'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
              accessibility:
                'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
            },
            win32: {
              microphone: 'ms-settings:privacy-microphone',
              'screen-recording': 'ms-settings:privacy',
              accessibility: 'ms-settings:easeofaccess-mouse',
            },
            linux: {},
            android: {},
            aix: {},
            freebsd: {},
            haiku: {},
            openbsd: {},
            sunos: {},
          }
          const url = targetUrls[process.platform]?.[target]
          if (!url) {
            return {
              success: false,
              error: '当前平台没有可直接打开的系统权限设置页面。',
            }
          }

          // macOS's System Settings deep links are handled more reliably by
          // the `open` command when the settings app is already running;
          // shell.openExternal can focus the app without changing panes.
          if (process.platform === 'darwin') {
            await execFileAsync('open', [url])
          } else {
            await shell.openExternal(url)
          }
          return { success: true, target }
        } catch (error) {
          return {
            success: false,
            error: error instanceof Error ? error.message : String(error),
          }
        }
      }
    )

    ipcMain.handle('desktop:captureScreen', async event => {
      try {
        const access = await this.ensureScreenCaptureApproved(event)
        if (!access.success) return access

        const primaryDisplay = screen.getPrimaryDisplay()
        const { width, height } = primaryDisplay.size
        const scale = Math.min(
          1,
          1600 / Math.max(width, 1),
          1000 / Math.max(height, 1)
        )
        const thumbnailSize = {
          width: Math.max(1, Math.round(width * scale)),
          height: Math.max(1, Math.round(height * scale)),
        }
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize,
          fetchWindowIcons: false,
        })
        const source =
          sources.find(item => item.display_id === String(primaryDisplay.id)) ||
          sources[0]
        if (!source || source.thumbnail.isEmpty()) {
          const permissionHint =
            process.platform === 'darwin'
              ? '请确认 Alice 已获得 macOS“屏幕录制”权限。'
              : process.platform === 'win32'
                ? '请确认 Windows 隐私设置允许桌面应用捕获屏幕，并检查目标窗口是否以更高权限运行。'
                : '请确认当前桌面会话支持屏幕捕获；Wayland 环境可能需要切换到 X11。'
          return {
            success: false,
            error: `未能读取屏幕内容。${permissionHint}`,
          }
        }

        const jpeg = source.thumbnail.toJPEG(72)
        if (!jpeg.byteLength) {
          return { success: false, error: '屏幕截图为空。' }
        }
        const size = source.thumbnail.getSize()
        return {
          success: true,
          data: {
            imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
            width: size.width,
            height: size.height,
            displayId: source.display_id || String(primaryDisplay.id),
            capturedAt: new Date().toISOString(),
          },
        }
      } catch (error) {
        console.error('[DesktopManager] Screen capture failed:', error)
        return {
          success: false,
          error:
            error instanceof Error
              ? `屏幕读取失败：${error.message}`
              : '屏幕读取失败。请检查系统屏幕捕获权限。',
        }
      }
    })

    ipcMain.handle('desktop:runAction', async (event, args) => {
      try {
        const action = this.parseDesktopAction(args)
        const owner = BrowserWindow.fromWebContents(event.sender)
        const confirmation = owner
          ? await dialog.showMessageBox(owner, {
              type: 'warning',
              buttons: ['取消', '允许执行'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认桌面操作',
              message: `Alice 请求执行：${this.describeAction(action)}`,
              detail:
                '桌面操作可能影响当前应用中的内容，请确认目标窗口和输入内容。',
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '允许执行'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认桌面操作',
              message: `Alice 请求执行：${this.describeAction(action)}`,
              detail:
                '桌面操作可能影响当前应用中的内容，请确认目标窗口和输入内容。',
            })
        if (confirmation.response !== 1)
          return { success: false, error: 'Desktop action cancelled by user.' }
        const result = await this.executeDesktopAction(action)
        return { success: true, action: action.action, ...result }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }
      }
    })

    ipcMain.handle(
      'desktop:executeCommand',
      async (event, command: unknown) => {
        if (typeof command !== 'string' || command.trim().length === 0) {
          return { success: false, error: 'A command is required.' }
        }

        if (command.length > 16_000) {
          return { success: false, error: 'Command is too long.' }
        }

        const commandPreview =
          command.length > 4_000
            ? `${command.slice(0, 4_000)}\n\n[Command preview truncated]`
            : command

        const owner = BrowserWindow.fromWebContents(event.sender)
        const confirmation = owner
          ? await dialog.showMessageBox(owner, {
              type: 'warning',
              buttons: ['Cancel', 'Run once'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: 'Allow command execution?',
              message: 'Alice wants to execute a command on this computer.',
              detail: commandPreview,
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['Cancel', 'Run once'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: 'Allow command execution?',
              message: 'Alice wants to execute a command on this computer.',
              detail: commandPreview,
            })

        if (confirmation.response !== 1) {
          return { success: false, error: 'Command execution denied by user.' }
        }

        return new Promise(resolve => {
          exec(
            command,
            { timeout: 60_000, maxBuffer: 1024 * 1024 },
            (error, stdout, stderr) => {
              if (error) {
                resolve({
                  success: false,
                  error: stderr ? `${error.message}\n${stderr}` : error.message,
                })
                return
              }
              resolve({
                success: true,
                output: stderr ? `${stdout}${stderr}` : stdout,
              })
            }
          )
        })
      }
    )
  }

  private async ensureDirectoryApproved(
    requestedPath: string,
    event: Electron.IpcMainInvokeEvent
  ): Promise<{ success: true } | { success: false; error: string }> {
    const normalized = path.resolve(requestedPath)
    const isApproved = [...this.approvedDirectoryRoots].some(root =>
      isPathWithinRoot(root, normalized)
    )
    if (isApproved) return { success: true }
    const owner = BrowserWindow.fromWebContents(event.sender)
    const platformHint =
      process.platform === 'darwin'
        ? 'macOS“系统设置 > 隐私与安全性 > 屏幕录制”'
        : process.platform === 'win32'
          ? 'Windows 隐私设置中的屏幕捕获权限'
          : '当前 Linux 桌面会话的屏幕捕获权限'
    const options = {
      type: 'warning' as const,
      buttons: ['Cancel', 'Allow for session'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: 'Allow directory access?',
      message: 'Alice wants to access this directory for the current session.',
      detail: normalized,
    }
    const confirmation = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (confirmation.response !== 1)
      return { success: false, error: 'Directory access denied by user.' }
    this.approvedDirectoryRoots.add(normalized)
    return { success: true }
  }

  private async ensureScreenCaptureApproved(
    event: Electron.IpcMainInvokeEvent
  ): Promise<{ success: true } | { success: false; error: string }> {
    if (this.screenCaptureApprovedForSession) return { success: true }

    const platformHint =
      process.platform === 'darwin'
        ? 'macOS“系统设置 > 隐私与安全性 > 屏幕录制”'
        : process.platform === 'win32'
          ? 'Windows 隐私设置中的屏幕捕获权限'
          : '当前 Linux 桌面会话的屏幕捕获权限'
    const owner = BrowserWindow.fromWebContents(event.sender)
    const options = {
      type: 'warning' as const,
      buttons: ['取消', '仅允许本次', '本次运行始终允许'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '允许 Alice 读取屏幕？',
      message: 'Alice 请求读取当前屏幕内容。',
      detail: `截图只会作为当前请求的临时视觉上下文发送给模型，不会写入长期聊天记录。你仍可在${platformHint}中随时撤销或调整权限。`,
    }
    const confirmation = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)

    if (confirmation.response === 0) {
      return { success: false, error: '用户取消了屏幕读取。' }
    }
    if (confirmation.response === 2) {
      this.screenCaptureApprovedForSession = true
    }
    return { success: true }
  }

  private async pathExists(target: string): Promise<boolean> {
    try {
      await fs.access(target)
      return true
    } catch {
      return false
    }
  }

  private validateFileOperations(input: unknown): FileOperation[] {
    if (!Array.isArray(input) || input.length > 100)
      throw new Error('operations must be an array with at most 100 items.')
    return input.map((item: any) => {
      if (!['move', 'copy', 'rename'].includes(item?.action))
        throw new Error('Unsupported file operation.')
      if (
        typeof item?.source !== 'string' ||
        typeof item?.destination !== 'string'
      )
        throw new Error('Each file operation needs source and destination.')
      if (!path.isAbsolute(item.source) || !path.isAbsolute(item.destination))
        throw new Error('File operation paths must be absolute.')
      return {
        action: item.action,
        source: item.source,
        destination: item.destination,
      }
    })
  }

  private parseDesktopAction(args: any): DesktopAction {
    const action = args?.action
    if (
      action === 'open_app' &&
      typeof args.target === 'string' &&
      args.target.trim()
    )
      return { action, target: args.target.trim() }
    if (
      action === 'focus_window' &&
      (typeof args.app === 'string' || typeof args.title === 'string')
    )
      return { action, app: args.app, title: args.title }
    if (
      action === 'click' &&
      Number.isFinite(args.x) &&
      Number.isFinite(args.y)
    )
      return {
        action,
        x: Number(args.x),
        y: Number(args.y),
        button: args.button === 'right' ? 'right' : 'left',
      }
    if (
      action === 'type' &&
      typeof args.text === 'string' &&
      args.text.length <= 10000
    )
      return { action, text: args.text }
    if (
      action === 'hotkey' &&
      typeof args.keys === 'string' &&
      args.keys.trim()
    )
      return { action, keys: args.keys.trim() }
    throw new Error('Invalid desktop action arguments.')
  }

  private describeAction(action: DesktopAction): string {
    switch (action.action) {
      case 'open_app':
        return `打开 ${action.target}`
      case 'focus_window':
        return `聚焦 ${action.app || action.title}`
      case 'click':
        return `点击屏幕坐标 (${action.x}, ${action.y})`
      case 'type':
        return `输入文本：${action.text.slice(0, 120)}${action.text.length > 120 ? '…' : ''}`
      case 'hotkey':
        return `按下快捷键 ${action.keys}`
    }
  }

  private getCapabilities() {
    const platform = process.platform
    const screenPermission =
      platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('screen')
        : 'not-applicable'
    const microphonePermission =
      platform === 'darwin'
        ? systemPreferences.getMediaAccessStatus('microphone')
        : 'unknown'
    return {
      platform,
      osVersion: os.release(),
      microphonePermission,
      supportedActions: ['open_app', 'focus_window', 'click', 'type', 'hotkey'],
      screenCapture: {
        supported:
          platform === 'darwin' || platform === 'win32' || platform === 'linux',
        permission: screenPermission,
      },
      note:
        platform === 'darwin'
          ? '点击和输入通过 macOS System Events 执行，需要授予辅助功能权限；读取屏幕还需要授予屏幕录制权限。'
          : platform === 'win32'
            ? '点击和输入通过 Windows PowerShell 执行，部分应用可能需要以相同权限级别运行。'
            : 'Linux 需要安装并启用 xdotool；应用级语义控件尚未统一。',
    }
  }

  private async executeDesktopAction(
    action: DesktopAction
  ): Promise<Record<string, any>> {
    if (action.action === 'open_app') {
      if (path.isAbsolute(action.target)) {
        const errorMessage = await shell.openPath(action.target)
        if (errorMessage) throw new Error(errorMessage)
      } else if (process.platform === 'darwin') {
        await execFileAsync('open', ['-a', action.target])
      } else if (process.platform === 'win32') {
        await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Start-Process -FilePath '${this.escapePowerShell(action.target)}'`,
        ])
      } else {
        await execFileAsync('xdg-open', [action.target])
      }
      return { message: '应用或目标已打开。' }
    }

    if (process.platform === 'darwin') {
      let script = ''
      if (action.action === 'focus_window') {
        if (action.app)
          script = `tell application "${this.escapeAppleScript(action.app)}" to activate`
        else if (action.title)
          script = `tell application "System Events" to set frontmost of first process whose name is "${this.escapeAppleScript(action.title)}" to true`
      } else if (action.action === 'click') {
        const button =
          action.button === 'right' ? 'right mouse button' : 'left mouse button'
        script = `tell application "System Events" to ${button} at {${action.x}, ${action.y}}`
      } else if (action.action === 'type') {
        script = `tell application "System Events" to keystroke "${this.escapeAppleScript(action.text)}"`
      } else if (action.action === 'hotkey') {
        script = buildAppleScriptHotkey(action.keys)
      }
      if (!script) throw new Error('Unable to build macOS desktop action.')
      await execFileAsync('osascript', ['-e', script])
      return { message: 'macOS 桌面操作已执行。' }
    }

    if (process.platform === 'win32') {
      const powershellScript = this.windowsPowerShellAction(action)
      await execFileAsync('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        powershellScript,
      ])
      return { message: 'Windows 桌面操作已执行。' }
    }

    if (action.action === 'focus_window')
      throw new Error('Linux 暂不支持按窗口标题聚焦。')
    const command =
      action.action === 'type'
        ? ['type', action.text]
        : action.action === 'hotkey'
          ? ['key', buildXdotoolHotkey(action.keys)]
          : [
              'mousemove',
              `${action.x}`,
              `${action.y}`,
              'click',
              action.button === 'right' ? '3' : '1',
            ]
    await execFileAsync('xdotool', command)
    return { message: 'Linux 桌面操作已执行。' }
  }

  private escapeAppleScript(value: string): string {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\\"')
  }
  private escapePowerShell(value: string): string {
    return value.replace(/'/g, "''")
  }

  private windowsPowerShellAction(action: DesktopAction): string {
    if (action.action === 'focus_window') {
      const value = this.escapePowerShell(action.app || action.title || '')
      return `$ws = New-Object -ComObject WScript.Shell; if (-not $ws.AppActivate('${value}')) { throw 'Window not found' }`
    }
    if (action.action === 'type') {
      const value = this.escapePowerShell(
        action.text.replace(/[+^%~(){}]/g, char => `{${char}}`)
      )
      return `$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${value}')`
    }
    if (action.action === 'hotkey') {
      const value = this.escapePowerShell(buildWindowsSendKeys(action.keys))
      return `$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${value}')`
    }
    if (action.action === 'click') {
      const button = action.button === 'right' ? '0x0008' : '0x0002'
      return `Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices; public static class AliceMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }\n'@; [AliceMouse]::SetCursorPos(${action.x},${action.y}); [AliceMouse]::mouse_event(${button},0,0,0,[UIntPtr]::Zero); [AliceMouse]::mouse_event(${action.button === 'right' ? '0x0010' : '0x0004'},0,0,0,[UIntPtr]::Zero)`
    }
    throw new Error('Unsupported Windows desktop action.')
  }
}

export default DesktopManager
