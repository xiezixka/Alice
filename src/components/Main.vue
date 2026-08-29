<template>
  <div class="h-screen flex w-full items-center justify-start relative">
    <div
      class="avatar-wrapper flex container h-full items-center justify-center relative z-2"
      :class="{ mini: isMinimized }"
    >
      <div class="avatar" :class="{ open: openSidebar }">
        <div
          class="avatar-ring"
          :style="avatarRingStyle"
          :class="{
            'ring-green-500!': audioState === 'SPEAKING',
            'ring-cyan-500!':
              audioState === 'PROCESSING_AUDIO' ||
              audioState === 'WAITING_FOR_RESPONSE',
            'ring-blue-500!': audioState === 'LISTENING',
            'w-[200px] h-[200px]': isMinimized,
            'w-[480px] h-[480px]': !isMinimized && isElectron,
            'w-[430px] h-[430px]': !isElectron,
          }"
        >
          <audio ref="audioPlayerElement" class="hidden"></audio>
          <video
            class="max-w-screen-md rounded-full"
            :class="{
              'avatar-video-standby':
                isBuiltInAvatar &&
                (audioState === 'IDLE' || audioState === 'LISTENING'),
              'avatar-video-speaking':
                isBuiltInAvatar && audioState === 'SPEAKING',
              'avatar-video-thinking':
                isBuiltInAvatar &&
                (audioState === 'PROCESSING_AUDIO' ||
                  audioState === 'WAITING_FOR_RESPONSE'),
              'h-[200px]': isMinimized,
              'h-[480px]': !isMinimized && isElectron,
              'h-[430px]': !isElectron,
            }"
            ref="aiVideoElement"
            :src="videoSource"
            :poster="avatarFallbackImage || undefined"
            loop
            muted
            autoplay
            playsinline
          ></video>
          <img
            v-if="isBuiltInAvatar && audioState !== 'SPEAKING'"
            class="avatar-blink-layer"
            :class="{ 'is-blinking': isBlinking }"
            :src="avatarBlinkImage"
            alt=""
            aria-hidden="true"
          />
          <Actions
            @takeScreenShot="handleTakeScreenshot"
            @togglePlaying="handleToggleTTS"
            @toggleRecording="handleToggleRecording"
            :isElectron="isElectron"
            :isTTSEnabled="isTTSEnabled"
            :audioState="audioState"
          />
        </div>
      </div>
      <Sidebar @processRequest="processRequestFromSidebar" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref as vueRef } from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import Actions from './Actions.vue'
import Sidebar from './Sidebar.vue'

import { useGeneralStore } from '../stores/generalStore'
import { useCustomAvatarsStore } from '../stores/customAvatarsStore'
import { useConversationStore } from '../stores/conversationStore'
import {
  indexMessageForThoughts,
  uploadFileToOpenAI,
} from '../services/apiService'
import type { ChatMessage, AppChatMessageContentPart } from '../types/chat'
import { useAudioProcessing } from '../composables/useAudioProcessing'
import { useAudioPlayback } from '../composables/useAudioPlayback'
import { useScreenshot } from '../composables/useScreenshot'
import eventBus from '../utils/eventBus'
import avatarBlinkImage from '../assets/images/avatar-cn-blink.png'

const audioProcessing = useAudioProcessing()
const { toggleRecordingRequest } = audioProcessing
const { toggleTTSPreference } = useAudioPlayback()
const {
  screenShot,
  screenshotReady,
  takeScreenShot,
  setupScreenshotListeners,
  cleanupScreenshotListeners,
} = useScreenshot()

const generalStore = useGeneralStore()
const customAvatarsStore = useCustomAvatarsStore()
const conversationStore = useConversationStore()

const {
  audioState,
  aiVideo,
  videoSource,
  audioPlayer,
  chatInput,
  openSidebar,
  isMinimized,
  isTTSEnabled,
  isRecordingRequested,
  takingScreenShot,
  avatarFallbackImage,
} = storeToRefs(generalStore)
const { setAudioState } = generalStore

const isElectron =
  typeof window !== 'undefined' && Boolean((window as any).electron)
const audioPlayerElement = vueRef<HTMLAudioElement | null>(null)
const aiVideoElement = vueRef<HTMLVideoElement | null>(null)

const isBuiltInAvatar = computed(
  () =>
    customAvatarsStore.activeAvatar.id === customAvatarsStore.builtInAvatar.id
)

let isProcessingRequest = false
let blinkTimer: ReturnType<typeof setTimeout> | null = null
let blinkEndTimer: ReturnType<typeof setTimeout> | null = null
const isBlinking = vueRef(false)

const avatarRingStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {
    backgroundColor: '#050505',
  }
  if (avatarFallbackImage.value) {
    style.backgroundImage = `url(${avatarFallbackImage.value})`
    style.backgroundSize = 'cover'
    style.backgroundPosition = 'center'
    style.backgroundRepeat = 'no-repeat'
  }
  return style
})

