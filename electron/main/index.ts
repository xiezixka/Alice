// Fix for hybrid graphics systems (NVIDIA + AMD): Disable GPU before any Electron initialization
// This prevents GPU process crashes on systems with multiple graphics cards
process.env.ELECTRON_DISABLE_GPU = '1'
process.env.LIBGL_ALWAYS_SOFTWARE = '1'
process.env.GALLIUM_DRIVER = 'llvmpipe'

import { app, session } from 'electron'

app.disableHardwareAcceleration()

import {
  initializeThoughtVectorStore,
  reindexMultilingualLocalEmbeddings,
  ensureSaveOnQuit as ensureThoughtStoreSave,
} from './thoughtVectorStore'
import { reindexRagIfNeeded } from './ragDocumentStore'
import {
  initializeSchedulerDB,
  loadAndScheduleAllTasks,
  shutdownScheduler,
} from './schedulerManager'
import { loadSettings } from './settingsManager'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'
import { WebSocketServer } from 'ws'

import {
  createMainWindow,
  createOverlayWindow,
  cleanupWindows,
  registerCustomProtocol,
  getMainWindow,
  focusMainWindow,
  minimizeMainWindow,
  getMainWindowPresentationState,
  getRendererDist,
} from './windowManager'
import {
  shouldAllowMicrophonePermissionCheck,
  shouldAllowMicrophonePermissionRequest,
} from './mediaPermissions'
import {
  createTray,
  destroyTray,
  setTrayBackgroundListening,
} from './trayManager'
import { getCustomAvatarsRootPath } from './customAvatarsManager'
import { registerIPCHandlers, registerGoogleIPCHandlers } from './ipcManager'
import {
  registerMicrophoneToggleHotkey,
  registerMutePlaybackHotkey,
  registerTakeScreenshotHotkey,
  unregisterAllHotkeys,
} from './hotkeyManager'
import { initializeUpdater, checkForUpdates } from './updaterManager'
import { registerAuthIPCHandlers, stopAuthServer } from './authManager'
import {
  registerCodexIPCHandlers,
  stopCodexAppServer,
} from './codexAppServerManager'
import DesktopManager from './desktopManager'
import { backendManager } from './backendManager'
import { setupDependencies } from '../../scripts/setup-dependencies.js'
import {
  BACKGROUND_LAUNCH_ARG,
  buildRelaunchArgs,
  getBackgroundLaunchPresentation,
  isBackgroundListeningActive,
  shouldKeepWindowHiddenForSecondInstance,
} from './backgroundLaunch'

// Global state for hot reload persistence
declare global {
  var aliceAppState:
    | {
        managersInitialized: boolean
        appInitialized: boolean
        initTimestamp: number
        initId: string
      }
    | undefined
}

const USER_DATA_PATH = app.getPath('userData')
const GENERATED_IMAGES_FULL_PATH = path.join(USER_DATA_PATH, 'generated_images')

let isHandlingQuit = false
let wss: any | null = null
// Windows login items can carry the explicit argv marker.  On macOS 13+
// Electron delegates login items to SMAppService, which does not forward
// custom args; `wasOpenedAtLogin` is therefore the authoritative fallback.
let isBackgroundLaunch = process.argv.includes(BACKGROUND_LAUNCH_ARG)
let activateHandlerRegistered = false
let pendingManualActivation = false
let activationReady = false
let initialBackgroundActivationSeen = false
type PendingActivation = {
  hasVisibleWindows: boolean
  receivedAt: number
}

// `activate` can be emitted while dependency setup/settings loading is still
// in flight.  Keep the event shape (rather than a boolean) so the startup
// policy can consume only the first no-visible-window login activation and
// replay later user/Dock activations in order.
const pendingActivations: PendingActivation[] = []
let loginItemSourceResolved = process.platform !== 'darwin'

