<template>
  <div class="space-y-6">
    <h3 class="text-xl font-semibold mb-4 text-blue-400">核心 API 配置</h3>
    <fieldset
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">API 密钥与服务商</legend>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">
        <div>
          <label for="ai-provider" class="block mb-1 text-sm"
            >AI 服务商 *</label
          >
          <select
            id="ai-provider"
            v-model="currentSettings.aiProvider"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
            <option value="zai">Z.ai（编程套餐）</option>
            <option value="minimax">MiniMax</option>
            <option value="deepseek">DeepSeek</option>
            <option value="codex">ChatGPT Codex</option>
            <option value="ollama">Ollama（本地）</option>
            <option value="lm-studio">LM Studio（本地）</option>
          </select>
        </div>
        <div>
          <label for="stt-provider" class="block mb-1 text-sm"
            >语音识别服务商 *</label
          >
          <select
            id="stt-provider"
            v-model="currentSettings.sttProvider"
            class="select select-bordered w-full focus:select-primary"
            @change="handleSttProviderChange"
          >
            <option value="openai">OpenAI (gpt-4o-transcribe)</option>
            <option value="groq">Groq (whisper-large-v3)</option>
            <option value="google">Google（云端）</option>
            <option value="local">本地（Go 后端）</option>
          </select>
        </div>
        <div
          v-if="
            currentSettings.sttProvider === 'google' ||
            currentSettings.sttProvider === 'local'
          "
        >
          <label for="stt-language" class="block mb-1 text-sm">语言 *</label>
          <select
            id="stt-language"
            v-model="currentSettings.localSttLanguage"
            class="select select-bordered w-full focus:select-primary"
            @change="
              e =>
                $emit('update:setting', 'localSttLanguage', getTargetValue(e))
            "
          >
            <option value="auto">自动检测</option>
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
          <p class="text-xs text-gray-400 mt-1">
            {{
              currentSettings.sttProvider === 'google'
                ? '选择语言可提升识别准确率。'
                : '自动检测适用于大多数语言；选择具体语言可提升准确率。'
            }}
          </p>
        </div>
        <div>
          <label for="openai-key" class="block mb-1 text-sm">
            OpenAI API 密钥
            <span v-if="openAiKeyRequired">*</span>
          </label>
          <input
            id="openai-key"
            type="password"
            v-model="currentSettings.VITE_OPENAI_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="sk-..."
          />
          <p class="text-xs text-gray-400 mt-1">
            {{
              openAiKeyRequired
                ? '当前配置使用了 OpenAI 服务，需要此密钥。'
                : '当前配置不需要 OpenAI API 密钥；只有切换到 OpenAI 的聊天、语音或向量服务时才需要。'
            }}
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'openrouter'">
          <label for="openrouter-key" class="block mb-1 text-sm"
            >OpenRouter API 密钥 *</label
          >
          <input
            id="openrouter-key"
            type="password"
            v-model="currentSettings.VITE_OPENROUTER_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="sk-or-v1-..."
          />
          <p class="text-xs text-gray-400 mt-1">
            使用 OpenRouter 聊天模型时需要此密钥。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'ollama'">
          <label for="ollama-url" class="block mb-1 text-sm"
            >Ollama 基础地址 *</label
          >
          <input
            id="ollama-url"
            type="text"
            v-model="currentSettings.ollamaBaseUrl"
            class="input focus:outline-none w-full"
            placeholder="http://localhost:11434"
          />
          <p class="text-xs text-gray-400 mt-1">Ollama 服务运行的地址。</p>
        </div>
        <div v-if="currentSettings.aiProvider === 'zai'">
          <label for="zai-key" class="block mb-1 text-sm"
            >Z.ai API 密钥 *</label
          >
          <input
            id="zai-key"
            type="password"
            v-model="currentSettings.VITE_ZAI_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="..."
          />
          <p class="text-xs text-gray-400 mt-1">
            使用 GLM 编程套餐聊天模型时需要此密钥。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'zai'">
          <label for="zai-url" class="block mb-1 text-sm"
            >Z.ai 基础地址 *</label
          >
          <input
            id="zai-url"
            type="text"
            v-model="currentSettings.zaiBaseUrl"
            class="input focus:outline-none w-full"
            placeholder="https://api.z.ai/api/coding/paas/v4"
          />
          <p class="text-xs text-gray-400 mt-1">
            兼容 OpenAI 工具格式的编程套餐接口地址。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'minimax'">
          <label for="minimax-key" class="block mb-1 text-sm"
            >MiniMax API 密钥 *</label
          >
          <input
            id="minimax-key"
            type="password"
            v-model="currentSettings.VITE_MINIMAX_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="..."
          />
          <p class="text-xs text-gray-400 mt-1">
            使用 MiniMax 兼容 OpenAI 的聊天模型时需要此密钥。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'minimax'">
          <label for="minimax-url" class="block mb-1 text-sm"
            >MiniMax 基础地址 *</label
          >
          <input
            id="minimax-url"
            type="text"
            v-model="currentSettings.minimaxBaseUrl"
            class="input focus:outline-none w-full"
            placeholder="https://api.minimax.io/v1"
          />
          <p class="text-xs text-gray-400 mt-1">
            MiniMax 令牌/编程套餐的 OpenAI 兼容接口地址。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'deepseek'">
          <label for="deepseek-key" class="block mb-1 text-sm"
            >DeepSeek API 密钥 *</label
          >
          <input
            id="deepseek-key"
            type="password"
            v-model="currentSettings.VITE_DEEPSEEK_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="sk-..."
          />
          <p class="text-xs text-gray-400 mt-1">
            使用 DeepSeek 聊天模型时需要此密钥。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'deepseek'">
          <label for="deepseek-url" class="block mb-1 text-sm"
            >DeepSeek 基础地址 *</label
          >
          <input
            id="deepseek-url"
            type="text"
            v-model="currentSettings.deepseekBaseUrl"
            class="input focus:outline-none w-full"
            placeholder="https://api.deepseek.com"
          />
          <p class="text-xs text-gray-400 mt-1">
            DeepSeek 聊天补全的 OpenAI 兼容接口地址。
          </p>
        </div>
        <div v-if="currentSettings.aiProvider === 'codex'">
          <label class="block mb-1 text-sm">ChatGPT Codex 账号 *</label>
          <div class="rounded-lg border border-blue-500/30 bg-gray-950/60 p-3">
            <div class="flex flex-col gap-3">
              <div>
                <p class="text-sm text-gray-200">
                  {{
                    codexAuthStatus.isAuthenticated
                      ? codexAuthStatus.accountLabel ||
                        currentSettings.codexAccountLabel ||
                        '已连接'
                      : '未连接'
                  }}
                </p>
                <p
                  v-if="codexAuthStatus.message"
                  class="text-xs text-green-300 mt-1"
                >
                  {{ codexAuthStatus.message }}
                </p>
                <p
                  v-if="codexAuthStatus.error"
                  class="text-xs text-red-300 mt-1"
                >
                  {{ codexAuthStatus.error }}
                </p>
              </div>
              <div class="flex flex-wrap gap-2">
                <button
                  v-if="!codexAuthStatus.isAuthenticated"
                  type="button"
                  class="btn btn-sm btn-primary"
                  :disabled="
                    codexAuthStatus.isLoading || codexAuthStatus.authInProgress
                  "
                  @click="startCodexAuth"
                >
                  {{
                    codexAuthStatus.authInProgress
                      ? '等待浏览器授权…'
                      : '授权 ChatGPT Codex'
                  }}
                </button>
                <button
                  v-else
                  type="button"
                  class="btn btn-sm btn-outline"
                  :disabled="codexAuthStatus.isLoading"
                  @click="disconnectCodex"
                >
                  断开连接
                </button>
                <button
                  type="button"
                  class="btn btn-sm btn-ghost"
                  :disabled="codexAuthStatus.isLoading"
                  @click="checkCodexAuthStatus"
                >
                  检查状态
                </button>
              </div>
            </div>
            <p class="text-xs text-gray-400 mt-1">
              使用你的 ChatGPT Codex 订阅进行聊天推理。只有在使用 OpenAI
              语音识别、语音播报或向量功能时才需要 OpenAI API 密钥。
            </p>
          </div>
        </div>
        <div v-if="currentSettings.aiProvider === 'lm-studio'">
          <label for="lmstudio-url" class="block mb-1 text-sm"
            >LM Studio 基础地址 *</label
          >
          <input
            id="lmstudio-url"
            type="text"
            v-model="currentSettings.lmStudioBaseUrl"
            class="input focus:outline-none w-full"
            placeholder="http://localhost:1234"
          />
          <p class="text-xs text-gray-400 mt-1">LM Studio 服务运行的地址。</p>
        </div>
        <div v-if="currentSettings.sttProvider === 'groq'">
          <label for="groq-key" class="block mb-1 text-sm"
            >Groq API 密钥（用于语音识别）*</label
          >
          <input
            id="groq-key"
            type="password"
            v-model="currentSettings.VITE_GROQ_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="gsk_..."
          />
          <p class="text-xs text-gray-400 mt-1">
            仅在上方选择 Groq 语音识别时需要。
          </p>
        </div>
        <div
          v-if="
            currentSettings.sttProvider === 'google' ||
            currentSettings.ttsProvider === 'google'
          "
        >
          <label for="google-key" class="block mb-1 text-sm"
            >Google API 密钥 *</label
          >
          <input
            id="google-key"
            type="password"
            v-model="currentSettings.VITE_GOOGLE_API_KEY"
            class="input focus:outline-none w-full"
            autocomplete="new-password"
            placeholder="AIza..."
          />
          <p class="text-xs text-gray-400 mt-1">
            使用 Google 语音识别或语音播报服务时需要。
          </p>
        </div>
      </div>
    </fieldset>

    <!-- Local STT Configuration Section -->
    <fieldset
      v-if="currentSettings.sttProvider === 'local'"
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        本地语音识别配置（Go 后端）
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('stt')"
          :title="getServiceStatusText('stt')"
        ></span>
      </legend>
      <div class="space-y-4 p-2">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label for="stt-model" class="block mb-1 text-sm"
              >Whisper 模型（当前版本固定）</label
            >
            <select
              id="stt-model"
              v-model="currentSettings.localSttModel"
              class="select select-bordered w-full focus:select-primary"
              disabled
              aria-describedby="stt-model-help"
              @change="
                e => $emit('update:setting', 'localSttModel', getTargetValue(e))
              "
            >
              <option value="whisper-base">Base（多语言，已内置）</option>
            </select>
            <p id="stt-model-help" class="text-xs text-gray-400 mt-1">
              当前安装包只内置多语言 Whisper
              Base，后台固定使用它；更大模型需要后续下载与资源管理，暂未开放选择。
            </p>
          </div>
          <div>
            <label for="stt-wake-enable" class="block mb-1 text-sm"
              >启用唤醒词</label
            >
            <select
              id="stt-wake-enable"
              v-model="currentSettings.localSttEnabled"
              class="select select-bordered w-full focus:select-primary"
              @change="handleLocalSttEnabledChange"
            >
              <!-- Bind booleans instead of the strings "true"/"false" so
                   v-model never exposes a truthy string to the readiness and
                   background-listening guards. -->
              <option :value="true">启用</option>
              <option :value="false">禁用</option>
            </select>
          </div>
          <div v-show="currentSettings.localSttEnabled">
            <label for="stt-wakeword" class="block mb-1 text-sm"
              >唤醒词 *</label
            >
            <input
              id="stt-wakeword"
              type="text"
              v-model="currentSettings.localSttWakeWord"
              class="input input-bordered w-full focus:input-primary"
              :aria-invalid="
                currentSettings.localSttWakeWord !== '' &&
                !wakeWordValidation.valid
              "
              :aria-describedby="
                currentSettings.localSttWakeWord !== '' &&
                !wakeWordValidation.valid
                  ? 'stt-wakeword-error'
                  : 'stt-wakeword-help'
              "
              @change="handleWakeWordChange"
              :placeholder="DEFAULT_WAKE_WORD"
            />
            <p id="stt-wakeword-help" class="text-xs text-gray-400 mt-1">
              说出此词即可激活录音；使用简单、常见的词语可提升识别效果。
            </p>
            <p
              v-if="
                currentSettings.localSttWakeWord !== '' &&
                !wakeWordValidation.valid
              "
              id="stt-wakeword-error"
              class="text-xs text-amber-300 mt-1"
              role="alert"
            >
              {{ wakeWordValidation.error }}
            </p>
            <p class="text-xs text-cyan-300/80 mt-1">
              支持中文、英文或混合短语（最多 40
              个字符）。修改后请点击页面底部“保存并重新加载”使新唤醒词生效；后台监听开关的切换会即时保存。
            </p>
          </div>
        </div>
        <div
          class="col-span-full rounded-lg border border-cyan-500/30 bg-cyan-950/20 p-3 space-y-3"
        >
          <div class="flex items-start justify-between gap-4">
            <div>
              <label
                for="background-listening"
                class="block text-sm font-medium"
              >
                后台语音监听
              </label>
              <p class="text-xs text-gray-400 mt-1">
                隐藏窗口后仍保留麦克风监听，只在识别到唤醒词时处理指令。需要“本地语音识别”和“启用唤醒词”，可从系统托盘退出
                Alice。
              </p>
            </div>
            <input
              id="background-listening"
              type="checkbox"
              class="toggle toggle-info mt-1 shrink-0"
              :checked="currentSettings.backgroundListeningEnabled"
              :disabled="
                !currentSettings.backgroundListeningEnabled &&
                (currentSettings.sttProvider !== 'local' ||
                  !currentSettings.localSttEnabled ||
                  !wakeWordValidation.valid)
              "
              @change="handleBackgroundListeningToggle"
            />
          </div>
          <div
            class="flex items-start justify-between gap-4 border-t border-gray-700/60 pt-3"
          >
            <div>
              <label for="launch-at-login" class="block text-sm font-medium">
                开机启动 Alice
              </label>
              <p class="text-xs text-gray-400 mt-1">
                登录 macOS 或 Windows 后自动启动。若同时开启后台监听，Alice
                会直接隐藏到托盘等待唤醒词。
              </p>
            </div>
            <input
              id="launch-at-login"
              type="checkbox"
              class="toggle toggle-info mt-1 shrink-0"
              :checked="currentSettings.launchAtLogin"
              @change="e => emitCheckboxChange('launchAtLogin', e)"
            />
          </div>
          <div
            class="rounded-md border border-gray-700/60 bg-gray-950/40 px-3 py-2 text-xs"
            :class="
              backgroundListeningReadiness.ready
                ? 'text-green-300'
                : 'text-amber-300'
            "
          >
            <span class="font-medium">后台唤醒状态：</span>
            {{ backgroundListeningReadiness.message }}
          </div>
          <div
            v-if="microphonePermissionMessage"
            class="rounded-md border border-gray-700/60 bg-gray-950/40 px-3 py-2 text-xs text-gray-300"
          >
            <span class="font-medium">麦克风权限：</span>
            {{ microphonePermissionMessage }}
          </div>
          <div
            v-if="desktopPermissionMessage"
            class="rounded-md border border-gray-700/60 bg-gray-950/40 px-3 py-2 text-xs text-gray-300"
          >
            <span class="font-medium">桌面权限：</span>
            {{ desktopPermissionMessage }}
          </div>
          <div class="flex flex-wrap gap-2">
            <button
              v-if="!currentSettings.backgroundListeningEnabled"
              type="button"
              class="btn btn-sm btn-outline btn-info w-full sm:w-auto"
              :disabled="isEnablingBackgroundWake || isCheckingMicrophone"
              @click="enableBackgroundWake"
            >
              <span
                v-if="isEnablingBackgroundWake"
                class="loading loading-spinner loading-xs"
              ></span>
              {{
                isEnablingBackgroundWake ? '正在准备后台唤醒…' : '启用后台唤醒'
              }}
            </button>
            <button
              type="button"
              class="btn btn-sm btn-outline w-full sm:w-auto"
              :disabled="isCheckingMicrophone"
              @click="checkMicrophone"
            >
              <span
                v-if="isCheckingMicrophone"
                class="loading loading-spinner loading-xs"
              ></span>
              {{ isCheckingMicrophone ? '正在检查麦克风…' : '检查麦克风' }}
            </button>
            <button
              v-if="microphonePermission !== 'granted'"
              type="button"
              class="btn btn-sm btn-outline w-full sm:w-auto"
              @click="openMicrophoneSettings"
            >
              打开麦克风设置
            </button>
            <button
              v-if="
                currentSettings.assistantTools.includes(
                  'capture_desktop_screen'
                ) || currentSettings.assistantTools.includes('desktop_observe')
              "
              type="button"
              class="btn btn-sm btn-outline w-full sm:w-auto"
              @click="
                openSystemPermissionSettings('screen-recording', '屏幕录制')
              "
            >
              打开屏幕录制设置
            </button>
            <button
              v-if="currentSettings.assistantTools.includes('desktop_action')"
              type="button"
              class="btn btn-sm btn-outline w-full sm:w-auto"
              @click="openSystemPermissionSettings('accessibility', '辅助功能')"
            >
              打开辅助功能设置
            </button>
          </div>
          <p v-if="microphoneCheckResult" class="text-xs text-gray-300">
            {{ microphoneCheckResult }}
          </p>
        </div>
      </div>
    </fieldset>

    <!-- TTS Settings Section -->
    <fieldset
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        语音播报配置
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('tts')"
          :title="getServiceStatusText('tts')"
        ></span>
      </legend>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4 p-2">
        <div>
          <label for="tts-provider" class="block mb-1 text-sm"
            >语音播报服务商 *</label
          >
          <select
            id="tts-provider"
            v-model="currentSettings.ttsProvider"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="openai">OpenAI（云端）</option>
            <option value="google">Google（云端）</option>
            <option value="local">本地（Piper）</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            可选择云端 OpenAI 语音或本地 Piper 语音。
          </p>
        </div>
        <div v-if="currentSettings.ttsProvider === 'openai'">
          <label for="tts-voice" class="block mb-1 text-sm">OpenAI 语音</label>
          <select
            id="tts-voice"
            v-model="currentSettings.ttsVoice"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="alloy">Alloy</option>
            <option value="ash">Ash</option>
            <option value="ballad">Ballad</option>
            <option value="coral">Coral</option>
            <option value="echo">Echo</option>
            <option value="fable">Fable</option>
            <option value="nova">Nova</option>
            <option value="onyx">Onyx</option>
            <option value="sage">Sage</option>
            <option value="shimmer">Shimmer</option>
            <option value="verse">Verse</option>
            <option value="marin">Marin（推荐）</option>
            <option value="cedar">Cedar（推荐）</option>
          </select>
        </div>
        <div v-if="currentSettings.ttsProvider === 'google'">
          <label for="google-tts-voice" class="block mb-1 text-sm"
            >Google 语音</label
          >
          <select
            id="google-tts-voice"
            v-model="currentSettings.googleTtsVoice"
            class="select select-bordered w-full focus:select-primary"
            @change="
              e => $emit('update:setting', 'googleTtsVoice', getTargetValue(e))
            "
          >
            <option value="en-US-Journey-F">Journey F（女声）</option>
            <option value="en-US-Journey-O">Journey O（女声）</option>
            <option value="en-US-Neural2-C">Neural2 C（女声）</option>
            <option value="en-US-Neural2-F">Neural2 F（女声）</option>
            <option value="en-US-Neural2-H">Neural2 H（女声）</option>
            <option value="en-US-Standard-C">Standard C（女声）</option>
            <option value="en-US-Standard-E">Standard E（女声）</option>
            <option value="en-US-Wavenet-C">Wavenet C（女声）</option>
            <option value="en-US-Wavenet-F">Wavenet F（女声）</option>
          </select>
        </div>
        <div v-if="currentSettings.ttsProvider === 'local'">
          <label for="local-tts-voice" class="block mb-1 text-sm"
            >本地语音</label
          >
          <div class="space-y-3">
            <div class="flex gap-2 items-center">
              <select
                id="local-tts-voice"
                v-model="currentSettings.localTtsVoice"
                class="select select-bordered flex-1 focus:select-primary"
                @change="onVoiceChange"
              >
                <option v-if="availableVoices.length === 0" disabled value="">
                  {{ isRefreshingVoices ? '正在加载语音…' : '暂无可用语音' }}
                </option>
                <optgroup
                  v-for="(voices, language) in groupedVoices"
                  :key="language"
                  :label="getLanguageDisplayName(language)"
                >
                  <option
                    v-for="voice in voices"
                    :key="voice.name"
                    :value="voice.name"
                    :title="`${voice.description} | 质量：${getVoiceQuality(voice.name)} | 性别：${voice.gender || '未知'}`"
                  >
                    {{ getVoiceDisplayName(voice) }}
                  </option>
                </optgroup>
              </select>
              <button
                type="button"
                @click="refreshVoices"
                :disabled="isRefreshingVoices"
                class="btn btn-square btn-sm"
                title="刷新语音列表"
              >
                <span
                  v-if="isRefreshingVoices"
                  class="loading loading-spinner loading-xs"
                ></span>
                <span v-else>🔄</span>
              </button>
              <button
                type="button"
                @click="previewVoice"
                :disabled="!currentSettings.localTtsVoice || isPreviewingVoice"
                class="btn btn-square btn-sm"
                title="试听所选语音"
              >
                <span
                  v-if="isPreviewingVoice"
                  class="loading loading-spinner loading-xs"
                ></span>
                <span v-else>🎵</span>
              </button>
            </div>

            <div
              class="flex items-center justify-between text-xs text-gray-400"
            >
              <span>
                {{ availableVoices.filter(v => v.gender !== 'male').length }}
                条语音，覆盖 {{ Object.keys(groupedVoices).length }} 种语言
              </span>
              <span
                class="text-blue-400 cursor-pointer hover:underline"
                @click="showVoiceHelp = !showVoiceHelp"
              >
                {{ showVoiceHelp ? '隐藏帮助' : '语音帮助' }}
              </span>
            </div>

            <!-- Voice Help Section -->
            <div
              v-if="showVoiceHelp"
              class="bg-base-300 p-3 rounded-lg text-xs space-y-2"
            >
              <h5 class="font-medium text-sm">语音质量等级：</h5>
              <div class="grid grid-cols-2 gap-2">
                <div>
                  <span class="badge badge-xs badge-outline mr-1">x_low</span>
                  16kHz，最小
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">low</span>
                  16kHz，快速
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">medium</span>
                  22kHz，高质量
                </div>
                <div>
                  <span class="badge badge-xs badge-outline mr-1">high</span>
                  22kHz，最佳质量
                </div>
              </div>
              <p class="text-base-content/60 mt-2">
                💡
                <strong>提示：</strong
                >语音模型首次使用时会自动下载。更高质量的语音效果更好，但需要更多存储空间。
              </p>
            </div>
          </div>
        </div>
      </div>
    </fieldset>

    <!-- Embedding Configuration Section -->
    <fieldset
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">
        向量配置
        <span
          class="w-2 h-2 rounded-full inline-block"
          :class="getServiceStatusClass('embeddings')"
          :title="getServiceStatusText('embeddings')"
        ></span>
      </legend>
      <div class="grid grid-cols-1 gap-4 p-2">
        <div>
          <label for="embedding-provider" class="block mb-1 text-sm"
            >向量服务商 *</label
          >
          <select
            id="embedding-provider"
            v-model="currentSettings.embeddingProvider"
            class="select select-bordered w-full focus:select-primary"
          >
            <option value="openai">OpenAI（云端）</option>
            <option value="local">本地（多语言 E5）</option>
          </select>
          <p class="text-xs text-gray-400 mt-1">
            可选择云端 OpenAI 向量或本地多语言 E5
            向量。已有文本会保留；模型变更时会重新构建本地向量。
          </p>
        </div>
      </div>
    </fieldset>

    <!-- Local Documents (RAG) Section -->
    <fieldset
      class="fieldset bg-gray-900/90 border-blue-500/50 rounded-box w-full border p-4"
    >
      <legend class="fieldset-legend">本地文档（RAG）</legend>
      <div class="grid grid-cols-1 gap-4 p-2">
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label for="rag-enabled" class="block mb-1 text-sm">启用 RAG</label>
            <select
              id="rag-enabled"
              v-model="currentSettings.ragEnabled"
              class="select select-bordered w-full focus:select-primary"
            >
              <option :value="true">已启用</option>
              <option :value="false">已禁用</option>
            </select>
          </div>
          <div>
            <label for="rag-topk" class="block mb-1 text-sm"
              >召回分块数量（Top K）</label
            >
            <input
              id="rag-topk"
              type="number"
              min="1"
              max="20"
              v-model.number="currentSettings.ragTopK"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
          <div>
            <label for="rag-max-chars" class="block mb-1 text-sm"
              >最大上下文字符数</label
            >
            <input
              id="rag-max-chars"
              type="number"
              min="500"
              max="6000"
              step="100"
              v-model.number="currentSettings.ragMaxContextChars"
              class="input input-bordered w-full focus:input-primary"
            />
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-2">
          <button
            type="button"
            class="btn btn-sm"
            :disabled="isIndexingRag"
            @click="selectRagPaths"
          >
            添加文件/文件夹
          </button>
          <button
            type="button"
            class="btn btn-sm"
            :disabled="isIndexingRag || currentSettings.ragPaths.length === 0"
            @click="reindexRag"
          >
            重新索引
          </button>
          <button
            type="button"
            class="btn btn-sm btn-outline"
            :disabled="isIndexingRag"
            @click="clearRagIndex"
          >
            清空索引
          </button>
          <span class="text-xs text-gray-400">
            {{ ragStats.documents }} 个文档，{{ ragStats.chunks }} 个分块
          </span>
          <span v-if="ragStatusMessage" class="text-xs text-gray-400">
            {{ ragStatusMessage }}
          </span>
        </div>

        <div v-if="currentSettings.ragPaths.length > 0">
          <label class="block mb-2 text-sm">已索引路径</label>
          <div class="space-y-2">
            <div
              v-for="pathItem in currentSettings.ragPaths"
              :key="pathItem"
              class="flex items-center justify-between gap-2 bg-gray-800/50 rounded px-3 py-2 text-xs"
            >
              <span class="truncate" :title="pathItem">{{ pathItem }}</span>
              <button
                type="button"
                class="btn btn-xs btn-ghost"
                @click="removeRagPath(pathItem)"
              >
                移除
              </button>
            </div>
          </div>
        </div>
      </div>
    </fieldset>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import type { AliceSettings } from '../../stores/settingsStore'
