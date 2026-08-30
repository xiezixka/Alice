#!/usr/bin/env node

import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import os from 'os'
import https from 'https'
import { pathToFileURL } from 'url'
import { resolveFFmpegPaths } from './setup-dependencies.js'

// FFmpeg download URLs for different platforms.  Keep the Linux GitHub build
// first: johnvansickle occasionally responds with an HTML error page while
// still returning HTTP 200, which used to make the build continue without an
// ffmpeg binary.  The static johnvansickle build remains a useful fallback.
const FFMPEG_URLS = {
  win32:
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
  darwin: 'https://evermeet.cx/ffmpeg/ffmpeg-8.0.zip', // Use available release version
  linux: [
    'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    'https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz',
  ],
}

// Whisper.cpp download URLs for different platforms (using aliceai.ca hosting for reliability)
const WHISPER_URLS = {
  win32: 'https://aliceai.ca/app_assets/whisper/whisper-windows.zip',
  darwin: {
    x64: 'https://aliceai.ca/app_assets/whisper/whisper-macos-x64.zip',
    arm64: 'https://aliceai.ca/app_assets/whisper/whisper-macos-arm64.zip',
  },
  linux: {
    x64: 'https://aliceai.ca/app_assets/whisper/whisper-linux-x64.zip',
  },
}

// Piper TTS download URLs for different platforms (matching Go backend URLs)
const PIPER_URLS = {
  win32:
    'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip',
  darwin: {
    x64: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_macos_x64.tar.gz',
    arm64:
      'https://raw.githubusercontent.com/pmbstyle/Alice/main/assets/binaries/piper-macos-arm64',
  },
  linux: {
    x64: 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_x86_64.tar.gz',
    arm64:
      'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_linux_aarch64.tar.gz',
  },
}

const archiveMagic = {
  '.zip': [
    Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    Buffer.from([0x50, 0x4b, 0x05, 0x06]),
    Buffer.from([0x50, 0x4b, 0x07, 0x08]),
  ],
  '.tar.xz': [Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])],
  '.tar.gz': [Buffer.from([0x1f, 0x8b])],
}

function removeFileIfPresent(filePath) {
  try {
    fs.rmSync(filePath, { force: true })
  } catch {
    // Cleanup is best effort.  The original error is more useful to callers.
  }
}

function readFileHeader(filePath, length = 8) {
  const handle = fs.openSync(filePath, 'r')
  try {
    const header = Buffer.alloc(length)
    const bytesRead = fs.readSync(handle, header, 0, length, 0)
    return header.subarray(0, bytesRead)
  } finally {
    fs.closeSync(handle)
  }
}

/**
 * Return the archive suffix understood by the extractor for a download URL.
 * Query strings on GitHub's redirected asset URLs are intentionally ignored.
 */
function archiveExtensionFromUrl(url) {
  const pathname = String(url).split(/[?#]/, 1)[0].toLowerCase()
  for (const extension of ['.tar.xz', '.tar.gz', '.zip']) {
    if (pathname.endsWith(extension)) return extension
  }
  return null
}

/**
 * Check an archive's magic bytes before handing it to tar/unzip.  A 200 HTML
 * response from a mirror therefore becomes a failed source (and can trigger
 * the next fallback) instead of a misleading successful download.
 */
function isValidArchive(filePath, extension) {
  const signatures = archiveMagic[extension]
  if (!signatures) return false

  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile() || stats.size === 0) return false
    const header = readFileHeader(filePath, 8)
    return signatures.some(signature =>
      header.subarray(0, signature.length).equals(signature)
    )
  } catch {
    return false
  }
}

/**
 * Download a file from URL.  The response is written to a .part file and
 * atomically renamed only after the stream finishes, so failed/partial
 * downloads cannot be mistaken for usable artifacts on a later attempt.
 */
function downloadFile(url, outputPath, options = {}) {
  const redirects = options.redirects || 0
  const maxRedirects = options.maxRedirects ?? 5
  const temporaryPath = `${outputPath}.part`

  return new Promise((resolve, reject) => {
    let settled = false
    const fail = error => {
      if (settled) return
      settled = true
      removeFileIfPresent(temporaryPath)
      reject(error instanceof Error ? error : new Error(String(error)))
    }

    console.log(`Downloading: ${url}`)
    const request = https.get(url, response => {
      const statusCode = response.statusCode || 0

      // Handle redirects explicitly and cap them to avoid loops.
      if (statusCode >= 300 && statusCode < 400) {
        const location = response.headers.location
        response.resume()
        if (!location) {
          fail(new Error(`HTTP ${statusCode} redirect without a location`))
          return
        }
        if (redirects >= maxRedirects) {
          fail(new Error(`Too many redirects while downloading ${url}`))
          return
        }

        const redirectUrl = new URL(location, url).toString()
        console.log(`Redirecting to: ${redirectUrl}`)
        downloadFile(redirectUrl, outputPath, {
          ...options,
          redirects: redirects + 1,
        })
          .then(() => {
            if (settled) return
            settled = true
            resolve()
          })
          .catch(fail)
        return
      }

      if (statusCode !== 200) {
        response.resume()
        fail(
          new Error(`HTTP ${statusCode} ${response.statusMessage || ''}`.trim())
        )
        return
      }

      removeFileIfPresent(temporaryPath)
      const file = fs.createWriteStream(temporaryPath)
      let streamFailed = false
      const failStream = error => {
        if (streamFailed) return
        streamFailed = true
        response.destroy()
        file.destroy()
        fail(error)
      }

      response.on('aborted', () =>
        failStream(new Error(`Download aborted while fetching ${url}`))
      )
      response.on('error', failStream)
      file.on('error', failStream)
      file.on('finish', () => {
        file.close(error => {
          if (error) {
            failStream(error)
            return
          }
          try {
            const stats = fs.statSync(temporaryPath)
            if (!stats.isFile() || stats.size === 0) {
              throw new Error('Downloaded file is empty')
            }
            // renameSync replaces files on Unix, but not on Windows.
            removeFileIfPresent(outputPath)
            fs.renameSync(temporaryPath, outputPath)
            if (!settled) {
              settled = true
              response.destroy()
              resolve()
            }
          } catch (error_) {
            fail(error_)
          }
        })
      })

      response.pipe(file)
    })

    request.on('error', fail)
    if (typeof request.setTimeout === 'function') {
      request.setTimeout(options.timeoutMs ?? 120000, () => {
        request.destroy(new Error(`Download timed out while fetching ${url}`))
      })
    }
  })
}