function detectMacLoginItemLaunch(): void {
  if (process.platform !== 'darwin') {
    loginItemSourceResolved = true
    return
  }
  try {
    if (app.getLoginItemSettings().wasOpenedAtLogin === true) {
      isBackgroundLaunch = true
      console.log(
        '[Main Index] Detected macOS login-item launch via wasOpenedAtLogin.'
      )
    }
  } catch (error) {
    console.warn(
      '[Main Index] Could not detect macOS login-item launch; using argv marker only:',
      error
    )
  } finally {
    // Even a failed probe is a resolved (fail-visible) decision.  Do not let
    // an activation remain indefinitely queued waiting for metadata that the
    // current runtime cannot provide.
    loginItemSourceResolved = true
  }
}

function replayPendingActivations(): void {
  if (!activationReady) return

  const queued = pendingActivations.splice(0)
  let shouldFocus = pendingManualActivation
  pendingManualActivation = false

  // A login-item launch on macOS 13+ may not carry our argv marker.  Once
  // `wasOpenedAtLogin` (or the explicit marker) identifies this process as a
  // background launch, consume exactly one queued activation with no visible
  // windows.  Any subsequent activation is a real user request and must be
  // replayed so a Dock click during startup is not lost.
  if (
    loginItemSourceResolved &&
    isBackgroundLaunch &&
    !initialBackgroundActivationSeen
  ) {
    const backgroundIndex = queued.findIndex(
      activation => activation.hasVisibleWindows === false
    )
    if (backgroundIndex >= 0) {
      queued.splice(backgroundIndex, 1)
      initialBackgroundActivationSeen = true
    }
  }

  if (queued.length > 0) shouldFocus = true
  if (!shouldFocus) return

  if (!focusMainWindow()) {
    void createMainWindow()
  }
}

function registerActivateHandler(): void {
  if (activateHandlerRegistered) return
  activateHandlerRegistered = true
  app.on('activate', (_event, hasVisibleWindows) => {
    // Register the listener before app.whenReady so no activate event is lost.
    // A login-item launch can emit an initial activation while dependencies
    // are still loading. Queue it until `wasOpenedAtLogin` and settings have
    // resolved; replayPendingActivations() then consumes only the first
    // no-visible-window background event and preserves later Dock clicks.
    if (!activationReady) {
      pendingActivations.push({
        hasVisibleWindows: hasVisibleWindows === true,
        receivedAt: Date.now(),
      })
      return
    }

    // The initial event is normally queued before the window is created.  If
    // Electron delivers it one tick later, retain the same one-shot rule, but
    // only for an explicit background launch source and a no-visible-window
    // event. A visible-window activation is always user initiated.
    if (
      loginItemSourceResolved &&
      isBackgroundLaunch &&
      !initialBackgroundActivationSeen &&
      hasVisibleWindows !== true
    ) {
      initialBackgroundActivationSeen = true
      return
    }
    if (!focusMainWindow()) {
      void createMainWindow()
    }
  })
}

// Electron documents `activate` as a macOS lifecycle event that may fire on
// the first launch, before the async initialization below has created a
// BrowserWindow. Install the guarded listener synchronously to handle both
// first-launch and subsequent Dock activations deterministically.
registerActivateHandler()
// Use global variables to persist across hot reloads
if (!global.aliceAppState) {
  global.aliceAppState = {
    managersInitialized: false,
    appInitialized: false,
    initTimestamp: Date.now(),
    initId: Math.random().toString(36).substr(2, 9),
  }
}

let managersInitialized = global.aliceAppState.managersInitialized
let appInitialized = global.aliceAppState.appInitialized
const initId = global.aliceAppState.initId

process.env.NODE_OPTIONS = '--max-old-space-size=4096'

const currentTime = Date.now()
const timeSinceLastInit = currentTime - global.aliceAppState.initTimestamp

console.log(
  `[Main Index ${initId}] Starting Electron main process... PID: ${process.pid}, Time since last init: ${timeSinceLastInit}ms`
)

function isBrowserContextToolEnabled(settings: any): boolean {
  return settings?.assistantTools?.includes('browser_context') || false
}