import { backendApi, type Voice } from '../../services/backendApi'
import { useCodexAuth } from '../../composables/useCodexAuth'
import {
  shouldDisableBackgroundListening,
  type BackgroundListeningConfig,
} from '../../composables/backgroundListeningPolicy'
import {
  DEFAULT_WAKE_WORD,
  validateWakeWord,
} from '../../composables/wakeWordConfig'

// Type for service status
interface ServiceStatus {
  status: 'ready' | 'downloading' | 'error' | 'offline'
}

const props = defineProps<{
  currentSettings: AliceSettings
}>()

const emit = defineEmits<{
  'update:setting': [
    key: keyof AliceSettings,
    value: string | boolean | number | string[],
  ]
  'persist-settings': []
}>()

const serviceStatus = ref<{
  stt: ServiceStatus
  tts: ServiceStatus
  embeddings: ServiceStatus
}>({
  stt: { status: 'offline' },
  tts: { status: 'offline' },
  embeddings: { status: 'offline' },
})
const microphonePermission = ref('unknown')
const desktopPlatform = ref('unknown')
const screenCapturePermission = ref('unknown')
const accessibilityPermission = ref('unknown')

const availableVoices = ref<Voice[]>([])
const isRefreshingVoices = ref(false)
const isPreviewingVoice = ref(false)
const isCheckingMicrophone = ref(false)
const isEnablingBackgroundWake = ref(false)
const microphoneCheckResult = ref('')
const showVoiceHelp = ref(false)
const ragStats = ref({ documents: 0, chunks: 0 })
const isIndexingRag = ref(false)
const ragStatusMessage = ref('')
const wakeWordValidation = computed(() =>
  validateWakeWord(props.currentSettings.localSttWakeWord)
)