/**
 * Extract ffmpeg binary from downloaded archive
 */
function findFileRecursive(directory, fileName) {
  let entries
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true })
  } catch {
    return null
  }

  for (const entry of entries) {
    // Archives are untrusted input; do not follow symlinked directories.
    if (entry.isSymbolicLink()) continue
    const candidate = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findFileRecursive(candidate, fileName)
      if (nested) return nested
    } else if (entry.name === fileName) {
      return candidate
    }
  }
  return null
}

const binaryMagic = {
  win32: [Buffer.from([0x4d, 0x5a])], // PE/COFF starts with MZ
  linux: [Buffer.from([0x7f, 0x45, 0x4c, 0x46])], // ELF
  darwin: [
    Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // 64-bit little-endian Mach-O
    Buffer.from([0xfe, 0xed, 0xfa, 0xcf]), // 64-bit big-endian Mach-O
    Buffer.from([0xca, 0xfe, 0xba, 0xbe]), // universal/fat Mach-O
    Buffer.from([0xbe, 0xba, 0xfe, 0xca]),
    Buffer.from([0xca, 0xfe, 0xba, 0xbf]), // 64-bit universal/fat Mach-O
    Buffer.from([0xbf, 0xba, 0xfe, 0xca]),
    Buffer.from([0xce, 0xfa, 0xed, 0xfe]), // 32-bit little-endian Mach-O
    Buffer.from([0xfe, 0xed, 0xfa, 0xce]), // 32-bit big-endian Mach-O
  ],
}

/**
 * Verify that a candidate is a non-empty native ffmpeg executable.  Checking
 * the platform magic prevents an HTML/text response or an archive sidecar
 * named "ffmpeg" from being packaged as the runtime binary.
 */
function isValidFFmpegBinary(filePath, platform = os.platform()) {
  const signatures = binaryMagic[platform]
  if (!signatures) return false

  try {
    const stats = fs.statSync(filePath)
    if (!stats.isFile() || stats.size === 0) return false
    const header = readFileHeader(filePath, 8)
    return signatures.some(signature =>
      header.subarray(0, signature.length).equals(signature)
    )
  } catch {
    return false
  }
}

