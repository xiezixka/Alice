import { describe, expect, it } from 'vitest'
import { parseWakeWord } from '../wakeWord'

describe('parseWakeWord', () => {
  it('extracts a command after the wake word', () => {
    expect(parseWakeWord('Alice，打开日历', 'alice')).toEqual({
      hasWakeWord: true,
      command: '打开日历',
    })
  })

  it('accepts hey/ok wake word prefixes', () => {
    expect(parseWakeWord('Hey Alice, 查一下天气', 'alice').command).toBe(
      '查一下天气'
    )
    expect(parseWakeWord('OK Alice', 'alice')).toEqual({
      hasWakeWord: true,
      command: '',
    })
  })

  it('does not match a wake word embedded in an ASCII word', () => {
    expect(parseWakeWord('malice 打开日历', 'alice')).toEqual({
      hasWakeWord: false,
      command: '',
    })
  })

  it('supports the two-stage follow-up command window', () => {
    expect(parseWakeWord('把明天上午的会议整理一下', 'alice', true)).toEqual({
      hasWakeWord: true,
      command: '把明天上午的会议整理一下',
    })
  })

  it('returns the transcript when wake-word mode has no configured word', () => {
    expect(parseWakeWord('直接执行这个任务', '')).toEqual({
      hasWakeWord: true,
      command: '直接执行这个任务',
    })
  })
})
