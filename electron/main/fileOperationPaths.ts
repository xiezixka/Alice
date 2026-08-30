import fs from 'node:fs/promises'
import path from 'node:path'

/**
 * Resolve a path through its deepest existing ancestor and append any
 * not-yet-created segments. This keeps directory approval checks symlink-safe
 * while still allowing a user to approve a destination whose leaf directory
 * will be created by a later operation.
 */
export async function resolvePathThroughExistingParent(
  requestedPath: string
): Promise<string> {
  let candidate = path.resolve(requestedPath)
  const missingSegments: string[] = []

  while (true) {
    try {
      const canonical = await fs.realpath(candidate)
      return path.join(canonical, ...missingSegments.reverse())
    } catch (error: any) {
      if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') throw error
      const parent = path.dirname(candidate)
      if (parent === candidate) throw error
      missingSegments.push(path.basename(candidate))
      candidate = parent
    }
  }
}