function extractFFmpeg(archivePath, outputDir, platform = os.platform()) {
  const binaryName = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const tempDir = path.join(
    outputDir,
    `.ffmpeg-extract-${process.pid}-${Date.now()}`
  )

  try {
    fs.mkdirSync(tempDir, { recursive: true })

    if (platform === 'win32') {
      // Extract ZIP file using PowerShell on Windows with proper path escaping.
      const normalizedArchivePath = archivePath.replace(/\//g, '\\')
      const normalizedTempDir = tempDir.replace(/\//g, '\\')
      const extractCmd = `powershell -command "Expand-Archive -Path '${normalizedArchivePath}' -DestinationPath '${normalizedTempDir}' -Force"`
      console.log(`Running extraction command: ${extractCmd}`)
      execSync(extractCmd, { stdio: 'pipe' })
    } else if (archiveExtensionFromUrl(archivePath) === '.zip') {
      execSync(`unzip -o "${archivePath}" -d "${tempDir}"`, {
        stdio: 'pipe',
      })
    } else {
      // tar auto-detects xz/gzip compression.  Extract into a temporary
      // directory because upstream archives use different root layouts
      // (johnvansickle puts ffmpeg at the root; BtbN puts it under bin/).
      execSync(`tar -xf "${archivePath}" -C "${tempDir}"`, {
        stdio: 'pipe',
      })
    }

    const sourcePath = findFileRecursive(tempDir, binaryName)
    console.log(`Found ffmpeg at: ${sourcePath}`)
    if (!sourcePath || !isValidFFmpegBinary(sourcePath, platform)) {
      throw new Error(
        `${binaryName} was not found or is not a valid ${platform} executable`
      )
    }

    const targetPath = path.join(outputDir, binaryName)
    fs.copyFileSync(sourcePath, targetPath)
    if (platform !== 'win32') fs.chmodSync(targetPath, 0o755)

    if (!isValidFFmpegBinary(targetPath, platform)) {
      throw new Error(`Copied ffmpeg is invalid: ${targetPath}`)
    }
    console.log(`Copied ffmpeg to: ${targetPath}`)
    return true
  } catch (error) {
    console.error(
      `Extraction failed: ${error instanceof Error ? error.message : String(error)}`
    )
    return false
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Best-effort cleanup; the caller still receives the extraction result.
    }
  }
}

/**
 * Extract whisper binary from downloaded archive
 */
function extractWhisper(archivePath, outputDir) {
  const platform = os.platform()

  try {
    if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
      // Create a temporary extraction directory
      const tempDir = path.join(outputDir, 'temp_extract_whisper')
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })

      let extractCmd
      if (platform === 'win32') {
        // Extract ZIP file using PowerShell on Windows
        const normalizedArchivePath = archivePath.replace(/\//g, '\\')
        const normalizedTempDir = tempDir.replace(/\//g, '\\')
        extractCmd = `powershell -command "Expand-Archive -Path '${normalizedArchivePath}' -DestinationPath '${normalizedTempDir}' -Force"`
      } else {
        // Extract ZIP file on macOS/Linux
        extractCmd = `cd "${tempDir}" && unzip -o "${archivePath}"`
      }

      console.log(`Running whisper extraction command: ${extractCmd}`)
      execSync(extractCmd, { stdio: 'pipe' })

      // Find whisper binary in the extracted folder - look for whisper executables
      function findWhisperRecursive(dir) {
        const items = fs.readdirSync(dir, { withFileTypes: true })

        // Priority order for whisper executables (based on new naming convention)
        const whisperExecutables = [
          'whisper-cli.exe',
          'whisper-cli',
          'whisper-main.exe',
          'whisper-main',
          'main.exe',
          'main',
          'whisper.exe',
          'whisper',
          'whisper-macos-arm64',
          'whisper-macos-x64', // macOS specific names
          'whisper-linux-x64',
          'whisper-linux-arm64', // Linux specific names
        ]

        for (const item of items) {
          const fullPath = path.join(dir, item.name)

          if (item.isDirectory()) {
            const result = findWhisperRecursive(fullPath)
            if (result) return result
          } else if (whisperExecutables.includes(item.name)) {
            return fullPath
          }
        }
        return null
      }

      const whisperExePath = findWhisperRecursive(tempDir)
      console.log(`Found whisper binary at: ${whisperExePath}`)

      if (whisperExePath && fs.existsSync(whisperExePath)) {
        const targetName = platform === 'win32' ? 'main.exe' : 'main'
        const targetPath = path.join(outputDir, targetName)
        fs.copyFileSync(whisperExePath, targetPath)
        console.log(`Copied whisper to: ${targetPath}`)

        // Copy all DLL dependencies for Windows and dylibs for macOS
        if (platform === 'win32') {
          const requiredDlls = [
            'SDL2.dll',
            'ggml-base.dll',
            'ggml-cpu.dll',
            'ggml.dll',
            'whisper.dll',
          ]

          function findAndCopyDlls(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true })

            for (const item of items) {
              const fullPath = path.join(dir, item.name)

              if (item.isDirectory()) {
                findAndCopyDlls(fullPath)
              } else if (requiredDlls.includes(item.name)) {
                const targetDllPath = path.join(outputDir, item.name)
                fs.copyFileSync(fullPath, targetDllPath)
                console.log(`Copied DLL: ${item.name}`)
              }
            }
          }

          findAndCopyDlls(tempDir)
        } else if (platform === 'darwin') {
          // Copy dylib dependencies for macOS
          const requiredDylibs = [
            'libggml.dylib',
            'libggml-base.dylib',
            'libggml-blas.dylib',
            'libggml-cpu.dylib',
            'libggml-metal.dylib',
            'libwhisper.dylib',
            'libwhisper.1.dylib',
            'libwhisper.1.7.6.dylib',
          ]

          // Create libinternal directory
          const libInternalDir = path.join(
            path.dirname(outputDir),
            'libinternal'
          )
          if (!fs.existsSync(libInternalDir)) {
            fs.mkdirSync(libInternalDir, { recursive: true })
          }

          function findAndCopyDylibs(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true })

            for (const item of items) {
              const fullPath = path.join(dir, item.name)

              if (item.isDirectory()) {
                findAndCopyDylibs(fullPath)
              } else if (requiredDylibs.includes(item.name)) {
                const targetDylibPath = path.join(libInternalDir, item.name)
                fs.copyFileSync(fullPath, targetDylibPath)
                console.log(`Copied dylib: ${item.name}`)
              }
            }
          }

          findAndCopyDylibs(tempDir)

          // Make executable on Unix systems
          fs.chmodSync(targetPath, '755')
        } else {
          // Make executable on Unix systems (Linux)
          fs.chmodSync(targetPath, '755')
        }

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true })
        return fs.existsSync(targetPath)
      } else {
        console.error('Whisper binary (main) not found in extracted files')

        // List extracted files for debugging
        console.log('Extracted contents:')
        function listDir(dir, indent = '') {
          if (!fs.existsSync(dir)) return
          const items = fs.readdirSync(dir, { withFileTypes: true })
          items.forEach(item => {
            console.log(
              `${indent}${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`
            )
            if (item.isDirectory() && indent.length < 20) {
              listDir(path.join(dir, item.name), indent + '  ')
            }
          })
        }
        listDir(tempDir)

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true })
        return false
      }
    }
  } catch (error) {
    console.error('Whisper extraction failed:', error.message)
    console.error('Full error:', error)
    return false
  }

  return false
}

/**
 * Extract piper binary from downloaded archive
 */
