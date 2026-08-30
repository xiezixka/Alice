<template>
  <div
    data-theme="dark"
    class="fixed inset-0 bg-transparent text-base-content flex items-center justify-center"
  >
    <div
      class="w-full max-w-2xl h-full bg-gray-900 border border-gray-700 rounded-lg shadow-2xl flex flex-col"
    >
      <!-- Header -->
      <WizardHeader :title="currentStepTitle" @close="closeWizard" />

      <!-- Scrollable Content -->
      <div
        ref="scrollContainer"
        class="flex-1 overflow-y-auto overflow-x-hidden p-6"
      >
        <WelcomeStep v-if="step === 1" @next="step = 2" />
        <AIProviderStep
          v-else-if="step === 2"
          :form-data="formData"
          :test-result="testResult"
          :is-testing="isTesting"
          @test-openai="testOpenAIKey"
          @test-openrouter="testOpenRouterKey"
          @test-zai="testZAIKey"
          @test-minimax="testMiniMaxKey"
          @test-deepseek="testDeepSeekKey"
          @test-codex="testCodexAuth"
          @test-ollama="testOllamaConnection"
          @test-lmstudio="testLMStudioConnection"
          @reset-tests="resetTestResults"
        />
        <VoiceModelsStep
          v-else-if="step === 3"
          :form-data="formData"
          @toggle-local="toggleLocalModels"
        />
        <FinalSetupStep
          v-else-if="step === 4"
          :form-data="formData"
          :is-finishing="isFinishing"
          @finish="finishOnboarding"
        />
      </div>

      <!-- Footer -->
      <WizardFooter
        :step="step"
        :total-steps="4"
        :can-continue="canContinue"
        :is-finishing="isFinishing"
        @back="goBack"
        @next="goNext"
        @finish="finishOnboarding"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import {
  ref,
  reactive,
  computed,
  watch,
  nextTick,
  onMounted,
  onUnmounted,
} from 'vue'
import { useSettingsStore } from '../../stores/settingsStore'
import WizardHeader from './WizardHeader.vue'
import WizardFooter from './WizardFooter.vue'
import WelcomeStep from './steps/WelcomeStep.vue'
import AIProviderStep from './steps/AIProviderStep.vue'
import VoiceModelsStep from './steps/VoiceModelsStep.vue'
import FinalSetupStep from './steps/FinalSetupStep.vue'
import OpenAI from 'openai'
import {
  DEEPSEEK_OPENAI_BASE_URL,
  MINIMAX_OPENAI_BASE_URL,
  PROVIDER_CONFIGS,
  ZAI_CODING_BASE_URL,
  type AIProviderKey,
} from '../../services/llmProviders/providerCatalog'
import { listDeepSeekModelsForConfig } from '../../services/llmProviders/deepseek'
import { listCodexModels } from '../../services/llmProviders/codex'
import { listMiniMaxModelsForConfig } from '../../services/llmProviders/minimax'
import { listOpenAIModelsForConfig } from '../../services/llmProviders/openai'
import { listOpenRouterModelsForConfig } from '../../services/llmProviders/openrouter'
import { listZAIModelsForConfig } from '../../services/llmProviders/zai'

const step = ref(1)
const settingsStore = useSettingsStore()
const scrollContainer = ref<HTMLElement>()
const OPENAI_SUMMARIZATION_MODEL = 'gpt-5.6-luna'
const DEFAULT_MAIN_WINDOW_SIZE = {
  width: 900,
  height: 300,
}
const WIZARD_WINDOW_SIZE = {
  width: 720,
  height: 800,
}

const getDefaultModels = (provider: AIProviderKey) => {
  const assistantModel =
    PROVIDER_CONFIGS[provider]?.defaultModel ||
    PROVIDER_CONFIGS.openai.defaultModel
  const summarizationModel =
    provider === 'openai' || provider === 'openrouter'
      ? OPENAI_SUMMARIZATION_MODEL
      : assistantModel

  return {
    assistantModel,
    summarizationModel,
  }
}

// Alice is shipped as a Chinese, vision-capable desktop agent. Keep the
// first-run wizard aligned with that product configuration instead of making
// users switch away from the upstream OpenAI/cloud defaults manually.
const deepseekDefaults = getDefaultModels('deepseek')

