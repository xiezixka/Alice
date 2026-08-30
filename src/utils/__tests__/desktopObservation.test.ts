import { describe, expect, it } from 'vitest'
import {
  clearObservations,
  createObservation,
  DesktopObservationStore,
  invalidateObservation,
  InvalidDesktopObservationContextError,
  InvalidDesktopObservationOptionsError,
  validateObservation,
  type DesktopObservationContext,
} from '../desktopObservation'

const context = (overrides: Partial<DesktopObservationContext> = {}) => ({
  displayId: 'display-main',
  width: 2560,
  height: 1440,
  scaleFactor: 2,
  foregroundApp: 'Finder',
  windowTitle: '工作区',
  ...overrides,
})

describe('DesktopObservationStore', () => {
  it('creates metadata-only observations and validates the matching context', () => {
    let now = 1_000
    const store = new DesktopObservationStore({
      now: () => now,
      idFactory: () => 'obs-test-1',
    })

    const observation = store.create(context())

    expect(observation).toMatchObject({
      observationId: 'obs-test-1',
      createdAt: 1_000,
      expiresAt: 31_000,
    })
    expect(observation.windowFingerprint).toMatch(/^window:v1:[0-9a-f]{16}$/)
    expect(observation.screenFingerprint).toMatch(/^screen:v1:[0-9a-f]{16}$/)
    expect(JSON.stringify(observation)).not.toContain('工作区')
    expect(JSON.stringify(observation)).not.toContain('imageDataUrl')

    const result = store.validate(observation.observationId, context())
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.observation).toEqual(observation)
      expect(Object.isFrozen(result.observation)).toBe(true)
    }
    expect(store.size).toBe(1)
    expect(store.getMetadata(observation)).toEqual(observation)

    // A caller cannot alter the returned token's metadata to bypass the
    // server-side registry; validation always looks up the ID internally.
    const forgedPayload = {
      ...observation,
      windowFingerprint: 'window:forged',
      screenFingerprint: 'screen:forged',
    }
    expect(store.validate(forgedPayload, context()).valid).toBe(true)

    now = 1_001
  })

  it('expires at the exact deadline and removes the record', () => {
    let now = 10_000
    const store = new DesktopObservationStore({
      now: () => now,
      ttlMs: 100,
      idFactory: () => `obs-${now}`,
    })
    const observation = store.create(context())

    now = observation.expiresAt - 1
    expect(store.validate(observation.observationId, context()).valid).toBe(
      true
    )

    now = observation.expiresAt
    expect(store.validate(observation.observationId, context())).toEqual({
      valid: false,
      observationId: observation.observationId,
      reason: 'expired',
    })
    expect(store.size).toBe(0)
    expect(store.validate(observation.observationId, context())).toEqual({
      valid: false,
      observationId: observation.observationId,
      reason: 'not-found',
    })
  })

  it('rejects a changed window or display context', () => {
    const store = new DesktopObservationStore({
      now: () => 50_000,
      idFactory: () => 'obs-context',
    })
    const observation = store.create(context())

    expect(
      store.validate(
        observation.observationId,
        context({ windowTitle: '另一个窗口' })
      )
    ).toEqual({
      valid: false,
      observationId: observation.observationId,
      reason: 'context-changed',
    })
    expect(
      store.validate(
        observation.observationId,
        context({ width: 1920, height: 1080 })
      )
    ).toEqual({
      valid: false,
      observationId: observation.observationId,
      reason: 'context-changed',
    })
  })

  it('binds an optional display origin when one is supplied', () => {
    const store = new DesktopObservationStore({
      now: () => 55_000,
      idFactory: () => 'obs-origin',
    })
    const observed = context({ originX: -1920, originY: 40 })
    const observation = store.create(observed)

    expect(store.validate(observation.observationId, observed).valid).toBe(true)
    expect(
      store.validate(
        observation.observationId,
        context({ originX: 0, originY: 40 })
      )
    ).toMatchObject({ valid: false, reason: 'context-changed' })
    expect(
      store.validate(
        observation.observationId,
        context({ originX: -1920, originY: 41 })
      )
    ).toMatchObject({ valid: false, reason: 'context-changed' })
  })

  it('keeps legacy contexts without an origin compatible', () => {
    const store = new DesktopObservationStore({
      now: () => 56_000,
      idFactory: () => 'obs-legacy-origin',
    })
    const legacy = context()
    const observation = store.create(legacy)

    expect(store.validate(observation.observationId, legacy).valid).toBe(true)
    expect(
      store.validate(observation.observationId, {
        ...legacy,
        originX: 0,
        originY: 0,
      })
    ).toMatchObject({ valid: false, reason: 'context-changed' })
  })

  it('rejects forged IDs and does not overwrite a colliding ID', () => {
    const ids = ['fixed-id', 'fixed-id', 'second-id']
    const store = new DesktopObservationStore({
      now: () => 80_000,
      idFactory: () => ids.shift() ?? 'third-id',
    })
    const first = store.create(context())
    const second = store.create(context())

    expect(first.observationId).toBe('fixed-id')
    expect(second.observationId).toBe('second-id')
    expect(store.size).toBe(2)
    expect(store.validate('forged-id', context())).toEqual({
      valid: false,
      observationId: 'forged-id',
      reason: 'not-found',
    })

    const constantStore = new DesktopObservationStore({
      now: () => 80_000,
      idFactory: () => 'always-the-same',
    })
    constantStore.create(context())
    expect(() => constantStore.create(context())).toThrow(
      InvalidDesktopObservationOptionsError
    )
  })

  it('cleans expired entries before enforcing the capacity bound', () => {
    let now = 100_000
    let nextId = 0
    const store = new DesktopObservationStore({
      now: () => now,
      ttlMs: 100,
      maxEntries: 2,
      idFactory: () => `obs-${nextId++}`,
    })
    const first = store.create(context())
    now += 10
    const second = store.create(context())
    expect(store.size).toBe(2)

    now = first.expiresAt
    const third = store.create(context())
    expect(store.size).toBe(2)
    expect(store.validate(first.observationId, context()).valid).toBe(false)
    expect(store.validate(second.observationId, context()).valid).toBe(true)
    expect(store.validate(third.observationId, context()).valid).toBe(true)

    now = third.expiresAt
    expect(store.size).toBe(0)
  })

  it('supports explicit fingerprints while still retaining only those fingerprints', () => {
    const store = new DesktopObservationStore({
      now: () => 200_000,
      idFactory: () => 'obs-explicit',
    })
    const explicit = {
      windowFingerprint: 'window-native-abc',
      screenFingerprint: 'screen-native-xyz',
      // These values are intentionally incomplete/noisy; explicit fingerprints
      // allow a native bridge to omit raw context from the renderer boundary.
    }
    const observation = store.create(explicit)
    expect(observation.windowFingerprint).toBe('window-native-abc')
    expect(observation.screenFingerprint).toBe('screen-native-xyz')
    expect(store.validate(observation.observationId, explicit).valid).toBe(true)
    expect(
      store.validate(observation.observationId, {
        ...explicit,
        screenFingerprint: 'screen-native-other',
      })
    ).toMatchObject({ valid: false, reason: 'context-changed' })
  })

  it('accepts native screen/window identifiers and request-shaped wrappers', () => {
    const nativeContext = {
      screenId: 9,
      width: 1728,
      height: 1117,
      scaleFactor: 2,
      windowId: 42,
      foregroundApp: 'Safari',
      windowTitle: '行程规划',
    }
    clearObservations()
    const observation = createObservation(nativeContext, 5_000)
    expect(observation.observationId).toMatch(/^obs_/)
    expect(
      validateObservation({
        observationId: observation.observationId,
        ...nativeContext,
      })
    ).toMatchObject({ valid: true })
    expect(invalidateObservation(observation)).toBe(true)
    expect(invalidateObservation(observation)).toBe(false)
  })

  it('returns explicit reasons for malformed input and invalidates exactly once', () => {
    const store = new DesktopObservationStore({
      now: () => 300_000,
      idFactory: () => 'obs-invalidate',
    })
    const observation = store.create(context())

    expect(store.validate('', context())).toEqual({
      valid: false,
      reason: 'invalid-id',
    })
    expect(store.validate(observation.observationId, {})).toEqual({
      valid: false,
      observationId: observation.observationId,
      reason: 'invalid-context',
    })
    expect(store.invalidate(observation.observationId)).toBe(true)
    expect(store.invalidate(observation.observationId)).toBe(false)
    expect(store.validate(observation.observationId, context())).toMatchObject({
      valid: false,
      reason: 'not-found',
    })
  })

  it('validates create-time context and registry options', () => {
    expect(() => new DesktopObservationStore({ ttlMs: 0 })).toThrow(
      InvalidDesktopObservationOptionsError
    )
    expect(() => new DesktopObservationStore({ maxEntries: 0 })).toThrow(
      InvalidDesktopObservationOptionsError
    )

    const store = new DesktopObservationStore({ now: () => 400_000 })
    expect(() => store.create({})).toThrow(
      InvalidDesktopObservationContextError
    )
    expect(() =>
      store.create({
        displayId: 'display-main',
        width: 0,
        height: 1440,
        scaleFactor: 2,
        foregroundApp: 'Finder',
        windowTitle: '工作区',
      })
    ).toThrow(InvalidDesktopObservationContextError)
  })
})
