<template>
  <div class="space-y-6">
    <h3 class="text-xl font-semibold mb-4 text-green-400">助手配置</h3>

    <fieldset
      class="fieldset bg-gray-900/90 border-green-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">模型与行为</legend>
      <div class="space-y-4 p-2">
        <div>
          <label
            for="assistant-model"
            class="block mb-1 text-sm flex items-center"
            >助手模型 *
            <div
              class="tooltip tooltip-right"
              data-tip="用于生成回复的核心模型。更强大的模型效果更好，但成本也更高。"
            >
              <img :src="infoIcon" class="size-4 ml-1" /></div
          ></label>
          <select
            id="assistant-model"
            v-model="currentSettings.assistantModel"
            class="select select-bordered w-full focus:select-primary"
          >
            <option disabled value="">选择模型</option>
            <option
              v-if="
                availableModels.length === 0 &&
                settingsStore.coreOpenAISettingsValid
              "
              value=""
            >
              正在加载模型…
            </option>
            <option
              v-for="model in availableModels"
              :key="model.id"
              :value="model.id"
            >
              {{ model.id }}
            </option>
          </select>
          <button
            type="button"
            @click="$emit('refresh-models')"
            :disabled="isRefreshingModels"
            class="btn btn-sm btn-outline btn-primary mt-2"
          >
            <span
              v-if="isRefreshingModels"
              class="loading loading-spinner loading-xs mr-2"
            ></span>
            {{ isRefreshingModels ? '加载中…' : '刷新模型' }}
          </button>
          <p
            v-if="
              !settingsStore.coreOpenAISettingsValid &&
              ((currentSettings.aiProvider === 'openai' &&
                currentSettings.VITE_OPENAI_API_KEY) ||
                (currentSettings.aiProvider === 'openrouter' &&
                  currentSettings.VITE_OPENROUTER_API_KEY) ||
                (currentSettings.aiProvider === 'zai' &&
                  currentSettings.VITE_ZAI_API_KEY &&
                  currentSettings.zaiBaseUrl) ||
                (currentSettings.aiProvider === 'minimax' &&
                  currentSettings.VITE_MINIMAX_API_KEY &&
                  currentSettings.minimaxBaseUrl) ||
                (currentSettings.aiProvider === 'deepseek' &&
                  currentSettings.VITE_DEEPSEEK_API_KEY &&
                  currentSettings.deepseekBaseUrl) ||
                (currentSettings.aiProvider === 'ollama' &&
                  currentSettings.ollamaBaseUrl) ||
                (currentSettings.aiProvider === 'lm-studio' &&
                  currentSettings.lmStudioBaseUrl)) &&
              availableModels.length === 0
            "
            class="text-xs text-warning mt-1"
          >
            {{ getProviderDisplayName(currentSettings.aiProvider) }}
            API 密钥/配置需要先校验（保存并测试）才能加载模型。
          </p>
          <div
            v-if="
              (currentSettings.assistantTools.includes(
                'capture_desktop_screen'
              ) ||
                currentSettings.assistantTools.includes('desktop_observe')) &&
              !isVisionCapableModel(
                currentSettings.aiProvider,
                currentSettings.assistantModel
              )
            "
            class="alert alert-warning mt-3 text-xs"
          >
            <span>
              当前模型不支持视觉输入，Alice
              不会把“读取当前屏幕”发送给它。请切换到 DeepSeek V4 Flash Vision
              实验版或其他视觉模型。
            </span>
          </div>
        </div>

        <div>
          <div class="flex justify-between items-center mb-1">
            <label for="assistant-system-prompt" class="block text-sm"
              >助手人设提示词</label
            >
            <button
              type="button"
              @click="$emit('reset-system-prompt')"
              class="btn btn-xs btn-ghost"
            >
              恢复默认
            </button>
          </div>
          <textarea
            id="assistant-system-prompt"
            v-model="currentSettings.assistantSystemPrompt"
            rows="8"
            class="textarea textarea-bordered w-full focus:textarea-primary h-48"
            placeholder="描述 Alice 的声音、语气和个性…"
          ></textarea>
        </div>

        <div class="rounded-box border border-cyan-400/30 bg-cyan-950/20 p-3">
          <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
            <span
              id="assistant-ui-mode-label"
              class="block text-sm font-semibold"
              >主界面样式</span
            >
            <span class="text-xs text-gray-400"
              >也可在主窗口右上角即时切换</span
            >
          </div>
          <div
            id="assistant-ui-mode"
            class="grid grid-cols-1 sm:grid-cols-2 gap-3"
            role="radiogroup"
            aria-label="主界面样式"
            aria-labelledby="assistant-ui-mode-label"
          >
            <label
              v-for="option in uiModeOptions"
              :key="option.value"
              class="flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors"
              :class="
                currentSettings.assistantUiMode === option.value
                  ? 'border-cyan-300 bg-cyan-400/15'
                  : 'border-gray-700 bg-gray-800/60 hover:border-gray-500'
              "
            >
              <input
                v-model="currentSettings.assistantUiMode"
                type="radio"
                name="assistant-ui-mode"
                :value="option.value"
                class="radio radio-info radio-sm mt-0.5"
              />
              <span>
                <span class="block text-sm font-semibold text-white">{{
                  option.label
                }}</span>
                <span class="mt-1 block text-xs leading-5 text-gray-300">{{
                  option.description
                }}</span>
              </span>
            </label>
          </div>
          <p class="mt-2 text-xs text-gray-400">
            胶囊模式更轻量；玻璃卡片模式会展示更多状态和上下文。保存后下次启动继续使用你的选择。
          </p>
        </div>

        <div
          v-if="isMacDesktop"
          class="rounded-box border border-indigo-400/30 bg-indigo-950/20 p-3"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <label
                for="mac-silent-mode"
                class="block text-sm font-semibold text-white"
              >
                macOS 静默灵动岛
              </label>
              <p class="mt-1 text-xs leading-5 text-gray-300">
                待命约 2.2 秒后，或点击主窗口的最小化后，Alice
                会收纳到屏幕顶部的窄胶囊中，可用鼠标左右拖动调整位置；后台登录启动会不抢焦点地显示一次。开始录音、识别、思考或播报时会自动展开。点击胶囊即可恢复完整界面。此功能仅在
                macOS 生效，默认开启。
              </p>
            </div>
            <input
              id="mac-silent-mode"
              type="checkbox"
              class="toggle toggle-info mt-1 shrink-0"
              :checked="currentSettings.macSilentModeEnabled"
              @change="handleMacSilentModeChange"
            />
          </div>
        </div>

        <div
          v-if="currentSettings.assistantModel.startsWith('gpt-5')"
          class="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div>
            <label
              for="reasoning-effort"
              class="block mb-1 text-sm flex items-center"
              >推理力度
              <div
                class="tooltip tooltip-right"
                data-tip="控制模型在生成回复前使用的推理令牌数量。力度越高，推理越充分，但成本和延迟也会增加。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <select
              id="reasoning-effort"
              v-model="currentSettings.assistantReasoningEffort"
              class="select select-bordered w-full focus:select-primary"
            >
              <option value="minimal">最低（最快）</option>
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高（最充分）</option>
            </select>
          </div>
          <div>
            <label
              for="response-verbosity"
              class="block mb-1 text-sm flex items-center"
              >回复详细度
              <div
                class="tooltip tooltip-left"
                data-tip="控制模型回复的详细程度。详细度越高，解释越充分，但令牌用量也会增加。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <select
              id="response-verbosity"
              v-model="currentSettings.assistantVerbosity"
              class="select select-bordered w-full focus:select-primary"
            >
              <option value="low">低（简洁）</option>
              <option value="medium">中</option>
              <option value="high">高（详细）</option>
            </select>
          </div>
        </div>

        <div
          v-if="
            !currentSettings.assistantModel.startsWith('gpt-5') &&
            !currentSettings.assistantModel.startsWith('o')
          "
          class="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          <div>
            <label
              for="assistant-temperature"
              class="block mb-1 text-sm flex items-center"
            >
              助手温度（{{ currentSettings.assistantTemperature.toFixed(1) }}）
              <div
                class="tooltip tooltip-right"
                data-tip="控制 AI 回复的随机性。数值越高（如 0.8）越有创意，数值越低（如 0.2）越稳定。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <input
              id="assistant-temperature"
              type="range"
              min="0"
              max="2"
              step="0.1"
              v-model.number="currentSettings.assistantTemperature"
              class="range range-primary"
            />
          </div>
          <div>
            <label
              for="assistant-top-p"
              class="block mb-1 text-sm flex items-center"
            >
              助手 Top P（{{ currentSettings.assistantTopP.toFixed(1) }}）
              <div
                class="tooltip tooltip-left"
                data-tip="温度采样的替代参数，模型只考虑累计概率达到 top-p 的令牌。例如 0.1 表示只考虑概率最高的 10%。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <input
              id="assistant-top-p"
              type="range"
              min="0"
              max="1"
              step="0.1"
              v-model.number="currentSettings.assistantTopP"
              class="range range-success"
            />
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset
      class="fieldset bg-gray-900/90 border-green-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">上下文与记忆</legend>
      <div class="space-y-4 p-2">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label
              for="max-history-messages"
              class="block mb-1 text-sm flex items-center"
              >API 最大历史消息数
              <div
                class="tooltip tooltip-right"
                data-tip="发送给 AI 的最近消息数量。数量越多，上下文越丰富，但成本也越高。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <input
              id="max-history-messages"
              type="number"
              min="1"
              max="50"
              step="1"
              v-model.number="currentSettings.MAX_HISTORY_MESSAGES_FOR_API"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
          <div>
            <label
              for="summarization-messages"
              class="block mb-1 text-sm flex items-center"
              >摘要消息数量
              <div
                class="tooltip tooltip-left"
                data-tip="用于生成摘要的消息数量，帮助 AI 在更长时间内记住对话内容。"
              >
                <img :src="infoIcon" class="size-4 ml-1" /></div
            ></label>
            <input
              id="summarization-messages"
              type="number"
              min="5"
              max="100"
              step="1"
              v-model.number="currentSettings.SUMMARIZATION_MESSAGE_COUNT"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
        </div>
        <div>
          <label
            for="summarization-model"
            class="block mb-1 text-sm flex items-center"
            >摘要模型 *
            <div
              class="tooltip tooltip-right"
              data-tip="用于总结对话的 AI 模型，建议使用更小、更快的模型。"
            >
              <img :src="infoIcon" class="size-4 ml-1" /></div
          ></label>
          <select
            id="summarization-model"
            v-model="currentSettings.SUMMARIZATION_MODEL"
            class="select select-bordered w-full focus:select-primary"
          >
            <option disabled value="">选择摘要模型</option>
            <option
              v-if="
                availableModels.length === 0 &&
                settingsStore.coreOpenAISettingsValid
              "
              value=""
            >
              正在加载模型…
            </option>
            <option
              v-for="model in availableModels"
              :key="`summ-${model.id}`"
              :value="model.id"
            >
              {{ model.id }}
            </option>
          </select>
          <p
            v-if="
              !settingsStore.coreOpenAISettingsValid &&
              ((currentSettings.aiProvider === 'openai' &&
                currentSettings.VITE_OPENAI_API_KEY) ||
                (currentSettings.aiProvider === 'openrouter' &&
                  currentSettings.VITE_OPENROUTER_API_KEY) ||
                (currentSettings.aiProvider === 'zai' &&
                  currentSettings.VITE_ZAI_API_KEY &&
                  currentSettings.zaiBaseUrl) ||
                (currentSettings.aiProvider === 'minimax' &&
                  currentSettings.VITE_MINIMAX_API_KEY &&
                  currentSettings.minimaxBaseUrl) ||
                (currentSettings.aiProvider === 'deepseek' &&
                  currentSettings.VITE_DEEPSEEK_API_KEY &&
                  currentSettings.deepseekBaseUrl) ||
                (currentSettings.aiProvider === 'ollama' &&
                  currentSettings.ollamaBaseUrl) ||
                (currentSettings.aiProvider === 'lm-studio' &&
                  currentSettings.lmStudioBaseUrl)) &&
              availableModels.length === 0
            "
            class="text-xs text-warning mt-1"
          >
            {{ getProviderDisplayName(currentSettings.aiProvider) }}
            API 密钥/配置需要先校验（保存并测试）才能加载模型。
          </p>
          <p class="text-xs text-gray-400 mt-1">
            用于生成对话摘要的模型（例如 gpt-5.6-luna）。
          </p>
        </div>

        <div>
          <label for="summarization-system-prompt" class="block mb-1 text-sm"
            >摘要系统提示词</label
          >
          <textarea
            id="summarization-system-prompt"
            v-model="currentSettings.SUMMARIZATION_SYSTEM_PROMPT"
            rows="6"
            class="textarea textarea-bordered w-full focus:textarea-primary h-40"
            placeholder="你是一名专业的对话摘要助手…"
          ></textarea>
          <p class="text-xs text-gray-400 mt-1">
            用于指导摘要模型的系统提示词。
          </p>
        </div>
      </div>
    </fieldset>

    <fieldset
      class="fieldset bg-gray-900/90 border-green-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">已启用工具</legend>
      <div class="space-y-4 p-2">
        <div>
          <div
            class="space-y-2 p-3 border border-neutral-content/20 rounded-md bg-gray-800/50"
          >
            <div
              class="mb-3 flex flex-col gap-2 rounded-md border border-cyan-500/30 bg-cyan-950/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-semibold text-cyan-100">
                  桌面智能体基础工具
                </p>
                <p class="text-xs text-gray-300 mt-1">
                  启用打开应用/网址、屏幕观察、桌面操作和文件整理工具；发送邮件、删除日历等不可逆操作不会被一键开启。
                </p>
              </div>
              <button
                type="button"
                class="btn btn-sm btn-outline btn-info shrink-0"
                @click="enableDesktopAgentTools"
              >
                一键启用
              </button>
            </div>
            <div
              class="mb-3 flex flex-col gap-2 rounded-md border border-violet-500/30 bg-violet-950/20 p-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p class="text-sm font-semibold text-violet-100">
                  邮件读取与回复
                </p>
                <p class="text-xs text-gray-300 mt-1">
                  启用后可查找、读取 Gmail
                  邮件并准备回复；实际回复前仍会弹窗核对并确认，不会静默发送。
                </p>
              </div>
              <button
                type="button"
                class="btn btn-sm btn-outline btn-secondary shrink-0"
                @click="enableEmailReplyTools"
              >
                启用邮件工具
              </button>
            </div>
            <div
              v-if="availableTools.length === 0"
              class="text-xs text-gray-400"
            >
              未定义工具。
            </div>
            <div
              v-for="tool in availableTools"
              :key="tool.name"
              class="form-control"
            >
              <label
                class="label cursor-pointer py-1 justify-start gap-3"
                :class="{
                  'opacity-50 cursor-not-allowed': !isToolConfigured(tool.name),
                }"
              >
                <input
                  type="checkbox"
                  :value="tool.name"
                  v-model="currentSettings.assistantTools"
                  class="checkbox checkbox-accent checkbox-sm"
                  :disabled="!isToolConfigured(tool.name)"
                />
                <span class="label-text font-bold text-white">
                  {{ tool.displayName }}
                  <span
                    v-if="!isToolConfigured(tool.name)"
                    class="text-xs text-warning normal-case"
                  >
                    （请在“应用与集成”中配置）
                  </span>
                </span>
              </label>
              <div class="text-sm text-gray-400">
                {{ tool.description }}
                <template v-if="!isToolConfigured(tool.name)"
                  >（请在“应用与集成”页配置所需 API 密钥）</template
                >
              </div>
            </div>
          </div>

          <div
            class="mt-4 border border-dashed border-gray-600 rounded-md p-3 bg-gray-900/70"
          >
            <div class="flex items-center justify-between">
              <span class="text-sm font-semibold text-gray-200"
                >自定义工具（在“个性化”页管理）</span
              >
              <span class="text-xs text-gray-400"
                >{{ customToolsStore.enabledAndValidTools.length }}/{{
                  customToolsStore.tools.length
                }}
                个已启用</span
              >
            </div>
            <div
              v-if="!customToolsStore.tools.length"
              class="text-xs text-gray-500 mt-1"
            >
              尚未注册自定义工具。
            </div>
            <ul v-else class="text-xs text-gray-300 mt-2 space-y-1">
              <li
                v-for="tool in customToolsStore.tools"
                :key="tool.id"
                class="flex items-center gap-2"
              >
                <span>{{ tool.name }}</span>
                <span
                  class="badge badge-xs"
                  :class="tool.enabled ? 'badge-success' : 'badge-ghost'"
                >
                  {{ tool.enabled ? '已启用' : '已禁用' }}
                </span>
                <span v-if="!tool.isValid" class="text-warning font-semibold">
                  需要修复
                </span>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </fieldset>

    <fieldset
      v-if="isBrowserContextToolActive"
      class="fieldset bg-gray-900/90 border-green-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">WebSocket 配置</legend>
      <div class="space-y-4 p-2">
        <div>
          <label
            for="websocket-port"
            class="block mb-1 text-sm flex items-center"
          >
            WebSocket 端口
            <div
              class="tooltip tooltip-right"
              data-tip="browser_context 工具使用的 WebSocket 服务端口，请确保端口可用且未被防火墙拦截。"
            >
              <img :src="infoIcon" class="size-4 ml-1" />
            </div>
          </label>
          <input
            id="websocket-port"
            type="number"
            min="1"
            max="65535"
            step="1"
            v-model.number="currentSettings.websocketPort"
            class="input input-bordered w-full focus:input-primary"
          />
          <p class="text-xs text-gray-400 mt-1">
            WebSocket 服务端口（1-65535），默认：5421
          </p>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import type { AliceSettings } from '../../stores/settingsStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useCustomToolsStore } from '../../stores/customToolsStore'
