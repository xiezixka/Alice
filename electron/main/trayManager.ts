import { app, Menu, nativeImage, Tray } from 'electron'
import path from 'node:path'
import {
  createMainWindow,
  createSettingsWindow,
  focusMainWindow,
  getVitePublic,
} from './windowManager'

let tray: Tray | null = null
let backgroundListeningEnabled = false

function showAliceWindow(): void {
  if (!focusMainWindow()) {
    void createMainWindow()
  }
}

function getTrayIcon() {
  const iconPath = path.join(getVitePublic(), 'app_logo.png')
  const source = nativeImage.createFromPath(iconPath)
  if (source.isEmpty()) {
    console.warn('[Tray] Could not load tray icon:', iconPath)
    return nativeImage.createEmpty()
  }

  // Keep the menu-bar icon compact on macOS and Windows. The source artwork
  // remains unchanged for the window/taskbar icon.
  return source.resize({ width: 18, height: 18 })
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '显示 Alice',
      click: showAliceWindow,
    },
    {
      label: '打开设置',
      click: () => {
        void createSettingsWindow()
      },
    },
    {
      label: `后台语音监听：${backgroundListeningEnabled ? '已开启' : '未开启'}`,
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '退出 Alice',
      click: () => app.quit(),
    },
  ])
}

export function createTray(enabled = false): Tray {
  backgroundListeningEnabled = enabled

  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu())
    return tray
  }

  tray = new Tray(getTrayIcon())
  tray.setToolTip('Alice 桌面助手')
  tray.setContextMenu(buildTrayMenu())
  tray.on('click', showAliceWindow)
  tray.on('double-click', showAliceWindow)
  console.log('[Tray] System tray initialized')
  return tray
}

export function setTrayBackgroundListening(enabled: boolean): void {
  backgroundListeningEnabled = enabled
  if (tray && !tray.isDestroyed()) {
    tray.setContextMenu(buildTrayMenu())
  }
}

export function destroyTray(): void {
  if (tray && !tray.isDestroyed()) {
    tray.destroy()
  }
  tray = null
}
