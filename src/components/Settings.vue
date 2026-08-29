<template>
  <div class="settings-panel p-4 h-full overflow-y-auto text-white">
    <div
      v-if="settingsStore.isLoading && !settingsStore.initialLoadAttempted"
      class="text-center p-4"
    >
      <span class="loading loading-lg loading-spinner text-primary my-4"></span>
      <p>正在加载设置…</p>
    </div>

    <form @submit.prevent="handleSaveAndTestSettings" v-else class="space-y-6">
      <div class="tabs justify-between mb-6 tabs-box flex-wrap">
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'core' }"
          @click="activeTab = 'core'"
        >
          🔑 核心设置
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'assistant' }"
          @click="activeTab = 'assistant'"
        >
          🤖 AI 助手
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'memories' }"
          @click="activeTab = 'memories'"
        >
          🧠 记忆
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'hotkeys' }"
          @click="activeTab = 'hotkeys'"
        >
          ⌨️ 快捷键
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'integrations' }"
          @click="activeTab = 'integrations'"
        >
          🔌 应用与集成
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'security' }"
          @click="activeTab = 'security'"
        >
          🔒 权限
        </button>
        <button
          type="button"
          class="tab"
          :class="{ 'tab-active': activeTab === 'customization' }"
          @click="activeTab = 'customization'"
        >
          ✨ 个性化
        </button>
      </div>

      <div>
        <CoreSettingsTab
          v-if="activeTab === 'core'"
          :current-settings="currentSettings"
          @update:setting="updateCurrentSetting"
        />

        <AssistantSettingsTab
          v-if="activeTab === 'assistant'"
          :current-settings="currentSettings"
          :available-models="availableModelsForSelect"
          :available-tools="availableToolsForSelect"
          :is-refreshing-models="isRefreshingModels"
          :is-tool-configured="isToolConfigured"
          @refresh-models="refreshModels"
          @reset-system-prompt="resetSystemPrompt"
        />

        <HotkeysTab
          v-if="activeTab === 'hotkeys'"
          :current-settings="currentSettings"
          :is-recording-hotkey-for="isRecordingHotkeyFor"
          @start-recording-hotkey="startRecordingHotkey"
          @clear-hotkey="clearHotkey"
        />

        <IntegrationsTab
          v-if="activeTab === 'integrations'"
          :current-settings="currentSettings"
          :google-auth-status="googleAuthStatus"
          @connect-google-services="connectGoogleServices"
          @disconnect-google-services="disconnectGoogleServices"
        />

        <SecurityTab
          v-if="activeTab === 'security'"
          :approved-commands="settingsStore.settings.approvedCommands"
          :session-approved-commands="settingsStore.sessionApprovedCommands"
          @remove-command="removeCommand"
        />

        <MemoryManager v-if="activeTab === 'memories'" />

        <UserCustomizationTab
          v-if="activeTab === 'customization'"
          :current-settings="currentSettings"
          @update:setting="updateCurrentSetting"
        />
      </div>

      <div class="mt-8 flex flex-col sm:flex-row justify-center gap-4">
        <button
          type="submit"
          :disabled="settingsStore.isSaving"
          class="btn btn-primary btn-active w-full sm:w-auto"
        >
          <span
            v-if="settingsStore.isSaving"
            class="loading loading-spinner loading-sm"
          ></span>
          {{ settingsStore.isSaving ? '保存并测试中…' : '保存并重新加载' }}
        </button>
      </div>

      <div
        role="alert"
        class="alert alert-error mt-4"
        v-if="settingsStore.error"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{{ settingsStore.error }}</span>
      </div>
      <div
        role="alert"
        class="alert alert-success mt-4"
        v-if="settingsStore.successMessage && !settingsStore.error"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-6 w-6 shrink-0 stroke-current"
          fill="none"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
          />
        </svg>
        <span>{{ settingsStore.successMessage }}</span>
      </div>

      <p class="text-xs text-gray-400 mt-4 text-center">
        * 带星号的是核心功能所必需的设置，其余 API 密钥仅在使用对应工具时需要。
      </p>
      <div
        class="text-xs text-gray-400 mt-4 flex justify-center items-center gap-1"
      >
        <span
          >Alice
          <a
            :href="
              'https://github.com/pmbstyle/Alice/releases/tag/v' + appVersion
            "
            target="_blank"
            class="link link-hover"
            >v{{ appVersion }}</a
          >。由</span
        >
        <img :src="heartIcon" class="size-3 inline-block ml-1" />
        <span
          >制作，
          <a
            href="https://github.com/pmbstyle"
            target="_blank"
            class="link link-hover"
            >pmbstyle</a
          >
        </span>
      </div>
    </form>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useSettingsStore, type AliceSettings } from '../stores/settingsStore'