// Surface an automatic fail-closed transition when a prerequisite is changed
// by another settings control or by a migrated settings file.
watch(
  () => [
    props.currentSettings.sttProvider,
    props.currentSettings.localSttEnabled,
    props.currentSettings.localSttWakeWord,
    props.currentSettings.backgroundListeningEnabled,
  ],
  (next, previous) => {
    const wasEnabled = previous?.[3] === true
    const nextConfig: BackgroundListeningConfig = {
      sttProvider: next[0] as string,
      localSttEnabled: next[1] as boolean,
      localSttWakeWord: next[2] as string,
      backgroundListeningEnabled: next[3] as boolean,
    }
    if (wasEnabled && shouldDisableBackgroundListening(nextConfig)) {
      microphoneCheckResult.value =
        '当前语音识别配置不满足本地唤醒条件，后台监听已自动关闭。完成本地语音设置后可重新启用。'
    }
  }
)

let statusInterval: NodeJS.Timeout | null = null

const {
  codexAuthStatus,
  checkCodexAuthStatus,
  startCodexAuth,
  disconnectCodex,
} = useCodexAuth()

const getTargetValue = (event: Event): string => {
  return (event.target as HTMLInputElement | HTMLSelectElement).value
}

const maybeDisableBackgroundListening = (
  overrides: Partial<BackgroundListeningConfig> = {}
) => {
  const nextConfig: BackgroundListeningConfig = {
    sttProvider: props.currentSettings.sttProvider,
    localSttEnabled: props.currentSettings.localSttEnabled,
    localSttWakeWord: props.currentSettings.localSttWakeWord,
    backgroundListeningEnabled:
      props.currentSettings.backgroundListeningEnabled,
    ...overrides,
  }

  if (!shouldDisableBackgroundListening(nextConfig)) return

  emit('update:setting', 'backgroundListeningEnabled', false)
  microphoneCheckResult.value =
    '当前语音识别配置不满足本地唤醒条件，后台监听已自动关闭。完成本地语音设置后可重新启用。'
  emit('persist-settings')
}

