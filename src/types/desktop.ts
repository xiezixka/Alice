/** Shared renderer/preload contract for safe desktop observation and actions. */

export interface DesktopDisplayBounds {
  x: number
  y: number
  width: number
  height: number
}

/** Coordinate space accepted by desktop_action input. */
export type DesktopActionCoordinateSpace = 'image' | 'screen'

/** Coordinate metadata emitted with a captured frame. */
export type DesktopScreenshotCoordinateSpace = 'image-pixels' | 'screen-points'

export interface DesktopScreenshot {
  imageDataUrl: string
  /** Legacy aliases retained for capture_desktop_screen consumers. */
  width: number
  height: number
  imageWidth?: number
  imageHeight?: number
  displayId?: string
  displayBounds?: DesktopDisplayBounds
  scaleFactor?: number
  coordinateSpace?: DesktopScreenshotCoordinateSpace
  capturedAt?: string
  observedAt?: string
  detail?: 'low' | 'high' | 'auto'
  context?: DesktopObservationContextMetadata
  observationId?: string
  expiresAt?: string
  expiresAtMs?: number
  warning?: string
}

export interface DesktopObservationContextMetadata {
  displayId?: string | number
  screenId?: string | number
  /** Global logical origin of the observed display. */
  originX?: number
  originY?: number
  width?: number
  height?: number
  scaleFactor?: number
  windowId?: string | number
  foregroundApp?: string
  windowTitle?: string
  windowFingerprint?: string
  screenFingerprint?: string
  confidence?: 'full' | 'unavailable'
  source?: 'accessibility' | 'win32' | 'xdotool' | 'unavailable'
}

/**
 * Main process response data. New bridges may return a nested `screenshot`;
 * the current bridge and legacy capture channel may emit the frame directly.
 */
export interface DesktopObservationData {
  message?: string
  observationId?: string
  observedAt?: string
  expiresAt?: string
  expiresAtMs?: number
  context?: DesktopObservationContextMetadata
  screenshot?: DesktopScreenshot
  imageDataUrl?: string
  width?: number
  height?: number
  imageWidth?: number
  imageHeight?: number
  displayId?: string
  displayBounds?: DesktopDisplayBounds
  scaleFactor?: number
  coordinateSpace?: DesktopScreenshotCoordinateSpace
  capturedAt?: string
  warning?: string
  [key: string]: unknown
}

export interface DesktopObservationResponse {
  success: boolean
  data?: DesktopObservationData
  error?: string
}

export interface DesktopActionArgs {
  action: 'open_app' | 'focus_window' | 'click' | 'type' | 'hotkey'
  target?: string
  app?: string
  title?: string
  x?: number
  y?: number
  button?: 'left' | 'right'
  text?: string
  keys?: string
  observationId?: string
  coordinateSpace?: DesktopActionCoordinateSpace
}

/**
 * High-level reply request for an already-open chat window.  The request is
 * intentionally bound to a fresh observation token; the main process shows a
 * confirmation dialog before typing or sending anything.
 */
export interface DesktopReplyArgs {
  observationId: string
  recipient: string
  body: string
  sendShortcut?: 'ENTER' | 'CTRL+ENTER' | 'CMD+ENTER'
  expectedApp?: string
  expectedWindowTitle?: string
}

export interface DesktopReplyResponse {
  success: boolean
  action?: 'reply_message'
  recipient?: string
  sent?: boolean
  targetApp?: string
  targetWindowTitle?: string
  sendShortcut?: 'ENTER' | 'CTRL+ENTER' | 'CMD+ENTER'
  message?: string
  error?: string
  observationId?: string
  verification?: DesktopActionVerification
  screenshot?: DesktopScreenshot
  [key: string]: unknown
}

export interface DesktopActionVerification {
  status: 'captured' | 'verified' | 'unavailable' | 'failed'
  message?: string
  observationId?: string
  observedAt?: string
  expiresAt?: string
  context?: DesktopObservationContextMetadata
  screenshot?: DesktopScreenshot
}

export interface DesktopActionResponse {
  success: boolean
  action?: DesktopActionArgs['action']
  message?: string
  error?: string
  observationId?: string
  verification?: DesktopActionVerification
  /** Post-action frame is top-level so the visual extractor can find it. */
  screenshot?: DesktopScreenshot
  [key: string]: unknown
}
