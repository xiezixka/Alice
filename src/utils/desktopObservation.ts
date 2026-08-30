/**
 * Short-lived capability tokens for desktop observations.
 *
 * A screenshot is useful for more than one tool call only when the screen and
 * foreground window have not changed in the meantime.  This module keeps a
 * small in-memory registry that lets the main process make that distinction
 * without retaining screenshot pixels (or the raw window title) in the
 * token store.
 *
 * The registry is deliberately process-local.  It is not a replacement for
 * user confirmation or OS-level permissions: callers should still enforce
 * those checks before executing a desktop action.
 */

export const DEFAULT_DESKTOP_OBSERVATION_TTL_MS = 30_000
export const DEFAULT_DESKTOP_OBSERVATION_MAX_ENTRIES = 256
export const MAX_DESKTOP_OBSERVATION_TTL_MS = 5 * 60_000

const MAX_OBSERVATION_ID_LENGTH = 256
const MAX_FINGERPRINT_LENGTH = 256
const MAX_ID_GENERATION_ATTEMPTS = 16

/**
 * Raw display/window context supplied by the desktop bridge.
 *
 * `windowFingerprint` and `screenFingerprint` can be supplied by a native
 * caller that already has its own fingerprinting strategy.  Otherwise the
 * four display fields and the two foreground-window fields are normalized and
 * fingerprinted synchronously by this module.
 */
export interface DesktopObservationContext {
  readonly displayId?: string | number
  /** Alias used by some native display APIs. */
  readonly screenId?: string | number
  readonly width?: number
  readonly height?: number
  readonly scaleFactor?: number
  readonly foregroundApp?: string
  readonly windowTitle?: string
  /** Optional native window handle/process identifier for stronger binding. */
  readonly windowId?: string | number
  readonly windowFingerprint?: string
  readonly screenFingerprint?: string
  /** Convenience fields accepted by createObservation request-shaped calls. */
  readonly createdAt?: number
  readonly ttlMs?: number
}

/** Short alias for integrations that use the generic observation wording. */
export type ObservationContext = DesktopObservationContext

/** The normalized, non-sensitive context values kept by the registry. */
export interface DesktopObservationFingerprints {
  readonly windowFingerprint: string
  readonly screenFingerprint: string
}

/** Public metadata returned for a successfully created observation. */
export interface DesktopObservation {
  readonly observationId: string
  readonly createdAt: number
  readonly expiresAt: number
  readonly windowFingerprint: string
  readonly screenFingerprint: string
}

export type ObservationToken = DesktopObservation

export interface CreateObservationOptions {
  /** Override the default 30-second lifetime for this observation. */
  readonly ttlMs?: number
  /** Explicit timestamp, primarily useful for deterministic tests. */
  readonly createdAt?: number
}

export type CreateObservationOptionsInput = CreateObservationOptions | number

export interface DesktopObservationStoreOptions {
  /** Default lifetime used when create() does not provide ttlMs. */
  readonly ttlMs?: number
  /** Alias for ttlMs that reads more clearly at construction sites. */
  readonly defaultTtlMs?: number
  /** Maximum number of live records retained in memory. */
  readonly maxEntries?: number
  /** Injectable wall clock returning milliseconds since Unix epoch. */
  readonly now?: () => number
  /** Injectable ID source for tests or a host-specific secure generator. */
  readonly idFactory?: () => string
}

export interface ValidateObservationOptions {
  /** Explicit timestamp, primarily useful for deterministic tests. */
  readonly now?: number
  /** Alias for now, convenient for request-shaped callers. */
  readonly at?: number
}

export type ValidateObservationOptionsInput =
  ValidateObservationOptions | number

export type ObservationValidationReason =
  'invalid-id' | 'not-found' | 'expired' | 'context-changed' | 'invalid-context'

export interface ValidObservationResult {
  readonly valid: true
  readonly observationId: string
  readonly observation: DesktopObservation
}

