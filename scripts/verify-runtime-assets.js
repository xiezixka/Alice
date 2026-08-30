#!/usr/bin/env node

/**
 * Verify the files that electron-builder copies to Resources/backend.
 *
 * Native architecture inspection lives in verify-native-assets.js.  This
 * preflight is intentionally complementary: it checks the runtime layout
 * after electron-builder has copied extraResources, catches an incomplete
 * voice bundle before an installer is uploaded, and verifies that Unix
 * executables still have their execute bit after packaging.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

const platformAliases = new Map([
  ['mac', 'darwin'],
  ['macos', 'darwin'],
  ['darwin', 'darwin'],
  ['macos-latest', 'darwin'],
  ['macos-14', 'darwin'],
  ['macos-15', 'darwin'],
  ['win', 'win32'],
  ['windows', 'win32'],
  ['win32', 'win32'],
  ['windows-latest', 'win32'],
  ['windows-2022', 'win32'],
  ['linux', 'linux'],
  ['linux-x64', 'linux'],
  ['ubuntu', 'linux'],
  ['ubuntu-latest', 'linux'],
])

const platformNames = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

const platformSpecs = {
  darwin: {
    backendBinary: 'alice-backend',
    executablePaths: ['alice-backend', 'bin/ffmpeg', 'bin/main', 'bin/piper'],
    requiredFiles: [
      'models/whisper-base.bin',
      'models/piper/zh_CN-huayan-medium.onnx',
      'models/piper/zh_CN-huayan-medium.onnx.json',
    ],
    // Whisper's macOS build normally needs these dylibs.  They are reported
    // as warnings rather than hard failures so a future static build remains
    // valid; architecture/linkage is checked separately by verify-native.
    recommendedPaths: [
      'libinternal/libwhisper.dylib',
      'libinternal/libggml.dylib',
    ],
  },
  win32: {
    backendBinary: 'alice-backend.exe',
    executablePaths: [
      'alice-backend.exe',
      'bin/ffmpeg.exe',
      'bin/main.exe',
      'bin/piper.exe',
    ],
    requiredFiles: [
      'models/whisper-base.bin',
      'models/piper/zh_CN-huayan-medium.onnx',
      'models/piper/zh_CN-huayan-medium.onnx.json',
    ],
    // Piper/Whisper release archives currently ship these sidecars.  Keep the
    // check advisory because upstream archive layouts can change without
    // changing the executable entrypoint.
    recommendedPaths: [
      'bin/ggml-base.dll',
      'bin/ggml-cpu.dll',
      'bin/ggml.dll',
      'bin/whisper.dll',
      'bin/espeak-ng.dll',
      'bin/onnxruntime.dll',
      'bin/onnxruntime_providers_shared.dll',
      'bin/piper_phonemize.dll',
      'bin/espeak-ng-data',
    ],
  },
  linux: {
    backendBinary: 'alice-backend',
    executablePaths: ['alice-backend', 'bin/ffmpeg', 'bin/main', 'bin/piper'],
    requiredFiles: [
      'models/whisper-base.bin',
      'models/piper/zh_CN-huayan-medium.onnx',
      'models/piper/zh_CN-huayan-medium.onnx.json',
    ],
    recommendedPaths: [],
  },
}

const STAGING_NAME_PATTERN =
  /^(?:temp[_-]?extract(?:[_-].*)?|.*(?:download|extract).*)\.(?:zip|tar|gz|xz|part|tmp)$/i

function normalizePlatform(value = process.platform) {
  const normalized = String(value).trim().toLowerCase()
  return platformAliases.get(normalized)
}

function normalizeRelative(relativePath) {
  return relativePath.split(path.sep).join('/')
}

function isNonEmptyRegularFile(filePath) {
  try {
    const stats = fs.statSync(filePath)
    return stats.isFile() && stats.size > 0
  } catch {
    return false
  }
}

function isNonEmptyDirectory(directoryPath) {
  try {
    const stats = fs.statSync(directoryPath)
    return stats.isDirectory() && fs.readdirSync(directoryPath).length > 0
  } catch {
    return false
  }
}

function hasUnixExecuteBit(filePath) {
  try {
    return (fs.statSync(filePath).mode & 0o111) !== 0
  } catch {
    return false
  }
}

function inspectPath(
  rootDir,
  relativePath,
  { kind = 'file', executable = false, checkExecutable = executable } = {}
) {
  const normalized = normalizeRelative(relativePath)
  const absolutePath = path.join(rootDir, ...normalized.split('/'))
  const exists =
    kind === 'directory'
      ? isNonEmptyDirectory(absolutePath)
      : isNonEmptyRegularFile(absolutePath)

  let status = exists ? 'ok' : 'missing-or-empty'
  if (
    exists &&
    executable &&
    checkExecutable &&
    !hasUnixExecuteBit(absolutePath)
  ) {
    status = 'not-executable'
  }

  return {
    relativePath: normalized,
    absolutePath,
    status,
    kind,
    executable,
  }
}

/**
 * Find Resources/backend (macOS) or resources/backend (Windows/Linux)
 * directories below a release output directory.  Symlinks are skipped to
 * avoid following user-controlled loops while inspecting build output.
 */