const formData = reactive({
  VITE_OPENAI_API_KEY: '',
  VITE_OPENROUTER_API_KEY: '',
  VITE_ZAI_API_KEY: '',
  VITE_MINIMAX_API_KEY: '',
  VITE_DEEPSEEK_API_KEY: '',
  codexAuthConnected: false,
  codexAccountLabel: '',
  aiProvider: 'deepseek' as AIProviderKey,
  assistantModel: deepseekDefaults.assistantModel as string,
  summarizationModel: deepseekDefaults.summarizationModel as string,
  sttProvider: 'local' as 'openai' | 'groq' | 'google' | 'local',
  ttsProvider: 'local' as 'openai' | 'google' | 'local',
  embeddingProvider: 'local' as 'openai' | 'local',
  VITE_GROQ_API_KEY: '',
  VITE_GOOGLE_API_KEY: '',
  ollamaBaseUrl: 'http://localhost:11434',
  lmStudioBaseUrl: 'http://localhost:1234',
  zaiBaseUrl: ZAI_CODING_BASE_URL,
  minimaxBaseUrl: MINIMAX_OPENAI_BASE_URL,
  deepseekBaseUrl: DEEPSEEK_OPENAI_BASE_URL,
  useLocalModels: true,
  availableModels: [] as string[],
  localSttLanguage: 'zh',
})

const isTesting = reactive({
  openai: false,
  openrouter: false,
  zai: false,
  minimax: false,
  deepseek: false,
  codex: false,
  ollama: false,
  lmStudio: false,
})

const testResult = reactive({
  openai: { success: false, error: '' },
  openrouter: { success: false, error: '' },
  zai: { success: false, error: '' },
  minimax: { success: false, error: '' },
  deepseek: { success: false, error: '' },
  codex: { success: false, error: '' },
  ollama: { success: false, error: '' },
  lmStudio: { success: false, error: '' },
})

const isFinishing = ref(false)

const currentStepTitle = computed(() => {
  const titles = {
    1: '欢迎使用 Alice',
    2: 'AI 服务设置',
    3: '语音与记忆模式',
    4: '完成配置',
  }
  return titles[step.value as keyof typeof titles] || '设置'
})

const canContinue = computed(() => {
  switch (step.value) {
    case 1:
      return true
    case 2:
      return isCurrentProviderTested()
    case 3:
      if (formData.useLocalModels) return true

      // Check OpenAI Key requirement for non-OpenAI providers (for voice features)
      if (
        (formData.aiProvider === 'ollama' ||
          formData.aiProvider === 'lm-studio' ||
          formData.aiProvider === 'openrouter' ||
          formData.aiProvider === 'zai' ||
          formData.aiProvider === 'minimax' ||
          formData.aiProvider === 'deepseek' ||
          formData.aiProvider === 'codex') &&
        !formData.VITE_OPENAI_API_KEY.trim()
      ) {
        return false
      }

      // Check specific STT provider requirements
      if (
        formData.sttProvider === 'groq' &&
        !formData.VITE_GROQ_API_KEY.trim()
      ) {
        return false
      }
      if (
        formData.sttProvider === 'google' &&
        !formData.VITE_GOOGLE_API_KEY.trim()
      ) {
        return false
      }

      return true
    case 4:
      return true
    default:
      return false
  }
})

watch(step, async () => {
  await nextTick()
  if (scrollContainer.value) {
    scrollContainer.value.scrollTop = 0
  }
})

onMounted(() => {
  window.electron?.resize?.(WIZARD_WINDOW_SIZE)
  window.aliceIPC?.on?.('codex-auth-status-changed', handleCodexStatus)
  window.aliceIPC?.on?.('codex-auth-login-completed', handleCodexLogin)
})

onUnmounted(() => {
  window.aliceIPC?.off?.('codex-auth-status-changed', handleCodexStatus)
  window.aliceIPC?.off?.('codex-auth-login-completed', handleCodexLogin)
})

const toggleLocalModels = (useLocal: boolean) => {
  formData.useLocalModels = useLocal
  if (useLocal) {
    formData.sttProvider = 'local'
    formData.ttsProvider = 'local'
    formData.embeddingProvider = 'local'
  } else {
    formData.sttProvider = 'openai'
    formData.ttsProvider = 'openai'
    formData.embeddingProvider = 'openai'
  }
}

watch(
  () => formData.aiProvider,
  newProvider => {
    const defaults = getDefaultModels(newProvider)
    formData.assistantModel = defaults.assistantModel
    formData.summarizationModel = defaults.summarizationModel
  }
)

