import { ipcMain, shell } from 'electron'
import http from 'node:http'
import { URL } from 'node:url'
import * as googleAuthManager from './googleAuthManager'
import { getMainWindow } from './windowManager'

const OAUTH_SERVER_PORT = 9876
let authServer: http.Server | null = null
let authIPCHandlersRegistered = false

export function registerAuthIPCHandlers(): void {
  if (authIPCHandlersRegistered) {
    return
  }
  authIPCHandlersRegistered = true
  ipcMain.handle('google-calendar:get-auth-url', async () => {
    try {
      await startAuthServer()
      const oAuth2Client = googleAuthManager.getOAuth2Client()
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: [
          'https://www.googleapis.com/auth/calendar',
          'https://www.googleapis.com/auth/gmail.readonly',
          'https://www.googleapis.com/auth/gmail.compose',
          'https://www.googleapis.com/auth/gmail.send',
        ],
      })
      console.log(
        '[IPC get-auth-url] Generated auth URL:',
        authUrl.substring(0, 100) + '...'
      )
      shell.openExternal(authUrl)
      return {
        success: true,
        message: '请在浏览器中完成授权。浏览器窗口或标签页已打开。',
      }
    } catch (error: any) {
      console.error(
        '[IPC get-auth-url] Failed to start auth server or generate URL:',
        error
      )
      return {
        success: false,
        error: `发起 Google 授权失败：${error.message}`,
      }
    }
  })

  ipcMain.handle('google-calendar:check-auth-status', async () => {
    const tokens = await googleAuthManager.loadTokens()
    return { success: true, isAuthenticated: !!tokens }
  })

  ipcMain.handle('google-calendar:disconnect', async () => {
    await googleAuthManager.clearTokens()
    stopAuthServer()
    return { success: true, message: '已断开 Google 服务。' }
  })
}

function closeAuthWindowAndNotify(
  success: boolean,
  messageOrError: string
): void {
  const win = getMainWindow()
  if (success) {
    console.log('[AuthServer] OAuth Success:', messageOrError)
    win?.webContents.send('google-auth-loopback-success', messageOrError)
  } else {
    console.error('[AuthServer] OAuth Error:', messageOrError)
    win?.webContents.send('google-auth-loopback-error', messageOrError)
  }
}

function startAuthServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (authServer && authServer.listening) {
      console.log('[AuthServer] Server already running.')
      resolve()
      return
    }

    authServer = http.createServer(async (req, res) => {
      try {
        if (!req.url) {
          res.writeHead(400, { 'Content-Type': 'text/plain' })
          res.end('请求无效：缺少 URL。')
          return
        }
        const requestUrl = new URL(
          req.url,
          `http://127.0.0.1:${OAUTH_SERVER_PORT}`
        )
        const pathName = requestUrl.pathname

        if (pathName === '/oauth2callback') {
          const code = requestUrl.searchParams.get('code')
          const error = requestUrl.searchParams.get('error')

          if (error) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(
              `<h1>授权失败</h1><p>${error}</p><p>现在可以关闭此窗口。</p>`
            )
            closeAuthWindowAndNotify(false, `OAuth 错误：${error}`)
            stopAuthServer()
          } else if (code) {
            await googleAuthManager.getTokensFromCode(code)
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(
              '<h1>授权成功！</h1><p>现在可以关闭此浏览器窗口或标签页，然后返回 Alice。</p>'
            )
            closeAuthWindowAndNotify(
              true,
              'Google 授权成功。'
            )
            stopAuthServer()
          } else {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(
              '<h1>授权失败</h1><p>回调中没有收到授权码或错误信息。</p><p>现在可以关闭此窗口。</p>'
            )
            closeAuthWindowAndNotify(
              false,
              '回调中没有收到授权码或错误信息。'
            )
            stopAuthServer()
          }
        } else {
          console.log(`[AuthServer] Ignoring request for path: ${pathName}`)
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('未找到请求的页面。')
        }
      } catch (e: any) {
        console.error('[AuthServer] Error processing auth request:', e)
        res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(
          '<h1>服务器内部错误</h1><p>处理授权时发生错误，请稍后重试。</p>'
        )
        closeAuthWindowAndNotify(
          false,
          `处理授权时发生服务器错误：${e.message}`
        )
        stopAuthServer()
      }
    })

    authServer.on('error', (e: NodeJS.ErrnoException) => {
      console.error('[AuthServer] Server error:', e)
      if (e.code === 'EADDRINUSE') {
        console.error(
          `[AuthServer] Port ${OAUTH_SERVER_PORT} is already in use. Cannot start auth server.`
        )
        reject(new Error(`端口 ${OAUTH_SERVER_PORT} 已被占用。`))
      } else {
        reject(e)
      }
      authServer = null
    })

    authServer.listen(OAUTH_SERVER_PORT, '127.0.0.1', () => {
      console.log(
        `[AuthServer] Listening on http://127.0.0.1:${OAUTH_SERVER_PORT}`
      )
      resolve()
    })
  })
}

export function stopAuthServer(): void {
  if (authServer) {
    authServer.close(() => {
      console.log('[AuthServer] Server stopped.')
      authServer = null
    })
  }
}
