import {
  clipboard,
  BrowserWindow,
  app,
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
  buildWindowsUnicodeTypeScript,
  buildXdotoolHotkey,
  splitWindowsUnicodeInput,
} from './desktopHotkeys'
import {
  FileOperationJournal,
  type JournalFileOperation,
} from './fileOperationJournal'
import { resolvePathThroughExistingParent } from './fileOperationPaths'
import {
  createObservation,
  DEFAULT_DESKTOP_OBSERVATION_MAX_ENTRIES,
  invalidateObservation,
  validateObservation,
  type DesktopObservationContext,
} from '../../src/utils/desktopObservation'
import {
  mapImagePointToDisplay,
  mapDisplayPointToNative,
  type DesktopDisplayBounds,
} from './desktopCoordinates'
import { selectPrimaryCaptureSource } from './desktopCaptureSelection'

const execFileAsync = promisify(execFile)

type DesktopActionContext = {
  observationId?: string
  coordinateSpace?: 'image' | 'screen'
}

type DesktopAction =
  | ({ action: 'open_app'; target: string } & DesktopActionContext)
  | ({
      action: 'focus_window'
      app?: string
      title?: string
    } & DesktopActionContext)
  | ({
      action: 'click'
      x: number
      y: number
      button?: 'left' | 'right'
    } & DesktopActionContext)
  | ({ action: 'type'; text: string } & DesktopActionContext)
  | ({ action: 'hotkey'; keys: string } & DesktopActionContext)

type ForegroundContext = {
  foregroundApp?: string
  windowTitle?: string
  confidence: 'full' | 'unavailable'
  source: 'accessibility' | 'win32' | 'xdotool' | 'unavailable'
  error?: string
}

type DesktopCaptureData = {
  imageDataUrl: string
  /** Image dimensions in pixels (the coordinate system used by the model). */
  imageWidth: number
  imageHeight: number
  /** Legacy aliases retained for existing tool consumers. */
  width: number
  height: number
  displayId: string
  displayBounds: DesktopDisplayBounds
  scaleFactor: number
  coordinateSpace: 'image-pixels'
  capturedAt: string
  observedAt: string
  observationId?: string
  expiresAt?: string
  expiresAtMs?: number
  context: {
    foregroundApp?: string
    windowTitle?: string
    confidence: ForegroundContext['confidence']
    source: ForegroundContext['source']
  }
  warning?: string
}

type DesktopCaptureResult =
  | { success: true; data: DesktopCaptureData }
  | { success: false; error: string }

/**
 * The image dimensions must stay paired with the observation that produced
 * them.  Electron may return a thumbnail whose size differs slightly from the
 * requested size, so recomputing it later can move a click by several pixels.
 * Keep only non-sensitive geometry and the token expiry in this side table;
 * screenshot pixels are never retained here.
 */
type ObservationFrameMetadata = {
  imageWidth: number
  imageHeight: number
  displayId: string
  expiresAt: number
}

type FileOperation = {
  action: 'move' | 'copy' | 'rename'
  source: string
  destination: string
}

type SystemSettingsTarget = 'microphone' | 'screen-recording' | 'accessibility'

type MicrophoneAccessResult = {
  success: boolean
  permission: string
  requested: boolean
  error?: string
}

type AppliedFileOperation = FileOperation & { completedAt: string }

class DesktopManager {
  private static instance: DesktopManager | null = null
  private readonly approvedDirectoryRoots = new Set<string>()
  private screenCaptureApprovedForSession = false
  private readonly fileOperationHistory = new Map<
    string,
    AppliedFileOperation[]
  >()
  private readonly fileOperationJournal!: FileOperationJournal
  private microphoneAccessRequest: Promise<MicrophoneAccessResult> | null = null
  /** Non-sensitive frame dimensions retained only while an observation lives. */
  private readonly observationFrameMetadata = new Map<
    string,
    ObservationFrameMetadata
  >()

  constructor() {
    if (DesktopManager.instance) {
      return DesktopManager.instance
    }
    DesktopManager.instance = this
    this.fileOperationJournal = new FileOperationJournal(
      path.join(app.getPath('userData'), 'alice-file-operation-history.json')
    )
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
      'desktop:requestMicrophoneAccess',
      'desktop:openSystemSettings',
      'desktop:observeScreen',
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
          return { success: false, error: '需要提供目录路径。' }
        }