function extractPiper(archivePath, outputDir) {
  const platform = os.platform()

  try {
    if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
      // Create a temporary extraction directory
      const tempDir = path.join(outputDir, 'temp_extract_piper')
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true })
      }
      fs.mkdirSync(tempDir, { recursive: true })

      let extractCmd
      if (platform === 'win32') {
        // Extract ZIP file using PowerShell on Windows
        const normalizedArchivePath = archivePath.replace(/\//g, '\\')
        const normalizedTempDir = tempDir.replace(/\//g, '\\')
        extractCmd = `powershell -command "Expand-Archive -Path '${normalizedArchivePath}' -DestinationPath '${normalizedTempDir}' -Force"`
      } else if (archivePath.endsWith('.tar.gz')) {
        // Extract tar.gz file on macOS/Linux
        extractCmd = `cd "${tempDir}" && tar -xzf "${archivePath}"`
      } else {
        // Extract ZIP file on macOS/Linux (fallback)
        extractCmd = `cd "${tempDir}" && unzip -o "${archivePath}"`
      }

      console.log(`Running piper extraction command: ${extractCmd}`)
      try {
        execSync(extractCmd, { stdio: 'pipe' })
      } catch (error) {
        console.error(
          'PowerShell extraction failed, trying alternative method...'
        )
        console.error('Error:', error.message)

        // Alternative: Try using tar (Windows 10+ has built-in tar support)
        if (platform === 'win32') {
          try {
            const tarCmd = `tar -xf "${archivePath}" -C "${tempDir}"`
            console.log(`Trying tar extraction: ${tarCmd}`)
            execSync(tarCmd, { stdio: 'pipe' })
          } catch (tarError) {
            console.error('Tar extraction also failed:', tarError.message)
            throw new Error(
              'All extraction methods failed - Windows Defender may be blocking files'
            )
          }
        }
      }

      // Find piper binary in the extracted folder
      function findPiperRecursive(dir) {
        const items = fs.readdirSync(dir, { withFileTypes: true })

        const piperExecutables = ['piper.exe', 'piper']

        for (const item of items) {
          const fullPath = path.join(dir, item.name)

          if (item.isDirectory()) {
            const result = findPiperRecursive(fullPath)
            if (result) return result
          } else if (piperExecutables.includes(item.name)) {
            return fullPath
          }
        }
        return null
      }

      const piperExePath = findPiperRecursive(tempDir)
      console.log(`Found piper binary at: ${piperExePath}`)

      if (piperExePath && fs.existsSync(piperExePath)) {
        const targetName = platform === 'win32' ? 'piper.exe' : 'piper'
        const targetPath = path.join(outputDir, targetName)
        fs.copyFileSync(piperExePath, targetPath)
        console.log(`Copied piper to: ${targetPath}`)

        // Copy all DLL dependencies for Windows
        if (platform === 'win32') {
          const requiredDlls = [
            'espeak-ng.dll',
            'onnxruntime.dll',
            'onnxruntime_providers_shared.dll',
            'piper_phonemize.dll',
          ]

          function findAndCopyDlls(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true })

            for (const item of items) {
              const fullPath = path.join(dir, item.name)

              if (item.isDirectory()) {
                findAndCopyDlls(fullPath)
              } else if (requiredDlls.includes(item.name)) {
                const targetDllPath = path.join(outputDir, item.name)
                fs.copyFileSync(fullPath, targetDllPath)
                console.log(`Copied Piper DLL: ${item.name}`)
              }
            }
          }

          findAndCopyDlls(tempDir)

          // Copy espeak-ng-data directory (required for phonemization)
          function findAndCopyEspeakData(dir) {
            const items = fs.readdirSync(dir, { withFileTypes: true })

            for (const item of items) {
              const fullPath = path.join(dir, item.name)

              if (item.isDirectory()) {
                if (item.name === 'espeak-ng-data') {
                  const targetEspeakDataPath = path.join(
                    outputDir,
                    'espeak-ng-data'
                  )
                  console.log(
                    `Copying espeak-ng-data directory from ${fullPath} to ${targetEspeakDataPath}`
                  )

                  // Copy directory recursively
                  function copyDirRecursive(src, dest) {
                    if (!fs.existsSync(dest)) {
                      fs.mkdirSync(dest, { recursive: true })
                    }

                    const items = fs.readdirSync(src, { withFileTypes: true })
                    for (const item of items) {
                      const srcPath = path.join(src, item.name)
                      const destPath = path.join(dest, item.name)

                      if (item.isDirectory()) {
                        copyDirRecursive(srcPath, destPath)
                      } else {
                        fs.copyFileSync(srcPath, destPath)
                      }
                    }
                  }

                  copyDirRecursive(fullPath, targetEspeakDataPath)
                  console.log(`Copied espeak-ng-data directory successfully`)
                  return true
                } else {
                  // Recursively search in subdirectories
                  if (findAndCopyEspeakData(fullPath)) {
                    return true
                  }
                }
              }
            }
            return false
          }

          findAndCopyEspeakData(tempDir)
        } else {
          // Make executable on Unix systems
          fs.chmodSync(targetPath, '755')
        }

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true })
        return fs.existsSync(targetPath)
      } else {
        console.error('Piper binary not found in extracted files')

        // List extracted files for debugging
        console.log('Extracted contents:')
        function listDir(dir, indent = '') {
          if (!fs.existsSync(dir)) return
          const items = fs.readdirSync(dir, { withFileTypes: true })
          items.forEach(item => {
            console.log(
              `${indent}${item.isDirectory() ? '[DIR]' : '[FILE]'} ${item.name}`
            )
            if (item.isDirectory() && indent.length < 20) {
              listDir(path.join(dir, item.name), indent + '  ')
            }
          })
        }
        listDir(tempDir)

        // Clean up temp directory
        fs.rmSync(tempDir, { recursive: true, force: true })
        return false
      }
    }
  } catch (error) {
    console.error('Piper extraction failed:', error.message)
    console.error('Full error:', error)
    return false
  }

  return false
}