function findBackendDirectories(releaseDirectory, { maxDepth = 10 } = {}) {
  const root = path.resolve(releaseDirectory)
  const candidates = []
  const queue = [{ directory: root, depth: 0 }]

  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || current.depth > maxDepth) continue

    let entries
    try {
      entries = fs.readdirSync(current.directory, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue
      const child = path.join(current.directory, entry.name)
      if (
        entry.isDirectory() &&
        entry.name.toLowerCase() === 'backend' &&
        path.basename(path.dirname(child)).toLowerCase() === 'resources'
      ) {
        candidates.push(path.resolve(child))
        continue
      }
      if (entry.isDirectory()) {
        queue.push({ directory: child, depth: current.depth + 1 })
      }
    }
  }

  return [...new Set(candidates)].sort()
}

function resolveBackendDirectory({
  backendDir,
  releaseDir,
  cwd = process.cwd(),
} = {}) {
  if (backendDir) return path.resolve(cwd, backendDir)
  if (releaseDir) {
    const candidates = findBackendDirectories(path.resolve(cwd, releaseDir))
    if (candidates.length === 1) return candidates[0]
    if (candidates.length === 0) {
      throw new Error(
        `在发布目录中找不到 Resources/backend：${path.resolve(cwd, releaseDir)}`
      )
    }
    throw new Error(
      `发布目录包含多个 Resources/backend，请使用 --backend-dir 指定目标：${candidates.join('、')}`
    )
  }
  return path.resolve(cwd, 'resources', 'backend')
}