export interface InvalidObservationResult {
  readonly valid: false
  readonly observationId?: string
  readonly reason: ObservationValidationReason
}

export type ObservationValidationResult =
  ValidObservationResult | InvalidObservationResult

export type ObservationValidation = ObservationValidationResult

/**
 * Request form accepted by the convenience validateObservation wrapper.
 * The object form makes it harder to accidentally validate a token against a
 * different context when forwarding data across an IPC boundary.
 */
export interface ValidateObservationRequest {
  readonly observationId: string | Pick<DesktopObservation, 'observationId'>
  readonly context: DesktopObservationContext
  readonly now?: number
  readonly at?: number
}

/** Flattened request form convenient for IPC payloads. */
export type FlatValidateObservationRequest = DesktopObservationContext & {
  readonly observationId: string | Pick<DesktopObservation, 'observationId'>
  readonly now?: number
  readonly at?: number
}

/** A descriptive error for malformed create-time input. */
export class InvalidDesktopObservationContextError extends Error {
  readonly code = 'INVALID_DESKTOP_OBSERVATION_CONTEXT'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidDesktopObservationContextError'
  }
}

/** A descriptive error for invalid registry configuration. */
export class InvalidDesktopObservationOptionsError extends Error {
  readonly code = 'INVALID_DESKTOP_OBSERVATION_OPTIONS'

  constructor(message: string) {
    super(message)
    this.name = 'InvalidDesktopObservationOptionsError'
  }
}

interface StoredObservation extends DesktopObservation {
  /** Monotonic insertion sequence used to clean up deterministically. */
  readonly sequence: number
}

function assertFiniteTimestamp(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new InvalidDesktopObservationOptionsError(
      `${label} must be a finite non-negative millisecond timestamp`
    )
  }
  return Math.trunc(value)
}

function normalizeTtl(value: number, label: string): number {
  if (
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_DESKTOP_OBSERVATION_TTL_MS
  ) {
    throw new InvalidDesktopObservationOptionsError(
      `${label} must be an integer between 1 and ${MAX_DESKTOP_OBSERVATION_TTL_MS} milliseconds`
    )
  }
  return value
}

function normalizeCreateOptions(
  options: CreateObservationOptionsInput | undefined
): CreateObservationOptions {
  if (options === undefined) return {}
  return typeof options === 'number' ? { ttlMs: options } : options
}

function normalizeValidateOptions(
  options: ValidateObservationOptionsInput | undefined
): ValidateObservationOptions {
  if (options === undefined) return {}
  return typeof options === 'number' ? { now: options } : options
}

function normalizeMaxEntries(value: number): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidDesktopObservationOptionsError(
      'maxEntries must be a positive integer'
    )
  }
  return value
}

function normalizeIdentifier(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  if (!normalized || normalized.length > MAX_OBSERVATION_ID_LENGTH) {
    return null
  }
  return normalized
}

function normalizeFingerprint(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new InvalidDesktopObservationContextError(`${label} must be a string`)
  }
  const normalized = value.trim()
  if (!normalized) {
    throw new InvalidDesktopObservationContextError(`${label} cannot be empty`)
  }
  if (normalized.length > MAX_FINGERPRINT_LENGTH) {
    throw new InvalidDesktopObservationContextError(
      `${label} must be no longer than ${MAX_FINGERPRINT_LENGTH} characters`
    )
  }
  return normalized
}

function normalizeText(value: unknown, label: string): string {
  if (typeof value !== 'string') {
    throw new InvalidDesktopObservationContextError(`${label} must be a string`)
  }
  // Whitespace normalization makes harmless title formatting changes less
  // likely to invalidate a token while preserving the semantic identity.
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ')
}

function requireFinitePositiveNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new InvalidDesktopObservationContextError(
      `${label} must be a finite positive number`
    )
  }
  return value
}

function requireDisplayId(value: unknown): string {
  return requireDisplayIdWithLabel(value, 'displayId')
}

