import {
  parseNaturalLanguageToCron,
  validateCronExpression,
} from '../cronParser'

interface FunctionResult {
  success: boolean
  data?: any
  error?: string
}

export interface ScheduleTaskArgs {
  name: string
  schedule: string
  action_type: 'command' | 'reminder'
  details: string
}

export interface ManageScheduledTasksArgs {
  action: 'list' | 'delete' | 'toggle'
  task_id?: string
}

interface CalendarEventResource {
  summary?: string
  description?: string
  start?: { dateTime?: string; timeZone?: string; date?: string }
  end?: { dateTime?: string; timeZone?: string; date?: string }
  location?: string
  attendees?: { email: string }[]
}

export async function schedule_task(
  args: ScheduleTaskArgs
): Promise<FunctionResult> {
  try {
    let cronExpression = parseNaturalLanguageToCron(args.schedule)

    if (!cronExpression) {
      if (validateCronExpression(args.schedule)) {
        cronExpression = args.schedule
      } else {
        return {
          success: false,
          error: `Unable to parse schedule "${args.schedule}". Try formats like "every morning at 8 AM", "every hour", "daily at 6 PM", or use cron format like "0 8 * * *".`,
        }
      }
    }

    if (!validateCronExpression(cronExpression)) {
      return {
        success: false,
        error: `Generated cron expression "${cronExpression}" is invalid.`,
      }
    }

    const result = await window.aliceIPC.invoke('scheduler:create-task', {
      name: args.name,
      cronExpression,
      actionType: args.action_type,
      details: args.details,
    })

    if (result.success) {
      return {
        success: true,
        data: {
          message: `Task "${args.name}" scheduled successfully.`,
          taskId: result.taskId,
          cronExpression,
          schedule: args.schedule,
        },
      }
    } else {
      return {
        success: false,
        error: result.error || 'Failed to create scheduled task.',
      }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function manage_scheduled_tasks(
  args: ManageScheduledTasksArgs
): Promise<FunctionResult> {
  try {
    switch (args.action) {
      case 'list': {
        const result = await window.aliceIPC.invoke('scheduler:get-all-tasks')
        if (result.success) {
          const tasks = result.tasks.map((task: any) => ({
            id: task.id,
            name: task.name,
            schedule: task.cronExpression,
            actionType: task.actionType,
            details: task.details,
            isActive: task.isActive,
            createdAt: task.createdAt,
            lastRun: task.lastRun,
            nextRun: task.nextRun,
          }))
          return {
            success: true,
            data: {
              message: `Found ${tasks.length} scheduled tasks.`,
              tasks,
            },
          }
        } else {
          return {
            success: false,
            error: result.error || 'Failed to get scheduled tasks.',
          }
        }
      }

      case 'delete': {
        if (!args.task_id) {
          return {
            success: false,
            error: 'Task ID is required for delete action.',
          }
        }

        const result = await window.aliceIPC.invoke('scheduler:delete-task', {
          taskId: args.task_id,
        })

        if (result.success) {
          return {
            success: true,
            data: { message: `Task ${args.task_id} deleted successfully.` },
          }
        } else {
          return {
            success: false,
            error: result.error || 'Failed to delete task.',
          }
        }
      }

      case 'toggle': {
        if (!args.task_id) {
          return {
            success: false,
            error: 'Task ID is required for toggle action.',
          }
        }

        const result = await window.aliceIPC.invoke('scheduler:toggle-task', {
          taskId: args.task_id,
        })

        if (result.success) {
          return {
            success: true,
            data: {
              message: `Task ${args.task_id} status toggled successfully.`,
            },
          }
        } else {
          return {
            success: false,
            error: result.error || 'Failed to toggle task status.',
          }
        }
      }

      default:
        return { success: false, error: `Unknown action: ${args.action}` }
    }
  } catch (error: any) {
    return { success: false, error: error.message }
  }
}

export async function get_calendar_events(args: {
  calendarId?: string
  timeMin?: string
  timeMax?: string
  q?: string
  maxResults?: number
}): Promise<FunctionResult> {
  try {
    const result = await window.aliceIPC.invoke('google-calendar:list-events', {
      calendarId: args.calendarId || 'primary',
      timeMin: args.timeMin,
      timeMax: args.timeMax,
      q: args.q,
      maxResults: args.maxResults || 10,
    })
    if (result.success) {
      return { success: true, data: result.data || 'No events found.' }
    }
    return {
      success: false,
      error: result.error || 'Failed to list calendar events.',
    }
  } catch (error: any) {
    return { success: false, error: `IPC Error: ${error.message}` }
  }
}

export async function create_calendar_event(args: {
  calendarId?: string
  summary: string
  description?: string
  startDateTime: string
  endDateTime: string
  location?: string
  attendees?: string[]
}): Promise<FunctionResult> {
  try {
    const eventResource: CalendarEventResource = {
      summary: args.summary,
      description: args.description,
      start: { dateTime: args.startDateTime },
      end: { dateTime: args.endDateTime },
      location: args.location,
    }
    if (args.attendees && args.attendees.length > 0) {
      eventResource.attendees = args.attendees.map(email => ({ email }))
    }

    const result = await window.aliceIPC.invoke(
      'google-calendar:create-event',
      {
        calendarId: args.calendarId || 'primary',
        eventResource,
      }
    )
    if (result.success) {
      return { success: true, data: result.data }
    }
    return {
      success: false,
      error: result.error || 'Failed to create calendar event.',
    }
  } catch (error: any) {
    return { success: false, error: `IPC Error: ${error.message}` }
  }
}

export async function update_calendar_event(args: {
  calendarId?: string
  eventId: string
  summary?: string
  description?: string
  startDateTime?: string
  endDateTime?: string
  location?: string
  attendees?: string[]
}): Promise<FunctionResult> {
  try {
    const eventResource: CalendarEventResource = {}
    if (args.summary) eventResource.summary = args.summary
    if (args.description) eventResource.description = args.description
    if (args.startDateTime)
      eventResource.start = { dateTime: args.startDateTime }
    if (args.endDateTime) eventResource.end = { dateTime: args.endDateTime }
    if (args.location) eventResource.location = args.location
    if (args.attendees && args.attendees.length > 0) {
      eventResource.attendees = args.attendees.map(email => ({ email }))
    }

    if (Object.keys(eventResource).length === 0) {
      return {
        success: false,
        error: 'No fields provided to update for the event.',
      }
    }

    const result = await window.aliceIPC.invoke(
      'google-calendar:update-event',
      {
        calendarId: args.calendarId || 'primary',
        eventId: args.eventId,
        eventResource,
      }
    )
    if (result.success) {
      return { success: true, data: result.data }
    }
    return {
      success: false,
      error: result.error || 'Failed to update calendar event.',
    }
  } catch (error: any) {
    return { success: false, error: `IPC Error: ${error.message}` }
  }
}

export async function delete_calendar_event(args: {
  calendarId?: string
  eventId: string
}): Promise<FunctionResult> {
  try {
    const result = await window.aliceIPC.invoke(
      'google-calendar:delete-event',
      {
        calendarId: args.calendarId || 'primary',
        eventId: args.eventId,
      }
    )
    if (result.success) {
      return { success: true, data: result.data }
    }
    return {
      success: false,
      error: result.error || 'Failed to delete calendar event.',
    }
  } catch (error: any) {
    return { success: false, error: `IPC Error: ${error.message}` }
  }
}

export interface ItineraryItem {
  title: string
  durationMinutes: number
  preferredStart?: string
  location?: string
}

/**
 * Finds conflict-free slots for a list of itinerary items without writing to
 * the calendar. The user can review the returned plan before creating events.
 */
export async function plan_itinerary(args: {
  calendarId?: string
  startDateTime: string
  endDateTime: string
  items: ItineraryItem[]
  bufferMinutes?: number
}): Promise<FunctionResult> {
  try {
    const windowStart = new Date(args.startDateTime)
    const windowEnd = new Date(args.endDateTime)
    if (
      !Number.isFinite(windowStart.getTime()) ||
      !Number.isFinite(windowEnd.getTime()) ||
      windowEnd <= windowStart
    ) {
      return { success: false, error: '行程规划的开始和结束时间无效。' }
    }
    if (
      !Array.isArray(args.items) ||
      args.items.length === 0 ||
      args.items.length > 50
    ) {
      return { success: false, error: 'items 必须包含 1-50 个行程项目。' }
    }
    const bufferMs =
      Math.max(0, Math.min(Number(args.bufferMinutes) || 0, 240)) * 60_000
    const calendarResult = await get_calendar_events({
      calendarId: args.calendarId,
      timeMin: windowStart.toISOString(),
      timeMax: windowEnd.toISOString(),
      maxResults: 250,
    })
    if (!calendarResult.success) return calendarResult

    const events = Array.isArray(calendarResult.data) ? calendarResult.data : []
    const busy = events
      .map((event: any) => {
        const start = event.start?.dateTime || event.start?.date
        const end = event.end?.dateTime || event.end?.date
        if (!start || !end) return null
        const startDate = new Date(start)
        const endDate = new Date(end)
        if (
          !Number.isFinite(startDate.getTime()) ||
          !Number.isFinite(endDate.getTime())
        )
          return null
        return {
          start: Math.max(startDate.getTime(), windowStart.getTime()),
          end: Math.min(endDate.getTime(), windowEnd.getTime()),
          title: event.summary || '未命名事件',
        }
      })
      .filter(
        (event: any): event is { start: number; end: number; title: string } =>
          Boolean(event && event.end > event.start)
      )
      .sort((a: any, b: any) => a.start - b.start)

    const mergedBusy: Array<{ start: number; end: number; titles: string[] }> =
      []
    for (const event of busy) {
      const previous = mergedBusy[mergedBusy.length - 1]
      if (previous && event.start <= previous.end) {
        previous.end = Math.max(previous.end, event.end)
        previous.titles.push(event.title)
      } else {
        mergedBusy.push({
          start: event.start,
          end: event.end,
          titles: [event.title],
        })
      }
    }
    const gaps: Array<{ start: number; end: number }> = []
    let cursor = windowStart.getTime()
    for (const event of mergedBusy) {
      if (event.start > cursor) gaps.push({ start: cursor, end: event.start })
      cursor = Math.max(cursor, event.end)
    }
    if (cursor < windowEnd.getTime())
      gaps.push({ start: cursor, end: windowEnd.getTime() })

    const suggestions: Array<{
      title: string
      startDateTime: string
      endDateTime: string
      location?: string
    }> = []
    const remainingGaps = gaps.map(gap => ({ ...gap }))
    for (const item of args.items) {
      const durationMs =
        Math.max(1, Math.min(Number(item.durationMinutes) || 0, 24 * 60)) *
        60_000
      const preferred = item.preferredStart
        ? new Date(item.preferredStart).getTime()
        : undefined
      let placed = false
      for (const gap of remainingGaps) {
        const candidate = Math.max(
          gap.start,
          Number.isFinite(preferred) ? preferred! : gap.start
        )
        if (candidate + durationMs + bufferMs <= gap.end) {
          suggestions.push({
            title: item.title,
            startDateTime: new Date(candidate).toISOString(),
            endDateTime: new Date(candidate + durationMs).toISOString(),
            location: item.location,
          })
          gap.start = candidate + durationMs + bufferMs
          placed = true
          break
        }
      }
      if (!placed) {
        return {
          success: true,
          data: {
            status: 'partial',
            message: `无法为“${item.title}”找到满足时长的空闲时间。`,
            busyEvents: mergedBusy,
            suggestions,
            unscheduled: args.items
              .slice(suggestions.length)
              .map(entry => entry.title),
          },
        }
      }
    }
    return {
      success: true,
      data: {
        status: 'complete',
        suggestions,
        busyEvents: mergedBusy,
        message: '已生成不写入日历的行程草案，请确认后再创建事件。',
      },
    }
  } catch (error: any) {
    return { success: false, error: `行程规划失败：${error.message}` }
  }
}
