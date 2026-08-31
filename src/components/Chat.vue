<template>
  <div class="flex-1 pr-2">
    <div
      v-if="isConversationReady && chatHistoryDisplay.length === 0"
      class="chat-empty-state"
      aria-label="开始与 Alice 对话"
    >
      <div class="chat-empty-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            d="m12 3 1.35 4.65L18 9l-4.65 1.35L12 15l-1.35-4.65L6 9l4.65-1.35L12 3Z"
            stroke-width="1.5"
            stroke-linejoin="round"
          />
          <path
            d="m19 14 .62 2.38L22 17l-2.38.62L19 20l-.62-2.38L16 17l2.38-.62L19 14Z"
            stroke-width="1.35"
            stroke-linejoin="round"
          />
        </svg>
      </div>
      <p class="chat-empty-title">今天想让我帮你做什么？</p>
      <p class="chat-empty-copy">直接输入任务，或说出你的想法。</p>
      <div class="chat-empty-chips" aria-hidden="true">
        <span>整理文件</span>
        <span>规划行程</span>
        <span>回复消息</span>
      </div>
    </div>
    <transition-group name="list" tag="div">
      <div
        class="chat mb-2"
        v-for="(message, index) in chatHistoryDisplay"
        :key="
          message.api_message_id ||
          message.local_id_temp ||
          message.id ||
          `local-${index}`
        "
        :class="{
          'chat-start':
            message.role === 'assistant' || message.role === 'system',
          'chat-end': message.role === 'user',
        }"
      >
        <div
          class="chat-bubble mb-2"
          :class="{
            'chat-bubble-primary': message.role === 'assistant',
            'chat-bubble-accent': message.role === 'developer',
            'chat-bubble-info': message.role === 'system',
          }"
          v-html="getDisplayableMessageContent(message)"
          @click="handleChatClick"
        ></div>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useGeneralStore } from '../stores/generalStore'
import { useConversationStore } from '../stores/conversationStore'
import type { ChatMessage, AppChatMessageContentPart } from '../types/chat'
import { messageMarkdown } from '../utils/markdown'
import { storeToRefs } from 'pinia'

const generalStore = useGeneralStore()
const conversationStore = useConversationStore()
const { chatHistory } = storeToRefs(generalStore)

const isConversationReady = computed(() => conversationStore.isInitialized)

const chatHistoryDisplay = computed(() => {
  return [...chatHistory.value].reverse().filter(message => {
    const isGenerallyDisplayableRole =
      message.role === 'assistant' ||
      message.role === 'system' ||
      message.role === 'developer' ||
      message.role === 'user'

    if (!isGenerallyDisplayableRole) {
      return false
    }

    if (message.role === 'assistant') {
      if (typeof message.content === 'string') {
        if (message.content.trim() === '') {
          return false
        }
      } else if (Array.isArray(message.content)) {
        if (message.content.length === 0) {
          return false
        }
        const hasDisplayableContent = message.content.some(
          part =>
            (part.type === 'app_text' &&
              part.text &&
              part.text.trim() !== '') ||
            part.type === 'app_generated_image_path' ||
            (part.type === 'app_error' && part.text && part.text.trim() !== '')
        )
        if (!hasDisplayableContent) {
          return false
        }
      } else if (message.content == null) {
        return false
      }
    }

    return true
  })
})

const openImageWithSystemViewer = (absoluteFilePath: string) => {
  if (!absoluteFilePath) {
    console.warn('Cannot open image: No absolute path provided.')
    return
  }
  const correctedPath = absoluteFilePath.replace(/\\/g, '/')
  console.log(
    `Requesting to open image with system viewer at OS path: ${correctedPath}`
  )
  window.aliceIPC
    .invoke('electron:open-path', { target: correctedPath })
    .then(result => {
      if (!result.success) {
        console.error(
          "Failed to open image via IPC ('electron:open-path'):",
          result.message
        )
      }
    })
    .catch(err =>
      console.error("Error invoking 'electron:open-path' for image:", err)
    )
}

