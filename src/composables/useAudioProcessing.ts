import { ref, watch, onUnmounted, onMounted } from 'vue'
import * as vad from '@ricky0123/vad-web'
import { float32ArrayToWav, hasMeaningfulAudio } from '../utils/audioProcess'
import { createVadOptions } from './vadRuntime'
import { useGeneralStore } from '../stores/generalStore'
import { useConversationStore } from '../stores/conversationStore'
import { useSettingsStore } from '../stores/settingsStore'
import { storeToRefs } from 'pinia'
import eventBus from '../utils/eventBus'
import { parseWakeWord } from './wakeWord'
import {
  isBlockedMicrophonePermissionStatus,
  isMicrophonePermissionError,
} from './microphonePermission'

let ipcListenersRegistered = false

export function useAudioProcessing() {
  const generalStore = useGeneralStore()
  const conversationStore = useConversationStore()
  const settingsStore = useSettingsStore()

  const {
    audioState,
    isRecordingRequested,
    awaitingWakeWord,
    wakeWordDetected,
  } = storeToRefs(generalStore)
  const { setAudioState } = generalStore

  const myvad = ref<vad.MicVAD | null>(null)
  const isVadInitializing = ref(false)
  const isSpeechDetected = ref(false)
  const vadAssetBasePath = ref<string>('./')
  let ownsIpcListeners = false
  let backgroundSessionActive = false
  let wakeSessionExpiresAt = 0
  let wakeSessionResetTimer: ReturnType<typeof setTimeout> | null = null

  const isWakeWordModeEnabled = () =>
    settingsStore.config.sttProvider === 'local' &&
    settingsStore.config.localSttEnabled &&
    Boolean(settingsStore.config.localSttWakeWord?.trim())

  const resetWakeSession = () => {
    wakeSessionExpiresAt = 0
    wakeSessionResetTimer = null
    if (isRecordingRequested.value && isWakeWordModeEnabled()) {
      awaitingWakeWord.value = true
      wakeWordDetected.value = false
      if (audioState.value === 'LISTENING') {
        generalStore.statusMessage = '等待唤醒词…'
      }
    }
  }

  const scheduleWakeSessionReset = () => {
    if (wakeSessionResetTimer) {
      clearTimeout(wakeSessionResetTimer)
    }
    wakeSessionResetTimer = setTimeout(resetWakeSession, 8000)
  }

  const handleGlobalMicToggle = () => {
    toggleRecordingRequest()
  }

  const handleGlobalMutePlayback = () => {
    eventBus.emit('mute-playback-toggle')
  }

  const handleGlobalTakeScreenshot = () => {
    eventBus.emit('take-screenshot')
  }

  onMounted(async () => {
    if (
      window.location.protocol === 'file:' &&
      window.electronPaths?.getRendererDistPath
    ) {
      try {
        const rendererDistPath =
          await window.electronPaths.getRendererDistPath()
        let fileUrlPath = rendererDistPath.replace(/\\/g, '/')
        if (fileUrlPath.match(/^[A-Za-z]:\//)) {
          fileUrlPath = `/${fileUrlPath}`
        }
        vadAssetBasePath.value = `file://${fileUrlPath}/`
        console.log(
          '[VAD Asset Path] Electron production, IPC derived base path:',
          vadAssetBasePath.value
        )
      } catch (error) {
        console.error(
          'Failed to get rendererDistPath via IPC. Falling back.',
          error
        )
        let path = window.location.href
        path = path.split('#')[0]
        path = path.substring(0, path.lastIndexOf('/') + 1)
        vadAssetBasePath.value = path
        console.warn(
          '[VAD Asset Path] IPC failed, fallback to href derived path:',
          vadAssetBasePath.value
        )
      }
    } else if (window.location.protocol === 'file:') {
      console.warn(
        '[VAD Asset Path] Electron production, but electronPaths API not found. Using relative path "./". This might fail.'
      )
      vadAssetBasePath.value = './'
    } else {
      console.log(
        '[VAD Asset Path] Development/Web, using relative base path "./"'
      )
      vadAssetBasePath.value = './'
    }
    if (window.aliceIPC && !ipcListenersRegistered) {
      window.aliceIPC.on('global-hotkey-mic-toggle', handleGlobalMicToggle)
      window.aliceIPC.on(
        'global-hotkey-mute-playback',
        handleGlobalMutePlayback
      )
      window.aliceIPC.on(
        'global-hotkey-take-screenshot',
        handleGlobalTakeScreenshot
      )
      ipcListenersRegistered = true
      ownsIpcListeners = true
    }

    // A background session is deliberately opt-in. It starts only after the
    // renderer has resolved its production VAD assets and the persisted
    // settings are available.
    syncBackgroundListening()
  })

  const initializeVAD = async () => {
    if (myvad.value || isVadInitializing.value) {
      console.log('VAD init skipped: Already initialized or initializing.')
      return
    }
    if (
      vadAssetBasePath.value === './' &&
      window.location.protocol === 'file:'
    ) {
      console.warn(
        '[VAD Manager] Attempting to initialize VAD, but asset path might not be fully resolved yet. Waiting briefly...'
      )
      await new Promise(resolve => setTimeout(resolve, 200))
      if (vadAssetBasePath.value === './') {
        console.error(
          "[VAD Manager] CRITICAL: VAD asset path still './' in file protocol after delay. VAD will likely fail."
        )
      }
    }

    console.log('[VAD Manager] Initializing VAD...')
    isVadInitializing.value = true
    isSpeechDetected.value = false

    await destroyVAD()

    try {
      const microphonePermission = await getMicrophonePermission()
      if (isBlockedMicrophonePermissionStatus(microphonePermission)) {
        stopAfterMicrophonePermissionFailure({
          name: 'NotAllowedError',
          message: microphonePermission,
        })
        return
      }

      const assetPath = vadAssetBasePath.value
      console.log(
        `[VAD Manager] Attempting to load VAD with baseAssetPath: ${assetPath}`
      )

      const vadInstance = await vad.MicVAD.new(
        createVadOptions(assetPath, {
          onSpeechStart: () => {
            if (
              audioState.value === 'SPEAKING' ||
              audioState.value === 'WAITING_FOR_RESPONSE'
            ) {
              console.log(
                `[VAD Barge-In] User interrupted Alice during ${audioState.value}. Stopping processes.`
              )
              eventBus.emit('cancel-llm-stream')
              generalStore.stopPlaybackAndClearQueue()
              setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
            }
            isSpeechDetected.value = true
            console.log('[VAD Callback] Speech started.')
          },
          onSpeechEnd: (audio: Float32Array) => {
            console.log(
              `[VAD Callback] Speech ended. Audio length: ${audio?.length}. Current state: ${audioState.value}`
            )
            if (audioState.value === 'LISTENING' && isSpeechDetected.value) {
              processAudioRecording(audio)
            } else {
              console.log(
                '[VAD Callback] Speech ended, but not processing (state changed or no speech detected).'
              )
              isSpeechDetected.value = false
            }
          },
        })
      )

      if (!isRecordingRequested.value) {
        console.log(
          '[VAD Manager] Recording was disabled during initialization; destroying the unused VAD instance.'
        )
        await vadInstance.destroy()
        return
      }

      myvad.value = vadInstance
      await myvad.value.start()
      console.log('[VAD Manager] VAD initialized and started successfully.')
    } catch (error) {
      console.error('[VAD Manager] VAD initialization failed:', error)
      await destroyVAD()
      if (stopAfterMicrophonePermissionFailure(error)) return
      setAudioState('IDLE')
      generalStore.statusMessage = '错误：麦克风/语音检测初始化失败'
      isSpeechDetected.value = false
    } finally {
      isVadInitializing.value = false
    }
  }

  const destroyVAD = async () => {
    if (!myvad.value) {
      return
    }
    console.log('[VAD Manager] Destroying VAD instance...')
    const vadInstance = myvad.value
    myvad.value = null
    try {
      await vadInstance.destroy()
      console.log('[VAD Manager] VAD destroyed.')
    } catch (error) {
      console.error('[VAD Manager] Error destroying VAD:', error)
    } finally {
      isSpeechDetected.value = false
      console.log('[VAD Manager] VAD instance reference removed.')
    }
  }

  /**
   * Read the native permission state before starting a VAD session. On
   * macOS, a background-launched renderer can otherwise remain in LISTENING
   * while getUserMedia is rejected, which makes the tray indicator lie about
   * the actual microphone state. Unknown/not-determined states are allowed to
   * continue so the browser/Electron permission prompt can do its job.
   */
  const getMicrophonePermission = async (): Promise<string> => {
    try {
      if (!window.desktopAPI?.getCapabilities) return 'unknown'
      const capabilities = await window.desktopAPI.getCapabilities()
      return capabilities.microphonePermission || 'unknown'
    } catch (error) {
      console.warn('[VAD Manager] Could not read microphone permission:', error)
      return 'unknown'
    }
  }

  const stopAfterMicrophonePermissionFailure = (reason?: unknown) => {
    if (!isMicrophonePermissionError(reason)) return false

    // Do not let the background watcher immediately restart a session that
    // the OS has just rejected. The user can re-enable it after granting the
    // permission in system settings.
    backgroundSessionActive = false
    if (isRecordingRequested.value) isRecordingRequested.value = false
    setAudioState('IDLE')
    awaitingWakeWord.value = false
    wakeWordDetected.value = false
    generalStore.statusMessage =
      '麦克风权限未开启，后台唤醒已暂停。请在系统设置中允许 Alice 使用麦克风后重试。'
    return true
  }

  const processAudioRecording = async (audio: Float32Array) => {
    if (audioState.value !== 'LISTENING' || !audio || audio.length === 0) {
      console.warn(
        '[Audio Processing] Processing aborted (invalid state or no audio).'
      )
      isSpeechDetected.value = false
      return
    }

    if (!hasMeaningfulAudio(audio)) {
      console.log('[Audio Processing] Ignoring silent or near-silent audio.')
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      isSpeechDetected.value = false
      return
    }

    setAudioState('PROCESSING_AUDIO')

    try {
      const wavBuffer = float32ArrayToWav(audio, 16000)
      const transcription =
        await conversationStore.transcribeAudioMessage(wavBuffer)

      if (transcription && transcription.trim()) {
        if (isWakeWordModeEnabled()) {
          const { hasWakeWord, command } = parseWakeWord(
            transcription,
            settingsStore.config.localSttWakeWord,
            Date.now() < wakeSessionExpiresAt
          )

          if (hasWakeWord) {
            wakeWordDetected.value = true
            awaitingWakeWord.value = false
            wakeSessionExpiresAt = Date.now() + 8000
            scheduleWakeSessionReset()

            if (command) {
              generalStore.recognizedText = command
              eventBus.emit('processing-complete', command)
            } else {
              // Do not send the wake word itself to the assistant as a user
              // command. Keep listening for the follow-up instruction.
              generalStore.statusMessage = '已唤醒，请说出指令'
              setAudioState('LISTENING')
              generalStore.statusMessage = '已唤醒，请说出指令'
              isSpeechDetected.value = false
            }
          } else {
            console.log(
              '[Audio Processing] Wake word not detected, continuing to listen'
            )
            awaitingWakeWord.value = true
            wakeWordDetected.value = false
            setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
            isSpeechDetected.value = false
          }
        } else {
          generalStore.recognizedText = transcription
          eventBus.emit('processing-complete', transcription)
        }
      } else {
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
        isSpeechDetected.value = false
      }
    } catch (error) {
      console.error('[Audio Processing] Error during transcription:', error)
      generalStore.statusMessage = '错误：语音转写失败'
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      isSpeechDetected.value = false
    }
  }

  watch(isRecordingRequested, isRequested => {
    console.log(
      `[VAD Lifecycle] Mic request changed to: ${isRequested}. Current state: ${audioState.value}`
    )
    if (isRequested) {
      if (!myvad.value && !isVadInitializing.value) {
        initializeVAD()
      }
      if (audioState.value === 'IDLE' || audioState.value === 'CONFIG') {
        setAudioState('LISTENING')
        if (isWakeWordModeEnabled()) {
          awaitingWakeWord.value = true
          wakeWordDetected.value = false
        } else {
          awaitingWakeWord.value = false
          wakeWordDetected.value = false
        }
      }
    } else {
      destroyVAD()
      if (audioState.value === 'LISTENING') {
        setAudioState('IDLE')
      }

      awaitingWakeWord.value = false
      wakeWordDetected.value = false
      wakeSessionExpiresAt = 0
      if (wakeSessionResetTimer) {
        clearTimeout(wakeSessionResetTimer)
        wakeSessionResetTimer = null
      }
    }
  })

  const syncBackgroundListening = () => {
    const backgroundEnabled = settingsStore.config.backgroundListeningEnabled
    const canRunBackground =
      backgroundEnabled &&
      settingsStore.config.sttProvider === 'local' &&
      settingsStore.config.localSttEnabled &&
      Boolean(settingsStore.config.localSttWakeWord?.trim())

    if (backgroundEnabled && !canRunBackground) {
      generalStore.statusMessage =
        '后台监听需要本地语音识别和唤醒词，请先完成语音设置'
    }

    if (canRunBackground) {
      if (!isRecordingRequested.value) {
        backgroundSessionActive = true
        isRecordingRequested.value = true
        generalStore.statusMessage = '后台监听已开启，等待唤醒词…'
      } else if (!backgroundSessionActive) {
        // A manually started microphone session becomes a managed background
        // session as soon as the user enables the setting.
        backgroundSessionActive = true
      }
      return
    }

    if (backgroundSessionActive) {
      backgroundSessionActive = false
      if (isRecordingRequested.value) {
        isRecordingRequested.value = false
      }
    }
  }

  watch(
    [
      () => settingsStore.config.backgroundListeningEnabled,
      () => settingsStore.config.localSttEnabled,
      () => settingsStore.config.sttProvider,
      () => settingsStore.config.localSttWakeWord,
    ],
    syncBackgroundListening
  )

  const toggleRecordingRequest = () => {
    isRecordingRequested.value = !isRecordingRequested.value
    if (
      !isRecordingRequested.value &&
      backgroundSessionActive &&
      settingsStore.config.backgroundListeningEnabled
    ) {
      // Let the user pause an active background session from the avatar or the
      // global hotkey without silently re-enabling it on the next tick.
      backgroundSessionActive = false
      generalStore.statusMessage = '后台监听已暂停，点击麦克风可恢复'
    } else if (
      isRecordingRequested.value &&
      settingsStore.config.backgroundListeningEnabled
    ) {
      backgroundSessionActive = true
    }
    console.log(
      `Recording request toggled via UI: ${isRecordingRequested.value}`
    )
  }

  onUnmounted(() => {
    destroyVAD()
    if (wakeSessionResetTimer) {
      clearTimeout(wakeSessionResetTimer)
      wakeSessionResetTimer = null
    }
    if (window.aliceIPC && ownsIpcListeners) {
      window.aliceIPC.off('global-hotkey-mic-toggle', handleGlobalMicToggle)
      window.aliceIPC.off(
        'global-hotkey-mute-playback',
        handleGlobalMutePlayback
      )
      window.aliceIPC.off(
        'global-hotkey-take-screenshot',
        handleGlobalTakeScreenshot
      )
      ipcListenersRegistered = false
      ownsIpcListeners = false
    }
  })

  return {
    toggleRecordingRequest,
  }
}
