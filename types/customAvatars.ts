export interface AvatarStateVideos {
  standby: string
  speaking: string
  thinking: string
  config?: string
}

export type AvatarSource = 'builtin' | 'custom'

export interface CustomAvatar {
  id: string
  name: string
  folderName: string
  source: AvatarSource
  stateVideos: AvatarStateVideos
  previewVideo: string
  /** Optional static image used while a state video is loading or unavailable. */
  fallbackImage?: string
}

export interface CustomAvatarsSnapshot {
  avatars: CustomAvatar[]
  customizationRoot: string
}