/**
 * Download and setup piper binary if missing
 */
async function ensurePiper() {
  const platform = os.platform()
  const arch = os.arch()
  const backendBinDir = path.join(process.cwd(), 'resources', 'backend', 'bin')
  const piperPath = path.join(
    backendBinDir,
    platform === 'win32' ? 'piper.exe' : 'piper'
  )

  // Check if piper already exists
  if (fs.existsSync(piperPath)) {
    console.log(`✅ Piper already available: ${piperPath}`)
    return true
  }

  // Ensure bin directory exists
  if (!fs.existsSync(backendBinDir)) {
    fs.mkdirSync(backendBinDir, { recursive: true })
  }

  // Get download URL for platform
  let downloadUrl = PIPER_URLS[platform]

  // Handle architecture selection for macOS and Linux
  if (typeof downloadUrl === 'object') {
    if (platform === 'darwin') {
      downloadUrl = arch === 'arm64' ? downloadUrl.arm64 : downloadUrl.x64
    } else if (platform === 'linux') {
      downloadUrl = downloadUrl.x64 // Default to x64 for Linux
    }
  }

  if (!downloadUrl) {
    console.warn(
      `⚠️  No piper download URL configured for platform: ${platform}/${arch}`
    )
    return false
  }

  try {
    console.log(`📥 Downloading piper for ${platform}/${arch}...`)

    // Determine correct file extension based on URL
    let archiveExt = '.zip'
    if (downloadUrl.includes('.tar.gz')) {
      archiveExt = '.tar.gz'
    } else if (downloadUrl.includes('piper-macos-arm64')) {
      archiveExt = '' // Direct binary
    }

    const archivePath = path.join(backendBinDir, `piper-download${archiveExt}`)

    // Download the archive
    await downloadFile(downloadUrl, archivePath)
    console.log('✅ Piper download completed')

    // Handle direct binary for macOS ARM64
    if (
      platform === 'darwin' &&
      arch === 'arm64' &&
      !archivePath.includes('.')
    ) {
      // Direct binary file
      const targetPath = path.join(backendBinDir, 'piper')
      fs.copyFileSync(archivePath, targetPath)
      fs.chmodSync(targetPath, '755')
      console.log(`✅ Direct Piper binary installed: ${targetPath}`)
      return true
    }

    // Extract piper binary
    console.log('📦 Extracting piper binary...')
    const extractSuccess = extractPiper(archivePath, backendBinDir)

    // Clean up archive
    fs.unlinkSync(archivePath)

    if (extractSuccess && fs.existsSync(piperPath)) {
      console.log(`✅ Piper setup completed: ${piperPath}`)
      return true
    } else {
      console.error('❌ Failed to extract piper binary')
      return false
    }
  } catch (error) {
    console.error('❌ Failed to download piper:', error.message)
    return false
  }
}

/**
 * Download and setup whisper binary if missing
 */
async function ensureWhisper() {
  const platform = os.platform()
  const arch = os.arch()
  const backendBinDir = path.join(process.cwd(), 'resources', 'backend', 'bin')
  const whisperPath = path.join(
    backendBinDir,
    platform === 'win32' ? 'main.exe' : 'main'
  )

  // Check if whisper already exists
  if (fs.existsSync(whisperPath)) {
    console.log(`✅ Whisper already available: ${whisperPath}`)
    return true
  }

  // Ensure bin directory exists
  if (!fs.existsSync(backendBinDir)) {
    fs.mkdirSync(backendBinDir, { recursive: true })
  }

  // Get download URL for platform
  let downloadUrl = WHISPER_URLS[platform]

  // Handle architecture selection for macOS and Linux
  if (typeof downloadUrl === 'object') {
    if (platform === 'darwin') {
      downloadUrl = arch === 'arm64' ? downloadUrl.arm64 : downloadUrl.x64
    } else if (platform === 'linux') {
      downloadUrl = downloadUrl.x64 // Default to x64 for Linux
    }
  }

  if (!downloadUrl) {
    console.warn(
      `⚠️  No whisper download URL configured for platform: ${platform}/${arch}`
    )
    return false
  }

  try {
    console.log(`📥 Downloading whisper for ${platform}/${arch}...`)

    const archivePath = path.join(backendBinDir, 'whisper-download.zip')

    // Download the archive
    await downloadFile(downloadUrl, archivePath)
    console.log('✅ Whisper download completed')

    // Extract whisper binary
    console.log('📦 Extracting whisper binary...')
    const extractSuccess = extractWhisper(archivePath, backendBinDir)

    // Clean up archive
    fs.unlinkSync(archivePath)

    if (extractSuccess && fs.existsSync(whisperPath)) {
      console.log(`✅ Whisper setup completed: ${whisperPath}`)
      return true
    } else {
      console.error('❌ Failed to extract whisper binary')
      return false
    }
  } catch (error) {
    console.error('❌ Failed to download whisper:', error.message)
    return false
  }
}

/**
 * Download whisper base model if missing
 */
