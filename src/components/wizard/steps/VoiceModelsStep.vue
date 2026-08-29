<template>
  <div>
    <div class="mb-3">
      <h2 class="text-2xl font-semibold mb-2">选择语音与记忆模式</h2>
      <p class="text-base-content/70">
        选择语音、音频和记忆向量的首次运行默认值，稍后可在“设置”中调整服务商、声音和本地模型。
      </p>
    </div>

    <!-- Local vs Cloud Toggle -->
    <div class="bg-base-300/50 p-3 rounded-lg mb-3">
      <div class="form-control">
        <label class="label w-full cursor-pointer">
          <div class="flex-1 pr-4">
            <span class="label-text font-medium text-lg">使用本地模型</span>
            <div class="text-sm text-base-content/60 mt-1">
              使用内置本地后端处理语音和记忆功能。
            </div>
          </div>
          <input
            type="checkbox"
            class="toggle toggle-primary toggle-lg flex-shrink-0"
            :checked="formData.useLocalModels"
            @change="
              $emit('toggle-local', ($event.target as HTMLInputElement).checked)
            "
          />
        </label>
      </div>
    </div>

    <div v-if="formData.useLocalModels">
      <!-- Local Models Information -->
      <div class="space-y-3">
        <div class="alert alert-success text-sm py-3">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-5 h-5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <div>
            <p class="font-medium">本地模式将使用以下默认配置：</p>
            <ul class="list-disc list-inside mt-1 space-y-0.5">
              <li>语音识别通过本地后端运行</li>
              <li>语音播报使用本地 Piper 声音</li>
              <li>向量使用本地 MiniLM 模型保存</li>
              <li>声音模型首次使用时下载</li>
              <li>声音和模型详情仍可在“设置”中编辑</li>
            </ul>
          </div>
        </div>

        <div class="bg-base-200 p-3 rounded-lg space-y-2">
          <h3 class="font-medium text-base-content/90">本地默认值：</h3>

          <div class="grid grid-cols-1 gap-2 text-sm">
            <div
              class="flex justify-between items-center p-2 bg-base-100 rounded"
            >
              <span class="flex items-center">
                <svg
                  class="w-4 h-4 mr-2 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a5 5 0 1110 0v6a3 3 0 01-3 3z"
                  />
                </svg>
                语音识别
              </span>
              <span class="text-base-content/60"
                >本地 Whisper（Go 后端）</span
              >
            </div>

            <div
              class="flex justify-between items-center p-2 bg-base-100 rounded"
            >
              <span class="flex items-center">
                <svg
                  class="w-4 h-4 mr-2 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M15.536 8.464a5 5 0 010 7.072m2.828-9.9a9 9 0 010 14.142M5.586 15H4a1 1 0 01-1-1v-4a1 1 0 011-1h1.586l4.707-4.707C10.923 3.663 12 4.109 12 5v14c0 .891-1.077 1.337-1.707.707L5.586 15z"
                  />
                </svg>
                语音播报
              </span>
              <div class="text-right">
                <div class="text-base-content/90 font-medium">
                  本地 Piper 语音（Go 后端）
                </div>
                <div class="text-xs text-base-content/60">
                  30+ 种声音，20+ 种语言
                </div>
              </div>
            </div>

            <div
              class="flex justify-between items-center p-2 bg-base-100 rounded"
            >
              <span class="flex items-center">
                <svg
                  class="w-4 h-4 mr-2 text-primary"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z"
                  />
                </svg>
                向量
              </span>
              <span class="text-base-content/60"
                >本地 MiniLM（Go 后端）</span
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <div v-else>
      <!-- Cloud Models Configuration -->
      <div class="space-y-4">
        <!-- OpenAI Key requirement for non-OpenAI providers -->
        <div
          v-if="
            (formData.aiProvider === 'ollama' ||
              formData.aiProvider === 'lm-studio' ||
              formData.aiProvider === 'openrouter' ||
              formData.aiProvider === 'zai' ||
              formData.aiProvider === 'minimax' ||
              formData.aiProvider === 'deepseek') &&
            !formData.VITE_OPENAI_API_KEY?.trim()
          "
          class="alert alert-warning text-sm"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-5 h-5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L4.314 16.5c-.77.833.192 2.5 1.732 2.5z"
            ></path>
          </svg>
          <span
            >云端模式使用 OpenAI 进行语音播报和向量处理，除非切换到本地模式，否则需要 OpenAI API 密钥。</span
          >
        </div>

        <div v-else class="alert alert-info text-sm">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            class="stroke-current shrink-0 w-5 h-5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            ></path>
          </svg>
          <span
            >云端模式可简化首次运行的语音和向量配置，你可以在“设置”中修改语音播报、向量和本地选项。</span
          >
        </div>

        <!-- OpenAI API Key for non-OpenAI providers -->
        <div
          v-if="
            formData.aiProvider === 'ollama' ||
            formData.aiProvider === 'lm-studio' ||
            formData.aiProvider === 'openrouter' ||
            formData.aiProvider === 'zai' ||
            formData.aiProvider === 'minimax' ||
            formData.aiProvider === 'deepseek'
          "
          class="form-control"
        >
          <label class="label">
            <span class="label-text">OpenAI API 密钥（用于语音功能）</span>
          </label>
          <div class="text-sm text-base-content/70 mb-2">
            云端语音播报和向量功能需要此密钥，可从
            <a
              href="https://platform.openai.com/api-keys"
              target="_blank"
              class="link link-primary"
              >OpenAI 平台</a
            >.
          </div>
          <input
            type="password"
            v-model="formData.VITE_OPENAI_API_KEY"
            placeholder="sk-..."
            class="input input-bordered w-full focus:input-primary"
          />
        </div>

        <div class="form-control">
          <label class="label">
            <span class="label-text font-medium">语音识别服务商</span>
          </label>
          <select
            v-model="formData.sttProvider"
            class="select select-bordered w-full focus:select-primary focus:outline-none"
          >
            <option value="openai">OpenAI（质量好，已集成）</option>
            <option value="groq">Groq（速度快，需要单独密钥）</option>
            <option value="google">Google（云端）</option>
          </select>
        </div>

        <div v-if="formData.sttProvider === 'groq'" class="form-control">
          <label class="label">
            <span class="label-text">Groq API 密钥</span>
          </label>
          <div class="text-sm text-base-content/70 mb-2">
            Get your key from the
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              class="link link-primary"
              >Groq 控制台</a
            >
          </div>
          <input
            type="password"
            v-model="formData.VITE_GROQ_API_KEY"
            placeholder="gsk_..."
            class="input input-bordered w-full focus:input-primary"
          />
        </div>

        <div v-if="formData.sttProvider === 'google'" class="form-control">
          <label class="label">
            <span class="label-text">Google API 密钥</span>
          </label>
          <div class="text-sm text-base-content/70 mb-2">
            Required for Google Cloud Speech-to-Text.
          </div>
          <input
            type="password"
            v-model="formData.VITE_GOOGLE_API_KEY"
            placeholder="AIza..."
            class="input input-bordered w-full focus:input-primary"
          />

          <label class="label mt-2">
            <span class="label-text">语言</span>
          </label>
          <select
            v-model="formData.localSttLanguage"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="auto">自动检测（默认英语）</option>
            <option value="en">英语</option>
            <option value="es">西班牙语</option>
            <option value="fr">法语</option>
            <option value="de">德语</option>
            <option value="it">意大利语</option>
            <option value="pt">葡萄牙语</option>
            <option value="ru">俄语</option>
            <option value="ja">日语</option>
            <option value="ko">韩语</option>
            <option value="zh">中文</option>
            <option value="ar">阿拉伯语</option>
            <option value="hi">印地语</option>
            <option value="tr">土耳其语</option>
            <option value="pl">波兰语</option>
            <option value="nl">荷兰语</option>
            <option value="sv">瑞典语</option>
            <option value="da">丹麦语</option>
            <option value="no">挪威语</option>
            <option value="fi">芬兰语</option>
          </select>
        </div>

        <div class="bg-base-200 p-4 rounded-lg space-y-2">
          <h3 class="font-medium text-base-content/90">
            当前配置：
          </h3>
          <div class="text-sm space-y-1">
            <div class="flex justify-between">
              <span class="text-base-content/60">语音识别：</span>
              <span class="capitalize">{{ formData.sttProvider }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/60">语音播报：</span>
              <span>{{ providerLabel(formData.ttsProvider) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-base-content/60">向量：</span>
              <span>{{ providerLabel(formData.embeddingProvider) }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  formData: any
}>()

defineEmits<{
  'toggle-local': [useLocal: boolean]
}>()

const providerLabel = (provider: string) => {
  const labels: Record<string, string> = {
    google: 'Google',
    local: '本地',
    openai: 'OpenAI',
  }

  return labels[provider] || provider
}
</script>
