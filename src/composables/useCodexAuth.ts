import { reactive, onMounted, onUnmounted } from 'vue'
import { useSettingsStore } from '../stores/settingsStore'

interface CodexAuthStatus {
  available: boolean
  isAuthenticated: boolean
  authInProgress: boolean
  isLoading: boolean
  accountLabel: string
  error: string | null
  message: string | null
}

interface CodexAccountStatusPayload {
  available?: boolean
  connected?: boolean
  accountLabel?: string
  error?: string
}

export function useCodexAuth() {
  const settingsStore = useSettingsStore()
  const codexAuthStatus = reactive<CodexAuthStatus>({
    available: true,
    isAuthenticated: false,
    authInProgress: false,
    isLoading: false,
    accountLabel: '',
    error: null,
    message: null,
  })

  function syncSettings(status: CodexAccountStatusPayload) {
    const connected = Boolean(status.connected)
    const accountLabel = connected ? status.accountLabel || '已连接' : ''
    codexAuthStatus.available = status.available !== false
    codexAuthStatus.isAuthenticated = connected
    codexAuthStatus.accountLabel = accountLabel

    settingsStore.updateSetting('codexAuthConnected', connected)
    settingsStore.updateSetting('codexAccountLabel', accountLabel)
  }

  async function checkCodexAuthStatus() {
    codexAuthStatus.isLoading = true
    codexAuthStatus.error = null
    try {
      const result = await window.aliceIPC.invoke('codex-auth:status')
      syncSettings(result || {})
      if (result?.error) {
        codexAuthStatus.error = result.error
      }
    } catch (error: any) {
      codexAuthStatus.available = false
      codexAuthStatus.isAuthenticated = false
      codexAuthStatus.error =
        '检查 ChatGPT Codex 授权状态失败：' + error.message
      settingsStore.updateSetting('codexAuthConnected', false)
      settingsStore.updateSetting('codexAccountLabel', '')
    } finally {
      codexAuthStatus.isLoading = false
    }
  }

  async function startCodexAuth() {
    codexAuthStatus.isLoading = true
    codexAuthStatus.authInProgress = true
    codexAuthStatus.error = null
    codexAuthStatus.message = null
    try {
      const result = await window.aliceIPC.invoke('codex-auth:start-login')
      if (result?.success) {
        codexAuthStatus.message =
          '已在浏览器中打开 ChatGPT 授权页面。'
      } else {
        codexAuthStatus.error =
          result?.error || '无法启动 ChatGPT Codex 授权。'
        codexAuthStatus.authInProgress = false
      }
    } catch (error: any) {
      codexAuthStatus.error =
        '启动 ChatGPT Codex 授权失败：' + error.message
      codexAuthStatus.authInProgress = false
    } finally {
      codexAuthStatus.isLoading = false
    }
  }

  async function disconnectCodex() {
    codexAuthStatus.isLoading = true
    codexAuthStatus.error = null
    codexAuthStatus.message = '正在断开 ChatGPT Codex 连接…'
    try {
      const result = await window.aliceIPC.invoke('codex-auth:disconnect')
      if (result?.success) {
        syncSettings({ available: true, connected: false })
        codexAuthStatus.authInProgress = false
        codexAuthStatus.message = 'ChatGPT Codex 已断开。'
      } else {
        codexAuthStatus.error =
          result?.error || '无法断开 ChatGPT Codex 连接。'
        codexAuthStatus.message = null
      }
    } catch (error: any) {
      codexAuthStatus.error =
        '断开 ChatGPT Codex 连接失败：' + error.message
      codexAuthStatus.message = null
    } finally {
      codexAuthStatus.isLoading = false
    }
  }

  function handleCodexLoginCompleted(payload: any) {
    codexAuthStatus.authInProgress = false
    if (payload?.success === false) {
      codexAuthStatus.isAuthenticated = false
      codexAuthStatus.error =
        payload?.error || 'ChatGPT Codex 授权失败。'
      codexAuthStatus.message = null
      return
    }
    codexAuthStatus.message = 'ChatGPT Codex 授权已完成。'
    codexAuthStatus.error = null
    void checkCodexAuthStatus()
  }

  function handleCodexStatusChanged(
    payload: CodexAccountStatusPayload
  ) {
    codexAuthStatus.authInProgress = false
    syncSettings(payload || {})
    codexAuthStatus.error = payload?.error || null
    codexAuthStatus.message = payload?.connected
      ? 'ChatGPT Codex 已连接。'
      : null
  }

  function handleCodexAccountUpdated() {
    void checkCodexAuthStatus()
  }

  onMounted(async () => {
    await checkCodexAuthStatus()
    if (window.aliceIPC) {
      window.aliceIPC.on(
        'codex-auth-login-completed',
        handleCodexLoginCompleted
      )
      window.aliceIPC.on(
        'codex-auth-status-changed',
        handleCodexStatusChanged
      )
      window.aliceIPC.on('codex-auth-updated', handleCodexAccountUpdated)
    }
  })

  onUnmounted(() => {
    if (window.aliceIPC) {
      window.aliceIPC.off(
        'codex-auth-login-completed',
        handleCodexLoginCompleted
      )
      window.aliceIPC.off(
        'codex-auth-status-changed',
        handleCodexStatusChanged
      )
      window.aliceIPC.off('codex-auth-updated', handleCodexAccountUpdated)
    }
  })

  return {
    codexAuthStatus,
    checkCodexAuthStatus,
    startCodexAuth,
    disconnectCodex,
  }
}