function requireOptionalIdentifier(
  value: unknown,
  label: string
): string | undefined {
  if (value === undefined) return undefined
  return requireDisplayIdWithLabel(value, label)
}

function requireDisplayIdWithLabel(value: unknown, label: string): string {
  if (
    (typeof value !== 'string' && typeof value !== 'number') ||
    (typeof value === 'number' && !Number.isFinite(value))
  ) {
    throw new InvalidDesktopObservationContextError(
      `${label} must be a non-empty string or finite number`
    )
  }
  const normalized = String(value).trim()
  if (!normalized) {
    throw new InvalidDesktopObservationContextError(`${label} cannot be empty`)
  }
  return normalized
}

/**
 * FNV-1a 64-bit is intentionally used instead of storing raw titles.  This is
 * a context binding (not a password hash); the token's security comes from a
 * random observationId and its short lifetime.  BigInt keeps the
 * implementation deterministic in both Node and browser/Electron builds.
 */
function fingerprint(value: string): string {
  const offset = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  const mask = 0xffffffffffffffffn
  let hash = offset
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index))
    hash = (hash * prime) & mask
  }
  return hash.toString(16).padStart(16, '0')
}

function hasDisplayContext(context: DesktopObservationContext): boolean {
  return (
    context.displayId !== undefined ||
    context.screenId !== undefined ||
    context.width !== undefined ||
    context.height !== undefined ||
    context.scaleFactor !== undefined
  )
}

function hasWindowContext(context: DesktopObservationContext): boolean {
  return (
    context.foregroundApp !== undefined ||
    context.windowTitle !== undefined ||
    context.windowId !== undefined
  )
}

/**
 * Normalize raw context into the two opaque fingerprints stored in a token.
 * Explicit fingerprints take precedence, which lets native bridges provide a
 * stronger identity when available.  If either one is omitted, enough raw
 * fields must be supplied to derive it.
 */
export function getObservationFingerprints(
  context: DesktopObservationContext
): DesktopObservationFingerprints {
  if (!context || typeof context !== 'object') {
    throw new InvalidDesktopObservationContextError('context is required')
  }

  let screenFingerprint: string
  if (context.screenFingerprint !== undefined) {
    screenFingerprint = normalizeFingerprint(
      context.screenFingerprint,
      'screenFingerprint'
    )
  } else {
    if (!hasDisplayContext(context)) {
      throw new InvalidDesktopObservationContextError(
        'screenFingerprint or displayId/width/height/scaleFactor is required'
      )
    }
    const displayId = requireDisplayId(context.displayId ?? context.screenId)
    const width = requireFinitePositiveNumber(context.width, 'width')
    const height = requireFinitePositiveNumber(context.height, 'height')
    const scaleFactor = requireFinitePositiveNumber(
      context.scaleFactor,
      'scaleFactor'
    )
    screenFingerprint = `screen:v1:${fingerprint(
      JSON.stringify({ displayId, width, height, scaleFactor })
    )}`
  }

  let windowFingerprint: string
  if (context.windowFingerprint !== undefined) {
    windowFingerprint = normalizeFingerprint(
      context.windowFingerprint,
      'windowFingerprint'
    )
  } else {
    if (!hasWindowContext(context)) {
      throw new InvalidDesktopObservationContextError(
        'windowFingerprint or foregroundApp/windowTitle is required'
      )
    }
    const foregroundApp = normalizeText(
      context.foregroundApp ?? '',
      'foregroundApp'
    )
    const windowTitle = normalizeText(context.windowTitle ?? '', 'windowTitle')
    const windowId = requireOptionalIdentifier(context.windowId, 'windowId')
    if (!foregroundApp && !windowTitle && windowId === undefined) {
      throw new InvalidDesktopObservationContextError(
        'foregroundApp or windowTitle cannot both be empty'
      )
    }
    windowFingerprint = `window:v1:${fingerprint(
      JSON.stringify({ foregroundApp, windowTitle, windowId: windowId ?? null })
    )}`
  }

  return { windowFingerprint, screenFingerprint }
}