const fetchAvailableModels = async () => {
  try {
    let baseURL = ''
    if (formData.aiProvider === 'ollama') {
      baseURL = `${formData.ollamaBaseUrl}/v1`
    } else if (formData.aiProvider === 'lm-studio') {
      baseURL = `${formData.lmStudioBaseUrl}/v1`
    } else if (formData.aiProvider === 'zai') {
      baseURL = formData.zaiBaseUrl
    } else if (formData.aiProvider === 'minimax') {
      baseURL = formData.minimaxBaseUrl
    } else if (formData.aiProvider === 'deepseek') {
      baseURL = formData.deepseekBaseUrl
    } else if (formData.aiProvider === 'codex') {
      const models = await listCodexModels()
      formData.availableModels = models.map(model => model.id)

      if (formData.availableModels.length > 0) {
        formData.assistantModel = formData.availableModels[0]
        formData.summarizationModel = formData.availableModels[0]
      }
      return
    } else {
      return
    }

    if (formData.aiProvider === 'minimax') {
      const models = await listMiniMaxModelsForConfig(
        formData.VITE_MINIMAX_API_KEY,
        baseURL
      )
      formData.availableModels = models.map(model => model.id)

      if (formData.availableModels.length > 0) {
        formData.assistantModel = formData.availableModels[0]
        formData.summarizationModel = formData.availableModels[0]
      }
      return
    }

    if (formData.aiProvider === 'deepseek') {
      const models = await listDeepSeekModelsForConfig(
        formData.VITE_DEEPSEEK_API_KEY,
        baseURL
      )
      formData.availableModels = models.map(model => model.id)

      if (formData.availableModels.length > 0) {
        formData.assistantModel = formData.availableModels[0]
        formData.summarizationModel = formData.availableModels[0]
      }
      return
    }

    if (formData.aiProvider === 'zai') {
      const models = await listZAIModelsForConfig(
        formData.VITE_ZAI_API_KEY,
        baseURL
      )
      formData.availableModels = models.map(model => model.id)

      if (formData.availableModels.length > 0) {
        formData.assistantModel = formData.availableModels[0]
        formData.summarizationModel = formData.availableModels[0]
      }
      return
    }

    const tempClient = new OpenAI({
      apiKey: formData.aiProvider,
      baseURL,
      dangerouslyAllowBrowser: true,
    })

    const models = await tempClient.models.list()
    formData.availableModels = models.data.map(model => model.id)

    if (formData.availableModels.length > 0) {
      formData.assistantModel = formData.availableModels[0]
      formData.summarizationModel = formData.availableModels[0]
    }
  } catch (error) {
    console.error('Failed to fetch models:', error)
    formData.availableModels = []
    throw error
  }
}

const testOpenAIKey = async () => {
  if (!formData.VITE_OPENAI_API_KEY.trim()) {
    testResult.openai.error = 'API 密钥不能为空。'
    testResult.openai.success = false
    return
  }

  isTesting.openai = true
  testResult.openai.error = ''
  testResult.openai.success = false

  try {
    await listOpenAIModelsForConfig(formData.VITE_OPENAI_API_KEY)
    testResult.openai.success = true
  } catch (e: any) {
    testResult.openai.error = 'API 密钥无效或没有所需权限。'
    if (e.message?.includes('401')) {
      testResult.openai.error = 'API 密钥无效，请检查后重试。'
    } else if (e.message?.includes('429')) {
      testResult.openai.error = '请求过于频繁，请稍后重试。'
    }
  } finally {
    isTesting.openai = false
  }
}

const testOpenRouterKey = async () => {
  if (!formData.VITE_OPENROUTER_API_KEY.trim()) {
    testResult.openrouter.error = 'API 密钥不能为空。'
    testResult.openrouter.success = false
    return
  }

  isTesting.openrouter = true
  testResult.openrouter.error = ''
  testResult.openrouter.success = false

  try {
    await listOpenRouterModelsForConfig(formData.VITE_OPENROUTER_API_KEY)
    testResult.openrouter.success = true
  } catch (e: any) {
    testResult.openrouter.error = 'API 密钥无效或没有所需权限。'
    if (e.message?.includes('401')) {
      testResult.openrouter.error = 'API 密钥无效，请检查后重试。'
    } else if (e.message?.includes('429')) {
      testResult.openrouter.error = '请求过于频繁，请稍后重试。'
    }
  } finally {
    isTesting.openrouter = false
  }
}

const testZAIKey = async () => {
  if (!formData.VITE_ZAI_API_KEY.trim()) {
    testResult.zai.error = 'API 密钥不能为空。'
    testResult.zai.success = false
    return
  }
  if (!formData.zaiBaseUrl.trim()) {
    testResult.zai.error = '基础地址不能为空。'
    testResult.zai.success = false
    return
  }

  isTesting.zai = true
  testResult.zai.error = ''
  testResult.zai.success = false

  try {
    await fetchAvailableModels()
    testResult.zai.success = true
  } catch (e: any) {
    testResult.zai.error = 'API 密钥或编程套餐地址无效，或没有所需权限。'
    if (e.message?.includes('401')) {
      testResult.zai.error = 'API 密钥无效，请检查后重试。'
    } else if (e.message?.includes('429')) {
      testResult.zai.error = '请求过于频繁，请稍后重试。'
    }
  } finally {
    isTesting.zai = false
  }
}

