import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { resolveFFmpegPaths } from '../../scripts/ffmpeg-paths.js'

// Read package.json as data instead of relying on Vite's JSON module transform.
// The latter emits invalid syntax on the Windows Vitest runner for this file.
const packageJson = JSON.parse(
  readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')
) as { scripts: Record<string, string> }
const packageScripts = packageJson.scripts

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

  it('builds macOS backend with the native build pipeline', () => {
    expect(packageScripts['build:go:mac']).toContain('scripts/build-go.js')
    expect(packageScripts['build:go:mac']).not.toContain('GOARCH=amd64')
  })
})
