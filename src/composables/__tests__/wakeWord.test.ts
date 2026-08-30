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

  it('accepts the bundled Piper-to-Whisper transcript variant', () => {
    expect(parseWakeWord('艾莉絲请打开日历', 'alice')).toEqual({
      hasWakeWord: true,
      command: '请打开日历',
    })
  })

  it('accepts the full bundled voice pipeline transcript', () => {
    expect(parseWakeWord('愛歷斯傾打開日曆', 'alice')).toEqual({
      hasWakeWord: true,
      command: '傾打開日曆',
    })
  })

  it('accepts the latest local TTS-to-STT transcript variant', () => {
    expect(parseWakeWord('艾利斯傾打開日曆', 'alice')).toEqual({
      hasWakeWord: true,
      command: '傾打開日曆',
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

  it('accepts a verified Piper-to-Whisper round-trip variant', () => {
    expect(parseWakeWord('爱力私情打开日曆', 'alice')).toEqual({
      hasWakeWord: true,
      command: '情打开日曆',
    })
  })

  it('normalizes narrow Chinese homophones observed in Whisper output', () => {
    expect(parseWakeWord('艾利斯请打开日历', 'alice')).toEqual({
      hasWakeWord: true,
      command: '请打开日历',
    })
    expect(parseWakeWord('爱历师请打开日历', 'alice')).toEqual({
      hasWakeWord: true,
      command: '请打开日历',
    })
  })

  it('does not match a wake word embedded in an ASCII word', () => {
    expect(parseWakeWord('malice 打开日历', 'alice')).toEqual({
      hasWakeWord: false,
      command: '',
    })
  })

  it('does not treat a normal two-character Chinese phrase as Alice', () => {
    expect(parseWakeWord('爱情请打开日历', 'alice')).toEqual({
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

  it('matches a user-defined Chinese wake phrase and strips punctuation', () => {
    expect(parseWakeWord('小助手，请打开日历', '小助手')).toEqual({
      hasWakeWord: true,
      command: '请打开日历',
    })
  })

  it('matches a user-defined English phrase case-insensitively', () => {
    expect(parseWakeWord('Hey Computer, open calendar', 'computer')).toEqual({
      hasWakeWord: true,
      command: 'open calendar',
    })
  })

  it('does not match a custom wake phrase inside an ASCII word', () => {
    expect(parseWakeWord('mycomputer 打开日历', 'computer')).toEqual({
      hasWakeWord: false,
      command: '',
    })
  })

  it('returns the transcript when wake-word mode has no configured word', () => {
    expect(parseWakeWord('直接执行这个任务', '')).toEqual({
      hasWakeWord: true,
      command: '直接执行这个任务',
    })
  })
})
