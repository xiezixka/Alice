import { describe, expect, it } from 'vitest'
import {
  isTrustedAliceRendererUrl,
  shouldAllowMicrophonePermissionCheck,
  shouldAllowMicrophonePermissionRequest,
} from '../../electron/main/mediaPermissions'

const rendererIndexPath = '/Applications/Alice AI App.app/Contents/Resources/app/dist/index.html'
const rendererUrl = `file://${rendererIndexPath}`

describe('media permission policy', () => {
  it('allows microphone checks from the packaged renderer main frame', () => {
    expect(
      shouldAllowMicrophonePermissionCheck({
        permission: 'media',
        mediaType: 'audio',
        isMainFrame: true,
        requestingOrigin: 'null',
        requestingUrl: `${rendererUrl}#settings`,
        currentUrl: `${rendererUrl}#settings`,
        rendererIndexPath,
      })
    ).toBe(true)
  })

  it('rejects camera checks, subframes, and unrelated permissions', () => {
    const base = {
      isMainFrame: true,
      requestingUrl: rendererUrl,
      currentUrl: rendererUrl,
      rendererIndexPath,
    }

    expect(
      shouldAllowMicrophonePermissionCheck({
        ...base,
        permission: 'media',
        mediaType: 'video',
      })
    ).toBe(false)
    expect(
      shouldAllowMicrophonePermissionCheck({
        ...base,
        permission: 'media',
        mediaType: 'audio',
        isMainFrame: false,
      })
    ).toBe(false)
    expect(
      shouldAllowMicrophonePermissionCheck({
        ...base,
        permission: 'geolocation',
        mediaType: 'audio',
      })
    ).toBe(false)
  })

  it('allows audio-only requests and rejects mixed audio/video requests', () => {
    const base = {
      permission: 'media',
      isMainFrame: true,
      requestingUrl: rendererUrl,
      currentUrl: rendererUrl,
      rendererIndexPath,
    }

    expect(
      shouldAllowMicrophonePermissionRequest({
        ...base,
        mediaTypes: ['audio'],
      })
    ).toBe(true)
    expect(
      shouldAllowMicrophonePermissionRequest({
        ...base,
        mediaTypes: ['audio', 'video'],
      })
    ).toBe(false)
    expect(
      shouldAllowMicrophonePermissionRequest({
        ...base,
        mediaTypes: [],
      })
    ).toBe(false)
  })

  it('rejects arbitrary file URLs and mismatched origins', () => {
    expect(
      isTrustedAliceRendererUrl(
        'file:///tmp/untrusted.html',
        rendererUrl,
        rendererIndexPath
      )
    ).toBe(false)
    expect(
      shouldAllowMicrophonePermissionRequest({
        permission: 'media',
        mediaTypes: ['audio'],
        isMainFrame: true,
        requestingUrl: 'https://example.com/index.html',
        currentUrl: rendererUrl,
        rendererIndexPath,
      })
    ).toBe(false)
  })

  it('supports the loopback development renderer without trusting other origins', () => {
    const base = {
      permission: 'media',
      mediaTypes: ['audio'],
      isMainFrame: true,
      currentUrl: 'http://localhost:3344/#/',
    }
    expect(
      shouldAllowMicrophonePermissionRequest({
        ...base,
        requestingUrl: 'http://localhost:3344/#/',
        requestingOrigin: 'http://localhost:3344',
      })
    ).toBe(true)
    expect(
      shouldAllowMicrophonePermissionRequest({
        ...base,
        requestingUrl: 'http://localhost:3345/#/',
        requestingOrigin: 'http://localhost:3345',
      })
    ).toBe(false)
  })
})
