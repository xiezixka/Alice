import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  vadRuntimeAssetNames,
  vadStaticCopyTargets,
} from '../../build/vadAssets'
import { createVadOptions } from '../composables/vadRuntime'
import { hasMeaningfulAudio } from '../utils/audioProcess'

describe('audio energy gate', () => {
  it('rejects silent and near-silent clips', () => {
    expect(hasMeaningfulAudio(new Float32Array(16000))).toBe(false)
    expect(hasMeaningfulAudio(new Float32Array(16000).fill(0.001))).toBe(false)
  })

  it('accepts quiet speech-like audio when it has enough energy', () => {
    const samples = new Float32Array(16000)
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((index / 16000) * Math.PI * 2 * 220) * 0.05
    }

    expect(hasMeaningfulAudio(samples)).toBe(true)
  })
})

describe('VAD runtime packaging', () => {
  it('ships every configured local runtime asset', () => {
    for (const target of vadStaticCopyTargets) {
      expect(fs.existsSync(path.resolve(target.src)), target.src).toBe(true)
    }

    expect(vadRuntimeAssetNames).toEqual(
      expect.arrayContaining([
        'vad.worklet.bundle.min.js',
        'silero_vad_legacy.onnx',
        'ort-wasm-simd-threaded.mjs',
        'ort-wasm-simd-threaded.wasm',
      ])
    )
  })
})

describe('VAD initialization options', () => {
  it('resolves relative assets from the renderer URL', () => {
    vi.stubGlobal('window', {
      location: { href: 'http://localhost:3344/' },
    })

    const options = createVadOptions('./', {
      onSpeechStart: vi.fn(),
      onSpeechEnd: vi.fn(),
    })

    expect(options.baseAssetPath).toBe('http://localhost:3344/')
    expect(options.onnxWASMBasePath).toBe('http://localhost:3344/')

    vi.unstubAllGlobals()
  })

  it('uses local assets and leaves startup under application control', () => {
    const onSpeechStart = vi.fn()
    const onSpeechEnd = vi.fn()

    const options = createVadOptions('file:///app/dist/', {
      onSpeechStart,
      onSpeechEnd,
    })

    expect(options).toMatchObject({
      baseAssetPath: 'file:///app/dist/',
      onnxWASMBasePath: 'file:///app/dist/',
      model: 'legacy',
      startOnLoad: false,
      onSpeechStart,
      onSpeechEnd,
    })

    const ort = { env: { logLevel: 'warning', wasm: {} } }
    options.ortConfig?.(ort as never)

    expect(ort).toMatchObject({
      env: {
        logLevel: 'error',
        wasm: {
          wasmPaths: {
            wasm: 'file:///app/dist/ort-wasm-simd-threaded.wasm',
            mjs: 'file:///app/dist/ort-wasm-simd-threaded.mjs',
          },
        },
      },
    })
  })
})