/** Backwards-friendly alias for callers that prefer a verb phrase. */
export const fingerprintObservationContext = getObservationFingerprints

function defaultIdFactory(): string {
  const cryptoObject = globalThis.crypto
  if (cryptoObject && typeof cryptoObject.randomUUID === 'function') {
    return `obs_${cryptoObject.randomUUID()}`
  }

  if (cryptoObject && typeof cryptoObject.getRandomValues === 'function') {
    const bytes = new Uint8Array(16)
    cryptoObject.getRandomValues(bytes)
    const randomPart = Array.from(bytes, byte =>
      byte.toString(16).padStart(2, '0')
    ).join('')
    return `obs_${randomPart}`
  }

  // Do not silently fall back to Math.random: the observation ID is a
  // capability and must not become guessable on a degraded host.  Electron
  // 43/Chromium and supported Node versions expose Web Crypto; test hosts can
  // inject a deterministic idFactory through DesktopObservationStoreOptions.
  throw new InvalidDesktopObservationOptionsError(
    'secure random number generation is unavailable; provide idFactory or enable Web Crypto'
  )
}

function cloneObservation(record: DesktopObservation): DesktopObservation {
  return Object.freeze({
    observationId: record.observationId,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    windowFingerprint: record.windowFingerprint,
    screenFingerprint: record.screenFingerprint,
  })
}

function extractObservationId(
  value: string | Pick<DesktopObservation, 'observationId'> | unknown
): string | null {
  if (typeof value === 'string') return normalizeIdentifier(value)
  if (value && typeof value === 'object' && 'observationId' in value) {
    return normalizeIdentifier(
      (value as { observationId?: unknown }).observationId
    )
  }
  return null
}

/**
 * In-memory registry for short-lived desktop observations.
 *
 * The class is exported so tests and hosts can use isolated registries.  The
 * module-level create/validate/invalidate functions below use one singleton
 * registry for the normal application path.
 */
export class DesktopObservationStore {
  private readonly records = new Map<string, StoredObservation>()
  private readonly defaultTtlMs: number
  private readonly maxEntries: number
  private readonly clock: () => number
  private readonly idFactory: () => string
  private sequence = 0

  constructor(options: DesktopObservationStoreOptions = {}) {
    const configuredTtl = options.defaultTtlMs ?? options.ttlMs
    this.defaultTtlMs = normalizeTtl(
      configuredTtl ?? DEFAULT_DESKTOP_OBSERVATION_TTL_MS,
      'ttlMs'
    )
    this.maxEntries = normalizeMaxEntries(
      options.maxEntries ?? DEFAULT_DESKTOP_OBSERVATION_MAX_ENTRIES
    )
    this.clock = options.now ?? (() => Date.now())
    this.idFactory = options.idFactory ?? defaultIdFactory
  }

  /** Number of non-expired records currently retained. */
  get size(): number {
    this.cleanupExpired(this.now())
    return this.records.size
  }

  /** Default lifetime for newly created records. */
  get ttlMs(): number {
    return this.defaultTtlMs
  }

  /** Configured capacity bound. */
  get capacity(): number {
    return this.maxEntries
  }

  private now(): number {
    return assertFiniteTimestamp(this.clock(), 'now()')
  }

  private cleanupExpired(now: number): void {
    for (const [id, record] of this.records) {
      if (record.expiresAt <= now) this.records.delete(id)
    }
  }

  private cleanupForCapacity(now: number): void {
    this.cleanupExpired(now)
    while (this.records.size >= this.maxEntries) {
      let oldest: StoredObservation | undefined
      for (const record of this.records.values()) {
        if (
          !oldest ||
          record.createdAt < oldest.createdAt ||
          (record.createdAt === oldest.createdAt &&
            record.sequence < oldest.sequence)
        ) {
          oldest = record
        }
      }
      if (!oldest) break
      this.records.delete(oldest.observationId)
    }
  }

