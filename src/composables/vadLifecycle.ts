/**
 * Small, dependency-free lifecycle gate for the browser VAD instance.
 *
 * MicVAD allocates an AudioContext and (when started) a microphone stream.
 * Starting a second instance while the first one is still being destroyed can
 * leak a stream or leave the renderer with no active instance.  This gate
 * serializes lifecycle operations and gives each start request a generation
 * token so an obsolete async start can safely discard its result.
 */
export interface VadLifecycleToken {
  generation: number
}

export interface VadLifecycleGate {
  /** Begin a new operation and return its generation token. */
  begin(): VadLifecycleToken
  /** Invalidate all operations that were started before this call. */
  invalidate(): VadLifecycleToken
  /** Whether a token still represents the latest requested operation. */
  isCurrent(token: VadLifecycleToken): boolean
  /** Run an operation after all previously queued operations settle. */
  enqueue<T>(operation: () => Promise<T> | T): Promise<T>
}

export interface VadRestartState {
  stopRequests: number
  restartAfterStop: boolean
  recordingRequested: boolean
  disposed: boolean
  hasInstance: boolean
}

/**
 * Decide whether a queued stop may hand control back to a fresh start. Keep
 * this predicate pure so rapid true→false→true transitions can be tested
 * without constructing MicVAD or touching a real microphone.
 */
export function shouldRestartVadAfterStop(state: VadRestartState): boolean {
  return (
    state.stopRequests === 0 &&
    state.restartAfterStop &&
    state.recordingRequested &&
    !state.disposed &&
    !state.hasInstance
  )
}

/** Whether an async onMounted continuation is still allowed to mutate state. */
export function shouldContinueVadMountWork(
  mounted: boolean,
  disposed: boolean
): boolean {
  return mounted && !disposed
}

export function createVadLifecycleGate(): VadLifecycleGate {
  let generation = 0
  let queue: Promise<unknown> = Promise.resolve()

  const begin = (): VadLifecycleToken => ({ generation: ++generation })
  const invalidate = (): VadLifecycleToken => ({ generation: ++generation })
  const isCurrent = (token: VadLifecycleToken) =>
    token.generation === generation

  const enqueue = <T>(operation: () => Promise<T> | T): Promise<T> => {
    // Keep the queue alive even when one operation fails. The individual
    // operation still receives/reports its own rejection to the caller.
    const next = queue.then(
      () => operation(),
      () => operation()
    )
    queue = next.then(
      () => undefined,
      () => undefined
    )
    return next
  }

  return { begin, invalidate, isCurrent, enqueue }
}
