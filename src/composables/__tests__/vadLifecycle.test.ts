import { describe, expect, it } from 'vitest'
import {
  createVadLifecycleGate,
  shouldContinueVadMountWork,
  shouldRestartVadAfterStop,
} from '../vadLifecycle'

describe('vad lifecycle gate', () => {
  it('invalidates an older start generation', () => {
    const gate = createVadLifecycleGate()
    const first = gate.begin()

    expect(gate.isCurrent(first)).toBe(true)

    gate.invalidate()

    expect(gate.isCurrent(first)).toBe(false)
  })

  it('serializes lifecycle operations even when one rejects', async () => {
    const gate = createVadLifecycleGate()
    const events: string[] = []
    let releaseFirst!: () => void
    const firstReleased = new Promise<void>(resolve => {
      releaseFirst = resolve
    })

    const first = gate.enqueue(async () => {
      events.push('first:start')
      await firstReleased
      events.push('first:end')
      throw new Error('expected test failure')
    })
    const second = gate.enqueue(async () => {
      events.push('second:start')
      events.push('second:end')
      return 'ok'
    })

    // The second operation must remain pending until the first settles.
    await Promise.resolve()
    expect(events).toEqual(['first:start'])

    releaseFirst()
    await expect(first).rejects.toThrow('expected test failure')
    await expect(second).resolves.toBe('ok')
    expect(events).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ])

    // A rejected operation must not poison the queue for later work.
    await expect(
      gate.enqueue(() => {
        events.push('third:start')
        return 'still-alive'
      })
    ).resolves.toBe('still-alive')
    expect(events.at(-1)).toBe('third:start')
  })

  it('does not restart after the latest rapid toggle is an explicit stop', () => {
    // Simulate true → false → true → false while one destroy is queued. The
    // final false clears restartAfterStop, so the stop finalizer must remain
    // idle even though an earlier true requested a restart.
    let restartAfterStop = false
    let recordingRequested = true
    let stopRequests = 0

    stopRequests += 1
    recordingRequested = false
    restartAfterStop = false

    recordingRequested = true
    restartAfterStop = true

    stopRequests += 1
    recordingRequested = false
    restartAfterStop = false

    stopRequests = 0
    expect(
      shouldRestartVadAfterStop({
        stopRequests,
        restartAfterStop,
        recordingRequested,
        disposed: false,
        hasInstance: false,
      })
    ).toBe(false)
  })

  it('allows one restart only when the latest request is still active', () => {
    expect(
      shouldRestartVadAfterStop({
        stopRequests: 0,
        restartAfterStop: true,
        recordingRequested: true,
        disposed: false,
        hasInstance: false,
      })
    ).toBe(true)
    expect(
      shouldRestartVadAfterStop({
        stopRequests: 0,
        restartAfterStop: true,
        recordingRequested: true,
        disposed: false,
        hasInstance: true,
      })
    ).toBe(false)
  })

  it('blocks stale onMounted continuations after unmount', () => {
    expect(shouldContinueVadMountWork(true, false)).toBe(true)
    expect(shouldContinueVadMountWork(false, false)).toBe(false)
    expect(shouldContinueVadMountWork(true, true)).toBe(false)
  })
})