const getDisplayableMessageContent = (message: ChatMessage): string => {
  if (typeof message.content === 'string') {
    return messageMarkdown(message.content)
  } else if (Array.isArray(message.content)) {
    let combinedHtml = ''
    for (const part of message.content as AppChatMessageContentPart[]) {
      if (part.type === 'app_text' && part.text) {
        if (part.text.trim() !== '') {
          if (part.isScheduledReminder) {
            const timeStr = part.timestamp
              ? new Date(part.timestamp).toLocaleTimeString()
              : ''
            combinedHtml += `
              <div class="scheduled-reminder-container my-2 p-3 bg-gradient-to-r from-orange-500/20 to-yellow-500/20 border-l-4 border-orange-400 rounded-r-lg">
                <div class="flex items-center gap-2 mb-1">
                  <span class="text-lg">⏰</span>
                  <span class="text-sm font-medium text-orange-200">定时提醒</span>
                  ${timeStr ? `<span class="text-xs text-gray-300 ml-auto">${timeStr}</span>` : ''}
                </div>
                <div class="text-white">${messageMarkdown(part.text)}</div>
                ${part.taskName ? `<div class="text-xs text-gray-300 mt-1 italic">任务：${part.taskName}</div>` : ''}
              </div>
            `
          } else {
            combinedHtml += messageMarkdown(part.text) + '<br/>'
          }
        }
      } else if (part.type === 'app_file' && part.fileName) {
        combinedHtml += `
          <div class="attached-file my-2 p-2 bg-gray-700/50 rounded-lg flex items-center gap-2 max-w-xs">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="w-6 h-6 shrink-0">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
            </svg>
            <span class="font-mono text-sm truncate" title="${part.fileName}">${part.fileName}</span>
          </div>
          <br/>`
      } else if (
        part.type === 'app_generated_image_path' &&
        part.path &&
        part.absolutePathForOpening
      ) {
        const imageSrcForDisplay = `alice-image://${part.path}`
        const imageClass = part.isPartial
          ? 'partial-image-preview'
          : 'final-image'
        const titleText = part.isPartial
          ? `图片预览 ${part.partialIndex || ''}（如可用，点击打开）`
          : '已生成图片（点击打开）'

        combinedHtml += `
          <div class="generated-image-container my-2 ${imageClass}">
            <img 
              src="${imageSrcForDisplay}" 
              alt="${titleText}" 
              class="max-w-xs md:max-w-sm rounded-lg cursor-pointer shadow-lg generated-alice-image" 
              data-absolute-path="${part.absolutePathForOpening}"
              title="${titleText}"
            />
            ${part.isPartial ? `<span class="text-xs text-gray-400 block text-center">生成中…</span>` : ''}
          </div>
          <br/>`
      } else if (part.type === 'app_image_uri' && part.uri) {
        combinedHtml += `
          <img 
            src="${part.uri}" 
            alt="用户提供的图片"
            class="max-w-xs md:max-w-sm rounded-lg my-2 shadow-lg" 
            title="用户提供的图片"
          />
          <br/>`
      } else if (part.type === 'app_error' && part.text) {
        const errorTypeDisplay = part.errorType ? ` (${part.errorType})` : ''
        const errorCodeDisplay = part.errorCode ? ` [${part.errorCode}]` : ''
        const errorParamDisplay = part.errorParam
          ? ` - Parameter: ${part.errorParam}`
          : ''

        combinedHtml += `
          <div class="error-message-container my-3 p-4 bg-gradient-to-r from-red-500/20 to-red-600/20 border-l-4 border-red-500 rounded-r-lg">
            <div class="flex items-start gap-3">
              <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6 text-red-400 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div class="flex-1">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-sm font-semibold text-red-300">错误${errorTypeDisplay}</span>
                  ${errorCodeDisplay ? `<span class="text-xs text-gray-400">${errorCodeDisplay}</span>` : ''}
                </div>
                <div class="text-white text-sm leading-relaxed">${part.text}</div>
                ${errorParamDisplay ? `<div class="text-xs text-gray-400 mt-2 italic">${errorParamDisplay}</div>` : ''}
              </div>
            </div>
          </div>
        `
      }
    }

    return combinedHtml.length > 5 && combinedHtml.endsWith('<br/>')
      ? combinedHtml.slice(0, -5)
      : combinedHtml || (message.role === 'assistant' ? '...' : '')
  }
  return messageMarkdown('错误：无法显示消息内容。')
}

