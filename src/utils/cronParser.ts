/**
 * Utility to parse natural language time expressions into cron expressions
 */

interface TimePattern {
  pattern: RegExp
  cronGenerator: (match: RegExpMatchArray) => string
}

/**
 * A normalized schedule understood by both the renderer tool bridge and the
 * main-process scheduler.  Recurring schedules use a five-field cron
 * expression; one-time schedules carry an absolute ISO timestamp instead.
 */
export type ScheduleType = 'once' | 'recurring'

export interface ParsedSchedule {
  scheduleType: ScheduleType
  cronExpression?: string
  runAt?: string
}

const timePatterns: TimePattern[] = [
  // "every hour"
  {
    pattern: /^every hour$/i,
    cronGenerator: () => '0 * * * *',
  },

  // "every 30 minutes"
  {
    pattern: /^every (\d+) minutes?$/i,
    cronGenerator: match => `*/${match[1]} * * * *`,
  },

  // "every day at 8:30 AM"
  {
    pattern: /^every day at (\d{1,2}):(\d{2})\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = parseInt(match[2])
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * *`
    },
  },

  // "every day at 8 AM"
  {
    pattern: /^every day at (\d{1,2})\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const period = match[2].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `0 ${hour} * * *`
    },
  },

  // "daily at 9:30 PM"
  {
    pattern: /^daily at (\d{1,2}):(\d{2})\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = parseInt(match[2])
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * *`
    },
  },

  // "daily at 9 PM"
  {
    pattern: /^daily at (\d{1,2})\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const period = match[2].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `0 ${hour} * * *`
    },
  },

  // "every morning at 8 AM"
  {
    pattern: /^every morning at (\d{1,2}):?(\d{2})?\s*(am)?$/i,
    cronGenerator: match => {
      const hour = parseInt(match[1])
      const minute = match[2] ? parseInt(match[2]) : 0
      return `${minute} ${hour} * * *`
    },
  },

  // "every morning at 8"
  {
    pattern: /^every morning at (\d{1,2})$/i,
    cronGenerator: match => {
      const hour = parseInt(match[1])
      return `0 ${hour} * * *`
    },
  },

  // "every evening at 6 PM"
  {
    pattern: /^every evening at (\d{1,2}):?(\d{2})?\s*(pm)?$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = match[2] ? parseInt(match[2]) : 0

      // If no PM specified but it's evening, assume PM
      if (!match[3] && hour < 12) hour += 12

      return `${minute} ${hour} * * *`
    },
  },

  // "every Monday at 2 PM"
  {
    pattern:
      /^every (monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2}):?(\d{2})?\s*(am|pm)$/i,
    cronGenerator: match => {
      const days = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      }
      const day = days[match[1].toLowerCase() as keyof typeof days]
      let hour = parseInt(match[2])
      const minute = match[3] ? parseInt(match[3]) : 0
      const period = match[4].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * ${day}`
    },
  },

  // "every weekday at 9 AM"
  {
    pattern: /^every weekday at (\d{1,2}):?(\d{2})?\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = match[2] ? parseInt(match[2]) : 0
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * 1-5`
    },
  },

  // "every Friday at 11 PM"
  {
    pattern:
      /^every (monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2}):?(\d{2})?\s*(am|pm)$/i,
    cronGenerator: match => {
      const days = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      }
      const day = days[match[1].toLowerCase() as keyof typeof days]
      let hour = parseInt(match[2])
      const minute = match[3] ? parseInt(match[3]) : 0
      const period = match[4].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * ${day}`
    },
  },

  // "every week on Friday at 5 PM"
  {
    pattern:
      /^every week on (monday|tuesday|wednesday|thursday|friday|saturday|sunday) at (\d{1,2}):?(\d{2})?\s*(am|pm)$/i,
    cronGenerator: match => {
      const days = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 0,
      }
      const day = days[match[1].toLowerCase() as keyof typeof days]
      let hour = parseInt(match[2])
      const minute = match[3] ? parseInt(match[3]) : 0
      const period = match[4].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * ${day}`
    },
  },

  // "at 3:30 PM daily"
  {
    pattern: /^at (\d{1,2}):(\d{2})\s*(am|pm) daily$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = parseInt(match[2])
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * *`
    },
  },

  // "at 4:45 PM today" or "at 4:45 PM on July 13, 2025" - convert to daily recurring
  {
    pattern: /^at (\d{1,2}):(\d{2})\s*(am|pm)(?:\s+(?:today|on\s+.+))?$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = parseInt(match[2])
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * *`
    },
  },

  // "in 5 minutes" - convert to one-time execution approximation
  {
    pattern: /^in (\d+) minutes?$/i,
    cronGenerator: match => {
      const now = new Date()
      now.setMinutes(now.getMinutes() + parseInt(match[1]))
      return `${now.getMinutes()} ${now.getHours()} * * *`
    },
  },

  // "today at 4:45 PM"
  {
    pattern: /^today at (\d{1,2}):(\d{2})\s*(am|pm)$/i,
    cronGenerator: match => {
      let hour = parseInt(match[1])
      const minute = parseInt(match[2])
      const period = match[3].toLowerCase()

      if (period === 'pm' && hour !== 12) hour += 12
      if (period === 'am' && hour === 12) hour = 0

      return `${minute} ${hour} * * *`
    },
  },
]