import { useConversationStore } from '../stores/conversationStore'
import { heartIcon } from '../utils/assetsImport'
import { PREDEFINED_OPENAI_TOOLS } from '../utils/assistantTools'
import { DEFAULT_ASSISTANT_PERSONA_PROMPT } from '../stores/settingsStore'
import { useHotkeyRecording } from '../composables/useHotkeyRecording'
import { useGoogleAuth } from '../composables/useGoogleAuth'
import {
  getStaticModelsForProvider,
  type ProviderModelDefinition,
} from '../services/llmProviders/providerCatalog'
import CoreSettingsTab from './settings/CoreSettingsTab.vue'
import AssistantSettingsTab from './settings/AssistantSettingsTab.vue'
import HotkeysTab from './settings/HotkeysTab.vue'
import IntegrationsTab from './settings/IntegrationsTab.vue'
import SecurityTab from './settings/SecurityTab.vue'
import UserCustomizationTab from './settings/UserCustomizationTab.vue'
import MemoryManager from './MemoryManager.vue'

const appVersion = ref(import.meta.env.VITE_APP_VERSION || '')
const settingsStore = useSettingsStore()
const conversationStore = useConversationStore()
const { settings } = storeToRefs(settingsStore)

const currentSettings = ref<AliceSettings>({
  ...settings.value,
})
const activeTab = ref<
  | 'core'
  | 'assistant'
  | 'hotkeys'
  | 'integrations'
  | 'security'
  | 'memories'
  | 'customization'
>('core')

const isRefreshingModels = ref(false)

const { availableModels } = storeToRefs(conversationStore)

const {
  isRecordingHotkeyFor,
  startRecordingHotkey: startRecordingHotkeyComposable,
  clearHotkey: clearHotkeyComposable,
} = useHotkeyRecording()

const { googleAuthStatus, connectGoogleServices, disconnectGoogleServices } =
  useGoogleAuth()

const availableToolsForSelect = computed(() => {
  return PREDEFINED_OPENAI_TOOLS.map(tool => {
    const functionDef = (tool as any).function || tool
    const toolInfo = getToolInfo(functionDef.name)
    return {
      name: functionDef.name,
      description: toolInfo.description,
      displayName: toolInfo.displayName,
    }
  }).filter(tool => tool.name)
})

const isBrowserContextToolActive = computed(() => {
  return currentSettings.value.assistantTools.includes('browser_context')
})

const availableModelsForSelect = computed(() => {
  const staticModels = getStaticModelsForProvider(
    currentSettings.value.aiProvider
  )
  if (staticModels.length > 0) {
    const staticModelIds = new Set(staticModels.map(model => model.id))
    return [
      ...staticModels.map((model: ProviderModelDefinition) => ({
        id: model.id,
      })),
      ...availableModels.value.filter(model => !staticModelIds.has(model.id)),
    ]
  }
  return availableModels.value
})

const toolDependencies: Record<string, string[]> = {
  search_torrents: ['VITE_JACKETT_API_KEY', 'VITE_JACKETT_URL'],
  add_torrent_to_qb: ['VITE_QB_URL', 'VITE_QB_USERNAME', 'VITE_QB_PASSWORD'],
  perform_web_search: ['VITE_TAVILY_API_KEY'],
  get_calendar_events: ['GOOGLE_AUTH'],
  create_calendar_event: ['GOOGLE_AUTH'],
  update_calendar_event: ['GOOGLE_AUTH'],
  delete_calendar_event: ['GOOGLE_AUTH'],
  get_unread_emails: ['GOOGLE_AUTH'],
  search_emails: ['GOOGLE_AUTH'],
  get_email_content: ['GOOGLE_AUTH'],
  create_email_draft: ['GOOGLE_AUTH'],
  reply_to_email: ['GOOGLE_AUTH'],
  send_email: ['GOOGLE_AUTH'],
  plan_itinerary: ['GOOGLE_AUTH'],
}
const refreshModels = async () => {
  if (isRefreshingModels.value) return

  isRefreshingModels.value = true
  try {
    await conversationStore.fetchModels()
  } catch (error) {
    console.error('Failed to refresh models:', error)
  } finally {
    isRefreshingModels.value = false
  }
}

