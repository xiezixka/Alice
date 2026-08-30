<template>
  <div
    class="actions-bar absolute bottom-0 py-2 z-20 flex flex-col w-full bg-black/60 no-drag"
    :class="[
      `actions-bar--${props.uiMode}`,
      { 'actions-bar--mini': isMinimized },
    ]"
  >
    <div class="pb-2 rounded-lg flex items-center justify-center gap-8">
      <img
        :src="micIconSrc"
        class="indicator capsule-control"
        :class="{ mini: isMinimized }"
        @click="!isConfigState ? emit('toggleRecording') : null"
        @keydown.enter.prevent="!isConfigState ? emit('toggleRecording') : null"
        @keydown.space.prevent="!isConfigState ? emit('toggleRecording') : null"
        data-tip="切换麦克风"
        :aria-label="micAriaLabel"
        :aria-pressed="isRecordingRequested"
        role="button"
        tabindex="0"
        :aria-disabled="isConfigState"
        draggable="false"
        alt=""
      />
      <span
        class="capsule-waveform"
        :class="{ active: waveformActive }"
        role="img"
        :aria-label="waveformAriaLabel"
      >
        <span v-for="bar in waveformBars" :key="bar" />
      </span>
      <img
        :src="props.isTTSEnabled ? speakerIcon : speakerIconInactive"
        class="indicator capsule-control"
        :class="{ mini: isMinimized }"
        @click="!isConfigState ? emit('togglePlaying') : null"
        @keydown.enter.prevent="!isConfigState ? emit('togglePlaying') : null"
        @keydown.space.prevent="!isConfigState ? emit('togglePlaying') : null"
        data-tip="切换语音播报"
        aria-label="切换语音播报"
        :aria-pressed="isTTSEnabled"
        role="button"
        tabindex="0"
        :aria-disabled="isConfigState"
        draggable="false"
        alt=""
      />
      <img
        v-if="!isMinimized"
        :src="chatIcon"
        class="indicator capsule-control"
        @click="!isConfigState ? changeSidebarView('chat') : null"
        @keydown.enter.prevent="
          !isConfigState ? changeSidebarView('chat') : null
        "
        @keydown.space.prevent="
          !isConfigState ? changeSidebarView('chat') : null
        "
        data-tip="切换聊天面板"
        aria-label="切换聊天面板"
        role="button"
        tabindex="0"
        :aria-disabled="isConfigState"
        draggable="false"
        alt=""
      />
    </div>
    <div
      class="status-message-container dragable select-none overflow-hidden whitespace-nowrap relative"
      :class="{
        'text-xs': isMinimized,
        'h-4': isMinimized,
        'h-6': !isMinimized,
      }"
      aria-live="polite"
      :title="statusMessage"
    >
      <span
        class="capsule-status-dot"
        :class="{ active: waveformActive }"
        aria-hidden="true"
      />
      <span
        :id="statusMessageId"
        class="status-message-text absolute"
        :class="{ 'scrolling-text': shouldScrollStatusMessage }"
        :style="statusMessageStyle"
      >
        {{ statusMessage }}
      </span>
      <span
        v-if="shouldScrollStatusMessage"
        class="status-message-text absolute scrolling-text"
        :style="statusMessageStyle"
        aria-hidden="true"
      >
        {{ statusMessage }}
      </span>
    </div>
  </div>

  <template v-if="props.isElectron">
    <div
      class="absolute w-full px-2 flex justify-between z-30 inside-actions inside-actions--utility no-drag"
      :class="{ 'top-[80px]': isMinimized, 'top-[220px]': !isMinimized }"
    >
      <button
        class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side tooltip tooltip-right"
        data-tip="截取屏幕"
        aria-label="截取屏幕"
        :class="{ 'btn-sm': isMinimized }"
        @click="!isConfigState ? emit('takeScreenShot') : null"
        :disabled="takingScreenShot"
      >
        <img
          :src="cameraIcon"
          class="indicator indicator-side"
          :class="{ mini: isMinimized }"
          alt=""
        />
      </button>
      <button
        class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side tooltip tooltip-left"
        :data-tip="isMinimized ? '最大化' : '最小化'"
        :aria-label="isMinimized ? '最大化窗口' : '最小化窗口'"
        :class="{ 'btn-sm': isMinimized }"
        @click="!isConfigState ? toggleMinimize() : null"
      >
        <img
          :src="isMinimized ? maxiIcon : miniIcon"
          class="indicator indicator-side"
          :class="{ mini: isMinimized }"
          alt=""
        />
      </button>
    </div>

    <div
      class="absolute w-full flex justify-center z-30 top-2 inside-actions inside-actions--menu no-drag"
    >
      <div class="dropdown dropdown-hover dropdown-center">
        <button
          tabindex="0"
          role="button"
          aria-label="应用菜单"
          class="btn btn-circle bg-opacity-20 bg-gray-500 border-0 p-2 btn-indicator-side close tooltip tooltip-bottom mb-2"
          :class="{ 'btn-sm': isMinimized }"
        >
          <img :src="hamburgerIcon" class="indicator indicator-side" alt="" />
        </button>
        <ul
          tabindex="0"
          class="dropdown-content menu bg-base-200 bg-opacity-80 rounded-box z-[1] w-36 p-2 shadow"
        >
          <li>
            <a @click="!isConfigState ? openSettingsWindow() : null">设置</a>
          </li>
          <li>
            <a @click="closeWindow">{{ closeActionLabel }}</a>
          </li>
        </ul>
      </div>
    </div>
  </template>