/**
 * Parse natural language time expression to cron expression
 */
export function parseNaturalLanguageToCron(input: string): string | null {
  const cleanInput = input.trim().toLowerCase()

  const cronParts = cleanInput.split(/\s+/)
  if (
    cronParts.length === 5 &&
    cronParts.every(part => /^[\d\*\-\/,]+$/.test(part))
  ) {
    return cleanInput
  }

  // The renderer is localized for Chinese users, so keep common Chinese
  // recurring phrases on the same cron path as their English equivalents.
  // One-time Chinese phrases (今天/明天/…后) are handled by parseSchedule
  // before this legacy recurring parser is called.
  const chineseRecurring = parseChineseRecurringToCron(cleanInput)
  if (chineseRecurring) return chineseRecurring

  if (input.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)) {
    try {
      const date = new Date(input)
      if (!isNaN(date.getTime())) {
        const minutes = date.getMinutes()
        const hours = date.getHours()
        console.log(
          `[CronParser] Converting ISO date ${input} to daily recurring: ${minutes} ${hours} * * *`
        )
        return `${minutes} ${hours} * * *`
      }
    } catch (error) {
      console.error('[CronParser] Error parsing ISO date:', error)
    }
  }

  for (const { pattern, cronGenerator } of timePatterns) {
    const match = cleanInput.match(pattern)
    if (match) {
      try {
        return cronGenerator(match)
      } catch (error) {
        console.error('[CronParser] Error generating cron expression:', error)
        continue
      }
    }
  }

  return null
}

type ClockParts = { hour: number; minute: number }

function parseClockParts(
  hourText: string,
  minuteText?: string,
  periodText?: string
): ClockParts | null {
  let hour = Number.parseInt(hourText, 10)
  const minute = minuteText ? Number.parseInt(minuteText, 10) : 0
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (minute < 0 || minute > 59) return null

  const period = periodText?.toLowerCase()
  if (period) {
    if (hour < 1 || hour > 12) return null
    if (period === 'pm' && hour !== 12) hour += 12
    if (period === 'am' && hour === 12) hour = 0
  } else if (hour < 0 || hour > 23) {
    return null
  }

  return { hour, minute }
}

