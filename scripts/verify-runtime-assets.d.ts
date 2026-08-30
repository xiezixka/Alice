export interface RuntimeAssetCheck {
  relativePath: string
  absolutePath: string
  status: 'ok' | 'missing-or-empty' | 'not-executable'
  kind: 'file' | 'directory'
  executable: boolean
}

export interface RuntimeAssetReport {
  platform: 'darwin' | 'win32' | 'linux'
  platformName: string
  backendDir: string
  strict: boolean
  checks: RuntimeAssetCheck[]
  recommended: RuntimeAssetCheck[]
  stagingEntries: string[]
  failures: RuntimeAssetCheck[]
  warnings: string[]
  ok: boolean
}

export function normalizePlatform(
  value?: string
): 'darwin' | 'win32' | 'linux' | undefined

export function findBackendDirectories(
  releaseDirectory: string,
  options?: { maxDepth?: number }
): string[]

export function resolveBackendDirectory(options?: {
  backendDir?: string
  releaseDir?: string
  cwd?: string
}): string

export function inspectRuntimeAssets(options: {
  platform: string
  backendDir?: string
  releaseDir?: string
  cwd?: string
  strict?: boolean
}): RuntimeAssetReport

export const platformSpecs: Record<string, unknown>