function configureLaunchAtLogin(enabled: boolean): void {
  if (typeof app.setLoginItemSettings !== 'function') return

  try {
    const loginItemSettings: Electron.Settings = {
      openAtLogin: enabled,
    }
    // `args` is supported for Windows registry launch items. macOS 13+
    // uses SMAppService and reports the launch through wasOpenedAtLogin.
    if (process.platform !== 'darwin') {
      loginItemSettings.args = [BACKGROUND_LAUNCH_ARG]
    }
    app.setLoginItemSettings(loginItemSettings)
    console.log(
      `[Main Index] Launch at login ${enabled ? 'enabled' : 'disabled'}`
    )
  } catch (error) {
    console.warn('[Main Index] Could not configure launch at login:', error)
  }
}

// CPU optimization for worker threads
process.env.ONNX_WEB_WEBGPU_DISABLED = 'true'
process.env.ONNX_WEB_INIT_TIMEOUT = '60000'
process.env.ONNX_WEB_WASM_ENABLE_SIMD = 'true'
process.env.UV_THREADPOOL_SIZE = '8'

if (process.platform === 'win32') app.setAppUserModelId(app.getName())

// Use Electron's built-in single instance lock
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  console.log(
    `[Main Index ${initId}] Electron single instance lock failed, quitting...`
  )
  app.quit()
  process.exit(0)
} else {
  console.log(
    `[Main Index ${initId}] Got Electron single instance lock, continuing to initialize...`
  )
}

console.log(
  `[Main Index ${initId}] About to define functions and event handlers...`
)

// Add error handlers to catch any unhandled exceptions
process.on('uncaughtException', error => {
  console.error(`[Main Index ${initId}] Uncaught Exception:`, error)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error(
    `[Main Index ${initId}] Unhandled Rejection at:`,
    promise,
    'reason:',
    reason
  )
})

function initializeManagers(): void {
  if (global.aliceAppState!.managersInitialized) {
    console.log(
      `[Main Index ${initId}] Managers already initialized, skipping...`
    )
    return
  }
  global.aliceAppState!.managersInitialized = true

  console.log(`[Main Index ${initId}] Initializing managers...`)
  DesktopManager.getInstance()
  initializeUpdater()

  registerIPCHandlers()
  registerGoogleIPCHandlers()
  registerAuthIPCHandlers()
  registerCodexIPCHandlers()
  console.log(`[Main Index ${initId}] Managers initialization complete.`)
}

async function handleContextAction(actionData: any) {
  try {
    const { action, selectedText, url, title } = actionData

    let prompt = ''
    switch (action) {
      case 'fact_check':
        prompt = `Please fact-check the following information using web search. Determine if the information is accurate, misleading, or false. Provide a clear assessment and cite sources:\n\n"${selectedText}"\n\nFrom: ${title} (${url})`
        break
      case 'summarize':
        prompt = `Please summarize the following content in a clear and concise manner:\n\n"${selectedText}"\n\nFrom: ${title} (${url})`
        break
      case 'tell_more':
        prompt = `Please provide more detailed information about the following topic using web search. Give me additional context, background, and related information:\n\n"${selectedText}"\n\nFrom: ${title} (${url})`
        break
      default:
        return
    }

    const mainWindow = getMainWindow()
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('context-action', {
        prompt,
        source: {
          selectedText,
          url,
          title,
          action,
        },
      })
    }
  } catch (error) {
    console.error('[WebSocket] Error handling context action:', error)
  }
}

