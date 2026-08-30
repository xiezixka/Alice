import { beforeEach, describe, expect, it, vi } from 'vitest'

let createPinia: typeof import('pinia').createPinia
let setActivePinia: typeof import('pinia').setActivePinia
let useSettingsStore: typeof import('../settingsStore').useSettingsStore

describe('useSettingsStore boolean settings', () => {
  beforeEach(async () => {
    ;({ createPinia, setActivePinia } = await import('pinia'))
    ;({ useSettingsStore } = await import('../settingsStore'))
    setActivePinia(createPinia())
  })

  it('keeps background listening and launch-at-login values boolean', () => {
    const store = useSettingsStore()

    store.updateSetting('backgroundListeningEnabled', true)
    store.updateSetting('launchAtLogin', false)

    expect(store.settings.backgroundListeningEnabled).toBe(true)
    expect(store.settings.launchAtLogin).toBe(false)
    expect(typeof store.settings.backgroundListeningEnabled).toBe('boolean')
    expect(typeof store.settings.launchAtLogin).toBe('boolean')
  })

  it('does not turn a false toggle into a truthy string', () => {
    const store = useSettingsStore()

    store.updateSetting('backgroundListeningEnabled', false)

    expect(store.settings.backgroundListeningEnabled).toBe(false)
    expect(Boolean(store.settings.backgroundListeningEnabled)).toBe(false)
  })

  it('automatically disables background listening when voice prerequisites change', () => {
    const store = useSettingsStore()

    store.updateSetting('backgroundListeningEnabled', true)
    expect(store.settings.backgroundListeningEnabled).toBe(true)

    store.updateSetting('localSttEnabled', false)
    expect(store.settings.backgroundListeningEnabled).toBe(false)

    // Direct attempts to re-enable the flag while local wake words are off
    // must fail closed as well.
    store.updateSetting('backgroundListeningEnabled', true)
    expect(store.settings.backgroundListeningEnabled).toBe(false)

    store.updateSetting('localSttEnabled', true)
    store.updateSetting('sttProvider', 'groq')
    store.updateSetting('backgroundListeningEnabled', true)
    expect(store.settings.backgroundListeningEnabled).toBe(false)
  })

  it('migrates an invalid persisted background flag during settings load', async () => {
    const saveSettings = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', {
      settingsAPI: {
        loadSettings: vi.fn(async () => ({
          sttProvider: 'groq',
          localSttEnabled: true,
          localSttWakeWord: 'alice',
          backgroundListeningEnabled: true,
        })),
        saveSettings,
      },
    })

    try {
      const store = useSettingsStore()
      await store.loadSettings()

      expect(store.settings.backgroundListeningEnabled).toBe(false)
      expect(saveSettings).toHaveBeenCalled()
      expect(
        (
          saveSettings.mock.calls as unknown as Array<[Record<string, any>]>
        ).some(([payload]) => payload.backgroundListeningEnabled === false)
      ).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('ships Chinese desktop-agent defaults without enabling the microphone', () => {
    const store = useSettingsStore()

    expect(store.settings.aiProvider).toBe('deepseek')
    expect(store.settings.assistantModel).toBe('deepseek-v4-flash-vision-exp')
    expect(store.settings.sttProvider).toBe('local')
    expect(store.settings.localSttLanguage).toBe('zh')
    expect(store.settings.localSttWakeWord).toBe('alice')
    expect(store.settings.localSttEnabled).toBe(true)
    expect(store.settings.backgroundListeningEnabled).toBe(false)
    expect(store.settings.localTtsVoice).toBe('zh_CN-huayan-medium')
    expect(store.settings.assistantTools).toEqual(
      expect.arrayContaining([
        'open_path',
        'capture_desktop_screen',
        'desktop_action',
        'organize_files',
        'plan_itinerary',
        'create_email_draft',
      ])
    )
  })

  it('normalizes legacy local STT model choices to the bundled Base model', async () => {
    const saveSettings = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', {
      settingsAPI: {
        loadSettings: vi.fn(async () => ({
          sttProvider: 'local',
          localSttModel: 'whisper-large',
        })),
        saveSettings,
      },
    })

    try {
      const store = useSettingsStore()
      await store.loadSettings()

      expect(store.settings.localSttModel).toBe('whisper-base')
      expect(saveSettings).toHaveBeenCalled()
      expect(
        (
          saveSettings.mock.calls as unknown as Array<[Record<string, any>]>
        ).some(([payload]) => payload.localSttModel === 'whisper-base')
      ).toBe(true)
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('migrates the old avatar persona without overwriting custom wording', async () => {
    const saveSettings = vi.fn(async () => ({ success: true }))
    vi.stubGlobal('window', {
      settingsAPI: {
        loadSettings: vi.fn(async () => ({
          assistantSystemPrompt: `
你是 Alice，一位温暖、机智的 AI 桌面伙伴，拥有青绿色头发和闪亮的绿色眼睛。
请先共情，再保持俏皮但务实、略带一点独特幽默的风格。
使用自然、像真人一样的对话节奏，句子长短有变化，适度使用温和的比喻。
默认使用简体中文回答；遇到用户指定的语言时切换到对应语言。
以第一人称表达，整体语气友好、支持性强。
`.trim(),
        })),
        saveSettings,
      },
    })

    try {
      const store = useSettingsStore()
      await store.loadSettings()

      expect(store.settings.assistantSystemPrompt).toContain('中国年轻女性')
      expect(saveSettings).toHaveBeenCalled()

      setActivePinia(createPinia())
      const customStore = useSettingsStore()
      vi.stubGlobal('window', {
        settingsAPI: {
          loadSettings: vi.fn(async () => ({
            assistantSystemPrompt: '这是我自己写的角色设定。',
          })),
          saveSettings,
        },
      })
      await customStore.loadSettings()
      expect(customStore.settings.assistantSystemPrompt).toBe(
        '这是我自己写的角色设定。'
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
