/**
 * Coordinate conversion for vision-driven desktop actions.
 *
 * Screenshots are commonly down-scaled before they are sent to a model, while
 * the native automation APIs expect coordinates in the display's coordinate
 * space.  Keeping this conversion in a dependency-free module makes the
 * security-sensitive boundary easy to test without importing Electron.
 */

export interface DesktopPoint {
  x: number
  y: number
}

export interface DesktopSize {
  width: number
  height: number
}

/** A display rectangle. `x`/`y` may be negative on a multi-monitor desktop. */
export interface DesktopBounds extends DesktopPoint, DesktopSize {}

/** Name used by the Electron capture/action bridge. */
export type DesktopDisplayBounds = DesktopBounds

export type CoordinateBoundaryMode = 'reject' | 'clamp'

export interface DesktopCoordinateMappingOptions {
  /**
   * Native pixels per display unit.  If `nativeBounds` is supplied, the
   * explicit rectangle takes precedence for the actual mapping.
   */
  scaleFactor?: number
  /**
   * Native/global rectangle for the target display.  Supplying this is the
   * most precise option when an OS exposes a native coordinate space whose
   * origin differs from Electron's display bounds.
   */
  nativeBounds?: DesktopBounds
  /**
   * Reject points outside the image by default. `clamp` is useful for model
   * output that is off by a pixel at an image edge, but callers should keep the
   * default `reject` for actions with irreversible side effects.
   */
  boundary?: CoordinateBoundaryMode
}

export interface DesktopCoordinateMappingInput extends DesktopCoordinateMappingOptions {
  /** Point in screenshot/image pixels, origin at the top-left. */
  point: DesktopPoint
  /** Actual pixel dimensions of the screenshot supplied to the model. */
  imageSize: DesktopSize
  /** Display bounds in the logical/display coordinate space. */
  displayBounds: DesktopBounds
}

/** Flat input shape used by desktopManager's capture metadata. */
export interface ImagePointToDisplayInput {
  x: number
  y: number
  imageWidth: number
  imageHeight: number
  displayBounds: DesktopDisplayBounds
  boundary?: CoordinateBoundaryMode
}

/**
 * Convert Electron display coordinates to the coordinate space expected by a
 * platform's native pointer API.  Electron reports display bounds in DIPs.
 */
export interface DisplayPointToNativeInput {
  x: number
  y: number
  scaleFactor: number
  platform: string
  /** Optional safety check when the caller still has the observed bounds. */
  displayBounds?: DesktopDisplayBounds
}

export interface DesktopCoordinateMapping {
  /** The validated (and, in clamp mode, clamped) source point. */
  imagePoint: DesktopPoint
  /** Normalized image position, each component in [0, 1]. */
  normalizedPoint: DesktopPoint
  /** Rounded, in-bounds point in display coordinates. */
  displayPoint: DesktopPoint
  /** Rounded, in-bounds point in native coordinates. */
  nativePoint: DesktopPoint
  /** Unrounded display-space result, useful for diagnostics. */
  displayPointExact: DesktopPoint
  /** Unrounded native-space result, useful for diagnostics. */
  nativePointExact: DesktopPoint
  imageSize: DesktopSize
  displayBounds: DesktopBounds
  nativeBounds: DesktopBounds
  /** Effective native/display scale on each axis. */
  nativeScale: DesktopPoint
}

export type DesktopCoordinateErrorCode = 'invalid-input' | 'out-of-bounds'

export class DesktopCoordinateError extends Error {
  readonly code: DesktopCoordinateErrorCode

  constructor(code: DesktopCoordinateErrorCode, message: string) {
    super(message)
    this.name = 'DesktopCoordinateError'
    this.code = code
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requireFiniteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DesktopCoordinateError(
      'invalid-input',
      `${label} must be a finite number`
    )
  }
  return value
}

function requirePositiveNumber(value: unknown, label: string): number {
  const number = requireFiniteNumber(value, label)
  if (number <= 0) {
    throw new DesktopCoordinateError(
      'invalid-input',
      `${label} must be greater than zero`
    )
  }
  return number
}