const testMiniMaxKey = async () => {
  if (!formData.VITE_MINIMAX_API_KEY.trim()) {
    testResult.minimax.error = 'API 密钥不能为空。'
    testResult.minimax.success = false
    return
  }
  if (!formData.minimaxBaseUrl.trim()) {
    testResult.minimax.error = '基础地址不能为空。'
    testResult.minimax.success = false
    return
  }

  isTesting.minimax = true
  testResult.minimax.error = ''
  testResult.minimax.success = false

  try {
    await fetchAvailableModels()
    testResult.minimax.success = true
  } catch (e: any) {
    testResult.minimax.error =
      'API 密钥或 OpenAI 兼容地址无效，或没有所需权限。'
    if (e.message?.includes('401')) {
      testResult.minimax.error = 'API 密钥无效，请检查后重试。'
    } else if (e.message?.includes('429')) {
      testResult.minimax.error = '请求过于频繁，请稍后重试。'
    }
  } finally {
    isTesting.minimax = false
  }
}

const testDeepSeekKey = async () => {
  if (!formData.VITE_DEEPSEEK_API_KEY.trim()) {
    testResult.deepseek.error = 'API 密钥不能为空。'
    testResult.deepseek.success = false
    return
  }
  if (!formData.deepseekBaseUrl.trim()) {
    testResult.deepseek.error = '基础地址不能为空。'
    testResult.deepseek.success = false
    return
  }

  isTesting.deepseek = true
  testResult.deepseek.error = ''
  testResult.deepseek.success = false

  try {
    await fetchAvailableModels()
    testResult.deepseek.success = true
  } catch (e: any) {
    testResult.deepseek.error =
      'API 密钥或 OpenAI 兼容地址无效，或没有所需权限。'
    if (e.message?.includes('401')) {
      testResult.deepseek.error = 'API 密钥无效，请检查后重试。'
    } else if (e.message?.includes('429')) {
      testResult.deepseek.error = '请求过于频繁，请稍后重试。'
    }
  } finally {
    isTesting.deepseek = false
  }
}

const syncCodexStatus = async () => {
  const status = await window.aliceIPC.invoke('codex-auth:status')
  const connected = Boolean(status?.connected)
  formData.codexAuthConnected = connected
  formData.codexAccountLabel = connected ? status.accountLabel || '已连接' : ''
  testResult.codex.success = connected
  testResult.codex.error = connected
    ? ''
    : status?.error || 'ChatGPT Codex 尚未连接。'

  if (connected) {
    await fetchAvailableModels()
  }

  return connected
}

const testCodexAuth = async () => {
  isTesting.codex = true
  testResult.codex.error = ''
  testResult.codex.success = false

  try {
    if (await syncCodexStatus()) {
      return
    }

    const result = await window.aliceIPC.invoke('codex-auth:start-login')
    if (!result?.success) {
      testResult.codex.error = result?.error || '无法启动 ChatGPT Codex 授权。'
      return
    }

    testResult.codex.error = '浏览器授权页面已打开，请完成授权后返回 Alice。'
  } catch (e: any) {
    testResult.codex.error =
      'ChatGPT Codex 授权失败：' + (e.message || String(e))
  } finally {
    isTesting.codex = false
  }
}

function handleCodexStatus(status: any) {
  const connected = Boolean(status?.connected)
  formData.codexAuthConnected = connected
  formData.codexAccountLabel = connected ? status.accountLabel || '已连接' : ''
  testResult.codex.success = connected
  testResult.codex.error = connected
    ? ''
    : status?.error || 'ChatGPT Codex 尚未连接。'
  if (connected && formData.aiProvider === 'codex') {
    void fetchAvailableModels()
  }
}

function handleCodexLogin(payload: any) {
  if (payload?.success === false) {
    testResult.codex.success = false
    testResult.codex.error = payload?.error || 'ChatGPT Codex 授权失败。'
    return
  }
  void syncCodexStatus()
}

