import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  FFMPEG_URLS,
  archiveExtensionFromUrl,
  ensureFFmpeg,
  isValidArchive,
  isValidFFmpegBinary,
} from '../../scripts/build-go.js'

const temporaryDirectories: string[] = []

function createTemporaryBin() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'alice-ffmpeg-test-'))
  temporaryDirectories.push(root)
  const bin = path.join(root, 'resources', 'backend', 'bin')
  fs.mkdirSync(bin, { recursive: true })
  return bin
}

function writeArchiveFixture(filePath: string, valid: boolean) {
  fs.writeFileSync(
    filePath,
    valid
      ? Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00, 0x00])
      : '<html><body>temporary upstream error</body></html>'
  )
}

function writeLinuxBinaryFixture(filePath: string) {
  fs.writeFileSync(
    filePath,
    Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46]), Buffer.alloc(32)])
  )
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('build-go ffmpeg bootstrap', () => {
  it('prefers the GitHub Linux archive and keeps johnvansickle as fallback', () => {
    expect(FFMPEG_URLS.linux[0]).toContain('BtbN/FFmpeg-Builds')
    expect(FFMPEG_URLS.linux[0]).toMatch(/linux64-gpl\.tar\.xz$/)
    expect(FFMPEG_URLS.linux[1]).toContain('johnvansickle.com')
  })

  it('selects a pinned native arm64 archive for Apple Silicon', () => {
    expect(FFMPEG_URLS.darwin.arm64).toContain(
      'binmgr/ffmpeg/releases/download/v8.1.2/ffmpeg-darwin-arm64.tar.gz'
    )
  })

  it('infers archive type without being confused by redirect query strings', () => {
    expect(
      archiveExtensionFromUrl(
        'https://example.test/ffmpeg.tar.xz?download=1&sig=abc'
      )
    ).toBe('.tar.xz')
    expect(archiveExtensionFromUrl('https://example.test/archive.zip')).toBe(
      '.zip'
    )
    expect(archiveExtensionFromUrl('https://example.test/ffmpeg')).toBeNull()
  })

  it('checks archive magic bytes instead of trusting HTTP status or filenames', () => {
    const bin = createTemporaryBin()
    const archivePath = path.join(bin, 'candidate.tar.xz')
    writeArchiveFixture(archivePath, false)
    expect(isValidArchive(archivePath, '.tar.xz')).toBe(false)

    writeArchiveFixture(archivePath, true)
    expect(isValidArchive(archivePath, '.tar.xz')).toBe(true)
  })

  it('rejects an HTML 200 response before extraction and falls back', async () => {
    const bin = createTemporaryBin()
    const urls = [
      'https://bad.example/ffmpeg.tar.xz',
      'https://good.example/ffmpeg.tar.xz',
    ]
    const downloaded: string[] = []
    const extractedArchives: string[] = []

    const result = await ensureFFmpeg({
      platform: 'linux',
      backendBinDir: bin,
      urls,
      download: async (url: string, outputPath: string) => {
        downloaded.push(url)
        writeArchiveFixture(outputPath, url === urls[1])
      },
      extract: async (archivePath: string, outputDir: string) => {
        extractedArchives.push(archivePath)
        writeLinuxBinaryFixture(path.join(outputDir, 'ffmpeg'))
        return true
      },
    })

    expect(result).toBe(true)
    expect(downloaded).toEqual(urls)
    // The invalid first source must never reach tar/unzip.
    expect(extractedArchives).toHaveLength(1)
    expect(extractedArchives[0]).toContain('ffmpeg-download.tar.xz')
    expect(isValidFFmpegBinary(path.join(bin, 'ffmpeg'), 'linux')).toBe(true)
    expect(fs.existsSync(path.join(bin, 'ffmpeg-download.tar.xz'))).toBe(false)
  })

  it('returns false after all sources fail and leaves no archive staging files', async () => {
    const bin = createTemporaryBin()
    const result = await ensureFFmpeg({
      platform: 'linux',
      backendBinDir: bin,
      urls: ['https://bad.example/ffmpeg.tar.xz'],
      download: async (_url: string, outputPath: string) => {
        writeArchiveFixture(outputPath, false)
      },
      extract: async () => {
        throw new Error('extractor must not run for invalid archive')
      },
    })

    expect(result).toBe(false)
    expect(fs.readdirSync(bin)).toEqual([])
  })

  it('replaces an existing invalid binary and validates the new native file', async () => {
    const bin = createTemporaryBin()
    const ffmpegPath = path.join(bin, 'ffmpeg')
    fs.writeFileSync(ffmpegPath, 'not an executable')

    const result = await ensureFFmpeg({
      platform: 'linux',
      backendBinDir: bin,
      urls: ['https://good.example/ffmpeg.tar.xz'],
      download: async (_url: string, outputPath: string) => {
        writeArchiveFixture(outputPath, true)
      },
      extract: async (_archivePath: string, outputDir: string) => {
        writeLinuxBinaryFixture(ffmpegPath)
        return true
      },
    })

    expect(result).toBe(true)
    expect(fs.existsSync(path.join(bin, 'ffmpeg-download.tar.xz'))).toBe(false)
    expect(isValidFFmpegBinary(ffmpegPath, 'linux')).toBe(true)
  })
})