const clearBlinkTimers = () => {
  if (blinkTimer) {
    clearTimeout(blinkTimer)
    blinkTimer = null
  }
  if (blinkEndTimer) {
    clearTimeout(blinkEndTimer)
    blinkEndTimer = null
  }
  isBlinking.value = false
}

const scheduleBlink = () => {
  if (blinkTimer) clearTimeout(blinkTimer)

  // A natural blink is irregular rather than a fixed CSS loop. Keep the
  // interval long enough to avoid distracting the user, with occasional
  // shorter pauses that make the avatar feel less mechanical.
  const delay = 3200 + Math.random() * 6800
  blinkTimer = setTimeout(() => {
    blinkTimer = null
    isBlinking.value = true

    const duration = 105 + Math.random() * 95
    blinkEndTimer = setTimeout(() => {
      blinkEndTimer = null
      isBlinking.value = false

      // Real people occasionally double-blink. Do this infrequently and use
      // a short pause so it reads as one natural gesture, not a loop.
      if (Math.random() < 0.16) {
        blinkTimer = setTimeout(
          () => {
            blinkTimer = null
            isBlinking.value = true
            blinkEndTimer = setTimeout(
              () => {
                blinkEndTimer = null
                isBlinking.value = false
                scheduleBlink()
              },
              90 + Math.random() * 70
            )
          },
          90 + Math.random() * 130
        )
      } else {
        scheduleBlink()
      }
    }, duration)
  }, delay)
}

onMounted(async () => {
  audioPlayer.value = audioPlayerElement.value
  aiVideo.value = aiVideoElement.value

  if (aiVideo.value) {
    aiVideo.value
      .play()
      .catch(e => console.warn('Initial video play failed:', e))
  }

  if (isElectron) {
    setupScreenshotListeners()
  }

  eventBus.on('processing-complete', handleProcessingComplete)
  eventBus.on('mute-playback-toggle', handleToggleTTS)
  eventBus.on('take-screenshot', handleTakeScreenshot)
  scheduleBlink()
})

onUnmounted(() => {
  if (isElectron) {
    cleanupScreenshotListeners()
  }
  aiVideo.value = null
  clearBlinkTimers()
  eventBus.off('processing-complete', handleProcessingComplete)
  eventBus.off('mute-playback-toggle', handleToggleTTS)
  eventBus.off('take-screenshot', handleTakeScreenshot)
})

const handleTakeScreenshot = () => {
  if (isElectron && !takingScreenShot.value) {
    takeScreenShot()
  }
}

const handleToggleTTS = () => {
  toggleTTSPreference()
}

const handleToggleRecording = () => {
  toggleRecordingRequest()
}

const handleProcessingComplete = (transcription: string) => {
  const meaningfulTranscription =
    transcription && transcription.trim().length > 1

  if (isProcessingRequest) {
    return
  }

  if (
    meaningfulTranscription &&
    (audioState.value === 'PROCESSING_AUDIO' ||
      audioState.value === 'LISTENING')
  ) {
    generalStore.recognizedText = transcription
    processRequest(transcription, 'VOICE')
  } else {
    if (
      audioState.value !== 'SPEAKING' &&
      audioState.value !== 'WAITING_FOR_RESPONSE'
    ) {
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    }
  }
}

const processRequestFromSidebar = (text: string) => {
  if (isProcessingRequest) {
    generalStore.statusMessage = '正在处理上一条请求…'
    setTimeout(() => {
      generalStore.setAudioState(audioState.value)
    }, 2000)
    return
  }
  if (text.trim() || generalStore.attachedFile) {
    if (
      audioState.value === 'IDLE' ||
      audioState.value === 'LISTENING' ||
      audioState.value === 'WAITING_FOR_RESPONSE' ||
      audioState.value === 'SPEAKING'
    ) {
      generalStore.recognizedText = ''
      processRequest(text, 'SIDEBAR_TEXT')
    } else {
      generalStore.statusMessage = '当前繁忙，请稍候…'

      setTimeout(() => {
        if (generalStore.statusMessage === '当前繁忙，请稍候…')
          generalStore.setAudioState(audioState.value)
      }, 2000)
    }
  }
}