  private nextUniqueId(): string {
    for (let attempt = 0; attempt < MAX_ID_GENERATION_ATTEMPTS; attempt += 1) {
      const candidate = normalizeIdentifier(this.idFactory())
      if (candidate && !this.records.has(candidate)) return candidate
    }
    throw new InvalidDesktopObservationOptionsError(
      'idFactory did not produce a unique non-empty observationId'
    )
  }

  create(
    context: DesktopObservationContext,
    optionsInput: CreateObservationOptionsInput = {}
  ): DesktopObservation {
    const options = normalizeCreateOptions(optionsInput)
    const fingerprints = getObservationFingerprints(context)
    const now =
      options.createdAt === undefined
        ? context.createdAt === undefined
          ? this.now()
          : assertFiniteTimestamp(context.createdAt, 'createdAt')
        : assertFiniteTimestamp(options.createdAt, 'createdAt')
    const ttlMs = normalizeTtl(
      options.ttlMs ?? context.ttlMs ?? this.defaultTtlMs,
      'ttlMs'
    )

    this.cleanupForCapacity(now)
    const observationId = this.nextUniqueId()
    const record: StoredObservation = {
      observationId,
      createdAt: now,
      expiresAt: now + ttlMs,
      windowFingerprint: fingerprints.windowFingerprint,
      screenFingerprint: fingerprints.screenFingerprint,
      sequence: this.sequence++,
    }
    this.records.set(observationId, record)
    return cloneObservation(record)
  }

  /** Explicit method name for class consumers mirroring the module wrapper. */
  createObservation(
    context: DesktopObservationContext,
    options: CreateObservationOptionsInput = {}
  ): DesktopObservation {
    return this.create(context, options)
  }

  validate(
    value: string | Pick<DesktopObservation, 'observationId'>,
    context: DesktopObservationContext,
    optionsInput: ValidateObservationOptionsInput = {}
  ): ObservationValidationResult {
    const options = normalizeValidateOptions(optionsInput)
    const observationId = extractObservationId(value)
    if (!observationId) return { valid: false, reason: 'invalid-id' }

    const now =
      options.now === undefined
        ? options.at === undefined
          ? this.now()
          : assertFiniteTimestamp(options.at, 'at')
        : assertFiniteTimestamp(options.now, 'now')
    const record = this.records.get(observationId)
    if (!record) {
      this.cleanupExpired(now)
      return { valid: false, observationId, reason: 'not-found' }
    }
    if (record.expiresAt <= now) {
      this.records.delete(observationId)
      return { valid: false, observationId, reason: 'expired' }
    }

    let fingerprints: DesktopObservationFingerprints
    try {
      fingerprints = getObservationFingerprints(context)
    } catch {
      return { valid: false, observationId, reason: 'invalid-context' }
    }
    if (
      fingerprints.windowFingerprint !== record.windowFingerprint ||
      fingerprints.screenFingerprint !== record.screenFingerprint
    ) {
      return { valid: false, observationId, reason: 'context-changed' }
    }

    const observation = cloneObservation(record)
    return { valid: true, observationId, observation }
  }

  /** Explicit method name for class consumers mirroring the module wrapper. */
  validateObservation(
    value: string | Pick<DesktopObservation, 'observationId'>,
    context: DesktopObservationContext,
    options: ValidateObservationOptionsInput = {}
  ): ObservationValidationResult {
    return this.validate(value, context, options)
  }

  invalidate(
    value: string | Pick<DesktopObservation, 'observationId'>
  ): boolean {
    const observationId = extractObservationId(value)
    if (!observationId) return false
    return this.records.delete(observationId)
  }

  /** Explicit method name for class consumers mirroring the module wrapper. */
  invalidateObservation(
    value: string | Pick<DesktopObservation, 'observationId'>
  ): boolean {
    return this.invalidate(value)
  }

