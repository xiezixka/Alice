import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useConversationStore } from './conversationStore'
import { useGeneralStore } from './generalStore'
import { reinitializeClients } from '../services/apiClients'
import { DEFAULT_PERSONA_PROMPT } from '../prompts/defaultPersonaPrompt'
import {
  DEEPSEEK_OPENAI_BASE_URL,
  MINIMAX_OPENAI_BASE_URL,
  PROVIDER_CONFIGS,
  ZAI_CODING_BASE_URL,
  getProviderDisplayName,
  getSafeProviderModel,
  type AIProviderKey,
} from '../services/llmProviders/providerCatalog'
import { shouldDisableBackgroundListening } from '../composables/backgroundListeningPolicy'

export const DEFAULT_ASSISTANT_PERSONA_PROMPT = DEFAULT_PERSONA_PROMPT

const DEFAULT_SUMMARIZATION_SYSTEM_PROMPT = `你是一名专业的对话摘要助手。
你的任务是对下面的对话片段生成**简洁、客观**的事实摘要。
请重点关注：
- 讨论的核心主题。
- 用户或助手分享的重要信息、事实或偏好。
- 已做出的决定。
- 尚未解决的问题或待办事项。

摘要应为后续交互提供上下文，使对话能够自然延续。
**摘要控制在 2-4 句话，且不超过 150 字。**
不要添加闲聊、评论，也不要加入“以下是摘要”等开头或结尾句，只输出对话内容的事实摘要。`

export interface AliceSettings {
  VITE_OPENAI_API_KEY: string
  VITE_OPENROUTER_API_KEY: string
  VITE_ZAI_API_KEY: string
  VITE_MINIMAX_API_KEY: string
  VITE_DEEPSEEK_API_KEY: string
  VITE_GROQ_API_KEY: string
  VITE_GOOGLE_API_KEY: string
  sttProvider: 'openai' | 'groq' | 'google' | 'local'
  aiProvider: AIProviderKey

  // Local Go Backend STT settings
  localSttModel: string
  localSttLanguage: string
  localSttEnabled: boolean
  localSttWakeWord: string
  /** Keep the microphone/VAD session alive while Alice is hidden in the tray. */
  backgroundListeningEnabled: boolean
  /** Start Alice when the current user logs in to macOS/Windows. */
  launchAtLogin: boolean

  ollamaBaseUrl: string
  lmStudioBaseUrl: string
  zaiBaseUrl: string
  minimaxBaseUrl: string
  deepseekBaseUrl: string
  codexAuthConnected: boolean
  codexAccountLabel: string

  assistantModel: string
  assistantSystemPrompt: string
  assistantTemperature: number
  assistantTopP: number
  assistantReasoningEffort: 'minimal' | 'low' | 'medium' | 'high'
  assistantVerbosity: 'low' | 'medium' | 'high'
  assistantTools: string[]
  assistantAvatar: string
  mcpServersConfig?: string
  MAX_HISTORY_MESSAGES_FOR_API: number
  SUMMARIZATION_MESSAGE_COUNT: number
  SUMMARIZATION_MODEL: string
  SUMMARIZATION_SYSTEM_PROMPT: string
  ttsProvider: 'openai' | 'google' | 'local'
  ttsVoice:
    | 'alloy'
    | 'ash'
    | 'ballad'
    | 'coral'
    | 'echo'
    | 'fable'
    | 'nova'
    | 'onyx'
    | 'sage'
    | 'shimmer'
    | 'verse'
    | 'marin'
    | 'cedar'
  googleTtsVoice: string
  localTtsVoice: string
  embeddingProvider: 'openai' | 'local'
  ragEnabled: boolean
  ragPaths: string[]
  ragTopK: number
  ragMaxContextChars: number

  microphoneToggleHotkey: string
  mutePlaybackHotkey: string
  takeScreenshotHotkey: string

  VITE_JACKETT_API_KEY: string
  VITE_JACKETT_URL: string
  VITE_QB_URL: string
  VITE_QB_USERNAME: string
  VITE_QB_PASSWORD: string

  VITE_TAVILY_API_KEY: string

  VITE_SEARXNG_URL: string
  VITE_SEARXNG_API_KEY: string

  websocketPort: number

  approvedCommands: string[]
  onboardingCompleted: boolean
}

// The current desktop bundle ships one multilingual Whisper model.  Keep the
// setting explicit so the UI and persisted configuration cannot imply that
// larger models are available when the backend always loads whisper-base.bin.
export const BUNDLED_LOCAL_STT_MODEL = 'whisper-base'

function hasMinimumConfigForOnboarding(config: AliceSettings): boolean {
  if (config.VITE_OPENAI_API_KEY?.trim()) {
    return true
  }
  if (config.VITE_OPENROUTER_API_KEY?.trim()) {
    return true
  }
  if (config.VITE_ZAI_API_KEY?.trim()) {
    return true
  }
  if (config.VITE_MINIMAX_API_KEY?.trim()) {
    return true
  }
  if (config.VITE_DEEPSEEK_API_KEY?.trim()) {
    return true
  }
  if (config.codexAuthConnected) {
    return true
  }

  if (config.aiProvider === 'ollama') {
    return Boolean(config.ollamaBaseUrl?.trim())
  }
  if (config.aiProvider === 'lm-studio') {
    return Boolean(config.lmStudioBaseUrl?.trim())
  }

  return false
}