function getToolInfo(name: string): {
  displayName: string
  description: string
} {
  const nameMap: Record<string, string> = {
    get_current_datetime: '当前日期与时间',
    open_path: '打开应用/网址',
    desktop_capabilities: '查看桌面操作能力',
    desktop_action: '执行桌面操作',
    manage_clipboard: '读写剪贴板',
    save_memory: '保存记忆',
    delete_memory: '删除记忆',
    recall_memories: '召回记忆',
    get_calendar_events: '获取日历事件',
    create_calendar_event: '创建日历事件',
    update_calendar_event: '更新日历事件',
    delete_calendar_event: '删除日历事件',
    get_unread_emails: '获取未读邮件',
    search_emails: '搜索邮件',
    get_email_content: '获取邮件内容',
    create_email_draft: '创建邮件草稿',
    reply_to_email: '回复邮件',
    send_email: '发送邮件',
    plan_itinerary: '规划日程草案',
    list_directory_detailed: '查看文件详细信息',
    find_files: '搜索文件',
    organize_files: '整理文件（预览/执行）',
    undo_file_organization: '撤销文件整理',
    search_torrents: '搜索种子',
    add_torrent_to_qb: '添加种子到 QB',
    perform_web_search: '网页搜索（Tavily）',
    searxng_web_search: '网页搜索（SearXNG）',
  }

  const descriptionMap: Record<string, string> = {
    get_current_datetime: '允许 Alice 获取当前日期和时间',
    open_path: '允许 Alice 打开电脑上的应用、网址、文件和文件夹',
    desktop_capabilities: '查看当前系统可用的桌面自动化动作',
    desktop_action: '在确认后点击、输入、聚焦窗口或打开应用',
    manage_clipboard: '允许 Alice 读写电脑剪贴板',
    save_memory: '允许 Alice 保存长期记忆',
    delete_memory: '允许 Alice 删除长期记忆',
    recall_memories: '允许 Alice 召回长期记忆',
    list_directory: '允许 Alice 列出电脑上的文件和文件夹',
    execute_command: '允许 Alice 在电脑上执行 Shell 命令',
    schedule_task: '允许 Alice 创建周期性任务',
    manage_scheduled_tasks: '允许 Alice 管理计划任务',
    get_calendar_events: '通过 Google 日历获取日历事件',
    create_calendar_event: '通过 Google 日历创建日历事件',
    update_calendar_event: '通过 Google 日历更新日历事件',
    delete_calendar_event: '通过 Google 日历删除日历事件',
    get_unread_emails: '通过 Google Gmail 获取未读邮件',
    search_emails: '通过 Google Gmail 搜索邮件',
    get_email_content: '通过 Google Gmail 获取邮件内容',
    create_email_draft: '通过 Google Gmail 创建可供审核的草稿',
    reply_to_email: '通过 Google Gmail 回复邮件（发送前确认）',
    send_email: '通过 Google Gmail 发送邮件（发送前确认）',
    plan_itinerary: '读取 Google 日历并生成不写入日历的行程草案',
    list_directory_detailed: '读取文件类型、大小和修改时间',
    find_files: '在授权目录中搜索文件和文件夹',
    organize_files: '预览或确认后执行移动、复制和重命名，并支持撤销',
    undo_file_organization: '撤销最近一次文件整理操作',
    search_torrents: '允许 Alice 搜索网络种子（需要 Jackett）',
    add_torrent_to_qb:
      '允许 Alice 将种子添加到 qBittorrent（需要 qBittorrent）',
    browser_context: '允许 Alice 获取浏览器当前网页信息（需要浏览器扩展）',
    perform_web_search: '为不具备网页搜索能力的模型提供搜索（Tavily）',
    searxng_web_search: '为不具备网页搜索能力的模型提供搜索（SearXNG）',
  }

  return {
    displayName:
      nameMap[name] ||
      name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
    description: descriptionMap[name] || '暂无描述',
  }
}

