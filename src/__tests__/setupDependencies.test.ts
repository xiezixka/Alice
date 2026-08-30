import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import { resolveFFmpegPaths } from '../../scripts/setup-dependencies.js'

describe('resolveFFmpegPaths', () => {
  it('uses packaged resources first and the Windows executable name', () => {
    const paths = resolveFFmpegPaths({
      platform: 'win32',
      homeDir: 'C:/Users/tester',
      cwd: 'C:/workspace/Alice',
      resourcesPath: 'C:/Program Files/Alice/resources',
      localAppData: 'C:/Users/tester/AppData/Local',
    })

    expect(paths.binaryName).toBe('ffmpeg.exe')
    expect(paths.sourceCandidates[0]).toContain('Program Files/Alice/resources')
    expect(paths.sourceCandidates[0]).toMatch(/ffmpeg\.exe$/)
    expect(paths.targetPath).toContain('AppData/Local')
    expect(paths.targetPath).toMatch(/ffmpeg\.exe$/)
  })

  it('keeps development fallback and Unix user-bin behavior', () => {
    const paths = resolveFFmpegPaths({
      platform: 'darwin',
      homeDir: '/Users/tester',
      cwd: '/workspace/Alice',
      resourcesPath: '',
    })

    expect(paths.binaryName).toBe('ffmpeg')
    expect(paths.sourceCandidates).toEqual([
      '/workspace/Alice/resources/backend/bin/ffmpeg',
    ])
    expect(paths.targetPath).toBe('/Users/tester/.local/bin/ffmpeg')
  })

  it('accepts the current platform and architecture in the native-build guard', () => {
    expect(() =>
      execFileSync(
        process.execPath,
        ['scripts/assert-native-build.js', process.platform, process.arch],
        { cwd: process.cwd(), stdio: 'pipe' }
      )
    ).not.toThrow()
  })
})
