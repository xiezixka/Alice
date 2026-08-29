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
})
