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
// A user choosing “隐藏到后台” must not be overridden by the first
// background-launch reveal.  Keep this native guard in addition to the
// renderer timer so a close-to-tray action remains deterministic even when
// the renderer is still finishing its initial mount.
let mainWindowHiddenByUser = false
// `BrowserWindow({ show: false })` can report a visible state while its first
// paint is still suppressed. Track the intent explicitly so a background
// launch can reveal the island exactly once without relying on isVisible().
let mainWindowInitiallyHidden = false

function fitMainWindowSize(
  width: number,
  height: number,
  display = screen.getPrimaryDisplay()
) {
  const workArea = display.workArea
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

export async function createMainWindow(
  show = true,
  backgroundLaunch = false
): Promise<BrowserWindow> {
  mainWindowRestoreSize = { ...DEFAULT_MAIN_WINDOW_SIZE }
  mainWindowRestoreBounds = null
  mainWindowSilent = false
  mainWindowCompact = false
  mainWindowHiddenByUser = false
  mainWindowInitiallyHidden = !show
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
      // Renderer processes do not consistently inherit the main-process
      // command line on every Electron/macOS combination.  Pass an explicit
      // marker so the first silent-island reveal is deterministic.
      additionalArguments: backgroundLaunch
        ? ['--alice-renderer-background']
        : [],
    },
  })

  installNavigationGuards(win)

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(getIndexHtmlPath())
  }

  const repositionSilentWindow = () => {
    if (!win || win.isDestroyed() || !mainWindowSilent) return
    const display = screen.getDisplayMatching(win.getBounds())
    const bounds = getMacSilentWindowBounds(display.bounds, {
      width: MAC_SILENT_WINDOW_SIZE.width,
      height: MAC_SILENT_WINDOW_SIZE.height,
    })
    win.setPosition(bounds.x, bounds.y)
  }
  // Keep the simulated island attached to the active display when the user
  // changes scale/resolution or docks/undocks a monitor.
  screen.on('display-metrics-changed', repositionSilentWindow)
  screen.on('display-added', repositionSilentWindow)
  screen.on('display-removed', repositionSilentWindow)

  const markMainWindowVisible = () => {
    if (!mainWindowHiddenByUser) {
      mainWindowInitiallyHidden = false
    }
  }
  const mainWindow = win
  mainWindow.on('show', markMainWindowVisible)

  win.on('closed', () => {
    screen.off('display-metrics-changed', repositionSilentWindow)
    screen.off('display-added', repositionSilentWindow)
    screen.off('display-removed', repositionSilentWindow)
    mainWindow.off('show', markMainWindowVisible)
    win = null
    mainWindowInitiallyHidden = false
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
  if (!win || win.isDestroyed() || mainWindowCompact) return

  // Renderer watchers can issue a stale resize immediately after the
  // minimize transition. Never let that asynchronous IPC call stretch the
  // native 240×44 island (or the legacy 210×210 mini window); expansion first
  // clears `mainWindowCompact`, then an explicit resize is allowed.
  const display = screen.getDisplayMatching(win.getBounds())
  const fittedSize = fitMainWindowSize(width, height, display)
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
  silent = minimize && shouldUseMacSilentWindow(process.platform),
  showWhenHidden = false
): void {
  if (!win || win.isDestroyed()) return

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
      const shouldRevealHiddenWindow =
        (showWhenHidden || mainWindowInitiallyHidden) && !mainWindowHiddenByUser
      const wasInitiallyHidden = mainWindowInitiallyHidden

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
      if (shouldRevealHiddenWindow && typeof win.showInactive === 'function') {
        // Background login launches remain non-activating: the island becomes
        // visible without stealing focus from the user's current app.
        win.showInactive()
      }
      console.log('[WindowManager] Main window moved to macOS silent island', {
        ...bounds,
        initiallyHidden: wasInitiallyHidden,
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
    // Any explicit expansion (island click, tray/Dock activation, or a
    // renderer request) means the user is interacting with Alice again. Keep
    // an explicit close-to-tray guard until the tray/Dock focus path clears
    // it; otherwise a wake event could immediately undo the user's choice.
    const wasHiddenByUser = mainWindowHiddenByUser
    const wasInitiallyHidden = mainWindowInitiallyHidden
    if (!wasHiddenByUser && win.isMinimized()) {
      // Wake-word activity may arrive while the user also pressed Cmd+M (or
      // the Dock minimized the BrowserWindow). Restore the native window
      // before resizing so the renderer's expanded state is actually visible.
      win.restore()
    }
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
      mainWindowRestoreSize.height,
      display
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
    if (!wasHiddenByUser) {
      mainWindowHiddenByUser = false
      mainWindowInitiallyHidden = false
    }
    if (
      (showWhenHidden || wasInitiallyHidden) &&
      !wasHiddenByUser &&
      typeof win.showInactive === 'function'
    ) {
      // Expand an active background wake without activating Alice over the
      // user's current application.
      win.showInactive()
    }
  }
}

/** Return whether the native window is currently in the macOS silent island. */
export function isMainWindowSilent(): boolean {
  return mainWindowSilent
}

export interface MainWindowPresentationState {
  silent: boolean
  hiddenByUser: boolean
  initiallyHidden: boolean
}

/**
 * Return the native presentation state so a renderer that mounted after a
 * tray/Dock click can reconcile its reactive layout instead of relying on a
 * one-shot event that may have fired before Vue registered its listener.
 */
export function getMainWindowPresentationState(): MainWindowPresentationState {
  return {
    silent: mainWindowSilent,
    hiddenByUser: mainWindowHiddenByUser,
    initiallyHidden: mainWindowInitiallyHidden,
  }
}

export function focusMainWindow(): boolean {
  if (win && !win.isDestroyed()) {
    const wasSilent = mainWindowSilent
    const wasInitiallyHidden = mainWindowInitiallyHidden
    const wasHiddenByUser = mainWindowHiddenByUser
    // A Dock/tray activation can arrive while macOS (or the user) has
    // minimized the native BrowserWindow. Restore that OS-level state before
    // applying the compact-window transition; otherwise `show()`/`focus()`
    // may leave the window hidden behind the Dock.
    if (win.isMinimized()) {
      win.restore()
    }
    mainWindowHiddenByUser = false
    mainWindowInitiallyHidden = false
    // A tray click / Dock activation is an explicit request to work with
    // Alice. Expand the macOS island before focusing it so the user is never
    // left with an apparently unresponsive 240×44 surface. Keep the legacy
    // square mini window's historical focus-only behaviour unchanged.
    if (wasSilent) {
      minimizeMainWindow(false)
    }
    win.show()
    win.focus()
    win.moveTop()
    // Keep the renderer's reactive `isMinimized` state in sync when a tray or
    // Dock activation explicitly reveals the app. Do not emit on an ordinary
    // macOS activate/focus event, otherwise a normal visible launch would be
    // marked as manually expanded and its idle timer would never run.
    if (
      (wasSilent || wasInitiallyHidden || wasHiddenByUser) &&
      !win.webContents.isDestroyed()
    ) {
      win.webContents.send('main-window:expanded', { userInitiated: true })
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
  mainWindowHiddenByUser = false
  mainWindowInitiallyHidden = false
}

/**
 * Hide the main window for background listening without quitting the app.
 * This is intentionally native so a renderer timer cannot accidentally
 * re-show the window during the same launch.
 */
export function hideMainWindowToTray(): boolean {
  if (!win || win.isDestroyed()) return false
  mainWindowHiddenByUser = true
  win.hide()
  return true
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