function copyPoint(point: DesktopPoint): DesktopPoint {
  return { x: point.x, y: point.y }
}

function copySize(size: DesktopSize): DesktopSize {
  return { width: size.width, height: size.height }
}

function copyBounds(bounds: DesktopBounds): DesktopBounds {
  return {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  }
}

function validatePoint(point: unknown, label: string): DesktopPoint {
  if (!isRecord(point)) {
    throw new DesktopCoordinateError('invalid-input', `${label} is required`)
  }
  return {
    x: requireFiniteNumber(point.x, `${label}.x`),
    y: requireFiniteNumber(point.y, `${label}.y`),
  }
}

function validateSize(size: unknown, label: string): DesktopSize {
  if (!isRecord(size)) {
    throw new DesktopCoordinateError('invalid-input', `${label} is required`)
  }
  return {
    width: requirePositiveNumber(size.width, `${label}.width`),
    height: requirePositiveNumber(size.height, `${label}.height`),
  }
}

function validateBounds(bounds: unknown, label: string): DesktopBounds {
  if (!isRecord(bounds)) {
    throw new DesktopCoordinateError('invalid-input', `${label} is required`)
  }
  const origin = validatePoint(bounds, label)
  const size = validateSize(bounds, label)
  return { ...origin, ...size }
}

function assertBoundaryMode(value: unknown): CoordinateBoundaryMode {
  if (value === undefined) return 'reject'
  if (value === 'reject' || value === 'clamp') return value
  throw new DesktopCoordinateError(
    'invalid-input',
    'boundary must be either "reject" or "clamp"'
  )
}

