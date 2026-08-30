import { BrowserWindow, screen, shell, protocol } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  resolvePathWithinRoot,
  validateExternalOpenUrl,
} from './securityBoundaries'
import {
  getMacSilentWindowBounds,
  MAC_SILENT_WINDOW_SIZE,
  shouldUseMacSilentWindow,
} from './macSilentWindow'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

if (!process.env.APP_ROOT) {
  process.env.APP_ROOT = path.join(__dirname, '../..')
}

export function getMainDist(): string {
  return path.join(process.env.APP_ROOT!, 'dist-electron')
}

export function getRendererDist(): string {
  return path.join(process.env.APP_ROOT!, 'dist')
}

export function getVitePublic(): string {
  return process.env.VITE_DEV_SERVER_URL
    ? path.join(process.env.APP_ROOT!, 'public')
    : getRendererDist()
}

export const VITE_DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL

const IS_DEV = !!VITE_DEV_SERVER_URL

function getPreloadPath(): string {
  return path.join(__dirname, '../preload/index.mjs')
}

function getIndexHtmlPath(): string {
  return path.join(getRendererDist(), 'index.html')
}

let win: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
// The default A layout is a wide floating capsule. Glass mode can resize this
// window to its own card dimensions once the renderer has loaded settings.
const DEFAULT_MAIN_WINDOW_SIZE = { width: 900, height: 300 }
const MINI_MAIN_WINDOW_SIZE = { width: 210, height: 210 }
let mainWindowRestoreSize = { ...DEFAULT_MAIN_WINDOW_SIZE }
let mainWindowSilent = false
let mainWindowCompact = false
let mainWindowRestoreBounds: Electron.Rectangle | null = null

function fitMainWindowSize(width: number, height: number) {
  const workArea = screen.getPrimaryDisplay().workArea
  const requestedWidth = Number.isFinite(width)
    ? width
    : DEFAULT_MAIN_WINDOW_SIZE.width
  const requestedHeight = Number.isFinite(height)
    ? height
    : DEFAULT_MAIN_WINDOW_SIZE.height
  return {
    width: Math.min(
      Math.max(MINI_MAIN_WINDOW_SIZE.width, Math.round(requestedWidth)),
      Math.max(MINI_MAIN_WINDOW_SIZE.width, workArea.width - 20)
    ),
    height: Math.min(
      Math.max(MINI_MAIN_WINDOW_SIZE.height, Math.round(requestedHeight)),
      Math.max(MINI_MAIN_WINDOW_SIZE.height, workArea.height - 20)
    ),
  }
}

function installNavigationGuards(window: BrowserWindow): void {
  const openExternal = (url: string) => {
    try {
      void shell
        .openExternal(validateExternalOpenUrl(url))
        .catch(error =>
          console.warn('[Window Security] Could not open external URL:', error)
        )
    } catch (error) {
      console.warn('[Window Security] Blocked external URL:', url, error)
    }
  }

  window.webContents.setWindowOpenHandler(({ url }) => {
    openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    try {
      const candidate = new URL(url)
      if (VITE_DEV_SERVER_URL) {
        if (candidate.origin === new URL(VITE_DEV_SERVER_URL).origin) return
      } else if (
        candidate.protocol === 'file:' &&
        path.resolve(fileURLToPath(candidate)) ===
          path.resolve(getIndexHtmlPath())
      ) {
        return
      }
    } catch {
      // Invalid renderer navigation is blocked below.
    }
    event.preventDefault()
    openExternal(url)
  })
}

export function getMainWindow(): BrowserWindow | null {
  return win
}

export function getOverlayWindow(): BrowserWindow | null {
  return overlayWindow
}

export function getSettingsWindow(): BrowserWindow | null {
  return settingsWindow
}

export async function createMainWindow(show = true): Promise<BrowserWindow> {
  mainWindowRestoreSize = { ...DEFAULT_MAIN_WINDOW_SIZE }
  mainWindowRestoreBounds = null
  mainWindowSilent = false
  mainWindowCompact = false
  win = new BrowserWindow({
    title: 'Alice',
    icon: path.join(getVitePublic(), 'app_logo.png'),
    transparent: true,
    frame: false,
    width: DEFAULT_MAIN_WINDOW_SIZE.width,
    height: DEFAULT_MAIN_WINDOW_SIZE.height,
    minWidth: MINI_MAIN_WINDOW_SIZE.width,
    minHeight: MINI_MAIN_WINDOW_SIZE.height,
    resizable: true,
    alwaysOnTop: true,
    hasShadow: false,
    show,
    paintWhenInitiallyHidden: !show,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      offscreen: false,
      backgroundThrottling: false,
    },
  })

  installNavigationGuards(win)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(getIndexHtmlPath())
  }

  win.on('closed', () => {
    win = null
  })

  win.webContents.on('did-finish-load', () => {
    win?.webContents.send(
      'main-process-message',
      `Alice ready at ${new Date().toLocaleString()}`
    )
  })

  return win
}

