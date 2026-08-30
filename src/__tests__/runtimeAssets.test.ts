import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  findBackendDirectories,
  inspectRuntimeAssets,
} from '../../scripts/verify-runtime-assets.js'

const temporaryDirectories: string[] = []

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), 'alice-runtime-assets-')
  )
  temporaryDirectories.push(directory)
  return directory
}

function writeFixtureFile(
  root: string,
  relativePath: string,
  executable = false
) {
  const target = path.join(root, ...relativePath.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, 'fixture')
  if (executable && process.platform !== 'win32') fs.chmodSync(target, 0o755)
}

function createMacFixture() {
  const root = createTemporaryDirectory()
  for (const relativePath of [
    'alice-backend',
    'bin/ffmpeg',
    'bin/main',
    'bin/piper',
    'models/whisper-base.bin',
    'models/piper/zh_CN-huayan-medium.onnx',
    'models/piper/zh_CN-huayan-medium.onnx.json',
  ]) {
    writeFixtureFile(
      root,
      relativePath,
      relativePath.startsWith('bin/') || relativePath === 'alice-backend'
    )
  }
  return root
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('verify-runtime-assets', () => {
  it('accepts a complete macOS runtime bundle and checks executable bits', () => {
    const backendDir = createMacFixture()
    const report = inspectRuntimeAssets({
      platform: 'macos',
      backendDir,
      strict: true,
    })

    expect(report.ok).toBe(true)
    expect(report.failures).toHaveLength(0)
    expect(report.checks.every(check => check.status === 'ok')).toBe(true)
  })

  it('rejects missing voice files and non-executable Unix entrypoints', () => {
    const backendDir = createMacFixture()
    fs.rmSync(path.join(backendDir, 'models/piper/zh_CN-huayan-medium.onnx'))
    fs.chmodSync(path.join(backendDir, 'bin/main'), 0o644)

    const report = inspectRuntimeAssets({
      platform: 'darwin',
      backendDir,
      strict: true,
    })

    expect(report.ok).toBe(false)
    expect(report.failures.map(check => check.relativePath)).toEqual(
      expect.arrayContaining([
        'models/piper/zh_CN-huayan-medium.onnx',
        'bin/main',
      ])
    )
  })

  it('does not require Unix mode bits for a Windows bundle', () => {
    const backendDir = createTemporaryDirectory()
    for (const relativePath of [
      'alice-backend.exe',
      'bin/ffmpeg.exe',
      'bin/main.exe',
      'bin/piper.exe',
      'models/whisper-base.bin',
      'models/piper/zh_CN-huayan-medium.onnx',
      'models/piper/zh_CN-huayan-medium.onnx.json',
    ]) {
      writeFixtureFile(backendDir, relativePath)
    }

    const report = inspectRuntimeAssets({
      platform: 'windows',
      backendDir,
      strict: true,
    })

    expect(report.ok).toBe(true)
  })

  it('finds the copied backend directory inside an app bundle', () => {
    const releaseDir = createTemporaryDirectory()
    const backendDir = path.join(
      releaseDir,
      'mac-arm64',
      'Alice AI App.app',
      'Contents',
      'Resources',
      'backend'
    )
    fs.mkdirSync(backendDir, { recursive: true })

    expect(findBackendDirectories(releaseDir)).toEqual([backendDir])
    expect(
      inspectRuntimeAssets({ platform: 'macos', releaseDir }).backendDir
    ).toBe(backendDir)
  })

  it('reports leftover extraction staging entries without hiding valid assets', () => {
    const backendDir = createMacFixture()
    fs.mkdirSync(path.join(backendDir, 'bin/temp_extract_whisper'), {
      recursive: true,
    })
    writeFixtureFile(backendDir, 'bin/ffmpeg-download.zip')

    const report = inspectRuntimeAssets({
      platform: 'darwin',
      backendDir,
      strict: true,
    })

    expect(report.ok).toBe(true)
    expect(report.stagingEntries).toEqual([
      'bin/ffmpeg-download.zip',
      'bin/temp_extract_whisper',
    ])
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        '发现未清理的构建临时文件 bin/ffmpeg-download.zip',
        '发现未清理的构建临时文件 bin/temp_extract_whisper',
      ])
    )
  })

  it('fails closed when a release directory contains multiple app bundles', () => {
    const releaseDir = createTemporaryDirectory()
    for (const architecture of ['mac-arm64', 'mac-x64']) {
      fs.mkdirSync(
        path.join(
          releaseDir,
          architecture,
          'Alice AI App.app',
          'Contents',
          'Resources',
          'backend'
        ),
        { recursive: true }
      )
    }

    expect(() =>
      inspectRuntimeAssets({ platform: 'darwin', releaseDir })
    ).toThrow('包含多个 Resources/backend')
  })
})