function startWebSocketServer() {
  // Check if server is already running
  if (wss && wss.readyState === 1) {
    // 1 = OPEN
    console.log('[WebSocket] Server already running, skipping initialization')
    return
  }

  // Close existing server first
  if (wss) {
    try {
      wss.close()
      wss = null
    } catch (error) {
      console.warn('[WebSocket] Error closing existing server:', error)
    }
  }

  const setupWebSocketHandlers = (server: any, port: number) => {
    console.log(
      `[WebSocket] WebSocket server listening at ws://localhost:${port}`
    )

    const pendingRequests = new Map<
      string,
      { resolve: (value: any) => void; reject: (error: any) => void }
    >()

    server.on('connection', (ws: any) => {
      ws.on('message', async (message: any) => {
        try {
          const data = JSON.parse(message.toString())

          if (data.type === 'browser_context_response') {
            const mainWindow = getMainWindow()
            if (mainWindow && mainWindow.webContents) {
              mainWindow.webContents.send('websocket:response', data)
            }
          } else if (data.type === 'context_action') {
            await handleContextAction(data.data)
          }
        } catch (error) {
          console.error('[WebSocket] Error processing message:', error)
        }
      })
    })

    server.on('error', (error: any) => {
      console.error('[WebSocket] Server error:', error)
      if (error.code === 'EADDRINUSE') {
        console.error(`[WebSocket] Port ${port} is already in use`)
        // Try alternative ports
        tryAlternativePorts(port + 1)
      }
    })
  }

  const tryAlternativePorts = (startPort: number) => {
    const maxRetries = 5
    for (let i = 0; i < maxRetries; i++) {
      const port = startPort + i
      try {
        console.log(`[WebSocket] Trying alternative port ${port}...`)
        wss = new WebSocketServer({ host: '127.0.0.1', port })
        setupWebSocketHandlers(wss, port)
        return // Success
      } catch (error: any) {
        if (error.code === 'EADDRINUSE') {
          console.warn(`[WebSocket] Port ${port} also in use, trying next...`)
          continue
        } else {
          console.error(`[WebSocket] Unexpected error on port ${port}:`, error)
          break
        }
      }
    }
    console.error('[WebSocket] Failed to find available port after retries')
    wss = null
  }

  loadSettings()
    .then(settings => {
      const websocketPort = settings?.websocketPort || 5421

      try {
        wss = new WebSocketServer({ host: '127.0.0.1', port: websocketPort })
        setupWebSocketHandlers(wss, websocketPort)
      } catch (error: any) {
        console.error(
          `[WebSocket] Failed to create WebSocket server on port ${websocketPort}:`,
          error
        )
        if (error.code === 'EADDRINUSE') {
          tryAlternativePorts(websocketPort + 1)
        }
      }
    })
    .catch(error => {
      console.error(
        '[WebSocket] Failed to load settings, using default port 5421:',
        error
      )

      try {
        wss = new WebSocketServer({ host: '127.0.0.1', port: 5421 })
        setupWebSocketHandlers(wss, 5421)
      } catch (serverError: any) {
        console.error(
          '[WebSocket] Failed to create WebSocket server on default port 5421:',
          serverError
        )
        if (serverError.code === 'EADDRINUSE') {
          tryAlternativePorts(5422)
        } else {
          wss = null
        }
      }
    })
}

export function getWebSocketServer() {
  return wss
}

export { startWebSocketServer }

export function stopWebSocketServer() {
  if (wss) {
    console.log('[WebSocket] Stopping WebSocket server')
    try {
      wss.close(() => {
        console.log('[WebSocket] WebSocket server stopped')
      })
    } catch (error) {
      console.warn('[WebSocket] Error stopping server:', error)
    }
    wss = null
  }
}

export function restartWebSocketServer() {
  console.log(
    '[WebSocket] Restarting WebSocket server with new port configuration'
  )

  stopWebSocketServer()

  setTimeout(() => {
    startWebSocketServer()
  }, 1000)
}

app.on('ready', () => {
  console.log(`[Main Index ${initId}] App 'ready' event fired`)
  const rendererIndexPath = path.join(getRendererDist(), 'index.html')
  const getCurrentRendererUrl = (webContents: Electron.WebContents): string => {
    try {
      return webContents.getURL()
    } catch (error) {
      console.warn('[Media Permission] Could not read renderer URL:', error)
      return ''
    }
  }

  session.defaultSession.setPermissionCheckHandler(
    (webContents, permission, requestingOrigin, details) => {
      if (!webContents || webContents.isDestroyed()) return false
      return shouldAllowMicrophonePermissionCheck({
        permission,
        mediaType: details?.mediaType,
        isMainFrame: details?.isMainFrame,
        requestingOrigin,
        requestingUrl: details?.requestingUrl,
        currentUrl: getCurrentRendererUrl(webContents),
        rendererIndexPath,
      })
    }
  )
  session.defaultSession.setPermissionRequestHandler(
    (webContents, permission, callback, details) => {
      if (!webContents || webContents.isDestroyed()) {
        callback(false)
        return
      }

      const mediaDetails = (details || {}) as {
        mediaTypes?: string[]
        isMainFrame?: boolean
        requestingUrl?: string
        securityOrigin?: string
      }
      callback(
        shouldAllowMicrophonePermissionRequest({
          permission,
          mediaTypes: mediaDetails.mediaTypes,
          isMainFrame: mediaDetails.isMainFrame,
          requestingOrigin: mediaDetails.securityOrigin,
          requestingUrl: mediaDetails.requestingUrl,
          currentUrl: getCurrentRendererUrl(webContents),
          rendererIndexPath,
        })
      )
    }
  )
})