import { infoIcon } from '../../utils/assetsImport'
import { isVisionCapableModel } from '../../services/llmProviders/providerCatalog'

interface Tool {
  name: string
  description: string
  displayName: string
}

const props = defineProps<{
  currentSettings: AliceSettings
  availableModels: Array<{ id: string }>
  availableTools: Tool[]
  isRefreshingModels: boolean
  isToolConfigured: (toolName: string) => boolean
}>()

const emit = defineEmits<{
  'refresh-models': []
  'reset-system-prompt': []
  'persist-settings': []
}>()

const settingsStore = useSettingsStore()
const customToolsStore = useCustomToolsStore()

const uiModeOptions = [
  {
    value: 'capsule' as const,
    label: '悬浮胶囊',
    description: '轻量待机，突出头像和语音入口。',
  },
  {
    value: 'glass' as const,
    label: '玻璃对话卡片',
    description: '显示状态、识别内容和快捷上下文。',
  },
]

const isMacDesktop =
  typeof window !== 'undefined' && window.electron?.platform === 'darwin'

const handleMacSilentModeChange = (event: Event) => {
  props.currentSettings.macSilentModeEnabled = (
    event.target as HTMLInputElement
  ).checked
  // Persist immediately so the next minimize action and next launch use the
  // same presentation, even when the user closes Settings right away.
  emit('persist-settings')
}