function buildLocalDate(now: Date, dayOffset: number, clock: ClockParts): Date {
  const result = new Date(now)
  result.setDate(result.getDate() + dayOffset)
  result.setHours(clock.hour, clock.minute, 0, 0)
  return result
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function chineseClockToParts(
  hourText: string,
  minuteText?: string,
  periodText?: string
): ClockParts | null {
  let hour = Number.parseInt(hourText, 10)
  const minute =
    minuteText === '半' ? 30 : Number.parseInt(minuteText || '0', 10)
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null
  if (minute < 0 || minute > 59) return null

  if (
    periodText &&
    ['下午', '晚上', '今晚'].includes(periodText) &&
    hour < 12
  ) {
    hour += 12
  } else if (periodText === '中午' && hour < 11) {
    hour += 12
  } else if (
    periodText &&
    ['早上', '上午', '凌晨'].includes(periodText) &&
    hour === 12
  ) {
    hour = 0
  }

  return hour >= 0 && hour <= 23 ? { hour, minute } : null
}

function parseChineseRecurringToCron(input: string): string | null {
  const normalized = input.replace(/\s+/g, '').replace(/：/g, ':')

  if (/^每(?:隔)?(?:一|1)?小时(?:一次)?$/.test(normalized)) {
    return '0 * * * *'
  }

  const everyHours = normalized.match(/^每(?:隔)?(\d{1,2})小时(?:一次)?$/)
  if (everyHours) {
    const hours = Number.parseInt(everyHours[1], 10)
    return hours >= 1 && hours <= 23 ? `0 */${hours} * * *` : null
  }

  if (/^每(?:隔)?半小时(?:一次)?$/.test(normalized)) {
    return '*/30 * * * *'
  }

  const interval = normalized.match(
    /^每(?:隔)?(\d{1,3})(?:分钟|分)(?:钟)?(?:一次)?$/
  )
  if (interval) {
    const minutes = Number.parseInt(interval[1], 10)
    if (minutes >= 1 && minutes <= 59) return `*/${minutes} * * * *`
    return null
  }

  const clockPattern =
    /^(早上|上午|中午|下午|晚上|今晚|凌晨)?(\d{1,2})(?:(?::|点|时)(\d{1,2}|半)?)?(?:分|分钟)?$/
  const parseClock = (value: string): ClockParts | null => {
    const match = value.match(clockPattern)
    return match ? chineseClockToParts(match[2], match[3], match[1]) : null
  }

  const daily = normalized.match(/^(?:每天|每日)(.+)$/)
  if (daily) {
    const clock = parseClock(daily[1])
    return clock ? `${clock.minute} ${clock.hour} * * *` : null
  }

  const weekdays = normalized.match(/^(?:每个?工作日|工作日)(.+)$/)
  if (weekdays) {
    const clock = parseClock(weekdays[1])
    return clock ? `${clock.minute} ${clock.hour} * * 1-5` : null
  }

  const weekend = normalized.match(/^(?:每周末|每个周末)(.+)$/)
  if (weekend) {
    const clock = parseClock(weekend[1])
    return clock ? `${clock.minute} ${clock.hour} * * 0,6` : null
  }

  const weekly = normalized.match(/^每(?:周|星期)([一二三四五六日天1-7])(.+)$/)
  if (weekly) {
    const dayMap: Record<string, number> = {
      一: 1,
      二: 2,
      三: 3,
      四: 4,
      五: 5,
      六: 6,
      日: 0,
      天: 0,
      '1': 1,
      '2': 2,
      '3': 3,
      '4': 4,
      '5': 5,
      '6': 6,
      '7': 0,
    }
    const clock = parseClock(weekly[2])
    const day = dayMap[weekly[1]]
    return clock === null || day === undefined
      ? null
      : `${clock.minute} ${clock.hour} * * ${day}`
  }

  return null
}

/**
 * Parse an ISO/date-like timestamp without letting JavaScript interpret a
 * date-only value as UTC. Date-only and local date-time inputs are intended
 * to represent the user's local wall clock time; explicit offsets retain
 * their normal ISO semantics.
 */
function parseDateLike(input: string): Date | null {
  const match = input.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[tT ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(\s*(?:z|[+-]\d{2}:?\d{2}))?)?$/
  )
  if (!match) return null

  const year = Number.parseInt(match[1], 10)
  const month = Number.parseInt(match[2], 10)
  const day = Number.parseInt(match[3], 10)
  const hour = match[4] ? Number.parseInt(match[4], 10) : 0
  const minute = match[5] ? Number.parseInt(match[5], 10) : 0
  const second = match[6] ? Number.parseInt(match[6], 10) : 0
  if (
    month < 1 ||
    month > 12 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null
  }

  const timezone = match[7]?.trim()
  if (timezone) {
    const parsed = new Date(input.replace(' ', 'T'))
    return isValidDate(parsed) ? parsed : null
  }

  const parsed = new Date(year, month - 1, day, hour, minute, second, 0)
  // Date's constructor normalizes invalid days (e.g. February 31). Reject
  // those instead of silently scheduling a different date.
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day ||
    parsed.getHours() !== hour ||
    parsed.getMinutes() !== minute ||
    parsed.getSeconds() !== second
  ) {
    return null
  }
  return parsed
}