app.whenReady().then(async () => {
  // Must run before loading settings and choosing the initial window policy;
  // macOS 13+ does not preserve the custom background argv flag.
  detectMacLoginItemLaunch()
  console.log(
    `[Main Index ${initId}] whenReady called, appInitialized:`,
    global.aliceAppState!.appInitialized
  )
  if (global.aliceAppState!.appInitialized) {
    console.log(`[Main Index ${initId}] App already initialized, skipping...`)
    activationReady = Boolean(getMainWindow())
    replayPendingActivations()
    return
  }
  global.aliceAppState!.appInitialized = true

  console.log(`[Main Index ${initId}] Starting app initialization...`)

  // Setup dependencies for out-of-box experience
  console.log(`[Main Index ${initId}] Setting up dependencies...`)
  try {
    await setupDependencies()
  } catch (error) {
    console.warn(
      `[Main Index ${initId}] Warning: Could not setup all dependencies:`,
      error
    )
  }

  initializeManagers()

  registerCustomProtocol(GENERATED_IMAGES_FULL_PATH, getCustomAvatarsRootPath())

  const initialSettings = await loadSettings()
  if (initialSettings) {
    // Do not overwrite the user's existing login-item registration when a
    // transient settings read fails.  A null result is an error/first-run
    // state, not an explicit request to disable launch at login.
    configureLaunchAtLogin(initialSettings.launchAtLogin === true)
    registerMicrophoneToggleHotkey(initialSettings.microphoneToggleHotkey)
    registerMutePlaybackHotkey(initialSettings.mutePlaybackHotkey)
    registerTakeScreenshotHotkey(initialSettings.takeScreenshotHotkey)
  } else {
    console.warn('No initial settings found or settings failed to load.')
    const defaultFallbackSettings = {
      microphoneToggleHotkey: 'Alt+M',
      mutePlaybackHotkey: 'Alt+S',
      takeScreenshotHotkey: 'Alt+C',
    }
    registerMicrophoneToggleHotkey(
      defaultFallbackSettings.microphoneToggleHotkey
    )
    registerMutePlaybackHotkey(defaultFallbackSettings.mutePlaybackHotkey)
    registerTakeScreenshotHotkey(defaultFallbackSettings.takeScreenshotHotkey)
  }

  try {
    console.log(
      '[Main App Ready] Attempting to initialize Thought Vector Store...'
    )
    await initializeThoughtVectorStore()
    console.log(
      '[Main App Ready] Thought Vector Store initialization complete.'
    )
  } catch (error) {
    console.error(
      '[Main App Ready] CRITICAL ERROR during Thought Vector Store initialization:',
      error
    )
  }

  try {
    console.log('[Main App Ready] Initializing Task Scheduler...')
    initializeSchedulerDB()
    await loadAndScheduleAllTasks()
    console.log('[Main App Ready] Task Scheduler initialization complete.')
  } catch (error) {
    console.error(
      '[Main App Ready] ERROR during Task Scheduler initialization:',
      error
    )
  }

  // Never hide onboarding or malformed legacy settings. The native policy
  // validates local STT + wake-word prerequisites before allowing a login-item
  // launch to start hidden; otherwise the user would have no UI to repair it.
  const launchPresentation = getBackgroundLaunchPresentation(
    initialSettings,
    process.platform
  )
  const shouldLaunchSilently =
    isBackgroundLaunch &&
    (process.platform === 'darwin'
      ? launchPresentation.silentIsland
      : launchPresentation.launchInBackground)
  const showMainWindow = !shouldLaunchSilently
  await createMainWindow(showMainWindow, shouldLaunchSilently)
  activationReady = true
  replayPendingActivations()
  await createOverlayWindow()
  createTray(isBackgroundListeningActive(initialSettings))
  checkForUpdates()

  const revealBackendFailure = (
    message = '本地语音后端启动失败，请打开设置检查模型和权限。'
  ) => {
    if (!shouldLaunchSilently) return
    // Keep the tray status honest even when the persisted preference remains
    // enabled for the next retry. The listener is not usable in this run.
    setTrayBackgroundListening(false)
    const presentation = getMainWindowPresentationState()
    const alreadyVisibleToUser =
      presentation.visible &&
      !presentation.silent &&
      !presentation.initiallyHidden
    if (presentation.hiddenByUser) {
      // Respect an explicit close-to-tray action. This notification updates
      // renderer status without turning it back into an attention request.
      const hiddenWindow = getMainWindow()
      if (hiddenWindow && !hiddenWindow.isDestroyed()) {
        hiddenWindow.webContents.send('show-notification', {
          type: 'error',
          attention: false,
          message,
        })
      }
      return
    }
    if (alreadyVisibleToUser) {
      // Keep a full window open so the failure remains readable, but do not
      // perform another native focus/show transition.
      const visibleWindow = getMainWindow()
      if (visibleWindow && !visibleWindow.isDestroyed()) {
        visibleWindow.webContents.send('show-notification', {
          type: 'error',
          message,
        })
      }
      return
    }
    // Do not leave a login-item launch stranded in an invisible island when
    // the local backend/model cannot start. Reveal the full window without
    // activating it so the user can read the failure status and repair the
    // installation.
    minimizeMainWindow(false, false, true)
    const fallbackWindow = getMainWindow()
    if (fallbackWindow && !fallbackWindow.isDestroyed()) {
      fallbackWindow.webContents.send('main-window:expanded', {
        userInitiated: true,
      })
      fallbackWindow.webContents.send('show-notification', {
        type: 'error',
        message,
      })
    }
  }

  try {
    console.log('[Main App Ready] Starting Go AI backend...')
    const backendStarted = await backendManager.start()
    if (backendStarted) {
      console.log('[Main App Ready] Go AI backend started successfully')
      if (shouldLaunchSilently) {
        // The health endpoint can become reachable a little before its STT
        // readiness bit is published. Check in the background with short,
        // bounded retries so the island appears immediately and a transient
        // startup race does not flash the full window unnecessarily.
        void (async () => {
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const status = await Promise.race([
              backendManager.getServiceStatus(),
              new Promise<null>(resolve =>
                setTimeout(() => resolve(null), 1200)
              ),
            ])
            if (status?.stt) return
            if (attempt < 2) {
              await new Promise(resolve => setTimeout(resolve, 400))
            }
          }
          console.error(
            '[Main App Ready] Local STT service is unavailable; revealing the background launch.'
          )
          revealBackendFailure(
            '本地语音识别服务不可用，请打开设置检查 Whisper 模型和麦克风权限。'
          )
        })().catch(error => {
          console.error(
            '[Main App Ready] Background STT readiness check failed:',
            error
          )
          revealBackendFailure(
            '本地语音识别服务检查失败，请打开设置检查 Whisper 模型和麦克风权限。'
          )
        })
      }
      void (async () => {
        try {
          const result = await reindexMultilingualLocalEmbeddings()
          if (result.required) {
            console.log(
              `[Main App Ready] Automatic multi-lang Memory migration finished: indexed ${result.indexed}.`
            )
          }
        } catch (error) {
          console.warn(
            '[Main App Ready] Automatic multi-lang Memory migration will retry on the next launch:',
            error
          )
        }

        if (initialSettings?.ragEnabled && initialSettings.ragPaths?.length) {
          try {
            const result = await reindexRagIfNeeded(initialSettings.ragPaths, {
              recursive: true,
            })
            if (result.required) {
              console.log(
                `[Main App Ready] Automatic RAG migration finished: indexed ${result.indexed}, skipped ${result.skipped}.`
              )
            }
          } catch (error) {
            console.warn(
              '[Main App Ready] Automatic RAG migration will retry on the next launch:',
              error
            )
          }
        }
      })()
    } else {
      console.error('[Main App Ready] Failed to start Go AI backend')
      revealBackendFailure()
    }
  } catch (error) {
    console.error('[Main App Ready] Error starting Go AI backend:', error)
    revealBackendFailure()
  }

  if (initialSettings && isBrowserContextToolEnabled(initialSettings)) {
    console.log(
      '[Main App Ready] browser_context tool is enabled, starting WebSocket server'
    )
    startWebSocketServer()
  } else {
    console.log(
      '[Main App Ready] browser_context tool is disabled, skipping WebSocket server startup'
    )
  }
})

