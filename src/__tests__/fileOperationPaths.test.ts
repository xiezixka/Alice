import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { resolvePathThroughExistingParent } from '../../electron/main/fileOperationPaths'
import { isPathWithinRoot } from '../../electron/main/securityBoundaries'

const temporaryDirectories: string[] = []

async function createSandbox(): Promise<{
  root: string
  outside: string
}> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-paths-'))
  const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-outside-'))
  temporaryDirectories.push(root, outside)
  return { root, outside }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('resolvePathThroughExistingParent', () => {
  it('keeps a new destination under the canonical approved root', async () => {
    const { root } = await createSandbox()
    const requested = path.join(root, 'new-folder', 'report.txt')
    const resolved = await resolvePathThroughExistingParent(requested)
    const canonicalRoot = await fs.realpath(root)

    expect(resolved).toBe(path.join(canonicalRoot, 'new-folder', 'report.txt'))
    expect(isPathWithinRoot(canonicalRoot, resolved)).toBe(true)
  })

  it('resolves an existing symlink before approval so it cannot escape the root', async () => {
    const { root, outside } = await createSandbox()
    const link = path.join(root, 'shared')
    await fs.symlink(outside, link, 'dir')

    const resolved = await resolvePathThroughExistingParent(
      path.join(link, 'secret.txt')
    )
    const canonicalRoot = await fs.realpath(root)

    expect(resolved).toBe(path.join(await fs.realpath(outside), 'secret.txt'))
    expect(isPathWithinRoot(canonicalRoot, resolved)).toBe(false)
  })

  it('canonicalizes a symlink destination itself', async () => {
    const { root, outside } = await createSandbox()
    const link = path.join(root, 'alias')
    await fs.symlink(outside, link, 'dir')

    expect(await resolvePathThroughExistingParent(link)).toBe(
      await fs.realpath(outside)
    )
  })
})
