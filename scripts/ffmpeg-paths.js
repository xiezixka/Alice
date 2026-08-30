import path from 'path'
import os from 'os'

/**
 * Resolve the bundled and per-user locations used by the runtime dependency
 * bootstrap. Keep this pure so the path contract can be checked in CI without
 * creating directories or touching the user's machine.
 */
function resolveFFmpegPaths(options = {}) {
  const platform = options.platform || os.platform()
  const homeDir = options.homeDir || os.homedir()
  const cwd = options.cwd || process.cwd()
  const resourcesPath =
    options.resourcesPath ||
    (typeof process.resourcesPath === 'string' ? process.resourcesPath : '')
  const localAppData = options.localAppData || process.env.LOCALAPPDATA || ''
  const isWindows = platform === 'win32'
  const binaryName = isWindows ? 'ffmpeg.exe' : 'ffmpeg'
  const localBinDir = isWindows
    ? path.join(
        localAppData || path.join(homeDir, 'AppData', 'Local'),
        'Alice AI App',
        'bin'
      )
    : path.join(homeDir, '.local', 'bin')

  const sourceCandidates = []
  if (resourcesPath) {
    sourceCandidates.push(
      path.join(resourcesPath, 'backend', 'bin', binaryName)
    )
  }
  sourceCandidates.push(
    path.join(cwd, 'resources', 'backend', 'bin', binaryName)
  )

  return {
    binaryName,
    localBinDir,
    sourceCandidates: [...new Set(sourceCandidates)],
    targetPath: path.join(localBinDir, binaryName),
  }
}

export { resolveFFmpegPaths }
