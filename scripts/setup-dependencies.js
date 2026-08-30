#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import { resolveFFmpegPaths } from './ffmpeg-paths.js'

/**
 * Setup required dependencies for out-of-box Alice AI experience
 * This ensures ffmpeg is available for Whisper transcription
 */
function setupFFmpegForUser() {
  const paths = resolveFFmpegPaths()
  const sourceFfmpeg = paths.sourceCandidates.find(candidate =>
    fs.existsSync(candidate)
  )
  const targetFfmpeg = paths.targetPath

  // Skip if already installed
  if (fs.existsSync(targetFfmpeg)) {
    console.log(`✅ ffmpeg already available at: ${targetFfmpeg}`)
    // The backend inherits this process environment.  Make the per-user
    // location discoverable without requiring the user to edit PATH.
    prependToPath(paths.localBinDir)
    return true
  }

  if (!sourceFfmpeg) {
    console.warn(
      `⚠️  Bundled ${paths.binaryName} not found. Checked: ${paths.sourceCandidates.join(', ')}`
    )
    return false
  }

  // Create user's local bin directory only when a bundled binary is present.
  if (!fs.existsSync(paths.localBinDir)) {
    fs.mkdirSync(paths.localBinDir, { recursive: true })
    console.log(`Created directory: ${paths.localBinDir}`)
  }

  if (fs.existsSync(sourceFfmpeg)) {
    try {
      fs.copyFileSync(sourceFfmpeg, targetFfmpeg)
      if (process.platform !== 'win32') fs.chmodSync(targetFfmpeg, '755')
      console.log(`✅ Installed ffmpeg to user PATH: ${targetFfmpeg}`)
      prependToPath(paths.localBinDir)
      return true
    } catch (error) {
      console.warn(
        `⚠️  Could not install ffmpeg to user PATH: ${error.message}`
      )
      console.log(
        'Note: Whisper transcription may require manual ffmpeg installation'
      )
      return false
    }
  }

  return false
}

function prependToPath(directory) {
  const pathEntries = (process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  if (!pathEntries.includes(directory)) {
    process.env.PATH = [directory, ...pathEntries].join(path.delimiter)
  }
}

/**
 * Setup all required dependencies
 */
function setupDependencies() {
  console.log('🔧 Setting up Alice AI dependencies...')

  const ffmpegSuccess = setupFFmpegForUser()

  if (ffmpegSuccess) {
    console.log('✅ All dependencies setup successfully!')
    console.log('🎤 Voice transcription is ready to use')
  } else {
    console.log('⚠️  Some dependencies could not be setup automatically')
    console.log(
      'Voice transcription may not work without manual ffmpeg installation'
    )
  }

  return ffmpegSuccess
}

// Export for use in Electron app
export { resolveFFmpegPaths, setupFFmpegForUser, setupDependencies }

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  setupDependencies()
}