const processRequest = async (
  text: string,
  source: 'VOICE' | 'SIDEBAR_TEXT'
) => {
  if (isProcessingRequest) {
    return
  }
  isProcessingRequest = true

  setAudioState('WAITING_FOR_RESPONSE')

  const appContentParts: AppChatMessageContentPart[] = []

  const fileToProcess = generalStore.attachedFile
  if (fileToProcess) {
    generalStore.statusMessage = `正在上传 ${fileToProcess.name}…`
    try {
      const uploadedFileId = await uploadFileToOpenAI(fileToProcess)
      if (uploadedFileId) {
        appContentParts.push({
          type: 'app_file',
          fileId: uploadedFileId,
          fileName: fileToProcess.name,
        })
      } else {
        generalStore.statusMessage = '错误：PDF 文件上传失败。'
        isProcessingRequest = false
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
        generalStore.attachedFile = null
        return
      }
    } catch (error) {
      console.error('Error uploading file:', error)
      generalStore.statusMessage = '错误：PDF 文件上传失败。'
      isProcessingRequest = false
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      generalStore.attachedFile = null
      return
    }
    generalStore.attachedFile = null
  }

  if (text) {
    appContentParts.push({ type: 'app_text', text: text })
  }

  if (screenshotReady.value && screenShot.value) {
    appContentParts.push({ type: 'app_image_uri', uri: screenShot.value })
    screenshotReady.value = false
    screenShot.value = ''
  }

  if (appContentParts.length === 0) {
    generalStore.statusMessage = '没有可发送的内容。'
    isProcessingRequest = false
    setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    return
  }

  const userMessage: ChatMessage = {
    role: 'user',
    content: appContentParts,
  }

  try {
    let userTextForIndexing = ''
    if (Array.isArray(userMessage.content)) {
      const textParts = userMessage.content
        .filter(p => p.type === 'app_text' && p.text)
        .map(p => p.text!)
      userTextForIndexing = textParts.join(' ')
    }

    if (userTextForIndexing) {
      const conversationIdForThought =
        conversationStore.currentResponseId || 'default_conversation'
      await indexMessageForThoughts(conversationIdForThought, 'user', {
        content: appContentParts,
      })
    }
  } catch (e) {
    console.error(
      '[Main.vue] Error calling indexMessageForThoughts for user message:',
      e
    )
  }

  generalStore.addMessageToHistory(userMessage)
  try {
    const chatPromise = conversationStore.chat()

    const timeoutPromise = new Promise((_, reject) => {
      let timeoutId: NodeJS.Timeout
      let hasImageGeneration = false

      const startTimeout = () => {
        timeoutId = setTimeout(() => {
          if (generalStore.audioState === 'GENERATING_IMAGE') {
            console.log(
              '[Timeout] Skipping timeout - image generation in progress'
            )
            startTimeout()
            return
          }
          reject(new Error('Chat request timeout after 90 seconds'))
        }, 90000)
      }

      const stateWatcher = () => {
        if (
          generalStore.audioState === 'GENERATING_IMAGE' &&
          !hasImageGeneration
        ) {
          console.log('[Timeout] Image generation started, disabling timeout')
          clearTimeout(timeoutId)
          hasImageGeneration = true
        }
      }

      startTimeout()
      const intervalId = setInterval(stateWatcher, 500)

      chatPromise.finally(() => {
        clearTimeout(timeoutId)
        clearInterval(intervalId)
      })
    })

    await Promise.race([chatPromise, timeoutPromise])
  } catch (e) {
    console.error(
      `[Main.vue processRequest (${source})] Error during conversationStore.chat():`,
      e
    )

    if (
      generalStore.audioState !== 'IDLE' &&
      generalStore.audioState !== 'LISTENING' &&
      generalStore.audioState !== 'GENERATING_IMAGE'
    ) {
      console.log('[Error Recovery] Resetting audio state to prevent UI lock')
      setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
    }
  } finally {
    isProcessingRequest = false

    setTimeout(() => {
      if (
        generalStore.audioState === 'WAITING_FOR_RESPONSE' ||
        generalStore.audioState === 'PROCESSING_AUDIO'
      ) {
        console.log(
          '[Safety Recovery] Detected stuck audio state, resetting to interactive mode'
        )
        setAudioState(isRecordingRequested.value ? 'LISTENING' : 'IDLE')
      }
    }, 2000)
  }
}
</script>

<style scoped lang="postcss">
.avatar-ring {
  transition: ring-color 0.3s ease-in-out;
}

.avatar-video-standby {
  animation: avatar-breathe 6.5s ease-in-out infinite;
  transform-origin: 50% 62%;
}

.avatar-video-speaking {
  animation: avatar-speaking 1.15s ease-in-out infinite;
  transform-origin: 50% 62%;
}

.avatar-video-thinking {
  animation: avatar-thinking 4.6s ease-in-out infinite;
  transform-origin: 50% 62%;
}

.avatar-blink-layer {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: inherit;
  pointer-events: none;
  opacity: 0;
  transition: opacity 72ms ease-in-out;
}

.avatar-blink-layer.is-blinking {
  opacity: 1;
  transition-duration: 84ms;
}

@keyframes avatar-breathe {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.006);
  }
}

@keyframes avatar-speaking {
  0%,
  100% {
    transform: scale(1);
  }
  50% {
    transform: scale(1.009);
  }
}

@keyframes avatar-thinking {
  0%,
  100% {
    transform: rotate(0deg) scale(1);
  }
  32% {
    transform: rotate(-1.15deg) scale(1.004);
  }
  58% {
    transform: rotate(-0.35deg) scale(1.006);
  }
  78% {
    transform: rotate(0.65deg) scale(1.003);
  }
}

@media (prefers-reduced-motion: reduce) {
  .avatar-video-standby,
  .avatar-video-speaking,
  .avatar-video-thinking,
  .avatar-blink-layer {
    animation: none;
    transition: none;
  }
}
</style>