const resetSystemPrompt = () => {
  currentSettings.value.assistantSystemPrompt = DEFAULT_ASSISTANT_PERSONA_PROMPT
}

const startRecordingHotkey = (settingKey: keyof AliceSettings) => {
  startRecordingHotkeyComposable(settingKey, currentSettings.value)
}

const clearHotkey = (settingKey: keyof AliceSettings) => {
  clearHotkeyComposable(settingKey, currentSettings.value)
}

const updateCurrentSetting = (
  key: keyof AliceSettings,
  value: string | boolean | number | string[]
) => {
  ;(currentSettings.value as any)[key] = value
}

function isToolConfigured(toolName: string): boolean {
  const currentLocalSettings = currentSettings.value
  const deps = toolDependencies[toolName]
  if (!deps) return true

  return deps.every(depKey => {
    if (depKey === 'GOOGLE_AUTH') {
      return googleAuthStatus.isAuthenticated
    }
    const value = currentLocalSettings[depKey as keyof AliceSettings]
    if (typeof value === 'string') {
      return !!value.trim()
    }
    return !!value
  })
}

onMounted(async () => {
  if (!settingsStore.initialLoadAttempted) {
    await settingsStore.loadSettings()
  }
  currentSettings.value = { ...settings.value }

  if (
    settingsStore.coreOpenAISettingsValid &&
    conversationStore.availableModels.length === 0
  ) {
    await conversationStore.fetchModels()
  }
})

watch(
  settings,
  newSettings => {
    currentSettings.value = { ...newSettings }
  },
  { deep: true, immediate: true }
)

watch(
  currentSettings,
  newValues => {
    for (const key in newValues) {
      if (
        settingsStore.settings[key as keyof AliceSettings] !==
        newValues[key as keyof AliceSettings]
      ) {
        const value = newValues[key as keyof AliceSettings]
        if (value !== undefined) {
          settingsStore.updateSetting(key as keyof AliceSettings, value)
        }
      }
    }
  },
  { deep: true }
)

const handleSaveAndTestSettings = async () => {
  if (
    currentSettings.value.mcpServersConfig &&
    currentSettings.value.mcpServersConfig.trim() !== '' &&
    currentSettings.value.mcpServersConfig.trim() !== '[]'
  ) {
    try {
      const parsedMcpConfig = JSON.parse(currentSettings.value.mcpServersConfig)
      if (!Array.isArray(parsedMcpConfig)) {
        settingsStore.error =
          'MCP Servers Configuration must be a valid JSON array.'
        settingsStore.successMessage = null
        settingsStore.isSaving = false
        return
      }
    } catch (e) {
      settingsStore.error =
        'MCP Servers Configuration is not valid JSON. Please check for errors like trailing commas or unquoted keys.'
      settingsStore.successMessage = null
      settingsStore.isSaving = false
      return
    }
  }

  if (
    settingsStore.error &&
    settingsStore.error.startsWith('MCP Servers Configuration')
  ) {
    settingsStore.error = null
  }

  if (
    currentSettings.value.sttProvider === 'groq' &&
    !currentSettings.value.VITE_GROQ_API_KEY?.trim()
  ) {
    settingsStore.error = `Groq STT is selected, but the Groq API Key is missing.`
    settingsStore.successMessage = null
    settingsStore.isSaving = false
    return
  }

  if (
    (currentSettings.value.sttProvider === 'google' ||
      currentSettings.value.ttsProvider === 'google') &&
    !currentSettings.value.VITE_GOOGLE_API_KEY?.trim()
  ) {
    settingsStore.error = `Google is selected, but the Google API Key is missing.`
    settingsStore.successMessage = null
    settingsStore.isSaving = false
    return
  }

  await settingsStore.saveAndTestSettings()

  if (window.aliceIPC && window.location.hash === '#settings') {
    try {
      const success = !settingsStore.error && settingsStore.successMessage

      await window.aliceIPC.invoke('settings:notify-main-window', {
        type: 'settings-saved',
        success: success,
        validationComplete: true,
        settingsChanged: true,
      })
    } catch (error) {
      console.error('Failed to notify main window of settings changes:', error)
    }
  }
}

const removeCommand = async (command: string) => {
  await settingsStore.removeApprovedCommand(command)
}
</script>
