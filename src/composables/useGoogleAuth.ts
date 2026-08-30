import { reactive, onMounted, onUnmounted } from 'vue'

interface GoogleAuthStatus {
  isAuthenticated: boolean
  authInProgress: boolean
  isLoading: boolean
  error: string | null
  message: string | null
}

export function useGoogleAuth() {
  const googleAuthStatus = reactive<GoogleAuthStatus>({
    isAuthenticated: false,
    authInProgress: false,
    isLoading: false,
    error: null,
    message: null,
  })

  async function checkGoogleAuthStatus() {
    googleAuthStatus.isLoading = true
    googleAuthStatus.error = null
    try {
      const result = await window.aliceIPC.invoke(
        'google-calendar:check-auth-status'
      )
      if (result.success)
        googleAuthStatus.isAuthenticated = result.isAuthenticated
    } catch (e: any) {
      googleAuthStatus.error = '检查 Google 授权状态失败：' + e.message
    } finally {
      googleAuthStatus.isLoading = false
    }
  }

  async function connectGoogleServices() {
    googleAuthStatus.isLoading = true
    googleAuthStatus.authInProgress = true
    googleAuthStatus.error = null
    googleAuthStatus.message = null
    try {
      const result = await window.aliceIPC.invoke(
        'google-calendar:get-auth-url'
      )
      if (result.success) googleAuthStatus.message = result.message
      else {
        googleAuthStatus.error =
          result.error || '无法启动 Google 授权。'
        googleAuthStatus.authInProgress = false
      }
    } catch (e: any) {
      googleAuthStatus.error = '发起 Google 授权失败：' + e.message
      googleAuthStatus.authInProgress = false
    } finally {
      googleAuthStatus.isLoading = false
    }
  }

  async function disconnectGoogleServices() {
    googleAuthStatus.isLoading = true
    googleAuthStatus.error = null
    googleAuthStatus.message = '正在断开 Google 连接…'
    try {
      const result = await window.aliceIPC.invoke(
        'google-calendar:disconnect'
      )
      if (result.success) {
        googleAuthStatus.isAuthenticated = false
        googleAuthStatus.authInProgress = false
        googleAuthStatus.message = result.message
      } else {
        googleAuthStatus.error =
          result.error || '无法断开 Google 连接。'
        googleAuthStatus.message = null
      }
    } catch (e: any) {
      googleAuthStatus.error = '断开 Google 连接失败：' + e.message
      googleAuthStatus.message = null
    } finally {
      googleAuthStatus.isLoading = false
    }
  }

  function handleGoogleAuthSuccess(message: string) {
    googleAuthStatus.isAuthenticated = true
    googleAuthStatus.authInProgress = false
    googleAuthStatus.message = message
    googleAuthStatus.error = null
  }

  function handleGoogleAuthError(errorMsg: string) {
    googleAuthStatus.isAuthenticated = false
    googleAuthStatus.authInProgress = false
    googleAuthStatus.error = `Google 授权失败：${errorMsg}`
    googleAuthStatus.message = null
  }

  onMounted(async () => {
    await checkGoogleAuthStatus()
    if (window.aliceIPC) {
      window.aliceIPC.on(
        'google-auth-loopback-success',
        handleGoogleAuthSuccess
      )
      window.aliceIPC.on('google-auth-loopback-error', handleGoogleAuthError)
    }
  })

  onUnmounted(() => {
    if (window.aliceIPC) {
      window.aliceIPC.off(
        'google-auth-loopback-success',
        handleGoogleAuthSuccess
      )
      window.aliceIPC.off(
        'google-auth-loopback-error',
        handleGoogleAuthError
      )
    }
  })

  return {
    googleAuthStatus,
    checkGoogleAuthStatus,
    connectGoogleServices,
    disconnectGoogleServices,
  }
}