const handleSttProviderChange = (event: Event) => {
  const provider = getTargetValue(event)
  emit('update:setting', 'sttProvider', provider)
  maybeDisableBackgroundListening({ sttProvider: provider })
}

const handleLocalSttEnabledChange = (event: Event) => {
  const enabled = getTargetValue(event) === 'true'
  emit('update:setting', 'localSttEnabled', enabled)
  maybeDisableBackgroundListening({ localSttEnabled: enabled })
}

const handleWakeWordChange = (event: Event) => {
  const wakeWord = getTargetValue(event)
  const validation = validateWakeWord(wakeWord)
  // Keep invalid draft text visible so the inline message can explain what
  // needs fixing; the shared settings store rejects it again at persistence.
  emit(
    'update:setting',
    'localSttWakeWord',
    validation.valid ? validation.value : wakeWord
  )
  maybeDisableBackgroundListening({ localSttWakeWord: wakeWord })
}

const emitCheckboxChange = (key: keyof AliceSettings, event: Event): void => {
  emit('update:setting', key, (event.target as HTMLInputElement).checked)
}

const openAiKeyRequired = computed(
  () =>
    props.currentSettings.aiProvider === 'openai' ||
    props.currentSettings.sttProvider === 'openai' ||
    props.currentSettings.ttsProvider === 'openai' ||
    props.currentSettings.embeddingProvider === 'openai'
)

