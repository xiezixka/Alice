import { ref } from 'vue'
import { useGeneralStore } from '../stores/generalStore'
import { storeToRefs } from 'pinia'

type IpcListener = (...args: any[]) => void

export function useScreenshot() {
  const generalStore = useGeneralStore()
  const { statusMessage, isRecordingRequested, takingScreenShot } =
    storeToRefs(generalStore)

  const screenShot = ref<string>('')
  const screenshotReady = ref<boolean>(false)
  const isElectron = typeof window !== 'undefined' && (window as any)?.electron

  let handleScreenshotCapturedListener: IpcListener | null = null
  let handleOverlayClosedListener: IpcListener | null = null

  const takeScreenShot = async () => {
    if (isElectron && !takingScreenShot.value) {
      takingScreenShot.value = true
      screenshotReady.value = false
      screenShot.value = ''
      statusMessage.value = '正在截屏…'
      try {
        await window.aliceIPC.invoke('show-overlay')
        console.log('Screenshot overlay requested.')
      } catch (error) {
        console.error('Error showing screenshot overlay:', error)
        statusMessage.value = '错误：无法开始截屏'
        takingScreenShot.value = false
      }
    } else if (!isElectron) {
      statusMessage.value = '网页模式下无法截屏。'
    } else {
      console.log('Screenshot request ignored, already in progress.')
    }
  }

  const setupScreenshotListeners = () => {
    if (isElectron) {
      handleScreenshotCapturedListener = async () => {
        try {
          const dataURI = await window.aliceIPC.invoke('get-screenshot')
          if (dataURI) {
            screenShot.value = dataURI
            screenshotReady.value = true
            statusMessage.value = '截屏已准备好'
          } else {
            statusMessage.value = '错误：截屏内容为空'
            screenshotReady.value = false
          }
        } catch (error) {
          console.error('Error retrieving screenshot via IPC:', error)
          statusMessage.value = '错误：获取截屏失败'
          screenshotReady.value = false
        }
      }

      handleOverlayClosedListener = () => {
        if (takingScreenShot.value) {
          if (!screenshotReady.value) {
            statusMessage.value = isRecordingRequested.value
              ? 'Listening...'
              : 'Stand by'
          }
          takingScreenShot.value = false
          window.aliceIPC?.invoke('focus-main-window')
        }
      }

      window.aliceIPC.on(
        'screenshot-captured',
        handleScreenshotCapturedListener
      )
      window.aliceIPC.on('overlay-closed', handleOverlayClosedListener)
    } else {
      console.log('Not in Electron, skipping screenshot listener setup.')
    }
  }

  const cleanupScreenshotListeners = () => {
    if (isElectron) {
      try {
        if (handleScreenshotCapturedListener) {
          window.aliceIPC.off(
            'screenshot-captured',
            handleScreenshotCapturedListener
          )
        }
        if (handleOverlayClosedListener) {
          window.aliceIPC.off('overlay-closed', handleOverlayClosedListener)
        }
      } catch (error) {
        console.error('Error removing screenshot IPC listeners:', error)
      } finally {
        handleScreenshotCapturedListener = null
        handleOverlayClosedListener = null
      }
    }
  }

  return {
    screenShot,
    screenshotReady,
    takeScreenShot,
    setupScreenshotListeners,
    cleanupScreenshotListeners,
  }
}
