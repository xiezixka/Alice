export type FFmpegPlatform = 'win32' | 'darwin' | 'linux' | string

export interface FFmpegEnsureOptions {
  platform?: FFmpegPlatform
  cwd?: string
  backendBinDir?: string
  urls?: string | string[]
  download?: (url: string, outputPath: string) => Promise<void> | void
  downloadFile?: (url: string, outputPath: string) => Promise<void> | void
  extract?: (
    archivePath: string,
    outputDir: string
  ) => Promise<boolean> | boolean
  extractFFmpeg?: (
    archivePath: string,
    outputDir: string
  ) => Promise<boolean> | boolean
}

export interface DownloadOptions {
  redirects?: number
  maxRedirects?: number
  timeoutMs?: number
}

export const FFMPEG_URLS: {
  win32: string
  darwin: string
  linux: string[]
  [platform: string]: string | string[]
}

export function archiveExtensionFromUrl(
  url: string
): '.zip' | '.tar.xz' | '.tar.gz' | null

export function isValidArchive(filePath: string, extension: string): boolean

export function isValidFFmpegBinary(
  filePath: string,
  platform?: FFmpegPlatform
): boolean

export function downloadFile(
  url: string,
  outputPath: string,
  options?: DownloadOptions
): Promise<void>

export function extractFFmpeg(
  archivePath: string,
  outputDir: string,
  platform?: FFmpegPlatform
): boolean

export function ensureFFmpeg(options?: FFmpegEnsureOptions): Promise<boolean>

export function buildGoBackend(): Promise<void>
