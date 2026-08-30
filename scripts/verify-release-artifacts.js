#!/usr/bin/env node

/**
 * Verify that electron-builder produced a real installer for the requested
 * platform.  A successful electron-builder command can still leave only
 * metadata (or an unpacked directory) when a target is misconfigured, so
 * checking the output directory before uploading it prevents a misleading
 * green CI run and an unusable download.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

const aliases = new Map([
  ['mac', 'macos'],
  ['macos', 'macos'],
  ['darwin', 'macos'],
  ['macos-latest', 'macos'],
  ['macos-14', 'macos'],
  ['macos-15', 'macos'],
  ['win', 'windows'],
  ['windows', 'windows'],
  ['win32', 'windows'],
  ['windows-latest', 'windows'],
  ['windows-2022', 'windows'],
  ['linux', 'linux'],
  ['linux-x64', 'linux'],
  ['ubuntu', 'linux'],
  ['ubuntu-latest', 'linux'],
])

const expectedExtensions = {
  macos: ['.dmg', '.zip'],
  windows: ['.exe'],
  linux: ['.AppImage'],
}

const requested = String(process.argv[2] || process.platform)
  .trim()
  .toLowerCase()
const target = aliases.get(requested)

if (!target) {
  console.error(
    `❌ 不支持的打包平台：${requested}。用法：node scripts/verify-release-artifacts.js <macos|windows|linux> [release-directory]`
  )
  process.exit(2)
}

const packageJsonPath = path.resolve('package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
const version = String(packageJson.version || '').trim()
if (!version) {
  console.error('❌ package.json 缺少有效的 version，无法定位构建产物目录。')
  process.exit(1)
}

const releaseDirectory = path.resolve(
  process.argv[3] || path.join('release', version)
)
const expectedExtensionsForTarget = expectedExtensions[target]
const minimumBytes = 1024 * 1024

function listDirectFiles(directory) {
  if (!fs.existsSync(directory)) return []
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry => path.join(directory, entry.name))
}

if (!fs.existsSync(releaseDirectory)) {
  console.error(`❌ 构建产物目录不存在：${releaseDirectory}`)
  process.exit(1)
}

const directFiles = listDirectFiles(releaseDirectory)
const installersByExtension = new Map(
  expectedExtensionsForTarget.map(extension => [
    extension,
    directFiles.filter(file =>
      file.toLowerCase().endsWith(extension.toLowerCase())
    ),
  ])
)
const missingExtensions = expectedExtensionsForTarget.filter(
  extension => installersByExtension.get(extension).length === 0
)

if (missingExtensions.length > 0) {
  const entries = fs
    .readdirSync(releaseDirectory, { withFileTypes: true })
    .map(entry => entry.name)
    .sort()
  console.error(
    `❌ 未找到 ${target} 安装包（缺少 ${missingExtensions.join('、')}）：${releaseDirectory}`
  )
  console.error(`目录内容：${entries.join(', ') || '(空)'}`)
  process.exit(1)
}

const installers = expectedExtensionsForTarget.flatMap(extension =>
  installersByExtension.get(extension)
)

const invalid = installers.filter(file => {
  const stats = fs.statSync(file)
  const name = path.basename(file)
  return stats.size < minimumBytes || !name.includes(version)
})

if (invalid.length > 0) {
  for (const file of invalid) {
    const stats = fs.statSync(file)
    console.error(
      `❌ 安装包校验失败：${path.basename(file)}（${stats.size} bytes；文件名必须包含版本 ${version} 且大小至少 1 MiB）`
    )
  }
  process.exit(1)
}

const summaries = installers
  .map(file => {
    const stats = fs.statSync(file)
    return `${path.basename(file)} (${(stats.size / 1024 / 1024).toFixed(1)} MiB)`
  })
  .join(', ')

console.log(`✅ ${target} 安装包已验证：${summaries}`)
console.log(`   产物目录：${releaseDirectory}`)