const defaultSettings: AliceSettings = {
  VITE_OPENAI_API_KEY: '',
  VITE_OPENROUTER_API_KEY: '',
  VITE_ZAI_API_KEY: '',
  VITE_MINIMAX_API_KEY: '',
  VITE_DEEPSEEK_API_KEY: '',
  VITE_GROQ_API_KEY: '',
  VITE_GOOGLE_API_KEY: '',
  // Product defaults: Chinese local voice stack + DeepSeek vision model.
  // Local audio processing keeps background wake independent of a second
  // cloud STT key; microphone access is still opt-in at runtime.
  sttProvider: 'local',
  aiProvider: 'deepseek',

  localSttModel: 'whisper-base',
  localSttLanguage: 'zh',
  localSttEnabled: true,
  localSttWakeWord: 'alice',
  backgroundListeningEnabled: false,
  launchAtLogin: false,

  ollamaBaseUrl: 'http://localhost:11434',
  lmStudioBaseUrl: 'http://localhost:1234',
  zaiBaseUrl: ZAI_CODING_BASE_URL,
  minimaxBaseUrl: MINIMAX_OPENAI_BASE_URL,
  deepseekBaseUrl: DEEPSEEK_OPENAI_BASE_URL,
  codexAuthConnected: false,
  codexAccountLabel: '',

  assistantModel: 'deepseek-v4-flash-vision-exp',
  assistantSystemPrompt: DEFAULT_PERSONA_PROMPT,
  assistantTemperature: 0.7,
  assistantTopP: 1.0,
  assistantReasoningEffort: 'medium',
  assistantVerbosity: 'medium',
  assistantTools: [
    'get_current_datetime',
    'perform_web_search',
    'save_memory',
    'delete_memory',
    'recall_memories',
    'open_path',
    'desktop_capabilities',
    'capture_desktop_screen',
    'desktop_action',
    'list_directory_detailed',
    'find_files',
    'organize_files',
    'undo_file_organization',
    'get_calendar_events',
    'plan_itinerary',
    'create_email_draft',
  ],
  assistantAvatar: 'alice',
  mcpServersConfig: '[]',
  MAX_HISTORY_MESSAGES_FOR_API: 10,
  SUMMARIZATION_MESSAGE_COUNT: 20,
  SUMMARIZATION_MODEL: 'deepseek-v4-flash-vision-exp',
  SUMMARIZATION_SYSTEM_PROMPT: DEFAULT_SUMMARIZATION_SYSTEM_PROMPT,
  ttsProvider: 'local',
  ttsVoice: 'nova',
  googleTtsVoice: 'en-US-Journey-F',
  localTtsVoice: 'zh_CN-huayan-medium',
  embeddingProvider: 'local',
  ragEnabled: false,
  ragPaths: [],
  ragTopK: 5,
  ragMaxContextChars: 1500,

  microphoneToggleHotkey: 'Alt+M',
  mutePlaybackHotkey: 'Alt+S',
  takeScreenshotHotkey: 'Alt+C',

  VITE_JACKETT_API_KEY: '',
  VITE_JACKETT_URL: '',
  VITE_QB_URL: '',
  VITE_QB_USERNAME: '',
  VITE_QB_PASSWORD: '',

  VITE_TAVILY_API_KEY: '',

  VITE_SEARXNG_URL: '',
  VITE_SEARXNG_API_KEY: '',

  websocketPort: 5421,

  approvedCommands: ['ls', 'dir'],
  onboardingCompleted: false,
}

const settingKeyToLabelMap: Record<keyof AliceSettings, string> = {
  VITE_OPENAI_API_KEY: 'OpenAI API 密钥',
  VITE_OPENROUTER_API_KEY: 'OpenRouter API 密钥',
  VITE_ZAI_API_KEY: 'Z.ai API 密钥',
  VITE_MINIMAX_API_KEY: 'MiniMax API 密钥',
  VITE_DEEPSEEK_API_KEY: 'DeepSeek API 密钥',
  VITE_GROQ_API_KEY: 'Groq API 密钥（语音识别）',
  VITE_GOOGLE_API_KEY: 'Google API 密钥',
  sttProvider: '语音识别服务商',
  aiProvider: 'AI 服务商',

  // Local Go Backend STT labels
  localSttModel: '本地语音识别模型',
  localSttLanguage: '语言',
  localSttEnabled: '启用唤醒词',
  localSttWakeWord: '唤醒词',
  backgroundListeningEnabled: '后台语音监听',
  launchAtLogin: '开机启动 Alice',

  ollamaBaseUrl: 'Ollama 基础地址',
  lmStudioBaseUrl: 'LM Studio 基础地址',
  zaiBaseUrl: 'Z.ai 基础地址',
  minimaxBaseUrl: 'MiniMax 基础地址',
  deepseekBaseUrl: 'DeepSeek 基础地址',
  codexAuthConnected: 'ChatGPT Codex 授权',
  codexAccountLabel: 'ChatGPT Codex 账号',

  assistantModel: '助手模型',
  assistantSystemPrompt: '助手人设提示词',
  assistantTemperature: '助手温度',
  assistantTopP: '助手 Top P',
  assistantReasoningEffort: '推理力度',
  assistantVerbosity: '回复详细度',
  assistantTools: '已启用的助手工具',
  assistantAvatar: '助手形象',
  MAX_HISTORY_MESSAGES_FOR_API: 'API 最大历史消息数',
  SUMMARIZATION_MESSAGE_COUNT: '摘要消息数量',
  SUMMARIZATION_MODEL: '摘要模型',
  SUMMARIZATION_SYSTEM_PROMPT: '摘要系统提示词',
  ttsProvider: '语音播报服务商',
  ttsVoice: 'OpenAI 语音',
  googleTtsVoice: 'Google 语音',
  localTtsVoice: '本地语音',
  embeddingProvider: '向量服务商',
  ragEnabled: '启用本地文档（RAG）',
  ragPaths: '本地文档路径',
  ragTopK: '本地文档 Top K',
  ragMaxContextChars: '本地文档最大上下文字符数',
  microphoneToggleHotkey: '麦克风切换快捷键',
  mutePlaybackHotkey: '静音播报快捷键',
  takeScreenshotHotkey: '截屏快捷键',

  VITE_JACKETT_API_KEY: 'Jackett API 密钥（种子）',
  VITE_JACKETT_URL: 'Jackett 地址（种子）',
  VITE_QB_URL: 'qBittorrent 地址',
  VITE_QB_USERNAME: 'qBittorrent 用户名',
  VITE_QB_PASSWORD: 'qBittorrent 密码',

  VITE_TAVILY_API_KEY: 'Tavily API 密钥（网页搜索）',

  VITE_SEARXNG_URL: 'SearXNG 实例地址',
  VITE_SEARXNG_API_KEY: 'SearXNG API 密钥（可选）',

  websocketPort: 'WebSocket 端口',
  mcpServersConfig: 'MCP 服务 JSON 配置',
  approvedCommands: '已批准的命令',
  onboardingCompleted: '已完成首次设置',
}