function inspectRuntimeAssets({
  platform,
  backendDir,
  releaseDir,
  cwd = process.cwd(),
  strict = true,
} = {}) {
  const normalizedPlatform = normalizePlatform(platform)
  if (!normalizedPlatform || !platformSpecs[normalizedPlatform]) {
    throw new Error(`不支持的打包平台：${platform || '(空)'}`)
  }

  const rootDir = resolveBackendDirectory({ backendDir, releaseDir, cwd })
  const spec = platformSpecs[normalizedPlatform]
  const checks = []

  checks.push(
    inspectPath(rootDir, spec.backendBinary, {
      executable: true,
      checkExecutable: normalizedPlatform !== 'win32',
    })
  )
  for (const relativePath of spec.executablePaths) {
    if (relativePath === spec.backendBinary) continue
    checks.push(
      inspectPath(rootDir, relativePath, {
        executable: true,
        checkExecutable: normalizedPlatform !== 'win32',
      })
    )
  }
  for (const relativePath of spec.requiredFiles) {
    checks.push(inspectPath(rootDir, relativePath))
  }

  const recommended = spec.recommendedPaths.map(relativePath => {
    const kind = relativePath.endsWith('-data') ? 'directory' : 'file'
    return inspectPath(rootDir, relativePath, { kind })
  })

  let stagingEntries = []
  try {
    const binDir = path.join(rootDir, 'bin')
    stagingEntries = fs
      .readdirSync(binDir, { withFileTypes: true })
      .filter(entry =>
        entry.isDirectory()
          ? /^temp[_-]?extract(?:[_-].*)?$/i.test(entry.name)
          : STAGING_NAME_PATTERN.test(entry.name)
      )
      .map(entry => normalizeRelative(path.join('bin', entry.name)))
      .sort()
  } catch {
    // A missing bin directory is already represented by the required checks.
  }

  const failures = checks.filter(check => check.status !== 'ok')
  const warnings = [
    ...recommended
      .filter(check => check.status !== 'ok')
      .map(check => `建议补齐 ${check.relativePath}`),
    ...stagingEntries.map(entry => `发现未清理的构建临时文件 ${entry}`),
  ]

  return {
    platform: normalizedPlatform,
    platformName: platformNames[normalizedPlatform],
    backendDir: rootDir,
    strict,
    checks,
    recommended,
    stagingEntries,
    failures,
    warnings,
    ok: failures.length === 0,
  }
}

function printReport(report) {
  console.log(
    `运行时资源预检：${report.platformName}（${report.strict ? '严格模式' : '警告模式'}）`
  )
  console.log(`资源目录：${report.backendDir}`)

  for (const check of report.checks) {
    const label = check.status === 'ok' ? '✅' : '❌'
    console.log(`${label} ${check.relativePath}：${check.status}`)
  }
  for (const check of report.recommended) {
    if (check.status !== 'ok') {
      console.warn(`⚠️  ${check.relativePath}：${check.status}（建议项）`)
    }
  }
  for (const warning of report.warnings.filter(message =>
    message.includes('临时文件')
  )) {
    console.warn(`⚠️  ${warning}`)
  }

  if (report.failures.length > 0) {
    console.error(
      `❌ 运行时资源预检失败：${report.failures.map(check => check.relativePath).join('、')}`
    )
  } else if (report.warnings.length > 0) {
    console.warn(`⚠️  预检通过，但有 ${report.warnings.length} 项建议处理。`)
  } else {
    console.log('✅ 运行时资源和可执行权限均已验证。')
  }
}

function parseArguments(args) {
  const positional = []
  const options = { strict: true }
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--warn') {
      options.strict = false
    } else if (argument === '--strict') {
      options.strict = true
    } else if (argument === '--backend-dir' || argument === '--release-dir') {
      const value = args[index + 1]
      if (!value || value.startsWith('--')) {
        throw new Error(`${argument} 需要一个目录参数`)
      }
      if (argument === '--backend-dir') options.backendDir = value
      if (argument === '--release-dir') options.releaseDir = value
      index += 1
    } else if (argument.startsWith('--')) {
      throw new Error(`未知参数：${argument}`)
    } else {
      positional.push(argument)
    }
  }
  return { platform: positional[0] || process.platform, options }
}

function runCli() {
  try {
    const { platform, options } = parseArguments(process.argv.slice(2))
    const report = inspectRuntimeAssets({ platform, ...options })
    printReport(report)
    if (options.strict && !report.ok) process.exitCode = 1
  } catch (error) {
    console.error(
      `❌ ${error instanceof Error ? error.message : String(error)}`
    )
    console.error(
      '用法：node scripts/verify-runtime-assets.js <macos|windows|linux> [--backend-dir <dir> | --release-dir <dir>] [--strict|--warn]'
    )
    process.exitCode = 2
  }
}

export {
  findBackendDirectories,
  inspectRuntimeAssets,
  normalizePlatform,
  platformSpecs,
  resolveBackendDirectory,
}

const entryPath = process.argv[1]
if (
  entryPath &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  runCli()
}