const desktopAgentToolPreset = [
  'open_path',
  'desktop_capabilities',
  'desktop_observe',
  'capture_desktop_screen',
  'desktop_action',
  'desktop_reply_message',
  'list_directory_detailed',
  'find_files',
  'organize_files',
  'undo_file_organization',
  'get_calendar_events',
  'plan_itinerary',
  'create_email_draft',
]

const emailReplyToolPreset = [
  'get_unread_emails',
  'search_emails',
  'get_email_content',
  'reply_to_email',
]

const enableDesktopAgentTools = () => {
  const nextTools = Array.from(
    new Set([
      ...props.currentSettings.assistantTools,
      ...desktopAgentToolPreset,
    ])
  )
  if (nextTools.length === props.currentSettings.assistantTools.length) return
  props.currentSettings.assistantTools = nextTools
  emit('persist-settings')
}

const enableEmailReplyTools = () => {
  const nextTools = Array.from(
    new Set([...props.currentSettings.assistantTools, ...emailReplyToolPreset])
  )
  if (nextTools.length === props.currentSettings.assistantTools.length) return
  props.currentSettings.assistantTools = nextTools
  emit('persist-settings')
}

onMounted(() => {
  customToolsStore.ensureInitialized()
})

const isBrowserContextToolActive = computed(() => {
  return props.currentSettings.assistantTools.includes('browser_context')
})

const getProviderDisplayName = (provider: string): string => {
  const providerNames: Record<string, string> = {
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    ollama: 'Ollama',
    'lm-studio': 'LM Studio',
    zai: 'Z.ai',
    minimax: 'MiniMax',
    deepseek: 'DeepSeek',
  }
  return providerNames[provider] || provider
}
</script>