function isFlatImagePointInput(
  input: DesktopCoordinateMappingInput | ImagePointToDisplayInput
): input is ImagePointToDisplayInput {
  return (
    'imageWidth' in input &&
    'imageHeight' in input &&
    'x' in input &&
    'y' in input
  )
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function normalizeImagePoint(
  point: DesktopPoint,
  imageSize: DesktopSize,
  boundary: CoordinateBoundaryMode
): DesktopPoint {
  const outside =
    point.x < 0 ||
    point.y < 0 ||
    point.x > imageSize.width ||
    point.y > imageSize.height

  if (outside && boundary === 'reject') {
    throw new DesktopCoordinateError(
      'out-of-bounds',
      `image point (${point.x}, ${point.y}) is outside ${imageSize.width}×${imageSize.height}`
    )
  }

  if (boundary === 'clamp') {
    return {
      x: clamp(point.x, 0, imageSize.width),
      y: clamp(point.y, 0, imageSize.height),
    }
  }
  return copyPoint(point)
}

function deriveNativeBounds(
  displayBounds: DesktopBounds,
  scaleFactor: number
): DesktopBounds {
  return {
    x: displayBounds.x * scaleFactor,
    y: displayBounds.y * scaleFactor,
    width: displayBounds.width * scaleFactor,
    height: displayBounds.height * scaleFactor,
  }
}

function integerBounds(bounds: DesktopBounds): {
  minX: number
  maxX: number
  minY: number
  maxY: number
} {
  // Native pointer APIs address pixels/points inside the rectangle, not the
  // right/bottom edge itself.  Ceil/floor also keeps fractional display bounds
  // safe when a platform reports them.
  const minX = Math.ceil(bounds.x)
  const maxX = Math.ceil(bounds.x + bounds.width) - 1
  const minY = Math.ceil(bounds.y)
  const maxY = Math.ceil(bounds.y + bounds.height) - 1
  if (maxX < minX || maxY < minY) {
    throw new DesktopCoordinateError(
      'invalid-input',
      'display bounds are too small to contain an integer pointer coordinate'
    )
  }
  return { minX, maxX, minY, maxY }
}

function roundInside(value: number, minimum: number, maximum: number): number {
  const rounded = Math.round(value)
  // Avoid leaking -0 into AppleScript/PowerShell diagnostics.
  const result = clamp(rounded, minimum, maximum)
  return Object.is(result, -0) ? 0 : result
}

function normalizeInput(input: DesktopCoordinateMappingInput): {
  point: DesktopPoint
  imageSize: DesktopSize
  displayBounds: DesktopBounds
  nativeBounds: DesktopBounds
  boundary: CoordinateBoundaryMode
  nativeScale: DesktopPoint
} {
  if (!isRecord(input)) {
    throw new DesktopCoordinateError(
      'invalid-input',
      'mapping input is required'
    )
  }

  const point = validatePoint(input.point, 'point')
  const imageSize = validateSize(input.imageSize, 'imageSize')
  const displayBounds = validateBounds(input.displayBounds, 'displayBounds')
  const boundary = assertBoundaryMode(input.boundary)

  const explicitScale =
    input.scaleFactor === undefined
      ? undefined
      : requirePositiveNumber(input.scaleFactor, 'scaleFactor')

  let nativeBounds: DesktopBounds
  if (input.nativeBounds !== undefined) {
    nativeBounds = validateBounds(input.nativeBounds, 'nativeBounds')
  } else {
    nativeBounds = deriveNativeBounds(displayBounds, explicitScale ?? 1)
  }

  // Validate that rounding can produce a usable native pointer before doing
  // any mapping. This also catches a scaleFactor so small that the native
  // rectangle collapses below one addressable pixel.
  integerBounds(displayBounds)
  integerBounds(nativeBounds)

  return {
    point,
    imageSize,
    displayBounds,
    nativeBounds,
    boundary,
    nativeScale: {
      x: nativeBounds.width / displayBounds.width,
      y: nativeBounds.height / displayBounds.height,
    },
  }
}

/**
 * Convert a screenshot point into both logical display and native coordinates.
 *
 * Image points are interpreted continuously in the rectangle `[0,width] ×
 * [0,height]`; the default boundary mode rejects values outside that rectangle.
 * The returned integer points are always clamped to an addressable pixel inside
 * their respective display rectangles, so a model selecting the exact
 * right/bottom edge cannot move the pointer outside the display.
 */
export function mapImagePoint(
  input: DesktopCoordinateMappingInput
): DesktopCoordinateMapping {
  const normalizedInput = normalizeInput(input)
  const imagePoint = normalizeImagePoint(
    normalizedInput.point,
    normalizedInput.imageSize,
    normalizedInput.boundary
  )
  const normalizedPoint = {
    x: imagePoint.x / normalizedInput.imageSize.width,
    y: imagePoint.y / normalizedInput.imageSize.height,
  }

  const displayPointExact = {
    x:
      normalizedInput.displayBounds.x +
      normalizedPoint.x * normalizedInput.displayBounds.width,
    y:
      normalizedInput.displayBounds.y +
      normalizedPoint.y * normalizedInput.displayBounds.height,
  }
  const nativePointExact = {
    x:
      normalizedInput.nativeBounds.x +
      normalizedPoint.x * normalizedInput.nativeBounds.width,
    y:
      normalizedInput.nativeBounds.y +
      normalizedPoint.y * normalizedInput.nativeBounds.height,
  }

  const displayIntegerBounds = integerBounds(normalizedInput.displayBounds)
  const nativeIntegerBounds = integerBounds(normalizedInput.nativeBounds)
  const displayPoint = {
    x: roundInside(
      displayPointExact.x,
      displayIntegerBounds.minX,
      displayIntegerBounds.maxX
    ),
    y: roundInside(
      displayPointExact.y,
      displayIntegerBounds.minY,
      displayIntegerBounds.maxY
    ),
  }
  const nativePoint = {
    x: roundInside(
      nativePointExact.x,
      nativeIntegerBounds.minX,
      nativeIntegerBounds.maxX
    ),
    y: roundInside(
      nativePointExact.y,
      nativeIntegerBounds.minY,
      nativeIntegerBounds.maxY
    ),
  }

  return {
    imagePoint,
    normalizedPoint,
    displayPoint,
    nativePoint,
    displayPointExact,
    nativePointExact,
    imageSize: copySize(normalizedInput.imageSize),
    displayBounds: copyBounds(normalizedInput.displayBounds),
    nativeBounds: copyBounds(normalizedInput.nativeBounds),
    nativeScale: copyPoint(normalizedInput.nativeScale),
  }
}

/** Return only the rounded logical/display coordinate. */
export function mapImagePointToDisplay(
  input: DesktopCoordinateMappingInput
): DesktopPoint
export function mapImagePointToDisplay(
  input: ImagePointToDisplayInput
): DesktopPoint
export function mapImagePointToDisplay(
  input: DesktopCoordinateMappingInput | ImagePointToDisplayInput
): DesktopPoint {
  if (isFlatImagePointInput(input)) {
    return mapImagePoint({
      point: { x: input.x, y: input.y },
      imageSize: {
        width: input.imageWidth,
        height: input.imageHeight,
      },
      displayBounds: input.displayBounds,
      boundary: input.boundary,
    }).displayPoint
  }
  return mapImagePoint(input).displayPoint
}

/**
 * Convert a logical display point to the coordinate space used by the native
 * automation backend.
 *
 * Windows `SetCursorPos` consumes physical pixels while Electron's `screen`
 * API reports DIPs, so Windows applies the display scale factor. macOS System
 * Events consumes logical screen points, and X11/xdotool coordinates already
 * match Electron's display coordinates in the supported Linux path.
 */
export function mapDisplayPointToNative(
  input: DisplayPointToNativeInput
): DesktopPoint {
  if (!isRecord(input)) {
    throw new DesktopCoordinateError(
      'invalid-input',
      'native mapping input is required'
    )
  }
  const point = validatePoint(input, 'point')
  const scaleFactor = requirePositiveNumber(input.scaleFactor, 'scaleFactor')
  if (typeof input.platform !== 'string' || !input.platform.trim()) {
    throw new DesktopCoordinateError(
      'invalid-input',
      'platform must be a non-empty string'
    )
  }

  let addressablePoint = point
  if (input.displayBounds !== undefined) {
    const bounds = validateBounds(input.displayBounds, 'displayBounds')
    const outside =
      point.x < bounds.x ||
      point.y < bounds.y ||
      point.x > bounds.x + bounds.width ||
      point.y > bounds.y + bounds.height
    if (outside) {
      throw new DesktopCoordinateError(
        'out-of-bounds',
        `display point (${point.x}, ${point.y}) is outside the observed display bounds`
      )
    }

    // A display rectangle's right/bottom edge is an exclusive geometric
    // boundary: native pointer APIs address the last pixel inside it instead
    // of the coordinate at `origin + size`.  Clamp an exact edge (and points
    // that round beyond the last integer pixel) to the addressable integer
    // bounds.  Points outside the observed rectangle still fail closed above.
    const boundsIntegers = integerBounds(bounds)
    addressablePoint = {
      x: clamp(point.x, boundsIntegers.minX, boundsIntegers.maxX),
      y: clamp(point.y, boundsIntegers.minY, boundsIntegers.maxY),
    }
  }

  const nativeScale = input.platform === 'win32' ? scaleFactor : 1
  const x = Math.round(addressablePoint.x * nativeScale)
  const y = Math.round(addressablePoint.y * nativeScale)
  return {
    x: Object.is(x, -0) ? 0 : x,
    y: Object.is(y, -0) ? 0 : y,
  }
}

/** Return only the rounded native/global coordinate for OS automation APIs. */
export function mapImagePointToNative(
  input: DesktopCoordinateMappingInput
): DesktopPoint {
  return mapImagePoint(input).nativePoint
}

/** Boolean boundary check for callers that want to validate before mapping. */
export function isImagePointWithinBounds(
  point: DesktopPoint,
  imageSize: DesktopSize
): boolean {
  try {
    const normalizedPoint = validatePoint(point, 'point')
    const normalizedSize = validateSize(imageSize, 'imageSize')
    return (
      normalizedPoint.x >= 0 &&
      normalizedPoint.y >= 0 &&
      normalizedPoint.x <= normalizedSize.width &&
      normalizedPoint.y <= normalizedSize.height
    )
  } catch {
    return false
  }
}

// Short aliases make the intent readable at call sites that already know the
// input is an image point; the canonical names above remain the documented API.
export const mapImageToDisplay = mapImagePointToDisplay
export const mapImageToNative = mapImagePointToNative