const backgroundListeningReadiness = computed(() => {
  if (props.currentSettings.sttProvider !== 'local') {
    return {
      ready: false,
      message: '请将语音识别切换为“本地（Go 后端）”。',
    }
  }
  if (!props.currentSettings.localSttEnabled) {
    return { ready: false, message: '请先启用唤醒词。' }
  }
  if (!props.currentSettings.localSttWakeWord?.trim()) {
    return { ready: false, message: '请设置唤醒词。' }
  }
  if (!wakeWordValidation.value.valid) {
    return {
      ready: false,
      message: wakeWordValidation.value.error || '唤醒词格式无效。',
    }
  }
  if (serviceStatus.value.stt.status !== 'ready') {
    return {
      ready: false,
      message: '本地语音识别服务尚未就绪，请等待模型加载完成。',
    }
  }
  if (
    microphonePermission.value === 'denied' ||
    microphonePermission.value === 'restricted'
  ) {
    return {
      ready: false,
      message: '系统已拒绝 Alice 的麦克风权限，请在系统设置中允许后重试。',
    }
  }
  if (microphonePermission.value === 'not-determined') {
    return {
      ready: false,
      message:
        '尚未完成麦克风授权，请点击“检查麦克风”并允许 Alice 使用麦克风。',
    }
  }
  if (!props.currentSettings.backgroundListeningEnabled) {
    return {
      ready: false,
      message: '前置条件已满足，开启上方开关即可后台监听。',
    }
  }
  return { ready: true, message: '已开启，隐藏窗口后会继续等待唤醒词。' }
})

