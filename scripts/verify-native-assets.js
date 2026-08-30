#!/usr/bin/env node

/**
 * Inspect the native voice assets that electron-builder is about to bundle.
 *
 * The build is intentionally warning-first: older checkouts may already have
 * an x86_64 ffmpeg cached under resources/, and making every developer delete
 * it before running a web build would be surprising.  Release CI (or a local
 * release build) can pass --strict to turn missing/mismatched native assets
 * and non-system macOS dependencies into hard failures.
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const platformAliases = new Map([
  ['mac', 'darwin'],
  ['macos', 'darwin'],
  ['darwin', 'darwin'],
  ['win', 'win32'],
  ['windows', 'win32'],
  ['win32', 'win32'],
  ['linux', 'linux'],
])

const args = process.argv.slice(2)
const strict = args.includes('--strict')
const requestedPlatform =
  args.find(arg => !arg.startsWith('--')) || process.platform
const platform = platformAliases.get(String(requestedPlatform).toLowerCase())

if (!platform) {
  console.error(
    '用法：node scripts/verify-native-assets.js <macos|windows|linux> [--arch <arm64|x64>] [--strict]'
  )
  process.exit(2)
}

function optionValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

const requestedArch = String(
  optionValue('--arch') || process.arch
).toLowerCase()
const archAliases = {
  arm64: ['arm64', 'aarch64'],
  aarch64: ['arm64', 'aarch64'],
  x64: ['x86_64', 'x64', 'amd64'],
  amd64: ['x86_64', 'x64', 'amd64'],
  x86_64: ['x86_64', 'x64', 'amd64'],
  ia32: ['i386', 'x86', 'ia32'],
}
const expectedArchitectures = archAliases[requestedArch]

if (!expectedArchitectures) {
  console.error(`❌ 不支持的架构：${requestedArch}`)
  process.exit(2)
}

const backendBinDirectory = path.resolve(
  optionValue('--bin-dir') || path.join('resources', 'backend', 'bin')
)

const platformNames = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

// Piper on macOS arm64 is currently a shell/Python launcher in this project,
// so it is reported for visibility but is not expected to be a Mach-O file.
const assetSpecs = {
  darwin: [
    { name: 'ffmpeg', role: 'FFmpeg', native: true },
    { name: 'main', role: 'Whisper', native: true },
    { name: 'piper', role: 'Piper', native: false },
  ],
  win32: [
    { name: 'ffmpeg.exe', role: 'FFmpeg', native: true },
    { name: 'main.exe', role: 'Whisper', native: true },
    { name: 'piper.exe', role: 'Piper', native: true },
  ],
  linux: [
    { name: 'ffmpeg', role: 'FFmpeg', native: true },
    { name: 'main', role: 'Whisper', native: true },
    { name: 'piper', role: 'Piper', native: true },
  ],
}

function commandOutput(command, commandArgs) {
  try {
    return execFileSync(command, commandArgs, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return ''
  }
}

function looksLikeText(filePath) {
  let descriptor
  try {
    descriptor = fs.openSync(filePath, 'r')
    const header = Buffer.alloc(96)
    fs.readSync(descriptor, header, 0, header.length, 0)
    const text = header.toString('utf8')
    return (
      (header[0] === 0x23 && header[1] === 0x21) || // shebang
      /^(?:#!|\s*(?:[A-Za-z_][A-Za-z0-9_]*=|set -|import |from ))/.test(text)
    )
  } catch {
    return false
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor)
      } catch {
        // The descriptor may already have been closed by the OS on error.
      }
    }
  }
}

function parseArchitectures(filePath) {
  if (looksLikeText(filePath)) {
    return { kind: 'script', architectures: [], description: '文本脚本' }
  }

  if (platform === 'darwin') {
    // lipo is authoritative for thin and universal Mach-O files.
    const lipoArchitectures = commandOutput('lipo', ['-archs', filePath])
    if (lipoArchitectures) {
      return {
        kind: 'native',
        architectures: lipoArchitectures.split(/\s+/).filter(Boolean),
        description: `Mach-O (${lipoArchitectures})`,
      }
    }
  }

  const fileDescription = commandOutput('file', ['-b', filePath])
  if (!fileDescription) {
    return { kind: 'unknown', architectures: [], description: '无法识别' }
  }

  const architectures = []
  if (/arm64|aarch64/i.test(fileDescription)) architectures.push('arm64')
  if (/x86[-_ ]64|amd64/i.test(fileDescription)) architectures.push('x86_64')
  if (/i[3-6]86|32-bit.*intel|x86 executable/i.test(fileDescription)) {
    architectures.push('i386')
  }

  if (/script|text|ascii|python|shell/i.test(fileDescription)) {
    return { kind: 'script', architectures: [], description: fileDescription }
  }

  return {
    kind: architectures.length > 0 ? 'native' : 'unknown',
    architectures,
    description: fileDescription,
  }
}

function hasExpectedArchitecture(architectures) {
  return architectures.some(architecture =>
    expectedArchitectures.includes(architecture)
  )
}

function macOSDependencies(filePath) {
  if (platform !== 'darwin') return []
  const output = commandOutput('otool', ['-L', filePath])
  if (!output) return []

  return output
    .split('\n')
    .slice(1)
    .map(line => line.trim().split(' ')[0])
    .filter(Boolean)
    .filter(dependency => {
      return !(
        dependency.startsWith('/usr/lib/') ||
        dependency.startsWith('/System/Library/') ||
        dependency.startsWith('/System/iOSSupport/') ||
        dependency.startsWith('@rpath/') ||
        dependency.startsWith('@loader_path/') ||
        dependency.startsWith('@executable_path/')
      )
    })
}

const specs = assetSpecs[platform]
const results = []

for (const spec of specs) {
  const filePath = path.join(backendBinDirectory, spec.name)
  if (!fs.existsSync(filePath)) {
    results.push({ ...spec, status: 'missing', filePath })
    continue
  }

  const inspection = parseArchitectures(filePath)
  const dependencies = macOSDependencies(filePath)
  let status = 'ok'

  if (spec.native) {
    if (inspection.kind !== 'native') {
      status = inspection.kind === 'script' ? 'script' : 'unknown'
    } else if (!hasExpectedArchitecture(inspection.architectures)) {
      status = 'mismatch'
    } else if (dependencies.length > 0) {
      status = 'external-dependency'
    }
  } else if (inspection.kind === 'script') {
    status = 'script'
  } else if (inspection.kind !== 'native') {
    status = 'unknown'
  }

  results.push({
    ...spec,
    status,
    filePath,
    description: inspection.description,
    architectures: inspection.architectures,
    dependencies,
  })
}

const labels = {
  ok: '通过',
  missing: '缺失',
  mismatch: '架构不匹配',
  'external-dependency': '存在非系统依赖',
  script: '脚本/解释器包装器',
  unknown: '无法识别',
}

console.log(
  `原生资源检查：${platformNames[platform]} / 目标架构 ${requestedArch}（${strict ? '严格模式' : '警告模式'}）`
)
console.log(`资源目录：${backendBinDirectory}`)

for (const result of results) {
  const details = []
  if (result.architectures?.length) {
    details.push(`arch=${result.architectures.join('+')}`)
  }
  if (result.dependencies?.length) {
    details.push(`deps=${result.dependencies.join(',')}`)
  }
  if (result.description && result.status !== 'ok') {
    details.push(result.description)
  }
  console.log(
    `${result.status === 'ok' ? '✅' : '⚠️ '} ${result.role} ${labels[result.status]}${details.length ? `（${details.join('；')}）` : ''}`
  )
}

const hardFailures = results.filter(result => {
  if (!strict) return false
  // A non-native Piper wrapper is an intentional current design on macOS;
  // do not make it a strict failure unless it is missing entirely.
  if (result.role === 'Piper' && result.status === 'script') return false
  return result.status !== 'ok'
})

if (hardFailures.length > 0) {
  console.error(
    `❌ 严格检查失败：${hardFailures.map(result => `${result.role}=${labels[result.status]}`).join('、')}`
  )
  console.error(
    '请在目标系统上重新下载对应架构的资源，或先安装可用的系统依赖；不要把另一架构的二进制静默打进安装包。'
  )
  process.exit(1)
}

const warnings = results.filter(result => result.status !== 'ok')
if (warnings.length > 0) {
  console.warn(
    `⚠️ 检查完成：${warnings.length} 项需要处理（警告模式不会阻断构建；发布前请使用 --strict）。`
  )
} else {
  console.log('✅ 所有已声明的原生资源均与目标架构兼容。')
}
