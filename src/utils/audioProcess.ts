export const float32ArrayToWav = (
  samples: Float32Array,
  sampleRate: number
): ArrayBuffer => {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)

  writeString(view, 0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  writeString(view, 8, 'WAVE')

  writeString(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)

  writeString(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  let index = 44
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    const val = s < 0 ? s * 0x8000 : s * 0x7fff
    view.setInt16(index, val, true)
    index += 2
  }

  return buffer
}

/**
 * Whisper can hallucinate text for a completely silent clip.  Keep a small
 * energy gate in front of transcription so VAD/background listening does not
 * turn silence or near-silence into a command.  The peak fallback preserves
 * quiet but clearly articulated speech that has a low RMS value.
 */
export const hasMeaningfulAudio = (
  samples: Float32Array,
  rmsThreshold = 0.005,
  peakThreshold = 0.02
): boolean => {
  if (!samples || samples.length === 0) return false

  let sumSquares = 0
  let peak = 0
  let finiteSamples = 0
  for (const sample of samples) {
    if (!Number.isFinite(sample)) continue
    const magnitude = Math.abs(sample)
    sumSquares += magnitude * magnitude
    peak = Math.max(peak, magnitude)
    finiteSamples += 1
  }

  if (finiteSamples === 0) return false
  const rms = Math.sqrt(sumSquares / finiteSamples)
  return rms >= rmsThreshold || peak >= peakThreshold
}

const writeString = (view: DataView, offset: number, string: string): void => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
}