async function ensureWhisperModel() {
  const backendModelsDir = path.join(
    process.cwd(),
    'resources',
    'backend',
    'models'
  )
  const modelPath = path.join(backendModelsDir, 'whisper-base.bin')

  // Check if model already exists
  if (fs.existsSync(modelPath)) {
    console.log(`✅ Whisper model already available: ${modelPath}`)
    return true
  }

  // Ensure models directory exists
  if (!fs.existsSync(backendModelsDir)) {
    fs.mkdirSync(backendModelsDir, { recursive: true })
  }

  try {
    console.log('📥 Downloading whisper base model...')
    const modelUrl =
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin'

    await downloadFile(modelUrl, modelPath)
    console.log(`✅ Whisper model downloaded: ${modelPath}`)
    return true
  } catch (error) {
    console.error('❌ Failed to download whisper model:', error.message)
    console.log('Note: Whisper will try to download the model at runtime')
    return false
  }
}

/**
 * Setup Piper TTS binary for out-of-box text-to-speech
 */
async function setupPiper() {
  const platform = os.platform()
  const backendBinDir = path.join(process.cwd(), 'resources', 'backend', 'bin')
  const piperPath = path.join(
    backendBinDir,
    platform === 'win32' ? 'piper.exe' : 'piper'
  )

  // Check if piper already exists and is working
  if (fs.existsSync(piperPath)) {
    try {
      // Test if it's a working binary (not a broken script)
      const testCmd = execSync(`"${piperPath}" --help`, {
        stdio: 'pipe',
        timeout: 5000,
      })
      if (testCmd.toString().includes('--model')) {
        console.log(`✅ Piper already available: ${piperPath}`)
        // Still download voice models if they're missing
        await downloadRequiredVoiceModels()
        return true
      }
    } catch (error) {
      console.log('🔄 Existing Piper binary is broken, replacing...')
    }
  }

  // Ensure bin directory exists
  if (!fs.existsSync(backendBinDir)) {
    fs.mkdirSync(backendBinDir, { recursive: true })
  }

  try {
    console.log('📥 Installing Piper TTS binary...')

    // Use the same reliable download method as ensurePiper()
    const piperSuccess = await ensurePiper()
    if (piperSuccess) {
      console.log(`✅ Piper TTS setup completed: ${piperPath}`)
      // Download required voice models
      await downloadRequiredVoiceModels()
      return true
    } else if (platform === 'darwin') {
      // On macOS, try pip installation as fallback
      console.log(
        '🔄 Binary download failed, trying pip installation on macOS...'
      )
      return await tryPipInstallation(piperPath)
    } else {
      console.log(
        '⚠️  Piper binary download failed, will fallback to runtime download'
      )
      return false
    }
  } catch (error) {
    if (platform === 'darwin') {
      console.log(
        '🔄 Error occurred, trying pip installation as fallback on macOS...'
      )
      return await tryPipInstallation(piperPath)
    }
    console.error('❌ Failed to setup Piper TTS:', error.message)
    console.log('Note: Piper will try to download at runtime')
    return false
  }
}

/**
 * Try pip installation of Piper TTS (macOS fallback)
 */
async function tryPipInstallation(piperPath) {
  try {
    console.log('Installing piper-tts via pip...')
    execSync('python3 -m pip install --user piper-tts', { stdio: 'pipe' })

    // Find the installed piper binary
    const homeDir = os.homedir()
    const possiblePaths = [
      path.join(homeDir, 'Library', 'Python', '3.9', 'bin', 'piper'), // macOS Python 3.9
      path.join(homeDir, 'Library', 'Python', '3.10', 'bin', 'piper'), // macOS Python 3.10
      path.join(homeDir, 'Library', 'Python', '3.11', 'bin', 'piper'), // macOS Python 3.11
      path.join(homeDir, 'Library', 'Python', '3.12', 'bin', 'piper'), // macOS Python 3.12
      path.join(homeDir, '.local', 'bin', 'piper'), // Alternative location
    ]

    let sourcePiper = null
    for (const possiblePath of possiblePaths) {
      if (fs.existsSync(possiblePath)) {
        sourcePiper = possiblePath
        break
      }
    }

    if (!sourcePiper) {
      // Try to find piper in PATH
      try {
        const whichResult = execSync('which piper', { stdio: 'pipe' })
        sourcePiper = whichResult.toString().trim()
      } catch (e) {
        throw new Error('Piper binary not found after pip installation')
      }
    }

    // Copy the working piper binary
    fs.copyFileSync(sourcePiper, piperPath)
    fs.chmodSync(piperPath, '755')

    console.log(`✅ Piper TTS installed via pip: ${piperPath}`)

    // Download required voice models
    await downloadRequiredVoiceModels()

    return true
  } catch (pipError) {
    console.error('❌ pip installation also failed:', pipError.message)
    console.log('Note: Piper TTS will be downloaded at runtime')
    return false
  }
}

/**
 * Download required voice models for Piper TTS
 */