const handleChatClick = (event: MouseEvent) => {
  let targetElement = event.target as HTMLElement

  // Handle generated image clicks
  if (
    targetElement.tagName === 'IMG' &&
    targetElement.classList.contains('generated-alice-image')
  ) {
    const absoluteImagePath = targetElement.getAttribute('data-absolute-path')
    if (absoluteImagePath) {
      openImageWithSystemViewer(absoluteImagePath)
      event.preventDefault()
      return
    } else {
      console.warn(
        "Clicked generated image has no 'data-absolute-path' attribute."
      )
    }
  }

  // Handle link clicks
  for (
    let i = 0;
    i < 3 && targetElement && targetElement !== event.currentTarget;
    i++
  ) {
    if (targetElement.tagName === 'A') {
      const href = targetElement.getAttribute('href')
      if (
        href &&
        (href.startsWith('http://') ||
          href.startsWith('https://') ||
          href.startsWith('mailto:'))
      ) {
        event.preventDefault()
        window.aliceIPC
          .invoke('electron:open-path', { target: href })
          .then(result => {
            if (!result.success) {
              console.error(
                "Failed to open external link via IPC ('electron:open-path'):",
                result.message
              )
            }
          })
          .catch(err => {
            console.error("Error invoking 'electron:open-path' for link:", err)
          })
        return
      }
    }
    if (targetElement.parentElement) {
      targetElement = targetElement.parentElement
    } else {
      break
    }
  }
}
</script>

<style scoped>
.list-enter-active,
.list-leave-active {
  transition: all 0.5s ease;
}
.list-enter-from,
.list-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

.partial-image-preview img {
  border: 2px dashed #00f5cc;
  opacity: 0.8;
}
.final-image img {
  border: 2px solid #5865f2;
}

.chat-bubble {
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.chat-bubble * {
  word-break: break-word;
  overflow-wrap: break-word;
  max-width: 100%;
}

.chat-bubble p,
.chat-bubble div,
.chat-bubble span,
.chat-bubble code {
  word-break: break-all;
  overflow-wrap: anywhere;
}

.chat-bubble pre {
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
}

.chat-empty-state {
  display: flex;
  min-height: 258px;
  margin: 12px 0 16px;
  padding: 28px 24px 24px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(168, 207, 255, 0.14);
  border-radius: 20px;
  background:
    radial-gradient(
      circle at 50% 0%,
      rgba(118, 231, 255, 0.12),
      transparent 48%
    ),
    linear-gradient(160deg, rgba(31, 52, 86, 0.5), rgba(7, 15, 32, 0.36));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 12px 26px rgba(2, 8, 22, 0.12);
  text-align: center;
}

.chat-empty-icon {
  display: grid;
  width: 44px;
  height: 44px;
  margin-bottom: 14px;
  place-items: center;
  border: 1px solid rgba(118, 231, 255, 0.26);
  border-radius: 14px;
  color: #a8f0ff;
  background: rgba(118, 231, 255, 0.09);
  box-shadow: 0 0 24px rgba(118, 231, 255, 0.12);
}

.chat-empty-icon svg {
  width: 24px;
  height: 24px;
}

.chat-empty-title {
  margin: 0;
  color: rgba(245, 249, 255, 0.94);
  font-size: 0.98rem;
  font-weight: 650;
}

.chat-empty-copy {
  max-width: 260px;
  margin: 8px 0 18px;
  color: rgba(205, 219, 240, 0.62);
  font-size: 0.78rem;
  line-height: 1.5;
}

.chat-empty-chips {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 7px;
}

.chat-empty-chips span {
  padding: 5px 9px;
  border: 1px solid rgba(168, 207, 255, 0.16);
  border-radius: 999px;
  color: rgba(220, 232, 251, 0.68);
  background: rgba(8, 16, 34, 0.32);
  font-size: 0.68rem;
}

:deep(.rag-citation) {
  display: inline-block;
  padding: 0.15rem 0.35rem;
  margin-left: 0.15rem;
  border-radius: 999px;
  font-size: 0.65rem;
  background: rgba(0, 0, 0, 0.15);
  cursor: default;
}
</style>
