<template>
  <div class="space-y-6">
    <h3 class="text-xl font-semibold mb-4 text-yellow-400">全局快捷键</h3>
    <fieldset
      class="fieldset bg-gray-900/90 border-yellow-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">键盘快捷方式</legend>
      <div class="p-2 space-y-4">
        <div>
          <label for="mic-toggle-hotkey" class="block mb-1 text-sm"
            >麦克风切换快捷键</label
          >
          <div class="flex items-center justify-between">
            <kbd class="kbd kbd-xl">{{
              formatAccelerator(currentSettings.microphoneToggleHotkey)
            }}</kbd>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="
                  $emit('start-recording-hotkey', 'microphoneToggleHotkey')
                "
                class="btn btn-secondary btn-active btn-sm"
                :disabled="isRecordingHotkeyFor === 'microphoneToggleHotkey'"
              >
                {{
                  isRecordingHotkeyFor === 'microphoneToggleHotkey'
                    ? '录制中…'
                    : '录制'
                }}
              </button>
              <button
                type="button"
                @click="$emit('clear-hotkey', 'microphoneToggleHotkey')"
                class="btn btn-warning btn-outline btn-sm"
                :disabled="!currentSettings.microphoneToggleHotkey"
              >
                清除
              </button>
            </div>
          </div>
          <p
            v-if="isRecordingHotkeyFor === 'microphoneToggleHotkey'"
            class="text-xs text-yellow-400 mt-1"
          >
            请按下所需的组合键，按 Esc 取消。
          </p>
        </div>

        <div>
          <label for="mute-playback-hotkey" class="block mb-1 text-sm"
            >静音播报快捷键</label
          >
          <div class="flex items-center justify-between">
            <kbd class="kbd kbd-xl">{{
              formatAccelerator(currentSettings.mutePlaybackHotkey)
            }}</kbd>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="$emit('start-recording-hotkey', 'mutePlaybackHotkey')"
                class="btn btn-secondary btn-active btn-sm"
                :disabled="isRecordingHotkeyFor === 'mutePlaybackHotkey'"
              >
                {{
                  isRecordingHotkeyFor === 'mutePlaybackHotkey'
                    ? '录制中…'
                    : '录制'
                }}
              </button>
              <button
                type="button"
                @click="$emit('clear-hotkey', 'mutePlaybackHotkey')"
                class="btn btn-warning btn-outline btn-sm"
                :disabled="!currentSettings.mutePlaybackHotkey"
              >
                清除
              </button>
            </div>
          </div>
          <p
            v-if="isRecordingHotkeyFor === 'mutePlaybackHotkey'"
            class="text-xs text-yellow-400 mt-1"
          >
            请按下所需的组合键，按 Esc 取消。
          </p>
        </div>

        <div>
          <label for="take-screenshot-hotkey" class="block mb-1 text-sm"
            >截屏快捷键</label
          >
          <div class="flex items-center justify-between">
            <kbd class="kbd kbd-xl">{{
              formatAccelerator(currentSettings.takeScreenshotHotkey)
            }}</kbd>
            <div class="flex items-center gap-2">
              <button
                type="button"
                @click="$emit('start-recording-hotkey', 'takeScreenshotHotkey')"
                class="btn btn-secondary btn-active btn-sm"
                :disabled="isRecordingHotkeyFor === 'takeScreenshotHotkey'"
              >
                {{
                  isRecordingHotkeyFor === 'takeScreenshotHotkey'
                    ? '录制中…'
                    : '录制'
                }}
              </button>
              <button
                type="button"
                @click="$emit('clear-hotkey', 'takeScreenshotHotkey')"
                class="btn btn-warning btn-outline btn-sm"
                :disabled="!currentSettings.takeScreenshotHotkey"
              >
                清除
              </button>
            </div>
          </div>
          <p
            v-if="isRecordingHotkeyFor === 'takeScreenshotHotkey'"
            class="text-xs text-yellow-400 mt-1"
          >
            请按下所需的组合键，按 Esc 取消。
          </p>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import type { AliceSettings } from '../../stores/settingsStore'

defineProps<{
  currentSettings: AliceSettings
  isRecordingHotkeyFor: keyof AliceSettings | null
}>()

defineEmits<{
  'start-recording-hotkey': [settingKey: keyof AliceSettings]
  'clear-hotkey': [settingKey: keyof AliceSettings]
}>()

function formatAccelerator(accelerator: string | undefined): string {
  if (!accelerator) return ''
  return accelerator.replace(/\+/g, ' + ')
}
</script>