async function downloadRequiredVoiceModels() {
  const modelsDir = path.join(
    process.cwd(),
    'resources',
    'backend',
    'models',
    'piper'
  )

  // Ensure models directory exists
  if (!fs.existsSync(modelsDir)) {
    fs.mkdirSync(modelsDir, { recursive: true })
  }

  // Required voice models (as defined in backend Go code)
  const requiredVoices = [
    {
      name: 'zh_CN-huayan-medium',
      modelUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx',
      configUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/zh/zh_CN/huayan/medium/zh_CN-huayan-medium.onnx.json',
    },
    {
      name: 'en_US-amy-medium',
      modelUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx',
      configUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/amy/medium/en_US-amy-medium.onnx.json',
    },
    {
      name: 'en_US-hfc_female-medium',
      modelUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx',
      configUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/hfc_female/medium/en_US-hfc_female-medium.onnx.json',
    },
    {
      name: 'en_US-kristin-medium',
      modelUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium.onnx',
      configUrl:
        'https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/kristin/medium/en_US-kristin-medium.onnx.json',
    },
  ]

  console.log('📥 Downloading required voice models for out-of-box TTS...')

  for (const voice of requiredVoices) {
    const modelPath = path.join(modelsDir, `${voice.name}.onnx`)
    const configPath = path.join(modelsDir, `${voice.name}.onnx.json`)

    try {
      // Check if model already exists
      if (fs.existsSync(modelPath) && fs.existsSync(configPath)) {
        console.log(`✅ Voice model already available: ${voice.name}`)
        continue
      }

      console.log(`📥 Downloading ${voice.name}...`)

      // Download model file (.onnx)
      if (!fs.existsSync(modelPath)) {
        await downloadFile(voice.modelUrl, modelPath)
        console.log(`✅ Downloaded model: ${voice.name}.onnx`)
      }

      // Download config file (.onnx.json)
      if (!fs.existsSync(configPath)) {
        await downloadFile(voice.configUrl, configPath)
        console.log(`✅ Downloaded config: ${voice.name}.onnx.json`)
      }
    } catch (error) {
      console.warn(
        `⚠️  Failed to download voice model ${voice.name}: ${error.message}`
      )
      console.log(`Note: ${voice.name} will be downloaded at runtime if needed`)
    }
  }

  console.log('✅ Voice model setup completed')
}

/**
 * Download and setup ffmpeg binary if missing
 */
async function ensureFFmpeg(options = {}) {
  const platform = options.platform || os.platform()
  const backendBinDir =
    options.backendBinDir ||
    path.join(options.cwd || process.cwd(), 'resources', 'backend', 'bin')
  const ffmpegPath = path.join(
    backendBinDir,
    platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  )

  // Check if ffmpeg already exists and is a native executable.  Merely
  // checking existence would preserve a truncated/HTML file from a previous
  // failed download and let the packaging preflight fail much later.
  if (isValidFFmpegBinary(ffmpegPath, platform)) {
    if (platform !== 'win32') {
      try {
        fs.chmodSync(ffmpegPath, 0o755)
      } catch (error) {
        console.warn(`⚠️  Could not make ffmpeg executable: ${error.message}`)
        return false
      }
    }
    console.log(`✅ FFmpeg already available: ${ffmpegPath}`)
    return true
  }
  if (fs.existsSync(ffmpegPath)) {
    console.warn(
      `⚠️  Existing ffmpeg is invalid and will be replaced: ${ffmpegPath}`
    )
    removeFileIfPresent(ffmpegPath)
  }

  // Ensure bin directory exists
  if (!fs.existsSync(backendBinDir)) {
    fs.mkdirSync(backendBinDir, { recursive: true })
  }

  // Get download URLs for platform.  Callers/tests can inject a list without
  // touching the network; a legacy string value is accepted for compatibility.
  const configuredUrls = options.urls ?? FFMPEG_URLS[platform]
  const downloadUrls = Array.isArray(configuredUrls)
    ? configuredUrls
    : configuredUrls
      ? [configuredUrls]
      : []
  if (downloadUrls.length === 0) {
    console.warn(
      `⚠️  No ffmpeg download URL configured for platform: ${platform}`
    )
    return false
  }

  const downloader = options.download || options.downloadFile || downloadFile
  const extractor =
    options.extract ||
    options.extractFFmpeg ||
    ((archivePath, outputDir) =>
      extractFFmpeg(archivePath, outputDir, platform))
  const failures = []

  for (const downloadUrl of downloadUrls) {
    const archiveExt = archiveExtensionFromUrl(downloadUrl)
    if (!archiveExt) {
      failures.push(`${downloadUrl}: unsupported archive extension`)
      console.warn(
        `⚠️  Skipping ffmpeg source with unknown archive type: ${downloadUrl}`
      )
      continue
    }

    const archivePath = path.join(backendBinDir, `ffmpeg-download${archiveExt}`)
    try {
      removeFileIfPresent(archivePath)
      removeFileIfPresent(`${archivePath}.part`)
      console.log(`📥 Downloading ffmpeg for ${platform}...`)

      await downloader(downloadUrl, archivePath)
      if (!isValidArchive(archivePath, archiveExt)) {
        throw new Error(
          `downloaded content is not a valid ${archiveExt} archive`
        )
      }
      console.log('✅ Download completed and archive validated')

      console.log('📦 Extracting ffmpeg binary...')
      const extractSuccess = await extractor(archivePath, backendBinDir)
      if (!extractSuccess || !isValidFFmpegBinary(ffmpegPath, platform)) {
        throw new Error('extracted ffmpeg binary is missing or invalid')
      }

      if (platform !== 'win32') fs.chmodSync(ffmpegPath, 0o755)
      if (!isValidFFmpegBinary(ffmpegPath, platform)) {
        throw new Error('ffmpeg binary failed the final validation')
      }
      console.log(`✅ FFmpeg setup completed: ${ffmpegPath}`)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push(`${downloadUrl}: ${message}`)
      console.warn(`⚠️  FFmpeg source failed, trying fallback: ${message}`)
    } finally {
      // Never leave archives in resources/backend/bin; the runtime preflight
      // reports these as staging artifacts and they can mask partial builds.
      removeFileIfPresent(archivePath)
      removeFileIfPresent(`${archivePath}.part`)
    }
  }

  console.error(
    `❌ Failed to obtain a valid ffmpeg binary for ${platform}. Sources tried:\n${failures
      .map(failure => `  - ${failure}`)
      .join('\n')}`
  )
  return false
}