const ESSENTIAL_CORE_API_KEYS: (keyof AliceSettings)[] = [
  'VITE_OPENAI_API_KEY',
  'VITE_OPENROUTER_API_KEY',
  'VITE_ZAI_API_KEY',
  'VITE_MINIMAX_API_KEY',
  'VITE_DEEPSEEK_API_KEY',
]

function requiresOpenAIKey(config: AliceSettings): boolean {
  return (
    config.aiProvider === 'openai' ||
    config.sttProvider === 'openai' ||
    config.ttsProvider === 'openai' ||
    config.embeddingProvider === 'openai'
  )
}

export const useSettingsStore = defineStore('settings', () => {
  const settings = ref<AliceSettings>({ ...defaultSettings })
  const isLoading = ref(false)
  const isSaving = ref(false)
  const error = ref<string | null>(null)
  const successMessage = ref<string | null>(null)
  const initialLoadAttempted = ref(false)
  const coreOpenAISettingsValid = ref(false)
  const sessionApprovedCommands = ref<string[]>([])

  const validateAndFixSettings = (
    loadedSettings: Partial<AliceSettings>
  ): { settings: AliceSettings; migrated: boolean } => {
    const validated = { ...defaultSettings, ...loadedSettings }
    let migrated = false

    // Migration: Handle old 'transformers' provider
    if ((validated.sttProvider as any) === 'transformers') {
      console.log(
        '🔄 Migrating settings: Converting old "transformers" provider to "local" (Go backend)'
      )
      validated.sttProvider = 'local'
      migrated = true

      // Migrate old transformers settings to new local settings
      if ((loadedSettings as any).transformersModel) {
        validated.localSttModel = (loadedSettings as any).transformersModel
        console.log(`📝 Migrated STT model: ${validated.localSttModel}`)
      }
      if ((loadedSettings as any).transformersLanguage) {
        validated.localSttLanguage = (
          loadedSettings as any
        ).transformersLanguage
        console.log(`🌐 Migrated STT language: ${validated.localSttLanguage}`)
      }
      if ((loadedSettings as any).transformersWakeWordEnabled !== undefined) {
        validated.localSttEnabled = (
          loadedSettings as any
        ).transformersWakeWordEnabled
        console.log(`🎤 Migrated STT enabled: ${validated.localSttEnabled}`)
      }
      if ((loadedSettings as any).transformersWakeWord) {
        validated.localSttWakeWord = (
          loadedSettings as any
        ).transformersWakeWord
        console.log(`🎯 Migrated wake word: ${validated.localSttWakeWord}`)
      }
      console.log('✅ Settings migration completed successfully')
    }

    const validSTTProviders = ['openai', 'groq', 'google', 'local'] as const
    if (!validSTTProviders.includes(validated.sttProvider as any)) {
      validated.sttProvider = 'openai'
    }

    const validAIProviders = [
      'openai',
      'openrouter',
      'ollama',
      'lm-studio',
      'zai',
      'minimax',
      'deepseek',
      'codex',
    ] as const
    if (!validAIProviders.includes(validated.aiProvider as any)) {
      validated.aiProvider = 'openai'
    }

    const safeAssistantModel = getSafeProviderModel(
      validated.aiProvider,
      validated.assistantModel
    )
    if (safeAssistantModel !== validated.assistantModel) {
      validated.assistantModel = safeAssistantModel
      migrated = true
    }

    const safeSummarizationModel = getSafeProviderModel(
      validated.aiProvider,
      validated.SUMMARIZATION_MODEL
    )
    if (safeSummarizationModel !== validated.SUMMARIZATION_MODEL) {
      validated.SUMMARIZATION_MODEL = safeSummarizationModel
      migrated = true
    }

    if (
      !validated.VITE_OPENAI_API_KEY?.trim() &&
      validated.aiProvider !== 'openai' &&
      validated.embeddingProvider === 'openai'
    ) {
      validated.embeddingProvider = 'local'
      migrated = true
    }

    if (!Array.isArray(validated.ragPaths)) {
      validated.ragPaths = []
      migrated = true
    }

    // New desktop-lifecycle flags were introduced after older settings files
    // shipped. Keep malformed legacy values from being treated as truthy.
    for (const key of [
      'backgroundListeningEnabled',
      'launchAtLogin',
    ] as const) {
      if (typeof validated[key] !== 'boolean') {
        validated[key] = defaultSettings[key]
        migrated = true
      }
    }

    // A persisted background-listening flag must never survive without the
    // local STT + wake-word prerequisites. Otherwise the tray and launch-at-
    // login path appear active while no valid wake session can be started.
    if (shouldDisableBackgroundListening(validated)) {
      validated.backgroundListeningEnabled = false
      migrated = true
      console.log(
        '🔇 Disabled background listening because local STT/wake-word prerequisites are missing'
      )
    }

    if (!Number.isFinite(validated.ragTopK) || validated.ragTopK < 1) {
      validated.ragTopK = defaultSettings.ragTopK
      migrated = true
    }

    if (
      !Number.isFinite(validated.ragMaxContextChars) ||
      validated.ragMaxContextChars < 300
    ) {
      validated.ragMaxContextChars = defaultSettings.ragMaxContextChars
      migrated = true
    }

    if (validated.localSttModel !== BUNDLED_LOCAL_STT_MODEL) {
      // Older builds exposed model IDs that were never wired through to the
      // Go backend. Normalize them now instead of silently claiming that a
      // different model is active, and persist the correction once.
      validated.localSttModel = BUNDLED_LOCAL_STT_MODEL
      migrated = true
    }

    return { settings: validated, migrated }
  }

  const isProduction = computed(() => import.meta.env.PROD)

  const areEssentialSettingsProvided = computed(() => {
    if (!isProduction.value) return true
    const essentialKeys: (keyof AliceSettings)[] = [
      'assistantModel',
      'SUMMARIZATION_MODEL',
    ]

    // API keys requirements based on provider
    if (settings.value.aiProvider === 'openai') {
      essentialKeys.push('VITE_OPENAI_API_KEY')
    } else if (settings.value.aiProvider === 'openrouter') {
      essentialKeys.push('VITE_OPENROUTER_API_KEY')
    } else if (settings.value.aiProvider === 'zai') {
      essentialKeys.push('VITE_ZAI_API_KEY', 'zaiBaseUrl')
    } else if (settings.value.aiProvider === 'minimax') {
      essentialKeys.push('VITE_MINIMAX_API_KEY', 'minimaxBaseUrl')
    } else if (settings.value.aiProvider === 'deepseek') {
      essentialKeys.push('VITE_DEEPSEEK_API_KEY', 'deepseekBaseUrl')
    } else if (settings.value.aiProvider === 'codex') {
      essentialKeys.push('codexAuthConnected')
    } else if (settings.value.aiProvider === 'ollama') {
      essentialKeys.push('ollamaBaseUrl')
    } else if (settings.value.aiProvider === 'lm-studio') {
      essentialKeys.push('lmStudioBaseUrl')
    }

    if (requiresOpenAIKey(settings.value)) {
      essentialKeys.push('VITE_OPENAI_API_KEY')
    }

    if (settings.value.sttProvider === 'groq') {
      essentialKeys.push('VITE_GROQ_API_KEY')
    }

    if (
      settings.value.sttProvider === 'google' ||
      settings.value.ttsProvider === 'google'
    ) {
      essentialKeys.push('VITE_GOOGLE_API_KEY')
    }

    if (settings.value.sttProvider === 'local') {
      essentialKeys.push('localSttModel')
    }

    return essentialKeys.every(key => {
      const value = settings.value[key]
      if (typeof value === 'string') return !!value.trim()
      if (typeof value === 'number') return true
      if (Array.isArray(value)) return true
      return false
    })
  })

  const areCoreApiKeysSufficientForTesting = computed(() => {
    if (!isProduction.value) return true

    const needsOpenAI = requiresOpenAIKey(settings.value)

    if (needsOpenAI && !settings.value.VITE_OPENAI_API_KEY?.trim()) {
      return false
    }

    if (settings.value.aiProvider === 'openrouter') {
      return !!settings.value.VITE_OPENROUTER_API_KEY?.trim()
    }

    if (settings.value.aiProvider === 'zai') {
      return (
        !!settings.value.VITE_ZAI_API_KEY?.trim() &&
        !!settings.value.zaiBaseUrl?.trim()
      )
    }

    if (settings.value.aiProvider === 'minimax') {
      return (
        !!settings.value.VITE_MINIMAX_API_KEY?.trim() &&
        !!settings.value.minimaxBaseUrl?.trim()
      )
    }

    if (settings.value.aiProvider === 'deepseek') {
      return (
        !!settings.value.VITE_DEEPSEEK_API_KEY?.trim() &&
        !!settings.value.deepseekBaseUrl?.trim()
      )
    }

    if (settings.value.aiProvider === 'ollama') {
      return !!settings.value.ollamaBaseUrl?.trim()
    }

    if (settings.value.aiProvider === 'lm-studio') {
      return !!settings.value.lmStudioBaseUrl?.trim()
    }

    if (settings.value.aiProvider === 'codex') {
      return settings.value.codexAuthConnected
    }

    return true
  })

  const config = computed<Readonly<AliceSettings>>(() => {
    if (isProduction.value) {
      return settings.value
    }

    const envOverrides = Object.fromEntries(
      Object.entries(import.meta.env)
        .filter(
          ([key]) =>
            key.startsWith('VITE_') ||
            key.startsWith('assistant') ||
            key === 'MAX_HISTORY_MESSAGES_FOR_API' ||
            key === 'SUMMARIZATION_MESSAGE_COUNT' ||
            key === 'SUMMARIZATION_MODEL' ||
            key === 'SUMMARIZATION_SYSTEM_PROMPT' ||
            key === 'sttProvider' ||
            key === 'aiProvider' ||
            key === 'onboardingCompleted'
        )
        .map(([key, value]) => {
          if (
            key === 'MAX_HISTORY_MESSAGES_FOR_API' ||
            key === 'SUMMARIZATION_MESSAGE_COUNT' ||
            key === 'assistantTemperature' ||
            key === 'assistantTopP' ||
            key === 'ragTopK' ||
            key === 'ragMaxContextChars'
          ) {
            return [key, parseFloat(String(value))]
          }
          if (key === 'assistantTools' && typeof value === 'string') {
            return [
              key,
              value
                .split(',')
                .map(t => t.trim())
                .filter(Boolean),
            ]
          }
          return [key, String(value)]
        })
    )

    return {
      ...defaultSettings,
      ...envOverrides,
      ...settings.value,
    }
  })

  async function loadSettings() {
    if (initialLoadAttempted.value) {
      return
    }

    initialLoadAttempted.value = true
    isLoading.value = true
    error.value = null
    successMessage.value = null
    coreOpenAISettingsValid.value = false
    try {
      if (isProduction.value) {
        const loaded = await window.settingsAPI.loadSettings()
        if (loaded) {
          const result = validateAndFixSettings(
            loaded as Partial<AliceSettings>
          )
          settings.value = result.settings
          await ensureOnboardingStateConsistency()

          let needsSave = false
          if (result.migrated) {
            needsSave = true
            console.log('💾 Automatically saving migrated settings to file')
          }

          if (
            !settings.value.onboardingCompleted &&
            settings.value.VITE_OPENAI_API_KEY?.trim()
          ) {
            settings.value.onboardingCompleted = true
            needsSave = true
          }

          if (needsSave) {
            await saveSettingsToFile()
          }
        } else {
          const result = validateAndFixSettings({})
          settings.value = result.settings
        }
      } else {
        let devCombinedSettings: AliceSettings = { ...defaultSettings }
        if (window.settingsAPI) {
          const loadedDevSettings = await window.settingsAPI.loadSettings()
          if (loadedDevSettings) {
            devCombinedSettings = {
              ...devCombinedSettings,
              ...(loadedDevSettings as Partial<AliceSettings>),
            }

            if (
              !devCombinedSettings.onboardingCompleted &&
              (loadedDevSettings as any).VITE_OPENAI_API_KEY?.trim()
            ) {
              devCombinedSettings.onboardingCompleted = true
            }
          }
        }
        for (const key of Object.keys(defaultSettings) as Array<
          keyof AliceSettings
        >) {
          if (key === 'onboardingCompleted') {
            continue
          }

          if (import.meta.env[key]) {
            const envValue = import.meta.env[key]
            if (
              key === 'assistantTemperature' ||
              key === 'assistantTopP' ||
              key === 'MAX_HISTORY_MESSAGES_FOR_API' ||
              key === 'SUMMARIZATION_MESSAGE_COUNT'
            ) {
              ;(devCombinedSettings as any)[key] = parseFloat(
                envValue as string
              )
            } else if (
              key === 'assistantTools' &&
              typeof envValue === 'string'
            ) {
              ;(devCombinedSettings as any)[key] = envValue
                .split(',')
                .map(t => t.trim())
                .filter(Boolean)
            } else {
              ;(devCombinedSettings as any)[key] = envValue
            }
          }
        }
        try {
          const result = validateAndFixSettings(devCombinedSettings)
          settings.value = result.settings

          if (result.migrated && window.settingsAPI) {
            console.log('💾 Automatically saving migrated dev settings to file')
            await saveSettingsToFile()
          }

          await ensureOnboardingStateConsistency()
        } catch (error) {
          console.error(
            '[SettingsStore] Settings validation failed, using unvalidated settings:',
            error
          )
          settings.value = devCombinedSettings as AliceSettings
        }
      }

      if (config.value.VITE_OPENAI_API_KEY) {
        try {
          const conversationStore = useConversationStore()
          await conversationStore.fetchModels()
          coreOpenAISettingsValid.value = true
        } catch (e: any) {
          console.warn(
            `[SettingsStore] Core OpenAI API key validation failed on load: ${e.message}`
          )
          coreOpenAISettingsValid.value = false
        }
      }
    } catch (e: any) {
      error.value = `加载设置失败：${e.message}`
      settings.value = { ...defaultSettings }
      coreOpenAISettingsValid.value = false
    } finally {
      isLoading.value = false
    }
  }

  async function ensureOnboardingStateConsistency() {
    if (settings.value.onboardingCompleted) {
      return
    }

    if (!hasMinimumConfigForOnboarding(settings.value)) {
      return
    }

    settings.value.onboardingCompleted = true
    try {
      await saveSettingsToFile()
    } catch (error) {
      console.warn(
        '[SettingsStore] Failed to persist onboarding completion state:',
        error
      )
    }
  }

  function updateSetting(
    key: keyof AliceSettings,
    value: string | boolean | number | string[]
  ) {
    if (
      key === 'assistantTemperature' ||
      key === 'assistantTopP' ||
      key === 'MAX_HISTORY_MESSAGES_FOR_API' ||
      key === 'SUMMARIZATION_MESSAGE_COUNT' ||
      key === 'websocketPort' ||
      key === 'ragTopK' ||
      key === 'ragMaxContextChars'
    ) {
      ;(settings.value as any)[key] = Number(value)
    } else if (
      (key === 'assistantTools' || key === 'ragPaths') &&
      Array.isArray(value)
    ) {
      settings.value[key] = value as string[]
    } else if (typeof value === 'boolean') {
      // Preserve boolean settings as booleans.  Converting them to strings
      // makes values such as "false" truthy, which can leave the microphone
      // listener or launch-at-login enabled after the user turns it off.
      ;(settings.value as any)[key] = value
    } else {
      ;(settings.value as any)[key] = String(value)
    }
    if (key === 'sttProvider') {
      settings.value[key] = value as 'openai' | 'groq' | 'google' | 'local'
    }
    if (key === 'aiProvider') {
      settings.value[key] = value as AIProviderKey
      if (settings.value.aiProvider === 'zai') {
        settings.value.assistantModel = PROVIDER_CONFIGS.zai.defaultModel
        settings.value.SUMMARIZATION_MODEL = PROVIDER_CONFIGS.zai.defaultModel
      } else if (settings.value.aiProvider === 'minimax') {
        settings.value.assistantModel = PROVIDER_CONFIGS.minimax.defaultModel
        settings.value.SUMMARIZATION_MODEL =
          PROVIDER_CONFIGS.minimax.defaultModel
      } else if (settings.value.aiProvider === 'deepseek') {
        settings.value.assistantModel = PROVIDER_CONFIGS.deepseek.defaultModel
        settings.value.SUMMARIZATION_MODEL =
          PROVIDER_CONFIGS.deepseek.defaultModel
      } else if (settings.value.aiProvider === 'codex') {
        settings.value.assistantModel = PROVIDER_CONFIGS.codex.defaultModel
        settings.value.SUMMARIZATION_MODEL = PROVIDER_CONFIGS.codex.defaultModel
      }
    }
    if (key === 'assistantReasoningEffort') {
      settings.value[key] = value as 'minimal' | 'low' | 'medium' | 'high'
    }
    if (key === 'assistantVerbosity') {
      settings.value[key] = value as 'low' | 'medium' | 'high'
    }
    if (key === 'localSttModel') {
      // Only the bundled multilingual Base model is currently available.
      // Keep accepting the generic setting key for forward compatibility, but
      // fail closed rather than persisting a model the backend cannot load.
      settings.value[key] = BUNDLED_LOCAL_STT_MODEL
    }
    if (key === 'localSttLanguage') {
      settings.value[key] = value as string
    }
    if (key === 'localSttEnabled') {
      settings.value[key] = value as boolean
    }
    if (key === 'ragEnabled') {
      settings.value[key] = value as boolean
    }
    if (key === 'ttsProvider') {
      settings.value[key] = value as 'openai' | 'google' | 'local'
    }
    if (key === 'localTtsVoice') {
      settings.value[key] = value as string
    }
    if (key === 'googleTtsVoice') {
      settings.value[key] = value as string
    }
    if (key === 'embeddingProvider') {
      settings.value[key] = value as 'openai' | 'local'
    }

    // Keep the persisted/runtime setting fail-closed when a voice prerequisite
    // is changed (including an external caller attempting to enable the flag
    // directly). The settings UI will show the corresponding notice and ask
    // the user to re-enable it after completing local voice setup.
    if (shouldDisableBackgroundListening(settings.value)) {
      settings.value.backgroundListeningEnabled = false
    }

    successMessage.value = null
    error.value = null
    if (
      key === 'VITE_OPENAI_API_KEY' ||
      key === 'VITE_OPENROUTER_API_KEY' ||
      key === 'VITE_ZAI_API_KEY' ||
      key === 'VITE_MINIMAX_API_KEY' ||
      key === 'VITE_DEEPSEEK_API_KEY' ||
      key === 'ollamaBaseUrl' ||
      key === 'lmStudioBaseUrl' ||
      key === 'zaiBaseUrl' ||
      key === 'minimaxBaseUrl' ||
      key === 'deepseekBaseUrl' ||
      key === 'codexAuthConnected' ||
      key === 'aiProvider'
    ) {
      coreOpenAISettingsValid.value = false
    }

    if (
      key === 'aiProvider' &&
      settings.value.aiProvider !== 'openai' &&
      !settings.value.VITE_OPENAI_API_KEY?.trim() &&
      settings.value.embeddingProvider === 'openai'
    ) {
      settings.value.embeddingProvider = 'local'
    }

    if (
      key === 'VITE_OPENAI_API_KEY' &&
      !settings.value.VITE_OPENAI_API_KEY?.trim() &&
      settings.value.aiProvider !== 'openai' &&
      settings.value.embeddingProvider === 'openai'
    ) {
      settings.value.embeddingProvider = 'local'
    }
  }

  async function saveSettingsToFile(): Promise<boolean> {
    if (!isProduction.value && !window.settingsAPI?.saveSettings) {
      successMessage.value =
        'Settings updated (Dev Mode - Not saved to file unless IPC available)'
      return true
    }
    isSaving.value = true
    error.value = null
    try {
      const plainSettings: AliceSettings = {
        VITE_OPENAI_API_KEY: settings.value.VITE_OPENAI_API_KEY,
        VITE_OPENROUTER_API_KEY: settings.value.VITE_OPENROUTER_API_KEY,
        VITE_ZAI_API_KEY: settings.value.VITE_ZAI_API_KEY,
        VITE_MINIMAX_API_KEY: settings.value.VITE_MINIMAX_API_KEY,
        VITE_DEEPSEEK_API_KEY: settings.value.VITE_DEEPSEEK_API_KEY,
        VITE_GROQ_API_KEY: settings.value.VITE_GROQ_API_KEY,
        VITE_GOOGLE_API_KEY: settings.value.VITE_GOOGLE_API_KEY,
        sttProvider: settings.value.sttProvider,
        aiProvider: settings.value.aiProvider,

        localSttModel: settings.value.localSttModel,
        localSttLanguage: settings.value.localSttLanguage,
        localSttEnabled: settings.value.localSttEnabled,
        localSttWakeWord: settings.value.localSttWakeWord,
        backgroundListeningEnabled: settings.value.backgroundListeningEnabled,
        launchAtLogin: settings.value.launchAtLogin,

        ollamaBaseUrl: settings.value.ollamaBaseUrl,
        lmStudioBaseUrl: settings.value.lmStudioBaseUrl,
        zaiBaseUrl: settings.value.zaiBaseUrl,
        minimaxBaseUrl: settings.value.minimaxBaseUrl,
        deepseekBaseUrl: settings.value.deepseekBaseUrl,
        codexAuthConnected: settings.value.codexAuthConnected,
        codexAccountLabel: settings.value.codexAccountLabel,
        assistantModel: settings.value.assistantModel,
        assistantSystemPrompt: settings.value.assistantSystemPrompt,
        assistantTemperature: settings.value.assistantTemperature,
        assistantTopP: settings.value.assistantTopP,
        assistantReasoningEffort: settings.value.assistantReasoningEffort,
        assistantVerbosity: settings.value.assistantVerbosity,
        assistantTools: Array.from(settings.value.assistantTools || []),
        assistantAvatar: settings.value.assistantAvatar,
        mcpServersConfig: settings.value.mcpServersConfig,
        MAX_HISTORY_MESSAGES_FOR_API:
          settings.value.MAX_HISTORY_MESSAGES_FOR_API,
        SUMMARIZATION_MESSAGE_COUNT: settings.value.SUMMARIZATION_MESSAGE_COUNT,
        SUMMARIZATION_MODEL: settings.value.SUMMARIZATION_MODEL,
        SUMMARIZATION_SYSTEM_PROMPT: settings.value.SUMMARIZATION_SYSTEM_PROMPT,
        ttsProvider: settings.value.ttsProvider,
        ttsVoice: settings.value.ttsVoice,
        googleTtsVoice: settings.value.googleTtsVoice,
        localTtsVoice: settings.value.localTtsVoice,
        embeddingProvider: settings.value.embeddingProvider,
        ragEnabled: settings.value.ragEnabled,
        ragPaths: Array.from(settings.value.ragPaths || []),
        ragTopK: settings.value.ragTopK,
        ragMaxContextChars: settings.value.ragMaxContextChars,
        microphoneToggleHotkey: settings.value.microphoneToggleHotkey,
        mutePlaybackHotkey: settings.value.mutePlaybackHotkey,
        takeScreenshotHotkey: settings.value.takeScreenshotHotkey,
        VITE_JACKETT_API_KEY: settings.value.VITE_JACKETT_API_KEY,
        VITE_JACKETT_URL: settings.value.VITE_JACKETT_URL,
        VITE_QB_URL: settings.value.VITE_QB_URL,
        VITE_QB_USERNAME: settings.value.VITE_QB_USERNAME,
        VITE_QB_PASSWORD: settings.value.VITE_QB_PASSWORD,
        VITE_TAVILY_API_KEY: settings.value.VITE_TAVILY_API_KEY,
        VITE_SEARXNG_URL: settings.value.VITE_SEARXNG_URL,
        VITE_SEARXNG_API_KEY: settings.value.VITE_SEARXNG_API_KEY,
        websocketPort: settings.value.websocketPort,
        approvedCommands: Array.from(settings.value.approvedCommands || []),
        onboardingCompleted: settings.value.onboardingCompleted,
      }

      const saveResult = await window.settingsAPI.saveSettings(plainSettings)

      if (saveResult.success) {
        isSaving.value = false
        return true
      } else {
        error.value = `保存设置文件失败：${saveResult.error || '未知错误'}`
        console.error(
          '[SettingsStore saveSettingsToFile] IPC save failed:',
          saveResult.error
        )
        isSaving.value = false
        return false
      }
    } catch (e: any) {
      error.value = `保存设置时发生错误：${e.message}`
      console.error(
        '[SettingsStore saveSettingsToFile] Exception during save:',
        e
      )
      isSaving.value = false
      return false
    }
  }

  async function saveAndTestSettings() {
    isSaving.value = true
    error.value = null
    successMessage.value = null
    const generalStore = useGeneralStore()
    const conversationStore = useConversationStore()

    const currentConfigForTest = config.value

    if (
      requiresOpenAIKey(currentConfigForTest) &&
      !currentConfigForTest.VITE_OPENAI_API_KEY?.trim()
    ) {
      error.value = `缺少必要设置：“${settingKeyToLabelMap.VITE_OPENAI_API_KEY}”。`
      generalStore.statusMessage = '需要 OpenAI API 密钥。'
      isSaving.value = false
      return
    }

    if (currentConfigForTest.aiProvider === 'openrouter') {
      if (!currentConfigForTest.VITE_OPENROUTER_API_KEY?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.VITE_OPENROUTER_API_KEY}”。`
        generalStore.statusMessage = '需要 OpenRouter API 密钥。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'zai') {
      if (!currentConfigForTest.VITE_ZAI_API_KEY?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.VITE_ZAI_API_KEY}”。`
        generalStore.statusMessage = '需要 Z.ai API 密钥。'
        isSaving.value = false
        return
      }
      if (!currentConfigForTest.zaiBaseUrl?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.zaiBaseUrl}”。`
        generalStore.statusMessage = '需要 Z.ai 基础地址。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'minimax') {
      if (!currentConfigForTest.VITE_MINIMAX_API_KEY?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.VITE_MINIMAX_API_KEY}”。`
        generalStore.statusMessage = '需要 MiniMax API 密钥。'
        isSaving.value = false
        return
      }
      if (!currentConfigForTest.minimaxBaseUrl?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.minimaxBaseUrl}”。`
        generalStore.statusMessage = '需要 MiniMax 基础地址。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'deepseek') {
      if (!currentConfigForTest.VITE_DEEPSEEK_API_KEY?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.VITE_DEEPSEEK_API_KEY}”。`
        generalStore.statusMessage = '需要 DeepSeek API 密钥。'
        isSaving.value = false
        return
      }
      if (!currentConfigForTest.deepseekBaseUrl?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.deepseekBaseUrl}”。`
        generalStore.statusMessage = '需要 DeepSeek 基础地址。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'codex') {
      if (!currentConfigForTest.codexAuthConnected) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.codexAuthConnected}”。`
        generalStore.statusMessage = '需要 ChatGPT Codex 授权。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'ollama') {
      if (!currentConfigForTest.ollamaBaseUrl?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.ollamaBaseUrl}”。`
        generalStore.statusMessage = '需要 Ollama 基础地址。'
        isSaving.value = false
        return
      }
    } else if (currentConfigForTest.aiProvider === 'lm-studio') {
      if (!currentConfigForTest.lmStudioBaseUrl?.trim()) {
        error.value = `缺少必要设置：“${settingKeyToLabelMap.lmStudioBaseUrl}”。`
        generalStore.statusMessage = '需要 LM Studio 基础地址。'
        isSaving.value = false
        return
      }
    }

    if (
      currentConfigForTest.sttProvider === 'groq' &&
      !currentConfigForTest.VITE_GROQ_API_KEY?.trim()
    ) {
      error.value = `已选择 Groq 语音识别，但缺少“${settingKeyToLabelMap.VITE_GROQ_API_KEY}”。`
      generalStore.statusMessage = 'Groq 语音识别需要 Groq API 密钥。'
      isSaving.value = false
      return
    }

    if (
      (currentConfigForTest.sttProvider === 'google' ||
        currentConfigForTest.ttsProvider === 'google') &&
      !currentConfigForTest.VITE_GOOGLE_API_KEY?.trim()
    ) {
      error.value = `已选择 Google 服务，但缺少“${settingKeyToLabelMap.VITE_GOOGLE_API_KEY}”。`
      generalStore.statusMessage = 'Google 服务需要 Google API 密钥。'
      isSaving.value = false
      return
    }

    const settingsPersistedInitially = await saveSettingsToFile()
    if (!settingsPersistedInitially) {
      generalStore.statusMessage = '错误：保存设置文件失败。'
      return
    }

    reinitializeClients()

    let openAIServiceTestSuccess = false
    try {
      await conversationStore.fetchModels()
      openAIServiceTestSuccess = true
      coreOpenAISettingsValid.value = true
    } catch (e: any) {
      const providerName = getProviderDisplayName(
        currentConfigForTest.aiProvider
      )
      error.value = `${providerName} API 连接测试失败：${e.message}。请检查 ${providerName} 配置。`
      coreOpenAISettingsValid.value = false
      openAIServiceTestSuccess = false
    }

    if (openAIServiceTestSuccess) {
      if (!currentConfigForTest.assistantModel?.trim()) {
        const providerName = getProviderDisplayName(
          currentConfigForTest.aiProvider
        )
        error.value = `${providerName} 连接有效，请选择“${settingKeyToLabelMap.assistantModel}”。`
        generalStore.statusMessage = '尚未选择助手模型。'
        successMessage.value = `${providerName} 连接有效，模型已加载，请完成模型选择。`
        isSaving.value = false
        return
      }
      if (!currentConfigForTest.SUMMARIZATION_MODEL?.trim()) {
        const providerName = getProviderDisplayName(
          currentConfigForTest.aiProvider
        )
        error.value = `${providerName} 连接有效，请选择“${settingKeyToLabelMap.SUMMARIZATION_MODEL}”。`
        generalStore.statusMessage = '尚未选择摘要模型。'
        successMessage.value = `${providerName} 连接有效，模型已加载，请完成模型选择。`
        isSaving.value = false
        return
      }

      successMessage.value = '设置校验通过并已保存！'
      if (!isProduction.value) {
        successMessage.value +=
          '（开发模式：如果未在界面配置全部设置，.env 可能会覆盖部分配置）'
      }
      generalStore.statusMessage = '正在使用新设置重新初始化 Alice…'

      if (conversationStore.isInitialized) {
        conversationStore.isInitialized = false
      }
      const initSuccess = await conversationStore.initialize()
      if (initSuccess) {
        successMessage.value += ' Alice 已就绪。'
        generalStore.setAudioState('IDLE')
      } else {
        const initErrorMsg =
          generalStore.statusMessage.includes('Error:') ||
          generalStore.statusMessage.includes('错误：')
            ? generalStore.statusMessage
            : '使用新设置重新初始化 Alice 失败。'
        error.value = (error.value ? error.value + '; ' : '') + initErrorMsg
        successMessage.value = `设置有效，但${initErrorMsg}`
      }
    } else {
      generalStore.statusMessage = '设置校验失败，请检查 API 密钥。'
    }
    isSaving.value = false
    setTimeout(() => {
      successMessage.value = null
    }, 5000)
  }

  async function completeOnboarding(onboardingData: {
    VITE_OPENAI_API_KEY: string
    VITE_OPENROUTER_API_KEY: string
    VITE_ZAI_API_KEY?: string
    VITE_MINIMAX_API_KEY?: string
    VITE_DEEPSEEK_API_KEY?: string
    sttProvider: 'openai' | 'groq' | 'google' | 'local'
    ttsProvider?: 'openai' | 'google' | 'local'
    embeddingProvider?: 'openai' | 'local'
    aiProvider: AIProviderKey
    assistantModel?: string
    summarizationModel?: string
    VITE_GROQ_API_KEY: string
    VITE_GOOGLE_API_KEY: string
    ollamaBaseUrl?: string
    lmStudioBaseUrl?: string
    zaiBaseUrl?: string
    minimaxBaseUrl?: string
    deepseekBaseUrl?: string
    useLocalModels?: boolean
    localSttLanguage?: string
  }) {
    settings.value.VITE_OPENAI_API_KEY = onboardingData.VITE_OPENAI_API_KEY
    settings.value.VITE_OPENROUTER_API_KEY =
      onboardingData.VITE_OPENROUTER_API_KEY
    settings.value.VITE_ZAI_API_KEY = onboardingData.VITE_ZAI_API_KEY || ''
    settings.value.VITE_MINIMAX_API_KEY =
      onboardingData.VITE_MINIMAX_API_KEY || ''
    settings.value.VITE_DEEPSEEK_API_KEY =
      onboardingData.VITE_DEEPSEEK_API_KEY || ''
    settings.value.sttProvider = onboardingData.sttProvider
    settings.value.aiProvider = onboardingData.aiProvider
    settings.value.VITE_GROQ_API_KEY = onboardingData.VITE_GROQ_API_KEY
    settings.value.VITE_GOOGLE_API_KEY = onboardingData.VITE_GOOGLE_API_KEY

    // Set models if provided
    if (onboardingData.assistantModel) {
      settings.value.assistantModel = onboardingData.assistantModel
    }
    if (onboardingData.summarizationModel) {
      settings.value.SUMMARIZATION_MODEL = onboardingData.summarizationModel
    }

    if (onboardingData.localSttLanguage) {
      settings.value.localSttLanguage = onboardingData.localSttLanguage
    }

    // Set TTS and embedding providers based on local models preference
    if (onboardingData.useLocalModels) {
      // Local STT is the intended path for the desktop wake-word assistant.
      // Enabling the wake-word capability does not open the microphone; the
      // separate backgroundListeningEnabled flag remains opt-in.
      settings.value.localSttEnabled = true
      if (!settings.value.localSttWakeWord?.trim()) {
        settings.value.localSttWakeWord = 'alice'
      }
      settings.value.ttsProvider = 'local'
      settings.value.embeddingProvider = 'local'
    } else {
      // Respect the user's choice from the wizard if available, otherwise default to openai
      settings.value.ttsProvider = onboardingData.ttsProvider || 'openai'
      settings.value.embeddingProvider =
        onboardingData.embeddingProvider || 'openai'
    }

    if (onboardingData.ollamaBaseUrl) {
      settings.value.ollamaBaseUrl = onboardingData.ollamaBaseUrl
    }
    if (onboardingData.lmStudioBaseUrl) {
      settings.value.lmStudioBaseUrl = onboardingData.lmStudioBaseUrl
    }
    if (onboardingData.zaiBaseUrl) {
      settings.value.zaiBaseUrl = onboardingData.zaiBaseUrl
    }
    if (onboardingData.minimaxBaseUrl) {
      settings.value.minimaxBaseUrl = onboardingData.minimaxBaseUrl
    }
    if (onboardingData.deepseekBaseUrl) {
      settings.value.deepseekBaseUrl = onboardingData.deepseekBaseUrl
    }

    settings.value.onboardingCompleted = true

    const success = await saveSettingsToFile()
    if (success) {
      reinitializeClients()
      const conversationStore = useConversationStore()
      await conversationStore.initialize()
      isSaving.value = false
    }
    return success
  }

  function addApprovedCommand(command: string) {
    const commandName = command.split(' ')[0]
    if (!settings.value.approvedCommands.includes(commandName)) {
      settings.value.approvedCommands.push(commandName)
      saveSettingsToFile()
    }
  }

  function addSessionApprovedCommand(command: string) {
    const commandName = command.split(' ')[0]
    if (!sessionApprovedCommands.value.includes(commandName)) {
      sessionApprovedCommands.value.push(commandName)
    }
  }

  function isCommandApproved(command: string): boolean {
    const commandName = command.split(' ')[0]
    return (
      settings.value.approvedCommands.includes(commandName) ||
      sessionApprovedCommands.value.includes(commandName)
    )
  }

  async function removeApprovedCommand(command: string) {
    const commandName = command.split(' ')[0]
    const index = settings.value.approvedCommands.indexOf(commandName)
    if (index > -1) {
      settings.value.approvedCommands.splice(index, 1)
      await saveSettingsToFile()
    }
  }

  return {
    settings,
    isLoading,
    isSaving,
    error,
    successMessage,
    initialLoadAttempted,
    coreOpenAISettingsValid,
    sessionApprovedCommands,
    isProduction,
    areEssentialSettingsProvided,
    areCoreApiKeysSufficientForTesting,
    config,
    loadSettings,
    updateSetting,
    saveSettingsToFile,
    saveAndTestSettings,
    completeOnboarding,
    addApprovedCommand,
    addSessionApprovedCommand,
    isCommandApproved,
    removeApprovedCommand,
  }
})
