import { beforeEach, describe, expect, it } from 'vitest'

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

  it('ships Chinese desktop-agent defaults without enabling the microphone', () => {
    const store = useSettingsStore()

    expect(store.settings.aiProvider).toBe('deepseek')
    expect(store.settings.assistantModel).toBe(
      'deepseek-v4-flash-vision-exp'
    )
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
})
