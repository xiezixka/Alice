#!/usr/bin/env node

/**
 * Release packaging includes native binaries and platform-specific voice
 * assets. Electron-builder can technically be invoked from another OS, but
 * doing so would package the wrong ffmpeg/Whisper/Piper artifacts. Fail fast
 * instead of producing an installer that starts but cannot listen or speak.
 */

const aliases = {
  mac: 'darwin',
  macos: 'darwin',
  darwin: 'darwin',
  win: 'win32',
  windows: 'win32',
  win32: 'win32',
  linux: 'linux',
}

const requested = String(process.argv[2] || '')
  .trim()
  .toLowerCase()
const expectedPlatform = aliases[requested]
const requestedArch = String(process.argv[3] || '')
  .trim()
  .toLowerCase()
const archAliases = {
  arm64: new Set(['arm64']),
  aarch64: new Set(['arm64']),
  x64: new Set(['x64', 'amd64']),
  amd64: new Set(['x64', 'amd64']),
  ia32: new Set(['ia32', 'x86']),
  x86: new Set(['ia32', 'x86']),
}
const platformNames = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

if (!expectedPlatform) {
  console.error(
    '用法：node scripts/assert-native-build.js <mac|windows|linux> [x64|arm64]'
  )
  process.exit(2)
}

if (requestedArch && !archAliases[requestedArch]) {
  console.error(`不支持的架构：${requestedArch}。可选值：x64、arm64。`)
  process.exit(2)
}

if (process.platform !== expectedPlatform) {
  console.error(
    `❌ ${platformNames[expectedPlatform]} 安装包必须在原生 ${platformNames[expectedPlatform]} 环境构建。`
  )
  console.error(
    `当前环境：${platformNames[process.platform] || process.platform}/${process.arch}；目标环境：${platformNames[expectedPlatform]}。`
  )
  console.error(
    '原因：Alice 会把当前系统对应的 ffmpeg、Whisper 和 Piper 原生资源一起打包；跨系统强行打包会导致语音监听或播报在目标机上失效。'
  )
  process.exit(1)
}

if (requestedArch && !archAliases[requestedArch].has(process.arch)) {
  console.error(
    `❌ ${platformNames[expectedPlatform]} ${requestedArch} 安装包必须在对应架构环境构建。`
  )
  console.error(
    `当前环境：${platformNames[process.platform] || process.platform}/${process.arch}；目标架构：${requestedArch}。`
  )
  console.error(
    '原因：Go 后端和 Whisper/Piper 原生资源由本机编译或下载；架构不一致会导致安装包启动后语音能力失效。'
  )
  process.exit(1)
}

console.log(
  `✅ 原生构建环境已确认：${platformNames[expectedPlatform] || expectedPlatform}/${process.arch}${requestedArch ? `（目标 ${requestedArch}）` : ''}`
)
