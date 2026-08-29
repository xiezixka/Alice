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

const requested = String(process.argv[2] || '').trim().toLowerCase()
const expectedPlatform = aliases[requested]
const platformNames = {
  darwin: 'macOS',
  win32: 'Windows',
  linux: 'Linux',
}

if (!expectedPlatform) {
  console.error(
    '用法：node scripts/assert-native-build.js <mac|windows|linux>'
  )
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

console.log(
  `✅ 原生构建环境已确认：${platformNames[expectedPlatform] || expectedPlatform}/${process.arch}`
)