function setupFFmpegForUser() {
  const paths = resolveFFmpegPaths()
  const sourceFfmpeg = paths.sourceCandidates.find(candidate =>
    fs.existsSync(candidate)
  )
  const targetFfmpeg = paths.targetPath

  // Avoid creating a user directory when the build did not produce a native
  // FFmpeg asset.  This keeps failed/partial builds from mutating user data.
  if (!sourceFfmpeg) {
    console.warn(
      `⚠️  Bundled ${paths.binaryName} not found. Checked: ${paths.sourceCandidates.join(', ')}`
    )
    return
  }

  if (!fs.existsSync(paths.localBinDir)) {
    fs.mkdirSync(paths.localBinDir, { recursive: true })
    console.log(`Created directory: ${paths.localBinDir}`)
  }

  if (fs.existsSync(sourceFfmpeg)) {
    try {
      fs.copyFileSync(sourceFfmpeg, targetFfmpeg)
      // Make executable on Unix-like systems
      if (os.platform() !== 'win32') {
        fs.chmodSync(targetFfmpeg, '755')
      }
      console.log(`✅ Installed ffmpeg to user PATH: ${targetFfmpeg}`)
    } catch (error) {
      console.warn(
        `⚠️  Could not install ffmpeg to user PATH: ${error.message}`
      )
      console.log(
        'Note: Whisper transcription may require manual ffmpeg installation'
      )
    }
  } else {
    console.warn(`⚠️  Bundled ffmpeg not found at: ${sourceFfmpeg}`)
  }
}

async function buildGoBackend() {
  const platform = os.platform()
  const isWindows = platform === 'win32'

  // Ensure resources/backend directory exists
  const backendDir = path.join(process.cwd(), 'resources', 'backend')
  if (!fs.existsSync(backendDir)) {
    fs.mkdirSync(backendDir, { recursive: true })
  }

  // Determine output filename
  const outputName = isWindows ? 'alice-backend.exe' : 'alice-backend'
  const outputPath = path.join('..', 'resources', 'backend', outputName)

  // Build command
  const buildCmd = `cd backend && go build -ldflags="-s -w" -o "${outputPath}"`

  console.log(`Building Go backend for ${platform}...`)
  console.log(`Command: ${buildCmd}`)

  try {
    execSync(buildCmd, {
      stdio: 'inherit',
      shell: true,
    })

    // Verify the binary was created
    const finalPath = path.join(
      process.cwd(),
      'resources',
      'backend',
      outputName
    )
    if (fs.existsSync(finalPath)) {
      const stats = fs.statSync(finalPath)
      console.log(
        `Go backend built successfully: ${finalPath} (${Math.round(stats.size / 1024 / 1024)}MB)`
      )

      // Setup ffmpeg for out-of-box experience
      console.log('\nSetting up ffmpeg for out-of-box transcription...')
      const ffmpegSuccess = await ensureFFmpeg()
      if (!ffmpegSuccess) {
        // FFmpeg is a required runtime asset and verify:runtime checks it in
        // strict mode.  Do not spend time downloading the remaining models or
        // produce a release that is guaranteed to fail that preflight.
        throw new Error(
          'FFmpeg setup failed; aborting build before downloading remaining runtime assets'
        )
      }
      setupFFmpegForUser()

      // Setup whisper for out-of-box transcription
      console.log('\nSetting up Whisper for out-of-box transcription...')
      const whisperSuccess = await ensureWhisper()
      if (!whisperSuccess) {
        console.warn(
          '⚠️  Whisper download failed, will fallback to runtime download'
        )
      }

      // Download Whisper model
      console.log('\nSetting up Whisper model...')
      const modelSuccess = await ensureWhisperModel()
      if (!modelSuccess) {
        console.warn(
          '⚠️  Whisper model download failed, will fallback to runtime download'
        )
      }

      // Setup Piper TTS for out-of-box text-to-speech
      console.log('\nSetting up Piper TTS for out-of-box text-to-speech...')
      const piperSuccess = await setupPiper()
      if (!piperSuccess) {
        console.warn(
          '⚠️  Piper TTS setup failed, will fallback to runtime download'
        )
      }
    } else {
      throw new Error(`Binary not found at expected path: ${finalPath}`)
    }
  } catch (error) {
    console.error(
      'Failed to build Go backend:',
      error instanceof Error ? error.message : String(error)
    )
    throw error
  }
}

export {
  FFMPEG_URLS,
  archiveExtensionFromUrl,
  buildGoBackend,
  downloadFile,
  extractFFmpeg,
  isValidArchive,
  isValidFFmpegBinary,
  ensureFFmpeg,
}

const entryPath = process.argv[1]
if (
  entryPath &&
  import.meta.url === pathToFileURL(path.resolve(entryPath)).href
) {
  ;(async () => {
    try {
      await buildGoBackend()
      console.log('🎉 Build script completed successfully!')
      process.exitCode = 0
    } catch (error) {
      console.error(
        'Build failed:',
        error instanceof Error ? error.message : String(error)
      )
      process.exitCode = 1
    }
  })()
}