const testOllamaConnection = async () => {
  if (!formData.ollamaBaseUrl.trim()) {
    testResult.ollama.error = 'Ollama 基础地址不能为空。'
    testResult.ollama.success = false
    return
  }

  isTesting.ollama = true
  testResult.ollama.error = ''
  testResult.ollama.success = false

  try {
    const tempClient = new OpenAI({
      apiKey: 'ollama',
      baseURL: `${formData.ollamaBaseUrl}/v1`,
      dangerouslyAllowBrowser: true,
      timeout: 10 * 1000,
      maxRetries: 1,
    })

    await tempClient.models.list()
    testResult.ollama.success = true
    await fetchAvailableModels()
  } catch (e: any) {
    testResult.ollama.error = '连接失败，请确认 Ollama 已启动且地址可访问。'
    if (e.message?.includes('NetworkError') || e.message?.includes('fetch')) {
      testResult.ollama.error = '无法连接 Ollama 服务，请确认它正在此地址运行。'
    } else if (e.message?.includes('timeout')) {
      testResult.ollama.error = '连接超时，Ollama 可能仍在启动。'
    }
  } finally {
    isTesting.ollama = false
  }
}

const testLMStudioConnection = async () => {
  if (!formData.lmStudioBaseUrl.trim()) {
    testResult.lmStudio.error = 'LM Studio 基础地址不能为空。'
    testResult.lmStudio.success = false
    return
  }

  isTesting.lmStudio = true
  testResult.lmStudio.error = ''
  testResult.lmStudio.success = false

  try {
    const tempClient = new OpenAI({
      apiKey: 'lm-studio',
      baseURL: `${formData.lmStudioBaseUrl}/v1`,
      dangerouslyAllowBrowser: true,
      timeout: 10 * 1000,
      maxRetries: 1,
    })

    await tempClient.models.list()
    testResult.lmStudio.success = true
    await fetchAvailableModels()
  } catch (e: any) {
    testResult.lmStudio.error =
      '连接失败，请确认 LM Studio 已启动且地址可访问。'
    if (e.message?.includes('NetworkError') || e.message?.includes('fetch')) {
      testResult.lmStudio.error =
        '无法连接 LM Studio 服务，请确认它正在此地址运行。'
    } else if (e.message?.includes('timeout')) {
      testResult.lmStudio.error = '连接超时，LM Studio 可能仍在启动。'
    }
  } finally {
    isTesting.lmStudio = false
  }
}

const resetTestResults = () => {
  testResult.openai.success = false
  testResult.openai.error = ''
  testResult.openrouter.success = false
  testResult.openrouter.error = ''
  testResult.zai.success = false
  testResult.zai.error = ''
  testResult.minimax.success = false
  testResult.minimax.error = ''
  testResult.deepseek.success = false
  testResult.deepseek.error = ''
  testResult.codex.success = false
  testResult.codex.error = ''
  testResult.ollama.success = false
  testResult.ollama.error = ''
  testResult.lmStudio.success = false
  testResult.lmStudio.error = ''
}

const isCurrentProviderTested = () => {
  if (formData.aiProvider === 'openai') {
    return testResult.openai.success
  } else if (formData.aiProvider === 'openrouter') {
    return testResult.openrouter.success
  } else if (formData.aiProvider === 'zai') {
    return (
      testResult.zai.success &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  } else if (formData.aiProvider === 'minimax') {
    return (
      testResult.minimax.success &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  } else if (formData.aiProvider === 'deepseek') {
    return (
      testResult.deepseek.success &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  } else if (formData.aiProvider === 'codex') {
    return (
      testResult.codex.success &&
      formData.codexAuthConnected &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  } else if (formData.aiProvider === 'ollama') {
    return (
      testResult.ollama.success &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  } else if (formData.aiProvider === 'lm-studio') {
    return (
      testResult.lmStudio.success &&
      Boolean(formData.assistantModel) &&
      Boolean(formData.summarizationModel)
    )
  }
  return false
}

const goBack = () => {
  if (step.value > 1) {
    step.value--
  }
}

const goNext = () => {
  if (step.value < 4 && canContinue.value) {
    step.value++
  }
}

const finishOnboarding = async () => {
  isFinishing.value = true

  try {
    const success = await settingsStore.completeOnboarding(formData)
    if (!success) {
      alert('设置保存失败，请重试。')
      return
    }
    window.electron?.resize?.(DEFAULT_MAIN_WINDOW_SIZE)
  } catch (error) {
    console.error('Onboarding completion error:', error)
    alert('设置过程中发生错误，请重试。')
  } finally {
    isFinishing.value = false
  }
}

const closeWizard = () => {
  try {
    if (typeof window.electron?.closeApp === 'function') {
      window.electron.closeApp()
      return
    }

    window.aliceIPC?.send?.('close-app')
  } catch (error) {
    console.error('Failed to close onboarding wizard:', error)
  }
}
</script>