export async function createOverlayWindow(): Promise<BrowserWindow> {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize

  overlayWindow = new BrowserWindow({
    width,
    height,
    transparent: false,
    frame: false,
    alwaysOnTop: true,
    fullscreen: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    backgroundColor: '#000000',
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      offscreen: false,
      backgroundThrottling: false,
    },
  })

  installNavigationGuards(overlayWindow)

  const arg = 'overlay'
  if (VITE_DEV_SERVER_URL) {
    await overlayWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    await overlayWindow.loadFile(getIndexHtmlPath(), { hash: arg })
  }

  overlayWindow.hide()

  overlayWindow.on('closed', () => {
    overlayWindow = null
  })

  return overlayWindow
}

export async function showOverlay(): Promise<boolean> {
  if (!overlayWindow) {
    await createOverlayWindow()
  }

  const currentOverlayWindow = overlayWindow
  if (!currentOverlayWindow) return false

  currentOverlayWindow.setOpacity(0.35)
  currentOverlayWindow.show()
  currentOverlayWindow.focus()
  currentOverlayWindow.webContents.send('overlay-shown')

  return true
}

export function hideOverlay(): boolean {
  overlayWindow?.hide()
  win?.webContents.send('overlay-closed')
  return true
}

export function setOverlayOpacity(opacity: number): boolean {
  if (!overlayWindow || overlayWindow.isDestroyed()) {
    return false
  }
  overlayWindow.setOpacity(opacity)
  return true
}

export function resizeMainWindow(width: number, height: number): void {
  if (!win || mainWindowCompact) return

  // Renderer watchers can issue a stale resize immediately after the
  // minimize transition. Never let that asynchronous IPC call stretch the
  // native 240×44 island (or the legacy 210×210 mini window); expansion first
  // clears `mainWindowCompact`, then an explicit resize is allowed.
  const fittedSize = fitMainWindowSize(width, height)
  if (
    fittedSize.width !== MINI_MAIN_WINDOW_SIZE.width ||
    fittedSize.height !== MINI_MAIN_WINDOW_SIZE.height
  ) {
    mainWindowRestoreSize = fittedSize
  }
  win.setSize(fittedSize.width, fittedSize.height)
  const current = win.getBounds()
  mainWindowRestoreBounds = {
    ...current,
    width: fittedSize.width,
    height: fittedSize.height,
  }
}

/**
 * Move the main window into (or out of) the macOS silent notch island.
 *
 * The renderer still owns the `isMinimized` state; this function only applies
 * native geometry and window-level flags.  The optional `silent` argument is
 * intentionally backwards-compatible with older renderers that only sent
 * `{ minimize: boolean }`.
 */
export function minimizeMainWindow(
  minimize: boolean,
  silent = minimize && shouldUseMacSilentWindow(process.platform)
): void {
  if (!win) return

  const display = screen.getDisplayMatching(win.getBounds())
  const workArea = display.workArea
  if (minimize) {
    if (!mainWindowCompact) {
      const currentBounds = win.getBounds()
      mainWindowRestoreBounds = { ...currentBounds }
    }
    const useMacSilentWindow =
      silent && shouldUseMacSilentWindow(process.platform, true)
    if (useMacSilentWindow) {
      const bounds = getMacSilentWindowBounds(display.bounds, {
        width: MAC_SILENT_WINDOW_SIZE.width,
        height: MAC_SILENT_WINDOW_SIZE.height,
      })

      // BrowserWindow's normal 210px minimum would otherwise clamp the
      // compact island back to a square.  Keep a dedicated minimum while in
      // silent mode and restore the regular minimum on expansion.
      win.setMinimumSize(
        MAC_SILENT_WINDOW_SIZE.width,
        MAC_SILENT_WINDOW_SIZE.height
      )
      win.setResizable(false)
      win.setSkipTaskbar(true)
      win.setAlwaysOnTop(true, 'floating')
      if (typeof win.setVisibleOnAllWorkspaces === 'function') {
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
      }
      win.setSize(bounds.width, bounds.height)
      win.setPosition(bounds.x, bounds.y)
      mainWindowSilent = true
      mainWindowCompact = true
      console.log('[WindowManager] Main window moved to macOS silent island', {
        ...bounds,
      })
      return
    }

    const x = workArea.x + workArea.width - MINI_MAIN_WINDOW_SIZE.width - 20
    const y = workArea.y + workArea.height - MINI_MAIN_WINDOW_SIZE.height - 20
    win.setMinimumSize(
      MINI_MAIN_WINDOW_SIZE.width,
      MINI_MAIN_WINDOW_SIZE.height
    )
    win.setResizable(false)
    win.setSkipTaskbar(false)
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(false)
    }
    win.setPosition(x, y)
    win.setSize(MINI_MAIN_WINDOW_SIZE.width, MINI_MAIN_WINDOW_SIZE.height)
    mainWindowSilent = false
    mainWindowCompact = true
  } else {
    win.setMinimumSize(
      MINI_MAIN_WINDOW_SIZE.width,
      MINI_MAIN_WINDOW_SIZE.height
    )
    win.setResizable(true)
    win.setSkipTaskbar(false)
    if (typeof win.setVisibleOnAllWorkspaces === 'function') {
      win.setVisibleOnAllWorkspaces(false)
    }
    const { width, height } = fitMainWindowSize(
      mainWindowRestoreSize.width,
      mainWindowRestoreSize.height
    )
    const savedBounds = mainWindowRestoreBounds
    const maxX = workArea.x + Math.max(0, workArea.width - width)
    const maxY = workArea.y + Math.max(0, workArea.height - height)
    const x = savedBounds
      ? Math.min(maxX, Math.max(workArea.x, Math.round(savedBounds.x)))
      : Math.round(workArea.x + workArea.width / 2 - width / 2)
    const y = savedBounds
      ? Math.min(maxY, Math.max(workArea.y, Math.round(savedBounds.y)))
      : Math.round(workArea.y + workArea.height / 2 - height / 2)
    win.setPosition(x, y)
    win.setSize(width, height)
    mainWindowSilent = false
    mainWindowCompact = false
    mainWindowRestoreBounds = null
  }
}

