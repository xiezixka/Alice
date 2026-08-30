/**
 * Choose where the Go backend should keep the MiniLM embedding model.
 *
 * A packaged app may be launched directly from a read-only location (for
 * example a mounted DMG or an AppImage).  Keep using bundled artifacts when
 * they are complete, but fall back to the per-user data directory whenever
 * the bundle is incomplete and cannot be written.
 */
export interface MiniLMModelDirectoryProbe {
  packaged: boolean
  bundledPath: string
  userDataPath: string
  bundledHasRequiredArtifacts: boolean
  bundledWritable: boolean
}

export function selectMiniLMModelPath(
  probe: MiniLMModelDirectoryProbe
): string {
  if (
    !probe.packaged ||
    probe.bundledHasRequiredArtifacts ||
    probe.bundledWritable
  ) {
    return probe.bundledPath
  }
  return probe.userDataPath
}
