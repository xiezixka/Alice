import { ref, shallowRef, watch, onUnmounted, onMounted } from 'vue'
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
import {
  createVadLifecycleGate,
  shouldRestartVadAfterStop,
} from './vadLifecycle'

let ipcListenersRegistered = false

// Keep only the public lifecycle surface here. Vue's Ref unwraps class
// instances, which makes the private fields of MicVAD unnecessarily leak into
// the inferred type and complicates safe stale-instance cleanup.
type VadInstance = Pick<vad.MicVAD, 'start' | 'destroy'>

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

  // Keep the external MicVAD object identity intact. A deep ref would wrap
  // the class instance in a proxy, making stale-generation identity checks
  // unreliable while a stop/restart is racing.
  const myvad = shallowRef<VadInstance | null>(null)
  const isVadInitializing = ref(false)
  const isSpeechDetected = ref(false)
  const vadAssetBasePath = ref<string>('./')
  let ownsIpcListeners = false
  let backgroundSessionActive = false
  let wakeSessionExpiresAt = 0
  let wakeSessionResetTimer: ReturnType<typeof setTimeout> | null = null
  const vadLifecycle = createVadLifecycleGate()
  let vadStartPromise: Promise<void> | null = null
  let vadStopRequests = 0
  let restartAfterStop = false
  let disposed = false

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

  const clearWakeSession = () => {
    wakeSessionExpiresAt = 0
    awaitingWakeWord.value = false
    wakeWordDetected.value = false
    if (wakeSessionResetTimer) {
      clearTimeout(wakeSessionResetTimer)
      wakeSessionResetTimer = null
    }
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

  const destroyVADInstance = async (vadInstance: VadInstance) => {
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
   * Destroy only the currently-owned instance. Callers that need to change
   * the desired state should use the queued destroyVAD wrapper below; keeping
   * this primitive unqueued avoids a start operation waiting on itself.
   */
  const destroyCurrentVAD = async () => {
    const vadInstance = myvad.value
    if (!vadInstance) return
    console.log('[VAD Manager] Destroying VAD instance...')
    myvad.value = null
    await destroyVADInstance(vadInstance)
  }

  /**
   * Queue VAD startup so MicVAD.new/start can never overlap a pending destroy.
   * The `isVadInitializing` flag is set before any await (including the file
   * asset-path grace period), and the generation token prevents an obsolete
   * async result from replacing a newer user choice.
   */
  const initializeVAD = (): Promise<void> => {
    if (disposed) return Promise.resolve()

    // A standalone start request must not inherit a stale restart intent from
    // an earlier stop burst. The intent is set again only when a stop is
    // actually pending and the user asks to keep listening.
    if (vadStopRequests === 0) restartAfterStop = false

    if (myvad.value) {
      if (vadStopRequests > 0 && isRecordingRequested.value) {
        restartAfterStop = true
      }
      console.log('VAD init skipped: Already initialized.')
      return Promise.resolve()
    }

    if (vadStartPromise) {
      if (vadStopRequests > 0 && isRecordingRequested.value) {
        restartAfterStop = true
      }
      console.log('VAD init skipped: Already initializing.')
      return vadStartPromise
    }

    console.log('[VAD Manager] Initializing VAD...')
    isVadInitializing.value = true
    isSpeechDetected.value = false
    const token = vadLifecycle.begin()

    const startPromise = vadLifecycle.enqueue(async () => {
      try {
        if (
          disposed ||
          !isRecordingRequested.value ||
          !vadLifecycle.isCurrent(token)
        ) {
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
          if (
            disposed ||
            !isRecordingRequested.value ||
            !vadLifecycle.isCurrent(token)
          ) {
            return
          }
          if (vadAssetBasePath.value === './') {
            console.error(
              "[VAD Manager] CRITICAL: VAD asset path still './' in file protocol after delay. VAD will likely fail."
            )
          }
        }

        // The queue has already waited for any prior destroy. This direct
        // cleanup is intentionally not queued again.
        await destroyCurrentVAD()

        const microphonePermission = await getMicrophonePermission()
        if (
          disposed ||
          !isRecordingRequested.value ||
          !vadLifecycle.isCurrent(token)
        ) {
          return
        }
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

        // MicVAD.new is asynchronous and may finish after the user stopped or
        // after a newer lifecycle request invalidated this generation.
        if (
          disposed ||
          !isRecordingRequested.value ||
          !vadLifecycle.isCurrent(token)
        ) {
          console.log(
            '[VAD Manager] Recording changed during initialization; destroying the unused VAD instance.'
          )
          await destroyVADInstance(vadInstance)
          return
        }

        myvad.value = vadInstance
        await vadInstance.start()

        // start() can also resolve after a stop/restart request. Only destroy
        // this exact instance; never tear down a newer instance by accident.
        if (
          disposed ||
          !isRecordingRequested.value ||
          !vadLifecycle.isCurrent(token)
        ) {
          if (myvad.value === vadInstance) {
            myvad.value = null
          }
          await destroyVADInstance(vadInstance)
          return
        }

        console.log('[VAD Manager] VAD initialized and started successfully.')
      } catch (error) {
        console.error('[VAD Manager] VAD initialization failed:', error)

        // Only the instance owned by this operation may be cleaned up. A
        // queued stop/restart can already have installed a newer instance.
        await destroyCurrentVAD()

        // The user may have stopped listening while MicVAD was loading. Do not
        // overwrite that intentional stop with a stale initialization error.
        if (
          disposed ||
          !isRecordingRequested.value ||
          !vadLifecycle.isCurrent(token)
        ) {
          if (audioState.value === 'LISTENING') setAudioState('IDLE')
          isSpeechDetected.value = false
          return
        }

        if (stopAfterMicrophonePermissionFailure(error)) return

        // A failed VAD startup must not leave the recording request enabled:
        // no stream exists in this state, yet the avatar and tray would report
        // an active microphone and block a clean retry.
        const backgroundWasActive =
          backgroundSessionActive ||
          settingsStore.config.backgroundListeningEnabled === true
        backgroundSessionActive = false
        isRecordingRequested.value = false
        clearWakeSession()
        setAudioState('IDLE')
        generalStore.statusMessage = backgroundWasActive
          ? '后台监听启动失败，麦克风已停止。请检查输入设备和本地语音服务后重试。'
          : '错误：麦克风/语音检测初始化失败'
        isSpeechDetected.value = false
      } finally {
        isVadInitializing.value = false
        if (
          shouldRestartVadAfterStop({
            stopRequests: vadStopRequests,
            restartAfterStop,
            recordingRequested: isRecordingRequested.value,
            disposed,
            hasInstance: Boolean(myvad.value),
          })
        ) {
          restartAfterStop = false
          void initializeVAD()
        }
      }
    })

    vadStartPromise = startPromise
    // Use then(success, failure) rather than an ignored finally promise so a
    // rejected queue operation cannot become an unhandled rejection.
    void startPromise.then(
      () => {
        if (vadStartPromise === startPromise) vadStartPromise = null
      },
      error => {
        if (vadStartPromise === startPromise) vadStartPromise = null
        console.error('[VAD Manager] Queued VAD start failed:', error)
      }
    )
    return startPromise
  }

  /**
   * Invalidate the current generation and serialize destruction behind any
   * in-flight MicVAD.new/start operation. If a new request arrives while the
   * stop is pending, the finalizer schedules one clean restart after all stop
   * requests have settled.
   */
  const destroyVAD = (): Promise<void> => {
    vadLifecycle.invalidate()
    // An explicit stop cancels any previously queued restart intent. A later
    // true request will set it again if this stop is still in flight.
    if (!isRecordingRequested.value) restartAfterStop = false
    vadStopRequests += 1

    const stopPromise = vadLifecycle.enqueue(async () => {
      await destroyCurrentVAD()
    })

    const finishStop = () => {
      vadStopRequests = Math.max(0, vadStopRequests - 1)
      if (
        shouldRestartVadAfterStop({
          stopRequests: vadStopRequests,
          restartAfterStop,
          recordingRequested: isRecordingRequested.value,
          disposed,
          hasInstance: Boolean(myvad.value),
        })
      ) {
        restartAfterStop = false
        void initializeVAD()
      }
    }

    void stopPromise.then(finishStop, error => {
      console.error('[VAD Manager] Queued VAD destroy failed:', error)
      finishStop()
    })
    return stopPromise
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

    const backgroundWasActive =
      backgroundSessionActive ||
      settingsStore.config.backgroundListeningEnabled === true

    // Do not let the background watcher immediately restart a session that
    // the OS has just rejected. The user can re-enable it after granting the
    // permission in system settings.
    backgroundSessionActive = false
    if (isRecordingRequested.value) isRecordingRequested.value = false
    setAudioState('IDLE')
    clearWakeSession()
    generalStore.statusMessage = backgroundWasActive
      ? '麦克风权限未开启，后台唤醒已暂停。请在系统设置中允许 Alice 使用麦克风后重试。'
      : '麦克风权限未开启，语音监听已停止。请在系统设置中允许 Alice 使用麦克风后重试。'
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
      // Let initializeVAD inspect the queued-stop/initializing state itself.
      // Calling it even while a prior start is in flight records a possible
      // restart intent for a rapid false→true toggle.
      void initializeVAD()
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
      clearWakeSession()
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
    // Invalidate any in-flight MicVAD.new/start before queuing teardown so an
    // obsolete completion cannot resurrect the microphone after unmount.
    disposed = true
    vadLifecycle.invalidate()
    void destroyVAD()
    clearWakeSession()
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