/** Return whether the native window is currently in the macOS silent island. */
export function isMainWindowSilent(): boolean {
  return mainWindowSilent
}

export function focusMainWindow(): boolean {
  if (win && !win.isDestroyed()) {
    // A tray click / Dock activation is an explicit request to work with
    // Alice. Expand the macOS island before focusing it so the user is never
    // left with an apparently unresponsive 240×44 surface. Keep the legacy
    // square mini window's historical focus-only behaviour unchanged.
    const wasSilent = mainWindowSilent
    if (wasSilent) {
      minimizeMainWindow(false)
    }
    win.show()
    win.focus()
    win.moveTop()
    // Keep the renderer's reactive `isMinimized` state in sync when a tray or
    // Dock activation expanded the native window.  This event is allowlisted
    // in the preload bridge and is intentionally emitted only for a real
    // compact → full transition.
    if (wasSilent && !win.webContents.isDestroyed()) {
      win.webContents.send('main-window:expanded')
    }
    console.log('[WindowManager] Main window focused')
    return true
  }
  return false
}

export async function createSettingsWindow(): Promise<BrowserWindow> {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show()
    settingsWindow.focus()
    return settingsWindow
  }

  settingsWindow = new BrowserWindow({
    title: 'Alice Settings',
    icon: path.join(getVitePublic(), 'app_logo.png'),
    width: 900,
    height: 700,
    minWidth: 600,
    minHeight: 500,
    frame: false,
    resizable: true,
    alwaysOnTop: false,
    parent: win || undefined,
    modal: false,
    backgroundColor: '#1f2937',
    show: false,
    webPreferences: {
      preload: getPreloadPath(),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      offscreen: false,
      backgroundThrottling: false,
    },
  })

  installNavigationGuards(settingsWindow)

  const arg = 'settings'
  if (VITE_DEV_SERVER_URL) {
    await settingsWindow.loadURL(`${VITE_DEV_SERVER_URL}#${arg}`)
  } else {
    await settingsWindow.loadFile(getIndexHtmlPath(), { hash: arg })
  }

  settingsWindow.show()
  settingsWindow.focus()

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  return settingsWindow
}

export function closeSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close()
  }
}

export function cleanupWindows(): void {
  win = null
  overlayWindow = null
  settingsWindow = null
}

export function registerCustomProtocol(
  generatedImagesPath: string,
  customAvatarsPath?: string
): void {
  protocol.registerFileProtocol('alice-image', (request, callback) => {
    try {
      const url = request.url.substring('alice-image://'.length)
      const decodedUrlPath = decodeURIComponent(url)
      const filePath = resolvePathWithinRoot(
        generatedImagesPath,
        decodedUrlPath
      )
      callback({ path: filePath })
    } catch {
      console.error(
        `[Protocol] Denied access to unsafe image path from URL: ${request.url}`
      )
      callback({ error: -6 })
    }
  })

  if (customAvatarsPath) {
    protocol.registerFileProtocol('alice-avatar', (request, callback) => {
      try {
        const url = request.url.substring('alice-avatar://'.length)
        const decodedUrlPath = decodeURIComponent(url)
        const filePath = resolvePathWithinRoot(
          customAvatarsPath,
          decodedUrlPath
        )
        callback({ path: filePath })
      } catch {
        console.error(
          `[Protocol] Denied access to unsafe avatar path from URL: ${request.url}`
        )
        callback({ error: -6 })
      }
    })
  }
}
