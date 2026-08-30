import { afterEach, describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const temporaryDirectories: string[] = []
const verifierScript = path.join(
  process.cwd(),
  'scripts',
  'verify-runtime-assets.js'
)

type RuntimePlatform = 'windows' | 'macos'

type VerifyResult = {
  status: number | null
  output: string
}

/**
 * Keep this test at the process boundary. Importing a setup-style ESM script
 * into Vitest works on Unix but can produce an invalid transformed token on
 * the Windows runner. The release workflow invokes the script with Node, so
 * exercising that same boundary is both portable and closer to CI behavior.
 */
function runVerifier(
  platform: RuntimePlatform,
  ...arguments_: string[]
): VerifyResult {
  const result = spawnSync(
    process.execPath,
    [verifierScript, platform, ...arguments_],
    {
      cwd: process.cwd(),
      encoding: 'utf8',
    }
  )
  const output = [result.stdout, result.stderr, result.error?.message]
    .filter(value => value !== undefined && value !== null)
    .map(String)
    .join('\n')
  return { status: result.status, output }
}

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

function hostFixturePlatform(): RuntimePlatform {
  return process.platform === 'win32' ? 'windows' : 'macos'
}

function createRuntimeFixture(
  root: string,
  platform: RuntimePlatform = hostFixturePlatform()
) {
  const suffix = platform === 'windows' ? '.exe' : ''
  for (const relativePath of [
    `alice-backend${suffix}`,
    `bin/ffmpeg${suffix}`,
    `bin/main${suffix}`,
    `bin/piper${suffix}`,
    'models/whisper-base.bin',
    'models/piper/zh_CN-huayan-medium.onnx',
    'models/piper/zh_CN-huayan-medium.onnx.json',
  ]) {
    writeFixtureFile(
      root,
      relativePath,
      platform !== 'windows' &&
        (relativePath.startsWith('bin/') || relativePath.startsWith('alice-'))
    )
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('verify-runtime-assets', () => {
  it('accepts a complete runtime bundle on every CI host', () => {
    const platform = hostFixturePlatform()
    const backendDir = createTemporaryDirectory()
    createRuntimeFixture(backendDir, platform)

    const result = runVerifier(
      platform,
      '--backend-dir',
      backendDir,
      '--strict'
    )

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain('运行时资源预检：')
    expect(result.output).toContain('✅ alice-backend')
  })

  it('rejects a missing voice file and Unix mode-bit violations when supported', () => {
    const platform = hostFixturePlatform()
    const backendDir = createTemporaryDirectory()
    createRuntimeFixture(backendDir, platform)
    const modelPath = path.join(
      backendDir,
      'models/piper/zh_CN-huayan-medium.onnx'
    )
    fs.rmSync(modelPath)

    const expectedMissingPaths = ['models/piper/zh_CN-huayan-medium.onnx']
    if (platform !== 'windows') {
      fs.chmodSync(path.join(backendDir, 'bin/main'), 0o644)
      expectedMissingPaths.push('bin/main')
    }

    const result = runVerifier(
      platform,
      '--backend-dir',
      backendDir,
      '--strict'
    )

    expect(result.status, result.output).toBe(1)
    for (const relativePath of expectedMissingPaths) {
      expect(result.output).toContain(relativePath)
    }
  })

  it('does not require Unix mode bits for a Windows bundle', () => {
    const backendDir = createTemporaryDirectory()
    createRuntimeFixture(backendDir, 'windows')

    const result = runVerifier(
      'windows',
      '--backend-dir',
      backendDir,
      '--strict'
    )

    expect(result.status, result.output).toBe(0)
  })

  it('discovers and validates a copied backend directory inside a release bundle', () => {
    const platform = hostFixturePlatform()
    const releaseDir = createTemporaryDirectory()
    const backendDir = path.join(releaseDir, 'bundle', 'Resources', 'backend')
    fs.mkdirSync(backendDir, { recursive: true })
    createRuntimeFixture(backendDir, platform)

    const result = runVerifier(
      platform,
      '--release-dir',
      releaseDir,
      '--strict'
    )

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(`资源目录：${backendDir}`)
  })

  it('reports leftover extraction staging entries without hiding valid assets', () => {
    const platform = hostFixturePlatform()
    const backendDir = createTemporaryDirectory()
    createRuntimeFixture(backendDir, platform)
    fs.mkdirSync(path.join(backendDir, 'bin/temp_extract_whisper'), {
      recursive: true,
    })
    writeFixtureFile(backendDir, 'bin/ffmpeg-download.zip')

    const result = runVerifier(
      platform,
      '--backend-dir',
      backendDir,
      '--strict'
    )

    expect(result.status, result.output).toBe(0)
    expect(result.output).toContain(
      '发现未清理的构建临时文件 bin/ffmpeg-download.zip'
    )
    expect(result.output).toContain(
      '发现未清理的构建临时文件 bin/temp_extract_whisper'
    )
  })

  it('fails closed when a release directory contains multiple app bundles', () => {
    const releaseDir = createTemporaryDirectory()
    for (const architecture of ['arm64', 'x64']) {
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

    const result = runVerifier('macos', '--release-dir', releaseDir, '--strict')

    expect(result.status, result.output).toBe(2)
    expect(result.output).toContain('包含多个 Resources/backend')
  })
})
