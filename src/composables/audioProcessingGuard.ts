/**
 * Decide whether an async transcription result still belongs to the active
 * recording request.
 *
 * Transcription is intentionally asynchronous. A user can stop (or stop and
 * immediately restart) the microphone while the STT request is in flight. In
 * that case the old result must not be emitted as a new assistant command.
 * Keeping this predicate side-effect free makes the lifecycle rule easy to
 * test without constructing MicVAD or touching a real microphone.
 */
export interface AudioProcessingGuardInput {
  /** Generation captured when the audio segment was submitted. */
  requestGeneration: number
  /** Latest generation of the recording request. */
  currentGeneration: number
  /** Whether the microphone request is still enabled. */
  isRecordingRequested: boolean
  /** Renderer audio state at the moment the transcription resolves. */
  audioState: string
}

export function shouldApplyTranscriptionResult({
  requestGeneration,
  currentGeneration,
  isRecordingRequested,
  audioState,
}: AudioProcessingGuardInput): boolean {
  return (
    isRecordingRequested &&
    audioState === 'PROCESSING_AUDIO' &&
    requestGeneration === currentGeneration
  )
}
