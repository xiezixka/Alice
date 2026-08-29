export function isBlockedMicrophonePermissionStatus(status: string): boolean {
  return status === 'denied' || status === 'restricted'
}

export function isMicrophonePermissionError(reason?: unknown): boolean {
  const name =
    reason && typeof reason === 'object' && 'name' in reason
      ? String((reason as { name?: unknown }).name || '')
      : ''
  const message =
    reason && typeof reason === 'object' && 'message' in reason
      ? String((reason as { message?: unknown }).message || '')
      : String(reason || '')

  return (
    name === 'NotAllowedError' ||
    name === 'PermissionDeniedError' ||
    /permission\s*(?:is\s*)?(?:denied|not granted)|not allowed|(?:denied|blocked).*microphone|麦克风.*(?:权限|拒绝)/i.test(
      message
    )
  )
}