const microphonePermissionMessage = computed(() => {
  switch (microphonePermission.value) {
    case 'granted':
      return '已允许 Alice 使用麦克风。'
    case 'denied':
      return '已拒绝。请到系统设置的“麦克风”权限中允许 Alice。'
    case 'restricted':
      return '受系统策略限制，当前账户无法授予麦克风权限。'
    case 'not-determined':
      return '尚未授权；首次启用后台唤醒时系统会弹出授权提示。'
    case 'unknown':
      return '当前平台未提供可查询的授权状态，启用时将由系统决定。'
    default:
      return `系统状态：${microphonePermission.value}`
  }
})

const desktopPermissionMessage = computed(() => {
  const needsScreenCapture =
    props.currentSettings.assistantTools.includes('capture_desktop_screen') ||
    props.currentSettings.assistantTools.includes('desktop_observe')
  const needsAccessibility =
    props.currentSettings.assistantTools.includes('desktop_action')
  if (!needsScreenCapture && !needsAccessibility) return ''

  if (desktopPlatform.value === 'darwin') {
    const missing: string[] = []
    if (needsScreenCapture && screenCapturePermission.value !== 'granted') {
      missing.push('屏幕录制')
    }
    if (needsAccessibility && accessibilityPermission.value !== 'granted') {
      missing.push('辅助功能')
    }
    return missing.length
      ? `macOS 尚未允许：${missing.join('、')}；点击下方对应按钮打开设置。`
      : 'macOS 屏幕录制和辅助功能权限均已允许。'
  }

  if (desktopPlatform.value === 'win32') {
    return 'Windows 桌面操作已提供；部分高权限应用需以相同权限级别运行。'
  }
  if (desktopPlatform.value === 'linux') {
    return 'Linux 桌面操作需要 xdotool；屏幕捕获还取决于当前桌面会话。'
  }
  return '正在读取当前系统的桌面权限状态。'
})

const withTimeout = <T,>(promise: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('操作超时，请检查系统权限提示。')),
      timeoutMs
    )
    promise.then(
      value => {
        clearTimeout(timer)
        resolve(value)
      },
      error => {
        clearTimeout(timer)
        reject(error)
      }
    )
  })

const checkMicrophone = async (): Promise<boolean> => {
  if (isCheckingMicrophone.value) return false

  isCheckingMicrophone.value = true
  microphoneCheckResult.value = ''
  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      microphoneCheckResult.value = '当前运行环境不支持麦克风检测。'
      return false
    }

    if (window.desktopAPI?.requestMicrophoneAccess) {
      const access = await withTimeout(
        window.desktopAPI.requestMicrophoneAccess(),
        45_000
      )
      microphonePermission.value = access.permission || 'unknown'
      if (!access.success) {
        microphoneCheckResult.value =
          access.error || '系统未允许 Alice 使用麦克风。'
        return false
      }
    }

    const stream = await withTimeout(
      navigator.mediaDevices.getUserMedia({ audio: true }),
      15_000
    )
    stream.getTracks().forEach(track => track.stop())
    await updateMicrophonePermission()
    microphoneCheckResult.value =
      '麦克风可用，权限已确认；检测音频流已立即关闭。'
    return true
  } catch (error) {
    await updateMicrophonePermission()
    const errorMessage = error instanceof Error ? error.message : ''
    microphoneCheckResult.value = errorMessage.includes('超时')
      ? `${errorMessage} 如果没有看到系统提示，请点击“打开麦克风设置”后允许 Alice。`
      : '无法访问麦克风。请检查系统权限，并确认没有其他应用独占设备。'
    console.warn('Microphone check failed:', error)
    return false
  } finally {
    isCheckingMicrophone.value = false
  }
}

const enableBackgroundWake = async () => {
  if (isEnablingBackgroundWake.value || isCheckingMicrophone.value) return

  isEnablingBackgroundWake.value = true
  try {
    const configuredWakeWord = props.currentSettings.localSttWakeWord || ''
    if (configuredWakeWord.trim()) {
      const wakeWordValidationResult = validateWakeWord(configuredWakeWord)
      if (!wakeWordValidationResult.valid) {
        microphoneCheckResult.value =
          wakeWordValidationResult.error || '请先修正唤醒词格式。'
        return
      }
    }

    // Request and verify access before changing the persisted setting. This
    // prevents a denied permission from leaving the UI in a misleading
    // "background listening enabled" state.
    // Always perform a short live-device check, even when the native status is
    // already "granted". A permission grant does not guarantee that an input
    // device is present or available (for example, another app may hold it).
    const microphoneReady = await checkMicrophone()
    if (!microphoneReady) {
      if (!microphoneCheckResult.value) {
        microphoneCheckResult.value =
          '请先完成麦克风授权，后台唤醒不会在未授权时开启。'
      }
      return
    }

    if (props.currentSettings.sttProvider !== 'local') {
      emit('update:setting', 'sttProvider', 'local')
    }
    emit('update:setting', 'localSttEnabled', true)
    if (!props.currentSettings.localSttWakeWord?.trim()) {
      emit('update:setting', 'localSttWakeWord', DEFAULT_WAKE_WORD)
    }
    emit('update:setting', 'backgroundListeningEnabled', true)
    microphoneCheckResult.value =
      '麦克风已授权；后台唤醒已开启，Alice 将在托盘中等待唤醒词。'
    // The enable button is an explicit action rather than a form field. Save
    // its state immediately so closing the settings window cannot silently
    // discard a successfully prepared background session.
    emit('persist-settings')
  } finally {
    isEnablingBackgroundWake.value = false
  }
}

const handleBackgroundListeningToggle = async (event: Event) => {
  const checked = (event.target as HTMLInputElement).checked

  if (checked) {
    // Route the direct toggle through the same permission/device check as the
    // explicit "启用后台唤醒" button. This avoids persisting a misleading
    // enabled state when the OS denies access or no input device is present.
    await enableBackgroundWake()
    if (!props.currentSettings.backgroundListeningEnabled) {
      // The native checkbox toggles before the async permission check
      // completes. Roll it back immediately on failure so the visual state
      // never claims that background listening is active.
      ;(event.target as HTMLInputElement).checked = false
    }
    return
  }

  emit('update:setting', 'backgroundListeningEnabled', false)
  microphoneCheckResult.value = '后台唤醒已关闭，Alice 不会继续占用麦克风。'
  // Persist the opt-out immediately so the tray and login-start path stop the
  // background session even if the settings window is closed right away.
  emit('persist-settings')
}

type SystemPermissionTarget =
  'microphone' | 'screen-recording' | 'accessibility'