app.on('before-quit', async event => {
  if (isHandlingQuit) {
    return
  }
  isHandlingQuit = true
  unregisterAllHotkeys()
  stopAuthServer()
  stopCodexAppServer()
  shutdownScheduler()
  stopWebSocketServer()
  destroyTray()
  console.log('[Main Index] Before quit: Performing cleanup...')
  event.preventDefault()

  const cleanupTimeout = setTimeout(() => {
    console.warn('[Main Index] Cleanup timeout reached, forcing quit...')
    app.exit(0)
  }, 5000)

  try {
    await Promise.race([
      Promise.all([ensureThoughtStoreSave(), backendManager.stop()]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Cleanup timeout')), 4000)
      ),
    ])
    console.log('[Main Index] All cleanup tasks complete. Quitting now.')
  } catch (err) {
    console.error('[Main Index] Error during before-quit cleanup:', err)
  } finally {
    clearTimeout(cleanupTimeout)
    app.exit(0)
  }
})

app.on('window-all-closed', () => {
  cleanupWindows()
  if (process.platform !== 'darwin') app.quit()
})

app.on('second-instance', (event, commandLine, workingDirectory) => {
  // A login-item launch can race with an already-running instance (for
  // example after a user logs in twice or an installer retries). Do not
  // surface the capsule for that background launch; a normal manual launch
  // still reveals/focuses the existing window below.
  void loadSettings()
    .then(settings => {
      if (
        shouldKeepWindowHiddenForSecondInstance(
          commandLine,
          isBackgroundListeningActive(settings)
        )
      ) {
        console.log(
          '[Main Index] Ignoring duplicate background launch; keeping Alice hidden.'
        )
        return
      }

      const win = getMainWindow()
      if (win) {
        // Route manual relaunches through the same focus helper as tray/Dock
        // activation so a compact macOS silent island is expanded before the
        // user is shown the full assistant window.
        focusMainWindow()
      } else {
        // Initialization performs dependency/model checks before creating the
        // BrowserWindow. Preserve a manual relaunch request that arrives in
        // that interval and reveal the window immediately after creation.
        pendingManualActivation = true
        replayPendingActivations()
      }
    })
    .catch(error => {
      // If settings cannot be read, prefer the manual-launch behavior so the
      // user is not left with an apparently missing application window.
      console.warn(
        '[Main Index] Could not inspect duplicate-launch mode; showing Alice:',
        error
      )
      const win = getMainWindow()
      if (win) {
        focusMainWindow()
      } else {
        pendingManualActivation = true
        replayPendingActivations()
      }
    })
})

app.on('certificate-error', (event, webContents, url, err, certificate, cb) => {
  console.error('Certificate error for URL:', url, err)

  if (
    url.startsWith('https://192.168.') ||
    url.startsWith('https://localhost')
  ) {
    console.warn(`Bypassing certificate error for local/dev URL: ${url}`)
    event.preventDefault()
    cb(true)
  } else {
    cb(false)
  }
})