  /** Prune expired records and return the number removed. */
  pruneExpired(at?: number): number {
    const now = at === undefined ? this.now() : assertFiniteTimestamp(at, 'at')
    const before = this.records.size
    this.cleanupExpired(now)
    return before - this.records.size
  }

  /** Remove all records, useful when the host loses its desktop session. */
  clear(): void {
    this.records.clear()
  }

  /**
   * Return metadata for diagnostics without exposing mutable internal state.
   * No screenshot/image field exists in this snapshot by design.
   */
  getMetadata(
    value: string | Pick<DesktopObservation, 'observationId'>
  ): DesktopObservation | undefined {
    const observationId = extractObservationId(value)
    if (!observationId) return undefined
    const record = this.records.get(observationId)
    if (!record || record.expiresAt <= this.now()) {
      if (record) this.records.delete(observationId)
      return undefined
    }
    return cloneObservation(record)
  }
}

const defaultObservationStore = new DesktopObservationStore()

/** Create a short-lived observation in the process-local default registry. */
export function createObservation(
  context: DesktopObservationContext,
  options: CreateObservationOptionsInput = {}
): DesktopObservation {
  return defaultObservationStore.create(context, options)
}

/**
 * Validate an observation against the current display/window context.
 *
 * Both `(observationId, context, options)` and
 * `({ observationId, context, now })` forms are accepted to make IPC adapters
 * straightforward while keeping the underlying class API explicit.
 */
export function validateObservation(
  observationId: string | Pick<DesktopObservation, 'observationId'>,
  context: DesktopObservationContext,
  options?: ValidateObservationOptionsInput
): ObservationValidationResult
export function validateObservation(
  request: ValidateObservationRequest
): ObservationValidationResult
export function validateObservation(
  request: FlatValidateObservationRequest
): ObservationValidationResult
export function validateObservation(
  first:
    | string
    | Pick<DesktopObservation, 'observationId'>
    | ValidateObservationRequest
    | FlatValidateObservationRequest,
  second?: DesktopObservationContext,
  third: ValidateObservationOptionsInput = {}
): ObservationValidationResult {
  if (
    first &&
    typeof first === 'object' &&
    'observationId' in first &&
    second === undefined
  ) {
    const request = first as
      ValidateObservationRequest | FlatValidateObservationRequest
    return defaultObservationStore.validate(
      request.observationId,
      'context' in request
        ? request.context
        : (request as FlatValidateObservationRequest),
      { now: request.now, at: request.at }
    )
  }
  if (!second) return { valid: false, reason: 'invalid-context' }
  return defaultObservationStore.validate(first as string, second, third)
}

/** Invalidate one observation; returns false for unknown/forged IDs. */
export function invalidateObservation(
  observationId: string | Pick<DesktopObservation, 'observationId'>
): boolean {
  return defaultObservationStore.invalidate(observationId)
}

/** Boolean convenience helper for callers that do not need diagnostics. */
export function isObservationValid(
  observationId: string | Pick<DesktopObservation, 'observationId'>,
  context: DesktopObservationContext,
  options?: ValidateObservationOptionsInput
): boolean {
  return defaultObservationStore.validate(observationId, context, options).valid
}

/** Expose the singleton for app lifecycle cleanup and diagnostics. */
export function getObservationStore(): DesktopObservationStore {
  return defaultObservationStore
}

/** Clear the singleton registry (for example after logout or display reset). */
export function clearObservations(): void {
  defaultObservationStore.clear()
}

// Alternate explicit names are intentionally aliases, not wrappers, so all
// callers share exactly the same registry and semantics.
export const createDesktopObservation = createObservation
export const validateDesktopObservation = validateObservation
export const invalidateDesktopObservation = invalidateObservation

// Minimal verb aliases for small adapters that import the registry as a
// capability object (`{ create, validate, invalidate }`).
export const create = createObservation
export const validate = validateObservation
export const invalidate = invalidateObservation
