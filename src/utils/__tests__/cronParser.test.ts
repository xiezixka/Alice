import { describe, expect, it } from 'vitest'
import { parseNaturalLanguageToCron, parseSchedule } from '../cronParser'

const now = new Date('2026-08-30T10:00:00.000+08:00')

describe('parseSchedule', () => {
  it('parses relative English time as a one-time ISO timestamp', () => {
    expect(parseSchedule('in 5 minutes', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-08-30T02:05:00.000Z',
    })
  })

  it('parses relative Chinese time as a one-time ISO timestamp', () => {
    expect(parseSchedule('30分钟后', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-08-30T02:30:00.000Z',
    })
  })

  it('parses an explicit day without turning it into a daily recurrence', () => {
    expect(parseSchedule('今天下午4点45分', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-08-30T08:45:00.000Z',
    })
    expect(parseSchedule('tomorrow at 9:15 AM', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-08-31T01:15:00.000Z',
    })
    expect(parseSchedule('明天晚上 9 点半', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-08-31T13:30:00.000Z',
    })
  })

  it('preserves an explicit ISO offset', () => {
    expect(parseSchedule('2026-09-01T09:30:00+08:00', now)).toEqual({
      scheduleType: 'once',
      runAt: '2026-09-01T01:30:00.000Z',
    })
  })

  it('keeps recurring expressions on the cron path', () => {
    expect(parseSchedule('every weekday at 9 AM', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '0 9 * * 1-5',
    })
  })

  it('parses common Chinese recurring expressions', () => {
    expect(parseSchedule('每天早上 8 点', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '0 8 * * *',
    })
    expect(parseSchedule('工作日下午 2:30', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '30 14 * * 1-5',
    })
    expect(parseSchedule('每周一晚上 7 点半', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '30 19 * * 1',
    })
    expect(parseSchedule('每星期五 11 点', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '0 11 * * 5',
    })
    expect(parseSchedule('每隔 30 分钟', now)).toEqual({
      scheduleType: 'recurring',
      cronExpression: '*/30 * * * *',
    })
  })

  it('keeps the legacy parser available for recurring callers', () => {
    expect(parseNaturalLanguageToCron('in 5 minutes')).toMatch(
      /^\d+ \d+ \* \* \*$/
    )
  })
})
