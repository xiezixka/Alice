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

  it('accepts common Mandarin aliases for Alice', () => {
    expect(parseWakeWord('爱丽丝，打开日历', 'alice')).toEqual({
      hasWakeWord: true,
      command: '打开日历',
    })
    expect(parseWakeWord('艾丽丝帮我整理文件', 'alice')).toEqual({
      hasWakeWord: true,
      command: '帮我整理文件',
    })
  })

  it('accepts traditional Chinese aliases emitted by some STT models', () => {
    expect(parseWakeWord('愛麗絲請告訴我今天的安排', 'alice')).toEqual({
      hasWakeWord: true,
      command: '請告訴我今天的安排',
    })
  })

  it('accepts mixed-script aliases emitted by ASR', () => {
    expect(parseWakeWord('艾莉斯請告訴我今天的安排', 'alice')).toEqual({
      hasWakeWord: true,
      command: '請告訴我今天的安排',
    })
  })

  it('accepts a verified Whisper homophone for Alice', () => {
    expect(parseWakeWord('爱历史请告诉我今天的安排', 'alice')).toEqual({
      hasWakeWord: true,
      command: '请告诉我今天的安排',
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