const openSystemPermissionSettings = async (
  target: SystemPermissionTarget,
  label: string
) => {
  try {
    if (!window.desktopAPI?.openSystemSettings) {
      microphoneCheckResult.value = '当前环境不支持直接打开系统权限设置。'
      return
    }
    const result = await window.desktopAPI.openSystemSettings(target)
    microphoneCheckResult.value = result.success
      ? `已打开系统${label}权限设置；完成授权后返回此处再检查状态。`
      : `无法打开系统设置：${result.error || '未知错误'}`
  } catch (error) {
    microphoneCheckResult.value = `无法打开系统设置，请手动进入系统设置中的“${label}”权限。`
    console.warn(`Failed to open ${label} settings:`, error)
  }
}

const openMicrophoneSettings = () =>
  openSystemPermissionSettings('microphone', '麦克风')

const updateServiceStatus = async () => {
  try {
    await backendApi.initialize()

    // Check each service status
    const [sttReady, ttsReady, embeddingsReady] = await Promise.all([
      backendApi.isSTTReady().catch(() => false),
      backendApi.isTTSReady().catch(() => false),
      backendApi.isEmbeddingsReady().catch(() => false),
    ])

    serviceStatus.value = {
      stt: { status: sttReady ? 'ready' : 'error' },
      tts: { status: ttsReady ? 'ready' : 'error' },
      embeddings: { status: embeddingsReady ? 'ready' : 'error' },
    }
  } catch (error) {
    console.warn('Failed to get service status:', error)
    serviceStatus.value = {
      stt: { status: 'offline' },
      tts: { status: 'offline' },
      embeddings: { status: 'offline' },
    }
  }
}

const updateMicrophonePermission = async () => {
  try {
    if (!window.desktopAPI?.getCapabilities) {
      microphonePermission.value = 'unknown'
      return
    }
    const capabilities = await window.desktopAPI.getCapabilities()
    desktopPlatform.value = capabilities.platform || 'unknown'
    microphonePermission.value = capabilities.microphonePermission || 'unknown'
    screenCapturePermission.value =
      capabilities.screenCapture?.permission || 'unknown'
    accessibilityPermission.value =
      capabilities.accessibilityPermission || 'unknown'
  } catch (error) {
    console.warn('Failed to get microphone permission status:', error)
    microphonePermission.value = 'unknown'
  }
}

const getServiceStatusClass = (service: 'stt' | 'tts' | 'embeddings') => {
  const status = serviceStatus.value[service].status
  switch (status) {
    case 'ready':
      return 'bg-green-500'
    case 'downloading':
      return 'bg-yellow-500'
    case 'error':
      return 'bg-red-500'
    case 'offline':
    default:
      return 'bg-gray-500'
  }
}

const getServiceStatusText = (service: 'stt' | 'tts' | 'embeddings') => {
  const status = serviceStatus.value[service].status
  const serviceNames = {
    stt: '语音识别',
    tts: '语音播报',
    embeddings: '向量',
  }

  switch (status) {
    case 'ready':
      return `${serviceNames[service]}服务已就绪`
    case 'downloading':
      return `${serviceNames[service]}模型正在下载`
    case 'error':
      return `${serviceNames[service]}服务存在错误`
    case 'offline':
    default:
      return `${serviceNames[service]}服务离线`
  }
}

// Voice management computed properties and functions
const groupedVoices = computed(() => {
  const groups: Record<string, Voice[]> = {}
  // Filter out male voices
  const femaleVoices = availableVoices.value.filter(
    voice => voice.gender !== 'male'
  )
  femaleVoices.forEach(voice => {
    const lang = voice.language || 'unknown'
    if (!groups[lang]) groups[lang] = []
    groups[lang].push(voice)
  })

  // Sort voices within each language group by name
  Object.keys(groups).forEach(lang => {
    groups[lang].sort((a, b) => a.name.localeCompare(b.name))
  })

  return groups
})

const getLanguageDisplayName = (langCode: string): string => {
  const languageMap: Record<string, string> = {
    'en-US': '英语（美国）',
    'en-GB': '英语（英国）',
    'es-ES': '西班牙语（西班牙）',
    'es-MX': '西班牙语（墨西哥）',
    'fr-FR': '法语',
    'de-DE': '德语',
    'it-IT': '意大利语',
    'pt-BR': '葡萄牙语（巴西）',
    'ru-RU': '俄语',
    'zh-CN': '中文（普通话）',
    'ja-JP': '日语',
    'nl-NL': '荷兰语',
    'no-NO': '挪威语',
    'sv-SE': '瑞典语',
    'da-DK': '丹麦语',
    'fi-FI': '芬兰语',
    'pl-PL': '波兰语',
    'uk-UA': '乌克兰语',
    'hi-IN': '印地语',
    'ar-JO': '阿拉伯语',
  }
  return languageMap[langCode] || langCode
}

const getLanguageFlag = (langCode: string): string => {
  const flagMap: Record<string, string> = {
    'en-US': '🇺🇸',
    'en-GB': '🇬🇧',
    'es-ES': '🇪🇸',
    'es-MX': '🇲🇽',
    'fr-FR': '🇫🇷',
    'de-DE': '🇩🇪',
    'it-IT': '🇮🇹',
    'pt-BR': '🇧🇷',
    'ru-RU': '🇷🇺',
    'zh-CN': '🇨🇳',
    'ja-JP': '🇯🇵',
    'nl-NL': '🇳🇱',
    'no-NO': '🇳🇴',
    'sv-SE': '🇸🇪',
    'da-DK': '🇩🇰',
    'fi-FI': '🇫🇮',
    'pl-PL': '🇵🇱',
    'uk-UA': '🇺🇦',
    'hi-IN': '🇮🇳',
    'ar-JO': '🇯🇴',
  }
  return flagMap[langCode] || '🌍'
}

const getVoiceDisplayName = (voice: Voice): string => {
  const quality = getVoiceQuality(voice.name)
  const genderIcon =
    voice.gender === 'male' ? '👨' : voice.gender === 'female' ? '👩' : '👥'
  return `${genderIcon} ${voice.description || voice.name} (${quality})`
}

const getVoiceQuality = (voiceName: string): string => {
  if (voiceName.includes('-x_low')) return 'x_low'
  if (voiceName.includes('-low')) return 'low'
  if (voiceName.includes('-medium')) return 'medium'
  if (voiceName.includes('-high')) return 'high'
  return 'unknown'
}