        const requestedPath = await fs.realpath(dirPath.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: '指定路径不是目录。',
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
          return { success: false, error: '需要提供目录路径。' }
        }
        const requestedPath = await fs.realpath(dirPath.trim())
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory()) {
          return {
            success: false,
            error: '指定路径不是目录。',
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
        if (!root) return { success: false, error: '需要提供根目录路径。' }
        const requestedPath = await fs.realpath(root)
        const stat = await fs.stat(requestedPath)
        if (!stat.isDirectory())
          return { success: false, error: '根路径不是目录。' }
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
        await this.fileOperationJournal.waitUntilReady()
        const operations = this.validateFileOperations(args?.operations)
        if (!operations.length)
          return {
            success: false,
            error: '至少需要一项文件操作。',
          }
        for (const operation of operations) {
          const sourcePath = await fs.realpath(operation.source)
          const sourceStat = await fs.stat(sourcePath)
          if (!sourceStat.isFile() && !sourceStat.isDirectory())
            throw new Error(`不支持的源路径：${sourcePath}`)
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
          return { success: false, error: '用户取消了文件整理。' }

        for (const operation of preview) {
          if (await this.pathExists(operation.destination)) {
            throw new Error(`目标路径已存在：${operation.destination}`)
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
        let undoPersistent = true
        try {
          await this.fileOperationJournal.set(
            operationId,
            applied as JournalFileOperation[]
          )
        } catch (journalError) {
          undoPersistent = false
          console.error(
            '[DesktopManager] Failed to persist file operation journal:',
            journalError
          )
        }
        return {
          success: true,
          dryRun: false,
          operationId,
          operations: applied,
          undoAvailable: true,
          undoPersistent,
          ...(undoPersistent
            ? {}
            : {
                warning:
                  '文件整理已完成，但撤销记录未能写入磁盘；本次运行结束后可能无法撤销。',
              }),
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
        await this.fileOperationJournal.waitUntilReady()
        const operationId =
          typeof args?.operationId === 'string' ? args.operationId : ''
        const operations =
          this.fileOperationHistory.get(operationId) ||
          this.fileOperationJournal.get(operationId)
        if (!operations)
          return {
            success: false,
            error: '找不到该操作，或操作已经撤销。',
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
          return { success: false, error: '用户取消了撤销操作。' }
        for (const operation of [...operations].reverse()) {
          if (operation.action === 'copy') {
            await fs.rm(operation.destination, {
              recursive: true,
              force: false,
            })
          } else {
            if (await this.pathExists(operation.source))
              throw new Error(`无法撤销，因为源路径已存在：${operation.source}`)
            await fs.rename(operation.destination, operation.source)
          }
        }
        this.fileOperationHistory.delete(operationId)
        let journalRemoved = true
        try {
          await this.fileOperationJournal.delete(operationId)
        } catch (journalError) {
          journalRemoved = false
          console.error(
            '[DesktopManager] Failed to remove undone file operation from journal:',
            journalError
          )
        }
        return {
          success: true,
          operationId,
          message: '文件整理已撤销。',
          journalRemoved,
          ...(journalRemoved
            ? {}
            : {
                warning:
                  '文件已撤销，但撤销记录未能从磁盘移除；请勿重复使用此 operationId。',
              }),
        }
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

    ipcMain.handle('desktop:requestMicrophoneAccess', async () =>
      this.requestMicrophoneAccess()
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

    // `desktop_observe` is the preferred read-only entry point.  Keep the
    // historical capture channel as an alias so older renderers and saved
    // conversations continue to work while receiving the observation token.
    ipcMain.handle('desktop:observeScreen', async event =>
      this.captureDesktopFrame(event, { requestPermission: true })
    )

    ipcMain.handle('desktop:captureScreen', async event =>
      this.captureDesktopFrame(event, { requestPermission: true })
    )

    ipcMain.handle('desktop:runAction', async (event, args) => {
      try {
        const action = this.parseDesktopAction(args)
        if (action.action !== 'open_app') {
          const accessibility = this.ensureAccessibilityApproved()
          if (!accessibility.success) return accessibility
        }

        // Coordinate clicks, text input, and hotkeys are bound to the exact
        // screen/window observation that the model just inspected.  Opening
        // an app or focusing a window is allowed to establish that context;
        // the next mutating action must observe again.
        const requiresObservation = this.actionRequiresObservation(action)
        let observationContext: DesktopObservationContext | undefined
        if (requiresObservation) {
          if (!action.observationId) {
            return {
              success: false,
              error:
                '执行点击、输入或快捷键前必须先调用 desktop_observe，并传入返回的 observationId。',
            }
          }
          observationContext = await this.getCurrentObservationContext()
          if (!observationContext) {
            this.consumeObservation(action.observationId)
            return {
              success: false,
              error:
                '无法确认当前前台窗口。为避免误操作，请重新调用 desktop_observe，或先聚焦目标窗口。',
            }
          }
          const validation = validateObservation(
            action.observationId,
            observationContext
          )
          if (!validation.valid) {
            this.consumeObservation(action.observationId)
            return {
              success: false,
              error: this.describeObservationValidationFailure(
                validation.reason
              ),
              observationId: action.observationId,
            }
          }
        }

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
          return { success: false, error: '用户取消了桌面操作。' }

        if (requiresObservation && action.observationId) {
          // The confirmation dialog can briefly become the frontmost window.
          // Hide the owner for one event-loop turn so the target app can regain
          // focus, then validate the token immediately before the native event.
          const postConfirmationContext =
            await this.readContextAfterConfirmation(owner, observationContext)
          if (!postConfirmationContext) {
            this.consumeObservation(action.observationId)
            return {
              success: false,
              error:
                '确认后无法再次确认目标窗口，操作已安全取消；请重新观察后重试。',
              observationId: action.observationId,
            }
          }
          const validation = validateObservation(
            action.observationId,
            postConfirmationContext
          )
          if (!validation.valid) {
            this.consumeObservation(action.observationId)
            return {
              success: false,
              error: this.describeObservationValidationFailure(
                validation.reason
              ),
              observationId: action.observationId,
            }
          }
          observationContext = postConfirmationContext
        }

        let mappedAction = action
        if (action.action === 'click') {
          const frameMetadata = action.observationId
            ? this.getObservationFrameMetadata(action.observationId)
            : undefined
          const mapped = await this.mapClickActionToDisplay(
            action,
            frameMetadata
          )
          if (!mapped.success) {
            this.consumeObservation(action.observationId)
            return mapped
          }
          mappedAction = mapped.action
        }

        // Tokens are single-use capabilities.  Consume immediately before the
        // native event so a partial platform failure cannot be retried against
        // a context that may already have changed.
        this.consumeObservation(action.observationId)
        const result = await this.executeDesktopAction(mappedAction)

        if (!requiresObservation) {
          return { success: true, action: action.action, ...result }
        }

        // A fresh frame gives the model a chance to verify that the click,
        // typing, or shortcut had the intended effect.  It is deliberately
        // best-effort: a transient OS capture failure must not turn a
        // successfully confirmed native action into a false failure.
        const verification = await this.captureDesktopFrame(event, {
          requestPermission: false,
          createObservation: true,
        })
        if (!verification.success) {
          return {
            success: true,
            action: action.action,
            ...result,
            verification: {
              status: 'unavailable',
              message: verification.error,
            },
          }
        }
        const { imageDataUrl: _verificationPixels, ...verificationMetadata } =
          verification.data
        return {
          success: true,
          action: action.action,
          ...result,
          verification: {
            status: 'captured',
            ...verificationMetadata,
          },
          screenshot: verification.data,
        }
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
          return { success: false, error: '需要提供要执行的命令。' }
        }

        if (command.length > 16_000) {
          return { success: false, error: '命令长度超过限制。' }
        }

        const commandPreview =
          command.length > 4_000
            ? `${command.slice(0, 4_000)}\n\n[Command preview truncated]`
            : command

        const owner = BrowserWindow.fromWebContents(event.sender)
        const confirmation = owner
          ? await dialog.showMessageBox(owner, {
              type: 'warning',
              buttons: ['取消', '仅运行一次'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认执行命令',
              message: 'Alice 请求在这台电脑上执行一条命令。',
              detail: commandPreview,
            })
          : await dialog.showMessageBox({
              type: 'warning',
              buttons: ['取消', '仅运行一次'],
              defaultId: 0,
              cancelId: 0,
              noLink: true,
              title: '确认执行命令',
              message: 'Alice 请求在这台电脑上执行一条命令。',
              detail: commandPreview,
            })

        if (confirmation.response !== 1) {
          return { success: false, error: '用户拒绝执行命令。' }
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

  /**
   * Capture a bounded primary-display frame and issue a short-lived
   * observation token.  Pixels are returned to the current tool call only;
   * the token registry stores opaque fingerprints, never screenshots or raw
   * window titles.
   */
  private async captureDesktopFrame(
    event: Electron.IpcMainInvokeEvent,
    options: {
      requestPermission?: boolean
      createObservation?: boolean
    } = {}
  ): Promise<DesktopCaptureResult> {
    try {
      this.cleanupObservationFrameMetadata()
      if (options.requestPermission !== false) {
        const access = await this.ensureScreenCaptureApproved(event)
        if (!access.success) return access
      }

      const primaryDisplay = screen.getPrimaryDisplay()
      const displaySize = primaryDisplay.size
      // Read the foreground context on both sides of the capture.  A user can
      // switch windows while desktopCapturer is producing a thumbnail; in
      // that case the pixels and the token must not be paired as if they were
      // one atomic observation.
      const foregroundBefore = await this.readForegroundContext()
      const thumbnailSize = this.getCaptureThumbnailSize(displaySize)
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize,
        fetchWindowIcons: false,
      })
      const sourceSelection = selectPrimaryCaptureSource(
        sources,
        String(primaryDisplay.id)
      )
      const source = sourceSelection.source
      if (!source || source.thumbnail.isEmpty()) {
        const permissionHint =
          process.platform === 'darwin'
            ? '请确认 Alice 已获得 macOS“屏幕录制”权限。'
            : process.platform === 'win32'
              ? '请确认 Windows 隐私设置允许桌面应用捕获屏幕，并检查目标窗口是否以更高权限运行。'
              : '请确认当前桌面会话支持屏幕捕获；Wayland 环境可能需要切换到 X11。'
        const sourceHint =
          sourceSelection.reason === 'no-matching-source'
            ? '未找到与当前主显示器对应的屏幕源；请重试，或暂时断开异常的外接显示器。'
            : ''
        return {
          success: false,
          error: `未能读取屏幕内容。${sourceHint}${permissionHint}`,
        }
      }

      const jpeg = source.thumbnail.toJPEG(72)
      if (!jpeg.byteLength) {
        return { success: false, error: '屏幕截图为空。' }
      }

      const imageSize = source.thumbnail.getSize()
      if (imageSize.width <= 0 || imageSize.height <= 0) {
        return { success: false, error: '屏幕截图尺寸无效。' }
      }

      const foregroundAfter = await this.readForegroundContext()
      const foreground =
        foregroundAfter.confidence === 'full'
          ? foregroundAfter
          : foregroundBefore
      const displayAfter = screen.getPrimaryDisplay()
      const displayStable =
        String(displayAfter.id) === String(primaryDisplay.id) &&
        displayAfter.size.width === displaySize.width &&
        displayAfter.size.height === displaySize.height &&
        displayAfter.scaleFactor === primaryDisplay.scaleFactor
      const observedAt = new Date()
      const displayId = source.display_id || String(primaryDisplay.id)
      const displayBounds: DesktopDisplayBounds = {
        x: primaryDisplay.bounds.x,
        y: primaryDisplay.bounds.y,
        width: primaryDisplay.bounds.width,
        height: primaryDisplay.bounds.height,
      }
      const data: DesktopCaptureData = {
        imageDataUrl: `data:image/jpeg;base64,${jpeg.toString('base64')}`,
        imageWidth: imageSize.width,
        imageHeight: imageSize.height,
        width: imageSize.width,
        height: imageSize.height,
        displayId,
        displayBounds,
        scaleFactor: primaryDisplay.scaleFactor,
        coordinateSpace: 'image-pixels',
        capturedAt: observedAt.toISOString(),
        observedAt: observedAt.toISOString(),
        context: {
          foregroundApp: foreground.foregroundApp,
          windowTitle: foreground.windowTitle,
          confidence: foreground.confidence,
          source: foreground.source,
        },
      }

      const shouldCreateObservation = options.createObservation !== false
      const stableForegroundContext =
        foregroundBefore.confidence === 'full' &&
        foregroundAfter.confidence === 'full' &&
        this.sameForegroundContext(foregroundBefore, foregroundAfter) &&
        displayStable
      if (shouldCreateObservation && stableForegroundContext) {
        try {
          const observation = createObservation({
            displayId,
            width: displaySize.width,
            height: displaySize.height,
            scaleFactor: primaryDisplay.scaleFactor,
            foregroundApp: foreground.foregroundApp,
            windowTitle: foreground.windowTitle,
          })
          data.observationId = observation.observationId
          data.expiresAtMs = observation.expiresAt
          data.expiresAt = new Date(observation.expiresAt).toISOString()
          this.rememberObservationFrame(observation.observationId, {
            imageWidth: imageSize.width,
            imageHeight: imageSize.height,
            displayId,
            expiresAt: observation.expiresAt,
          })
        } catch (error) {
          data.warning =
            error instanceof Error
              ? `未能创建观察令牌：${error.message}`
              : '未能创建观察令牌。'
        }
      } else if (shouldCreateObservation) {
        data.warning =
          foregroundBefore.confidence !== 'full' ||
          foregroundAfter.confidence !== 'full' ||
          !displayStable
            ? '当前平台暂时无法确认前台窗口；本次截图可供分析，但不会颁发可执行桌面操作的观察令牌。'
            : '截图期间前台窗口发生变化；为避免把截图绑定到错误窗口，本次不会颁发观察令牌，请重新观察。'
      }

      return { success: true, data }
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
  }

  /**
   * Remove expired geometry records and enforce the same bounded capacity as
   * the observation-token registry.  The registry itself is authoritative;
   * this side table only exists to preserve the exact thumbnail dimensions
   * needed for coordinate mapping.
   */
  private cleanupObservationFrameMetadata(now = Date.now()): void {
    for (const [observationId, metadata] of this.observationFrameMetadata) {
      if (!Number.isFinite(metadata.expiresAt) || metadata.expiresAt <= now) {
        this.observationFrameMetadata.delete(observationId)
      }
    }

    while (
      this.observationFrameMetadata.size >
      DEFAULT_DESKTOP_OBSERVATION_MAX_ENTRIES
    ) {
      const oldest = this.observationFrameMetadata.keys().next().value
      if (typeof oldest !== 'string') break
      this.observationFrameMetadata.delete(oldest)
    }
  }

  private rememberObservationFrame(
    observationId: string,
    metadata: ObservationFrameMetadata
  ): void {
    this.cleanupObservationFrameMetadata()
    this.observationFrameMetadata.set(observationId, { ...metadata })
    this.cleanupObservationFrameMetadata()
  }

  private getObservationFrameMetadata(
    observationId: string
  ): ObservationFrameMetadata | undefined {
    this.cleanupObservationFrameMetadata()
    const metadata = this.observationFrameMetadata.get(observationId)
    return metadata ? { ...metadata } : undefined
  }

  /** Consume a token and its paired frame metadata as one lifecycle action. */
  private consumeObservation(observationId: string | undefined): void {
    if (!observationId) return
    invalidateObservation(observationId)
    this.observationFrameMetadata.delete(observationId)
  }

  private getCaptureThumbnailSize(size: { width: number; height: number }) {
    const scale = Math.min(
      1,
      1600 / Math.max(size.width, 1),
      1000 / Math.max(size.height, 1)
    )
    return {
      width: Math.max(1, Math.round(size.width * scale)),
      height: Math.max(1, Math.round(size.height * scale)),
    }
  }

  private sameForegroundContext(
    first: ForegroundContext,
    second: ForegroundContext
  ): boolean {
    const normalize = (value: string | undefined) =>
      (value || '').normalize('NFKC').trim().replace(/\s+/gu, ' ')
    return (
      normalize(first.foregroundApp) === normalize(second.foregroundApp) &&
      normalize(first.windowTitle) === normalize(second.windowTitle)
    )
  }

  /** Read the foreground app/window without prompting for new permissions. */
  private async readForegroundContext(): Promise<ForegroundContext> {
    try {
      if (process.platform === 'darwin') {
        const script = [
          'tell application "System Events"',
          'set frontProcess to first process whose frontmost is true',
          'set processName to name of frontProcess',
          'set windowName to ""',
          'try',
          'set windowName to name of front window of frontProcess',
          'end try',
          'return processName & linefeed & windowName',
          'end tell',
        ].join('\n')
        const { stdout } = await execFileAsync('osascript', ['-e', script], {
          timeout: 2500,
          maxBuffer: 32 * 1024,
        })
        const lines = String(stdout)
          .trim()
          .split(/\r?\n/u)
          .map(value => value.trim())
        const foregroundApp = lines.shift() || undefined
        const windowTitle = lines.join(' ').trim() || undefined
        if (foregroundApp || windowTitle) {
          return {
            foregroundApp,
            windowTitle,
            confidence: 'full',
            source: 'accessibility',
          }
        }
        return {
          confidence: 'unavailable',
          source: 'unavailable',
          error: 'macOS 未返回前台窗口信息。',
        }
      }

      if (process.platform === 'win32') {
        const script = String.raw`
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class AliceForegroundWindow {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
'@
$handle = [AliceForegroundWindow]::GetForegroundWindow()
$titleBuilder = New-Object System.Text.StringBuilder 1024
[void][AliceForegroundWindow]::GetWindowText($handle, $titleBuilder, $titleBuilder.Capacity)
$processId = [uint32]0
[void][AliceForegroundWindow]::GetWindowThreadProcessId($handle, [ref]$processId)
$processName = ''
try { $processName = (Get-Process -Id $processId -ErrorAction Stop).ProcessName } catch {}
[PSCustomObject]@{ app = $processName; title = $titleBuilder.ToString() } | ConvertTo-Json -Compress
`
        const { stdout } = await execFileAsync(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            script,
          ],
          { timeout: 3000, maxBuffer: 32 * 1024, windowsHide: true }
        )
        const parsed = JSON.parse(String(stdout).trim()) as {
          app?: unknown
          title?: unknown
        }
        const foregroundApp =
          typeof parsed.app === 'string' ? parsed.app.trim() : undefined
        const windowTitle =
          typeof parsed.title === 'string' ? parsed.title.trim() : undefined
        if (foregroundApp || windowTitle) {
          return {
            foregroundApp,
            windowTitle,
            confidence: 'full',
            source: 'win32',
          }
        }
        return {
          confidence: 'unavailable',
          source: 'unavailable',
          error: 'Windows 未返回前台窗口信息。',
        }
      }

      if (process.platform === 'linux') {
        const { stdout: windowId } = await execFileAsync(
          'xdotool',
          ['getactivewindow'],
          { timeout: 1500, maxBuffer: 8 * 1024 }
        )
        const id = String(windowId).trim()
        if (!id) throw new Error('没有活动窗口 ID。')
        const [{ stdout: title }, { stdout: pid }] = await Promise.all([
          execFileAsync('xdotool', ['getwindowname', id], {
            timeout: 1500,
            maxBuffer: 32 * 1024,
          }),
          execFileAsync('xdotool', ['getwindowpid', id], {
            timeout: 1500,
            maxBuffer: 8 * 1024,
          }),
        ])
        let foregroundApp: string | undefined
        if (String(pid).trim()) {
          try {
            const processResult = await execFileAsync(
              'ps',
              ['-p', String(pid).trim(), '-o', 'comm='],
              { timeout: 1000, maxBuffer: 8 * 1024 }
            )
            foregroundApp = String(processResult.stdout).trim() || undefined
          } catch {
            // The title is still useful when process lookup is restricted.
          }
        }
        const windowTitle = String(title).trim() || undefined
        if (foregroundApp || windowTitle) {
          return {
            foregroundApp,
            windowTitle,
            confidence: 'full',
            source: 'xdotool',
          }
        }
      }
    } catch (error) {
      return {
        confidence: 'unavailable',
        source: 'unavailable',
        error: error instanceof Error ? error.message : String(error),
      }
    }

    return {
      confidence: 'unavailable',
      source: 'unavailable',
      error: `当前平台（${process.platform}）暂不支持读取前台窗口。`,
    }
  }

  private async getCurrentObservationContext(): Promise<
    DesktopObservationContext | undefined
  > {
    const foreground = await this.readForegroundContext()
    if (foreground.confidence !== 'full') return undefined
    const display = screen.getPrimaryDisplay()
    return {
      displayId: String(display.id),
      width: display.size.width,
      height: display.size.height,
      scaleFactor: display.scaleFactor,
      foregroundApp: foreground.foregroundApp,
      windowTitle: foreground.windowTitle,
    }
  }

  private async readContextAfterConfirmation(
    owner: BrowserWindow | null,
    initialContext?: DesktopObservationContext
  ): Promise<DesktopObservationContext | undefined> {
    let current = await this.getCurrentObservationContext()
    if (!this.looksLikeAliceContext(current)) return current

    // The owner window is only a confirmation surface.  Temporarily removing
    // it from the z-order lets the previously observed target regain focus;
    // restore visibility without activating Alice afterwards.
    const wasVisible = Boolean(
      owner && !owner.isDestroyed() && owner.isVisible()
    )
    try {
      if (owner && !owner.isDestroyed() && wasVisible) {
        owner.hide()
        await new Promise(resolve => setTimeout(resolve, 80))
        current = await this.getCurrentObservationContext()
      }
    } finally {
      if (owner && !owner.isDestroyed() && wasVisible) owner.showInactive()
    }

    // If the app stayed frontmost, return the context so the caller can fail
    // closed against the token.  `initialContext` is intentionally unused for
    // comparison here; the token registry performs the authoritative check.
    void initialContext
    return current
  }

  private looksLikeAliceContext(
    context: DesktopObservationContext | undefined
  ): boolean {
    if (!context) return false
    const combined =
      `${context.foregroundApp || ''} ${context.windowTitle || ''}`
        .trim()
        .toLowerCase()
    return combined.includes('alice')
  }

  private actionRequiresObservation(action: DesktopAction): boolean {
    return (
      action.action === 'click' ||
      action.action === 'type' ||
      action.action === 'hotkey'
    )
  }

  private describeObservationValidationFailure(reason: string): string {
    switch (reason) {
      case 'expired':
        return '观察令牌已过期。请重新调用 desktop_observe 后再执行。'
      case 'context-changed':
        return '自观察后屏幕或前台窗口已变化。为避免误操作，请重新调用 desktop_observe。'
      case 'invalid-context':
        return '当前桌面上下文无效。请重新调用 desktop_observe 并确认目标窗口。'
      case 'invalid-id':
      case 'not-found':
      default:
        return '观察令牌无效或已使用。请重新调用 desktop_observe。'
    }
  }

  private async mapClickActionToDisplay(
    action: Extract<DesktopAction, { action: 'click' }>,
    frameMetadata?: ObservationFrameMetadata
  ): Promise<
    | { success: true; action: Extract<DesktopAction, { action: 'click' }> }
    | { success: false; error: string; observationId?: string }
  > {
    const display = screen.getPrimaryDisplay()
    try {
      if (frameMetadata && frameMetadata.displayId !== String(display.id)) {
        return {
          success: false,
          error:
            '观察截图对应的显示器已变化。为避免误点击，请重新调用 desktop_observe。',
          observationId: action.observationId,
        }
      }

      if (action.coordinateSpace !== 'screen' && !frameMetadata) {
        return {
          success: false,
          error:
            '观察令牌缺少截图尺寸。为避免坐标偏移，请重新调用 desktop_observe。',
          observationId: action.observationId,
        }
      }

      const imageSize = frameMetadata
        ? {
            width: frameMetadata.imageWidth,
            height: frameMetadata.imageHeight,
          }
        : this.getCaptureThumbnailSize(display.size)
      const displayPoint =
        action.coordinateSpace === 'screen'
          ? { x: action.x, y: action.y }
          : mapImagePointToDisplay({
              x: action.x,
              y: action.y,
              imageWidth: imageSize.width,
              imageHeight: imageSize.height,
              displayBounds: display.bounds,
            })
      const nativePoint = mapDisplayPointToNative({
        x: displayPoint.x,
        y: displayPoint.y,
        scaleFactor: display.scaleFactor,
        platform: process.platform,
        displayBounds: display.bounds,
      })
      return {
        success: true,
        action: {
          ...action,
          x: nativePoint.x,
          y: nativePoint.y,
          coordinateSpace: 'screen',
        },
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : '点击坐标无效。',
        observationId: action.observationId,
      }
    }
  }

  private async ensureDirectoryApproved(
    requestedPath: string,
    event: Electron.IpcMainInvokeEvent
  ): Promise<{ success: true } | { success: false; error: string }> {
    let normalized: string
    try {
      normalized = await resolvePathThroughExistingParent(requestedPath)
    } catch (error) {
      return {
        success: false,
        error: `无法解析目录真实路径：${
          error instanceof Error ? error.message : String(error)
        }`,
      }
    }
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
      buttons: ['取消', '本次运行允许'],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      title: '允许访问目录？',
      message: 'Alice 请求在本次运行期间访问这个目录。',
      detail: normalized,
    }
    const confirmation = owner
      ? await dialog.showMessageBox(owner, options)
      : await dialog.showMessageBox(options)
    if (confirmation.response !== 1)
      return { success: false, error: '用户拒绝访问该目录。' }
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

  private ensureAccessibilityApproved():
    { success: true } | { success: false; error: string } {
    if (process.platform !== 'darwin') return { success: true }

    try {
      // This is deliberately a non-prompting check. The user can use the
      // settings shortcut shown in the renderer to grant access, and no
      // desktop action should be attempted while the permission is missing.
      if (systemPreferences.isTrustedAccessibilityClient(false)) {
        return { success: true }
      }
    } catch (error) {
      console.warn(
        '[DesktopManager] Could not read macOS accessibility permission:',
        error
      )
    }

    return {
      success: false,
      error:
        'macOS 尚未允许 Alice 使用辅助功能。请在“系统设置 > 隐私与安全性 > 辅助功能”中允许 Alice 后重试。',
    }
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
      throw new Error('operations 必须是最多包含 100 项的数组。')
    return input.map((item: any) => {
      if (!['move', 'copy', 'rename'].includes(item?.action))
        throw new Error('不支持的文件操作。')
      if (
        typeof item?.source !== 'string' ||
        typeof item?.destination !== 'string'
      )
        throw new Error('每项文件操作都需要源路径和目标路径。')
      if (!path.isAbsolute(item.source) || !path.isAbsolute(item.destination))
        throw new Error('文件操作路径必须使用绝对路径。')
      return {
        action: item.action,
        source: item.source,
        destination: item.destination,
      }
    })
  }

  private parseDesktopAction(args: any): DesktopAction {
    const action = args?.action
    const context = this.parseDesktopActionContext(args)
    if (
      action === 'open_app' &&
      typeof args.target === 'string' &&
      args.target.trim()
    )
      return { action, target: args.target.trim(), ...context }
    if (
      action === 'focus_window' &&
      (typeof args.app === 'string' || typeof args.title === 'string')
    )
      return { action, app: args.app, title: args.title, ...context }
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
        ...context,
      }
    if (
      action === 'type' &&
      typeof args.text === 'string' &&
      args.text.length <= 10000
    )
      return { action, text: args.text, ...context }
    if (
      action === 'hotkey' &&
      typeof args.keys === 'string' &&
      args.keys.trim()
    )
      return { action, keys: args.keys.trim(), ...context }
    throw new Error('桌面操作参数无效。')
  }

  private parseDesktopActionContext(args: any): DesktopActionContext {
    let observationId: string | undefined
    if (args?.observationId !== undefined) {
      if (
        typeof args.observationId !== 'string' ||
        args.observationId.trim().length === 0 ||
        args.observationId.trim().length > 256
      ) {
        throw new Error('observationId 必须是有效的观察令牌。')
      }
      observationId = args.observationId.trim()
    }

    let coordinateSpace: DesktopActionContext['coordinateSpace']
    if (args?.coordinateSpace !== undefined) {
      if (
        args.coordinateSpace !== 'image' &&
        args.coordinateSpace !== 'screen'
      ) {
        throw new Error('coordinateSpace 必须是 image 或 screen。')
      }
      coordinateSpace = args.coordinateSpace
    } else {
      coordinateSpace = 'image'
    }

    return { observationId, coordinateSpace }
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
    let accessibilityPermission = 'unknown'
    if (platform === 'darwin') {
      try {
        // A non-prompting check keeps capability inspection side-effect free.
        accessibilityPermission =
          systemPreferences.isTrustedAccessibilityClient(false)
            ? 'granted'
            : 'denied'
      } catch (error) {
        console.warn(
          '[DesktopManager] Could not read macOS accessibility permission:',
          error
        )
      }
    }
    return {
      platform,
      osVersion: os.release(),
      microphonePermission,
      accessibilityPermission,
      supportedActions: ['open_app', 'focus_window', 'click', 'type', 'hotkey'],
      observation: {
        supported: true,
        ttlMs: 30_000,
        singleUse: true,
        coordinateSpace: 'image-pixels',
      },
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

  private requestMicrophoneAccess(): Promise<MicrophoneAccessResult> {
    if (this.microphoneAccessRequest) return this.microphoneAccessRequest

    this.microphoneAccessRequest = (async () => {
      if (process.platform !== 'darwin') {
        return {
          success: true,
          permission: 'unknown',
          requested: false,
        }
      }

      const currentPermission =
        systemPreferences.getMediaAccessStatus('microphone')
      if (currentPermission === 'granted') {
        return {
          success: true,
          permission: currentPermission,
          requested: false,
        }
      }
      if (
        currentPermission === 'denied' ||
        currentPermission === 'restricted'
      ) {
        return {
          success: false,
          permission: currentPermission,
          requested: false,
          error: '系统已拒绝 Alice 的麦克风权限，请在系统设置中允许后重试。',
        }
      }

      try {
        const granted = await systemPreferences.askForMediaAccess('microphone')
        const permission = systemPreferences.getMediaAccessStatus('microphone')
        const success = granted || permission === 'granted'
        return {
          success,
          permission,
          requested: true,
          ...(success
            ? {}
            : {
                error:
                  '麦克风授权未完成，请在系统设置中允许 Alice 使用麦克风。',
              }),
        }
      } catch (error) {
        const permission = systemPreferences.getMediaAccessStatus('microphone')
        return {
          success: false,
          permission,
          requested: true,
          error:
            error instanceof Error ? error.message : '无法请求麦克风权限。',
        }
      }
    })().finally(() => {
      this.microphoneAccessRequest = null
    })

    return this.microphoneAccessRequest
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
        else if (action.title) {
          const title = this.escapeAppleScript(action.title)
          // A window title is not a process name.  Search the visible process
          // windows explicitly so titles such as browser tabs and document
          // names can be focused without accidentally targeting another app.
          script = [
            'tell application "System Events"',
            `set targetTitle to "${title}"`,
            'set foundWindow to false',
            'repeat with processRef in (every process whose background only is false)',
            'try',
            'repeat with windowRef in (windows of processRef)',
            'if (name of windowRef) is targetTitle then',
            'set frontmost of processRef to true',
            'set foundWindow to true',
            'exit repeat',
            'end if',
            'end repeat',
            'end try',
            'if foundWindow then exit repeat',
            'end repeat',
            'end tell',
            'if not foundWindow then error "Window not found"',
          ].join('\n')
        }
      } else if (action.action === 'click') {
        // System Events exposes click and right click as verbs.  Phrases such
        // as "left mouse button at …" look plausible but fail AppleScript
        // compilation, which made coordinate clicks unusable on macOS.
        const clickVerb = action.button === 'right' ? 'right click' : 'click'
        script = `tell application "System Events" to ${clickVerb} at {${action.x}, ${action.y}}`
      } else if (action.action === 'type') {
        // System Events' `keystroke` is layout-dependent and can silently
        // drop Chinese characters or emoji in some target applications. Use
        // the native pasteboard for non-empty text instead; the helper
        // restores the user's previous plain-text clipboard after the paste.
        await this.typeMacUnicodeText(action.text)
        return { message: 'macOS 桌面操作已执行。' }
      } else if (action.action === 'hotkey') {
        script = buildAppleScriptHotkey(action.keys)
      }
      if (!script) throw new Error('无法构造 macOS 桌面操作。')
      await execFileAsync('osascript', ['-e', script])
      return { message: 'macOS 桌面操作已执行。' }
    }

    if (process.platform === 'win32') {
      if (action.action === 'type') {
        // WScript.Shell.SendKeys is not Unicode-safe. SendInput is invoked in
        // bounded chunks so even a long Chinese message stays below Windows'
        // command-line length limit while preserving surrogate pairs.
        for (const chunk of splitWindowsUnicodeInput(action.text)) {
          await execFileAsync('powershell.exe', [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-Command',
            buildWindowsUnicodeTypeScript(chunk),
          ])
        }
      } else {
        const powershellScript = this.windowsPowerShellAction(action)
        await execFileAsync('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-Command',
          powershellScript,
        ])
      }
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

  /**
   * Paste text through the macOS pasteboard so Chinese, emoji, and multiline
   * content are delivered as Unicode regardless of the active keyboard
   * layout. The existing desktop-action confirmation happens before this
   * helper is called. The clipboard is restored even when the paste fails.
   */
  private async typeMacUnicodeText(text: string): Promise<void> {
    if (!text) return

    const previousClipboardText = clipboard.readText()
    clipboard.writeText(text)
    try {
      await execFileAsync('osascript', [
        '-e',
        'tell application "System Events" to keystroke "v" using {command down}',
      ])
      // Give the target application one event-loop turn to consume the
      // pasteboard before restoring it for the user.
      await new Promise(resolve => setTimeout(resolve, 80))
    } finally {
      clipboard.writeText(previousClipboardText)
    }
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
      // This branch is kept for callers that build a Windows action script
      // directly; executeDesktopAction uses the chunked Unicode path above.
      return buildWindowsUnicodeTypeScript(action.text)
    }
    if (action.action === 'hotkey') {
      const value = this.escapePowerShell(buildWindowsSendKeys(action.keys))
      return `$ws = New-Object -ComObject WScript.Shell; $ws.SendKeys('${value}')`
    }
    if (action.action === 'click') {
      const button = action.button === 'right' ? '0x0008' : '0x0002'
      return `Add-Type -TypeDefinition @'\nusing System; using System.Runtime.InteropServices; public static class AliceMouse { [DllImport("user32.dll")] public static extern bool SetCursorPos(int X,int Y); [DllImport("user32.dll")] public static extern void mouse_event(uint flags,uint dx,uint dy,uint data,UIntPtr extra); }\n'@; [AliceMouse]::SetCursorPos(${action.x},${action.y}); [AliceMouse]::mouse_event(${button},0,0,0,[UIntPtr]::Zero); [AliceMouse]::mouse_event(${action.button === 'right' ? '0x0010' : '0x0004'},0,0,0,[UIntPtr]::Zero)`
    }
    throw new Error('不支持的 Windows 桌面操作。')
  }
}

export default DesktopManager
