import { describe, expect, it } from 'vitest'
import { selectMiniLMModelPath } from '../../electron/main/backendPaths'

const baseProbe = {
  packaged: true,
  bundledPath: '/bundle/resources/backend/models/minilm',
  userDataPath: '/user-data/models/minilm',
  bundledHasRequiredArtifacts: false,
  bundledWritable: false,
}

describe('selectMiniLMModelPath', () => {
  it('falls back to user data for an incomplete read-only package', () => {
    expect(selectMiniLMModelPath(baseProbe)).toBe(baseProbe.userDataPath)
  })

  it('keeps complete bundled artifacts even when the package is read-only', () => {
    expect(
      selectMiniLMModelPath({
        ...baseProbe,
        bundledHasRequiredArtifacts: true,
      })
    ).toBe(baseProbe.bundledPath)
  })

  it('keeps the development path and writable package path', () => {
    expect(selectMiniLMModelPath({ ...baseProbe, packaged: false })).toBe(
      baseProbe.bundledPath
    )
    expect(selectMiniLMModelPath({ ...baseProbe, bundledWritable: true })).toBe(
      baseProbe.bundledPath
    )
  })
})
