export function setupDependencies(): Promise<void>
export interface FFmpegPathOptions {
  platform?: string
  homeDir?: string
  cwd?: string
  resourcesPath?: string
  localAppData?: string
}
export interface FFmpegPaths {
  binaryName: string
  localBinDir: string
  sourceCandidates: string[]
  targetPath: string
}
export function resolveFFmpegPaths(options?: FFmpegPathOptions): FFmpegPaths
