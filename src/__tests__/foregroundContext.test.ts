import { describe, expect, it } from 'vitest'
import { sameForegroundContext } from '../../electron/main/foregroundContext'

describe('foreground context identity comparison', () => {
  const base = {
    foregroundApp: '浏览器',
    windowTitle: '工作区',
  }

  it('accepts matching native window ids', () => {
    expect(
      sameForegroundContext(
        { ...base, windowId: 'mac:100:1' },
        { ...base, windowId: 'mac:100:1' }
      )
    ).toBe(true)
  })

  it('rejects same-title windows with different native ids', () => {
    expect(
      sameForegroundContext(
        { ...base, windowId: 'mac:100:1' },
        { ...base, windowId: 'mac:100:2' }
      )
    ).toBe(false)
  })

  it('fails closed when only one side has a native id', () => {
    expect(
      sameForegroundContext({ ...base, windowId: 'win:10:20' }, { ...base })
    ).toBe(false)
  })

  it('keeps app/title fallback for bridges without native ids', () => {
    expect(sameForegroundContext(base, { ...base })).toBe(true)
    expect(
      sameForegroundContext(base, { ...base, windowTitle: '另一个窗口' })
    ).toBe(false)
  })
})