</template>

<script setup lang="ts">
import {
  computed,
  defineProps,
  nextTick,
  ref,
  watch,
  onMounted,
  onUnmounted,
} from 'vue'
import { useGeneralStore, AudioState } from '../stores/generalStore'
import { useSettingsStore } from '../stores/settingsStore'
import { storeToRefs } from 'pinia'
import { hasBackgroundListeningPrerequisites } from '../composables/backgroundListeningPolicy'
import {
  micIcon,
  micIconActive,
  speakerIcon,
  speakerIconInactive,
  chatIcon,
  miniIcon,
  maxiIcon,
  cameraIcon,
  hamburgerIcon,
} from '../utils/assetsImport'

const props = defineProps({
  isElectron: {
    type: Boolean,
    default: false,
  },
  isTTSEnabled: {
    type: Boolean,
    required: true,
  },
  uiMode: {
    type: String as () => 'capsule' | 'glass',
    default: 'capsule',
  },
  audioState: {
    type: String as () => AudioState,
    required: true,
  },
  // Background VAD is intentionally allowed to remain quiet in the island
  // while it waits for the wake word. A manual LISTENING session is active
  // work and must stay visible instead.
  isBackgroundWakeListening: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits([
  'takeScreenShot',
  'togglePlaying',
  'toggleRecording',
  'manualMinimize',
])

const generalStore = useGeneralStore()
const settingsStore = useSettingsStore()
const {
  isMinimized,
  statusMessage,
  openSidebar,
  takingScreenShot,
  sideBarView,
  isRecordingRequested,
  audioState: storeAudioState,
} = storeToRefs(generalStore)

const baseWindowSize = computed(() =>
  props.uiMode === 'glass'
    ? { width: 640, height: 560 }
    : { width: 900, height: 300 }
)
const SIDEBAR_WINDOW_WIDTH = 1340
const SIDEBAR_WINDOW_HEIGHT = 560
let minimizeTransitionId = 0
let pendingSidebarMinimizeTimer: ReturnType<typeof setTimeout> | null = null

const statusMessageId = ref(
  `status-msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
)

const scrollSpeedFactor = 0.1
const scrollAnimationDuration = ref('10s')

const shouldScrollStatusMessage = computed(() => {
  return statusMessage.value.length > 20
})

const statusMessageStyle = computed(() => {
  if (shouldScrollStatusMessage.value) {
    return {
      'animation-duration': scrollAnimationDuration.value,
    }
  }
  return {}
})

const calculateScrollDuration = () => {
  nextTick(() => {
    const textEl = document.getElementById(statusMessageId.value)
    if (textEl && shouldScrollStatusMessage.value) {
      const textWidth = textEl.offsetWidth
      if (textWidth > 0) {
        const duration = textWidth * scrollSpeedFactor
        scrollAnimationDuration.value = `${Math.max(3, duration).toFixed(2)}s`
      } else {
        scrollAnimationDuration.value = `${(statusMessage.value.length * 0.3 * scrollSpeedFactor * 20).toFixed(2)}s`
      }
    } else if (!shouldScrollStatusMessage.value) {
      scrollAnimationDuration.value = '0s'
    }
  })
}

watch(
  statusMessage,
  () => {
    calculateScrollDuration()
  },
  { immediate: true }
)

watch(isMinimized, () => {
  calculateScrollDuration()
})

const micIconSrc = computed(() => {
  return props.audioState === 'LISTENING' ||
    (isRecordingRequested.value && props.audioState !== 'IDLE')
    ? micIconActive
    : micIcon
})

const micAriaLabel = computed(() => {
  return isRecordingRequested.value ? '停止麦克风' : '开启麦克风'
})

const waveformBars = [1, 2, 3, 4, 5, 6, 7, 8]
const waveformActive = computed(() =>
  [
    'LISTENING',
    'PROCESSING_AUDIO',
    'WAITING_FOR_RESPONSE',
    'SPEAKING',
    'GENERATING_IMAGE',
  ].includes(props.audioState)
)
const waveformAriaLabel = computed(() =>
  waveformActive.value ? 'Alice 正在处理音频' : '音频波形待命'
)

const backgroundListeningActive = computed(
  () =>
    settingsStore.config.onboardingCompleted === true &&
    settingsStore.config.backgroundListeningEnabled === true &&
    hasBackgroundListeningPrerequisites(settingsStore.config)
)

const closeActionLabel = computed(() =>
  backgroundListeningActive.value ? '隐藏到后台' : '关闭应用'
)

const closeWindow = () => {
  if (props.isElectron) {
    ;(window as any).electron.closeApp()
  }
}

const openSettingsWindow = async () => {
  if (window.aliceIPC) {
    try {
      await window.aliceIPC.invoke('settings-window:open')
    } catch (error) {
      console.error('Failed to open settings window:', error)
    }
  }
}

const changeSidebarView = (view: 'chat' | 'settings') => {
  if (sideBarView.value === view && openSidebar.value) {
    toggleSidebar()
  } else if (sideBarView.value !== view || !openSidebar.value) {
    sideBarView.value = view
    if (!openSidebar.value) {
      if (isMinimized.value) {
        toggleMinimize()
      }
      toggleSidebar()
    }
  }
}

const toggleSidebar = async () => {
  openSidebar.value = !openSidebar.value
  if (props.isElectron) {
    await nextTick()
    const targetWidth = openSidebar.value
      ? SIDEBAR_WINDOW_WIDTH
      : baseWindowSize.value.width
    const targetHeight = openSidebar.value
      ? Math.max(baseWindowSize.value.height, SIDEBAR_WINDOW_HEIGHT)
      : baseWindowSize.value.height
    ;(window as any).electron.resize({
      width: targetWidth,
      height: targetHeight,
    })
  }
}

const toggleMinimize = async () => {
  const willMinimize = !isMinimized.value
  const macSilentEnabled =
    props.isElectron &&
    window.electron?.platform === 'darwin' &&
    settingsStore.config.macSilentModeEnabled !== false
  const isBusy = [
    'PROCESSING_AUDIO',
    'WAITING_FOR_RESPONSE',
    'SPEAKING',
    'GENERATING_IMAGE',
  ].includes(props.audioState)
  const manualListeningBusy =
    props.audioState === 'LISTENING' && !props.isBackgroundWakeListening
  // Keep an active voice turn visible.  The main renderer also expands when
  // activity starts, but rejecting this reverse transition avoids a native
  // mini→full race if the user clicks the utility control mid-response.
  if (willMinimize && macSilentEnabled && (isBusy || manualListeningBusy))
    return
  if (pendingSidebarMinimizeTimer) {
    clearTimeout(pendingSidebarMinimizeTimer)
    pendingSidebarMinimizeTimer = null
  }
  const transitionId = ++minimizeTransitionId
  emit('manualMinimize', willMinimize)
  isMinimized.value = willMinimize

  if (props.isElectron) {
    await nextTick()

    if (willMinimize && openSidebar.value) {
      toggleSidebar()
      openSidebar.value = false
      pendingSidebarMinimizeTimer = setTimeout(() => {
        pendingSidebarMinimizeTimer = null
        if (
          transitionId !== minimizeTransitionId ||
          !isMinimized.value ||
          openSidebar.value
        ) {
          return
        }
        console.log('Minimizing window after closing sidebar.')
        ;(window as any).electron.mini({
          minimize: true,
          silent:
            window.electron?.platform === 'darwin' &&
            settingsStore.config.macSilentModeEnabled !== false,
        })
      }, 300)
    } else {
      console.log(`Toggling minimize state: ${willMinimize}`)
      ;(window as any).electron.mini({
        minimize: willMinimize,
        // On macOS the native window manager places this state at the top
        // center of the display, underneath the notch-safe island treatment.
        // Keep the flag explicit while preserving compatibility with older
        // main processes that only read `minimize`.
        silent:
          willMinimize &&
          window.electron?.platform === 'darwin' &&
          settingsStore.config.macSilentModeEnabled !== false,
      })
      if (!willMinimize) {
        await nextTick()
        ;(window as any).electron.resize({
          width: openSidebar.value
            ? SIDEBAR_WINDOW_WIDTH
            : baseWindowSize.value.width,
          height: openSidebar.value
            ? Math.max(baseWindowSize.value.height, SIDEBAR_WINDOW_HEIGHT)
            : baseWindowSize.value.height,
        })
      }
    }
  }
}

const isConfigState = computed(() => {
  return storeAudioState.value === 'CONFIG'
})

onMounted(() => {
  calculateScrollDuration()
})

onUnmounted(() => {
  if (pendingSidebarMinimizeTimer) {
    clearTimeout(pendingSidebarMinimizeTimer)
    pendingSidebarMinimizeTimer = null
  }
  minimizeTransitionId += 1
})
</script>