function parseOneTimeSchedule(input: string, now: Date): string | null {
  // Explicit ISO/local timestamps, e.g. 2026-08-30T16:45:00+08:00.
  const dateLike = parseDateLike(input)
  if (dateLike) return dateLike.toISOString()

  // Relative English and Chinese forms, e.g. "in 5 minutes" / "5分钟后".
  const relative = input.match(
    /^in\s+(\d+)\s+(seconds?|minutes?|hours?|days?)$/i
  )
  const chineseRelative = input.match(
    /^(\d+)\s*(秒钟?|秒|分钟?|分|小时?|天)后$/i
  )
  if (relative || chineseRelative) {
    const amount = Number.parseInt((relative || chineseRelative)![1], 10)
    const unit = (relative || chineseRelative)![2].toLowerCase()
    if (!Number.isSafeInteger(amount) || amount < 0) return null
    const multiplier = unit.startsWith('秒')
      ? 1_000
      : unit.startsWith('分') || unit.startsWith('minute')
        ? 60_000
        : unit.startsWith('小时') || unit.startsWith('hour')
          ? 3_600_000
          : unit.startsWith('天') || unit.startsWith('day')
            ? 86_400_000
            : 1_000
    const target = new Date(now.getTime() + amount * multiplier)
    return isValidDate(target) ? target.toISOString() : null
  }

  // English clock forms with an explicit one-time day marker. Recurring
  // phrases such as "at 4 PM daily" intentionally do not match here.
  const englishClock =
    input.match(
      /^(today|tomorrow)\s+at\s+(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i
    ) ||
    input.match(
      /^at\s+(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?\s+(today|tomorrow)$/i
    )
  if (englishClock) {
    const first = englishClock[1].toLowerCase()
    const dayWord =
      first === 'today' || first === 'tomorrow' ? first : englishClock[4]
    const hourText =
      first === 'today' || first === 'tomorrow'
        ? englishClock[2]
        : englishClock[1]
    const minuteText =
      first === 'today' || first === 'tomorrow'
        ? englishClock[3]
        : englishClock[2]
    const periodText =
      first === 'today' || first === 'tomorrow'
        ? englishClock[4]
        : englishClock[3]
    const clock = parseClockParts(hourText, minuteText, periodText)
    if (!clock) return null
    return buildLocalDate(
      now,
      dayWord.toLowerCase() === 'tomorrow' ? 1 : 0,
      clock
    ).toISOString()
  }

  // Chinese clock forms, e.g. "今天下午4点30分" or "明天 09:00".
  const chineseClock = input.match(
    /^(今天|明天)\s*(早上|上午|中午|下午|晚上|今晚|凌晨)?\s*(\d{1,2})\s*(?:(?::|点|时)\s*(\d{1,2}|半)?)?\s*(?:分|分钟)?$/
  )
  if (chineseClock) {
    const dayOffset = chineseClock[1] === '明天' ? 1 : 0
    const period = chineseClock[2]
    const clock = chineseClockToParts(chineseClock[3], chineseClock[4], period)
    if (!clock) return null
    return buildLocalDate(now, dayOffset, clock).toISOString()
  }

  // A small, deterministic subset of English calendar dates supported by the
  // legacy parser: "July 13, 2025 at 4:45 PM" (optionally prefixed by "on").
  const namedDate = input.match(
    /^(?:on\s+)?([a-z]+\s+\d{1,2},\s*\d{4})\s+at\s+(\d{1,2})(?::(\d{1,2}))?\s*(am|pm)?$/i
  )
  if (namedDate) {
    const clock = parseClockParts(namedDate[2], namedDate[3], namedDate[4])
    if (!clock) return null
    const base = new Date(namedDate[1])
    if (!isValidDate(base)) return null
    base.setHours(clock.hour, clock.minute, 0, 0)
    return base.toISOString()
  }

  return null
}

/**
 * Parse either a one-time or recurring schedule. This is the preferred API
 * for callers that create tasks; the legacy parseNaturalLanguageToCron
 * function remains available for recurring-only consumers.
 */
export function parseSchedule(
  input: string,
  now: Date = new Date()
): ParsedSchedule | null {
  if (typeof input !== 'string') return null
  const cleanInput = input.trim()
  if (!cleanInput || !isValidDate(now)) return null

  const runAt = parseOneTimeSchedule(cleanInput, now)
  if (runAt) {
    return { scheduleType: 'once', runAt }
  }

  const cronExpression = parseNaturalLanguageToCron(cleanInput)
  if (cronExpression && validateCronExpression(cronExpression)) {
    return { scheduleType: 'recurring', cronExpression }
  }

  return null
}

/**
 * Validate if a cron expression is valid
 */
export function validateCronExpression(cronExpression: string): boolean {
  const parts = cronExpression.trim().split(/\s+/)

  if (parts.length !== 5) return false

  const [minute, hour, day, month, weekday] = parts

  const patterns = {
    minute:
      /^(\*|[0-5]?[0-9]|[0-5]?[0-9]-[0-5]?[0-9]|[0-5]?[0-9]\/[0-9]+|\*\/[0-9]+|[0-5]?[0-9](,[0-5]?[0-9])*)$/,
    hour: /^(\*|[0-1]?[0-9]|2[0-3]|[0-1]?[0-9]-[0-1]?[0-9]|2[0-3]-2[0-3]|[0-1]?[0-9]\/[0-9]+|2[0-3]\/[0-9]+|\*\/[0-9]+|[0-1]?[0-9](,[0-1]?[0-9])*|2[0-3](,2[0-3])*)$/,
    day: /^(\*|[1-9]|[12][0-9]|3[01]|[1-9]-[1-9]|[12][0-9]-[12][0-9]|3[01]-3[01]|[1-9]\/[0-9]+|[12][0-9]\/[0-9]+|3[01]\/[0-9]+|\*\/[0-9]+|[1-9](,[1-9])*|[12][0-9](,[12][0-9])*|3[01](,3[01])*)$/,
    month:
      /^(\*|[1-9]|1[0-2]|[1-9]-[1-9]|1[0-2]-1[0-2]|[1-9]\/[0-9]+|1[0-2]\/[0-9]+|\*\/[0-9]+|[1-9](,[1-9])*|1[0-2](,1[0-2])*)$/,
    weekday: /^(\*|[0-6]|[0-6]-[0-6]|[0-6]\/[0-9]+|\*\/[0-9]+|[0-6](,[0-6])*)$/,
  }

  return (
    patterns.minute.test(minute) &&
    patterns.hour.test(hour) &&
    patterns.day.test(day) &&
    patterns.month.test(month) &&
    patterns.weekday.test(weekday)
  )
}

/**
 * Get human-readable description of a cron expression
 */
export function describeCronExpression(cronExpression: string): string {
  const parts = cronExpression.trim().split(/\s+/)
  if (parts.length !== 5) return 'Invalid cron expression'

  const [minute, hour, day, month, weekday] = parts

  if (cronExpression === '0 * * * *') return 'Every hour'
  if (cronExpression === '0 0 * * *') return 'Daily at midnight'
  if (cronExpression === '0 8 * * *') return 'Daily at 8:00 AM'
  if (cronExpression === '0 20 * * *') return 'Daily at 8:00 PM'
  if (cronExpression === '0 8 * * 1-5') return 'Weekdays at 8:00 AM'
  if (cronExpression === '0 8 * * 1') return 'Every Monday at 8:00 AM'
  if (cronExpression === '0 8 * * 5') return 'Every Friday at 8:00 AM'

  let description = ''

  if (hour === '*' && minute === '*') {
    description = 'Every minute'
  } else if (hour === '*') {
    if (minute.startsWith('*/')) {
      const interval = minute.substring(2)
      description = `Every ${interval} minutes`
    } else {
      description = `At ${minute} minutes past every hour`
    }
  } else {
    const hourNum = parseInt(hour)
    const minuteNum = parseInt(minute)
    const time12 =
      hourNum === 0
        ? '12:00 AM'
        : hourNum < 12
          ? `${hourNum}:${minuteNum.toString().padStart(2, '0')} AM`
          : hourNum === 12
            ? `12:${minuteNum.toString().padStart(2, '0')} PM`
            : `${hourNum - 12}:${minuteNum.toString().padStart(2, '0')} PM`
    description = `At ${time12}`
  }

  if (weekday !== '*') {
    const dayNames = [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]
    if (weekday === '1-5') {
      description += ' on weekdays'
    } else if (weekday.includes(',')) {
      const days = weekday
        .split(',')
        .map(d => dayNames[parseInt(d)])
        .join(', ')
      description += ` on ${days}`
    } else {
      description += ` on ${dayNames[parseInt(weekday)]}`
    }
  } else if (day !== '*') {
    description += ` on day ${day} of the month`
  } else {
    description += ' daily'
  }

  return description
}

/**
 * Get example expressions for help
 */
export function getExampleExpressions(): {
  natural: string
  cron: string
  description: string
}[] {
  return [
    {
      natural: 'every morning at 8 AM',
      cron: '0 8 * * *',
      description: 'Daily at 8:00 AM',
    },
    {
      natural: 'every hour',
      cron: '0 * * * *',
      description: 'Every hour',
    },
    {
      natural: 'every 30 minutes',
      cron: '*/30 * * * *',
      description: 'Every 30 minutes',
    },
    {
      natural: 'every Friday at 11 PM',
      cron: '0 23 * * 5',
      description: 'Every Friday at 11:00 PM',
    },
    {
      natural: 'every weekday at 9 AM',
      cron: '0 9 * * 1-5',
      description: 'Weekdays at 9:00 AM',
    },
    {
      natural: 'daily at 6:30 PM',
      cron: '30 18 * * *',
      description: 'Daily at 6:30 PM',
    },
  ]
}