const previewVoice = async () => {
  if (!props.currentSettings.localTtsVoice || isPreviewingVoice.value) return

  isPreviewingVoice.value = true
  try {
    await backendApi.initialize()

    // Get sample text based on language
    const selectedVoice = availableVoices.value.find(
      v => v.name === props.currentSettings.localTtsVoice
    )
    const sampleTexts: Record<string, string> = {
      'en-US': 'Hello! This is a preview of the Amy voice.',
      'en-GB': 'Good day! This is a preview of this British voice.',
      'es-ES': 'Hola, este es un ejemplo de esta voz en español.',
      'es-MX': 'Hola, este es un ejemplo de esta voz mexicana.',
      'fr-FR': 'Bonjour, ceci est un exemple de cette voix française.',
      'de-DE': 'Hallo, das ist ein Beispiel dieser deutschen Stimme.',
      'it-IT': 'Ciao, questo è un esempio di questa voce italiana.',
      'pt-BR': 'Olá, este é um exemplo desta voz brasileira.',
      'ru-RU': 'Привет, это пример этого русского голоса.',
      'zh-CN': '你好，这是这个中文声音的示例。',
      'ja-JP': 'こんにちは、これはこの日本語の音声のサンプルです。',
      'nl-NL': 'Hallo, dit is een voorbeeld van deze Nederlandse stem.',
      'no-NO': 'Hei, dette er et eksempel på denne norske stemmen.',
      'sv-SE': 'Hej, det här är ett exempel på denna svenska röst.',
      'da-DK': 'Hej, dette er et eksempel på denne danske stemme.',
      'fi-FI': 'Hei, tämä on esimerkki tästä suomalaisesta äänestä.',
      'pl-PL': 'Cześć, to jest przykład tego polskiego głosu.',
      'uk-UA': 'Привіт, це приклад цього українського голосу.',
      'hi-IN': 'नमस्ते, यह इस हिंदी आवाज़ का उदाहरण है।',
      'ar-JO': 'مرحبا، هذا مثال على هذا الصوت العربي.',
    }

    const sampleText =
      sampleTexts[selectedVoice?.language || 'en-US'] ||
      'Hello, this is a voice preview.'

    const result = await backendApi.synthesizeSpeech(
      sampleText,
      props.currentSettings.localTtsVoice
    )

    // Play the audio
    const audioData = new Uint8Array(result.audio)
    const blob = new Blob([audioData], { type: 'audio/wav' })
    const audioUrl = URL.createObjectURL(blob)
    const audio = new Audio(audioUrl)

    audio.play().catch(console.error)

    // Clean up URL after playing
    audio.addEventListener('ended', () => {
      URL.revokeObjectURL(audioUrl)
    })
  } catch (error) {
    console.warn('Failed to preview voice:', error)
  } finally {
    isPreviewingVoice.value = false
  }
}

const refreshVoices = async () => {
  if (isRefreshingVoices.value) return

  isRefreshingVoices.value = true
  let lastError: unknown = null
  try {
    // The embedded Go backend may still be starting when the settings view
    // mounts. Retry briefly so the voice selector does not remain empty until
    // the user manually refreshes it.
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        await backendApi.initialize()
        if (!(await backendApi.isTTSReady())) {
          throw new Error('TTS service is not ready')
        }
        const voices = await backendApi.getAvailableVoices()
        availableVoices.value = voices
        console.log('Available voices loaded:', voices)
        return
      } catch (error) {
        lastError = error
        if (attempt < 4) {
          await new Promise(resolve => setTimeout(resolve, 350 * (attempt + 1)))
        }
      }
    }
    console.warn('Failed to load voices after retries:', lastError)
    availableVoices.value = []
  } finally {
    isRefreshingVoices.value = false
  }
}

const onVoiceChange = async () => {
  try {
    await backendApi.initialize()
    await backendApi.setDefaultVoice(props.currentSettings.localTtsVoice)
    console.log('Default voice updated:', props.currentSettings.localTtsVoice)
  } catch (error) {
    console.warn('Failed to update default voice:', error)
  }
}

onMounted(async () => {
  updateServiceStatus()
  updateMicrophonePermission()
  statusInterval = setInterval(() => {
    updateServiceStatus()
    updateMicrophonePermission()
  }, 10000) // Check every 10 seconds

  // Load voices if local TTS is selected
  if (props.currentSettings.ttsProvider === 'local') {
    await refreshVoices()
  }

  await refreshRagStats()
})

// Watch for TTS provider changes to load voices
watch(
  () => props.currentSettings.ttsProvider,
  async newProvider => {
    if (newProvider === 'local') {
      await refreshVoices()
    }
  }
)

onUnmounted(() => {
  if (statusInterval) {
    clearInterval(statusInterval)
    statusInterval = null
  }
})

const refreshRagStats = async () => {
  try {
    const result = await window.aliceIPC.invoke('rag:stats')
    if (result.success && result.data) {
      ragStats.value = result.data
    }
  } catch (error) {
    console.warn('Failed to load RAG stats:', error)
  }
}

const selectRagPaths = async () => {
  try {
    const result = await window.aliceIPC.invoke('rag:select-paths')
    if (!result.success || !Array.isArray(result.data)) {
      return
    }
    const updated = Array.from(
      new Set([...props.currentSettings.ragPaths, ...result.data])
    )
    emit('update:setting', 'ragPaths', updated)
    await indexRagPaths(updated)
  } catch (error) {
    console.warn('Failed to select RAG paths:', error)
  }
}

const indexRagPaths = async (paths: string[]) => {
  const normalizedPaths = Array.from(paths || []).map(String)
  if (normalizedPaths.length === 0) return
  isIndexingRag.value = true
  ragStatusMessage.value = '正在建立索引…'
  try {
    const result = await window.aliceIPC.invoke('rag:index-paths', {
      paths: normalizedPaths,
      recursive: true,
    })
    if (result.success && result.data) {
      ragStatusMessage.value = `已建立 ${result.data.indexed} 个，跳过 ${result.data.skipped} 个`
    } else {
      ragStatusMessage.value = result.error || '建立索引失败'
    }
  } catch (error) {
    ragStatusMessage.value = '建立索引失败'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}

const reindexRag = async () => {
  await indexRagPaths(props.currentSettings.ragPaths)
}

const clearRagIndex = async () => {
  isIndexingRag.value = true
  ragStatusMessage.value = '正在清空索引…'
  try {
    await window.aliceIPC.invoke('rag:clear')
    ragStatusMessage.value = '索引已清空'
  } catch (error) {
    ragStatusMessage.value = '清空索引失败'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}

const removeRagPath = (pathItem: string) => {
  const updated = props.currentSettings.ragPaths.filter(
    item => item !== pathItem
  )
  emit('update:setting', 'ragPaths', updated)
  removeRagDocuments(pathItem)
}

const removeRagDocuments = async (pathItem: string) => {
  isIndexingRag.value = true
  ragStatusMessage.value = '正在移除文档…'
  try {
    const result = await window.aliceIPC.invoke('rag:remove-paths', {
      paths: [pathItem],
    })
    if (result.success && result.data) {
      ragStatusMessage.value = `已移除 ${result.data.removed} 个文档`
    } else {
      ragStatusMessage.value = result.error || '移除文档失败'
    }
  } catch (error) {
    ragStatusMessage.value = '移除文档失败'
  } finally {
    isIndexingRag.value = false
    await refreshRagStats()
  }
}
</script>
