import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type SchedulerRow = Record<string, any>

const rows = new Map<string, SchedulerRow>()
const windows: Array<{
  isDestroyed: () => boolean
  send: ReturnType<typeof vi.fn>
}> = []
const cronJobs: Array<{
  start: ReturnType<typeof vi.fn>
  stop: ReturnType<typeof vi.fn>
  destroy: ReturnType<typeof vi.fn>
}> = []

const database = {
  exec: vi.fn(),
  prepare: vi.fn((sql: string) => ({
    all: vi.fn(() => {
      if (sql.includes('PRAGMA table_info')) {
        return [
          { name: 'id' },
          { name: 'name' },
          { name: 'cron_expression' },
          { name: 'action_type' },
          { name: 'details' },
          { name: 'is_active' },
          { name: 'created_at' },
          { name: 'last_run' },
          { name: 'next_run' },
        ]
      }
      if (sql.includes('WHERE is_active = 1')) {
        return [...rows.values()].filter(row => row.is_active === 1)
      }
      if (sql.includes('ORDER BY created_at')) {
        return [...rows.values()]
      }
      return []
    }),
    get: vi.fn((id: string) => rows.get(id)),
    run: vi.fn((...params: any[]) => {
      if (sql.includes('INSERT INTO scheduled_tasks')) {
        const [
          id,
          name,
          cronExpression,
          scheduleType,
          runAt,
          actionType,
          details,
          isActive,
          status,
          createdAt,
          lastRun,
          nextRun,
        ] = params
        rows.set(id, {
          id,
          name,
          cron_expression: cronExpression,
          schedule_type: scheduleType,
          run_at: runAt,
          action_type: actionType,
          details,
          is_active: isActive,
          status,
          created_at: createdAt,
          last_run: lastRun,
          next_run: nextRun,
        })
        return { changes: 1 }
      }
      if (sql.includes('SET is_active = 0')) {
        const [status, timestamp, id] = params
        const row = rows.get(id)
        if (!row || row.is_active !== 1) return { changes: 0 }
        row.is_active = 0
        row.status = status
        row.last_run = timestamp
        row.next_run = null
        return { changes: 1 }
      }
      if (sql.includes('SET is_active = ?, status = ?')) {
        const [isActive, status, id] = params
        const row = rows.get(id)
        if (!row) return { changes: 0 }
        row.is_active = isActive
        row.status = status
        return { changes: 1 }
      }
      if (sql.includes('SET last_run = ?')) {
        const [lastRun, id] = params
        const row = rows.get(id)
        if (!row) return { changes: 0 }
        row.last_run = lastRun
        return { changes: 1 }
      }
      if (sql.includes('DELETE FROM scheduled_tasks')) {
        const [id] = params
        const deleted = rows.delete(id)
        return { changes: deleted ? 1 : 0 }
      }
      return { changes: 0 }
    }),
  })),
}

vi.mock('../../electron/main/thoughtVectorStore', () => ({
  getDBInstance: () => database,
}))

vi.mock('../../electron/main/settingsManager', () => ({
  loadSettings: vi.fn(async () => ({ approvedCommands: ['echo'] })),
}))

vi.mock('node-cron', () => ({
  validate: vi.fn(() => true),
  createTask: vi.fn(() => {
    const job = {
      start: vi.fn(),
      stop: vi.fn(),
      destroy: vi.fn(),
    }
    cronJobs.push(job)
    return job
  }),
}))

vi.mock('electron', () => ({
  webContents: {
    getAllWebContents: () => windows,
  },
}))

const {
  createScheduledTask,
  getAllScheduledTasks,
  initializeSchedulerDB,
  loadAndScheduleAllTasks,
  shutdownScheduler,
} = await import('../../electron/main/schedulerManager')

describe('schedulerManager one-time schedules', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T10:00:00.000+08:00'))
    rows.clear()
    windows.splice(0)
    cronJobs.splice(0)
    database.exec.mockClear()
    database.prepare.mockClear()
    initializeSchedulerDB()
  })

  afterEach(() => {
    shutdownScheduler()
    vi.useRealTimers()
  })

  it('fires a one-time reminder once and marks it completed', async () => {
    const send = vi.fn()
    windows.push({ isDestroyed: () => false, send })

    const result = await createScheduledTask(
      'stretch',
      '',
      'reminder',
      '站起来活动一下',
      {
        scheduleType: 'once',
        runAt: new Date(Date.now() + 1_000).toISOString(),
      }
    )

    expect(result.success).toBe(true)
    expect(rows.size).toBe(1)

    await vi.advanceTimersByTimeAsync(1_000)
    await vi.runAllTicks()

    expect(send).toHaveBeenCalledTimes(1)
    const task = [...rows.values()][0]
    expect(task.is_active).toBe(0)
    expect(task.status).toBe('completed')
    expect(task.next_run).toBeNull()

    await vi.advanceTimersByTimeAsync(60_000)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('cancels a future one-time timer during shutdown', async () => {
    const send = vi.fn()
    windows.push({ isDestroyed: () => false, send })

    const result = await createScheduledTask(
      'future',
      '',
      'reminder',
      '不会送达',
      {
        scheduleType: 'once',
        runAt: new Date(Date.now() + 60_000).toISOString(),
      }
    )
    expect(result.success).toBe(true)

    shutdownScheduler()
    await vi.advanceTimersByTimeAsync(60_000)

    expect(send).not.toHaveBeenCalled()
    expect([...rows.values()][0].is_active).toBe(1)
  })

  it('marks an expired one-time row missed instead of replaying it on startup', async () => {
    rows.set('expired', {
      id: 'expired',
      name: '过期提醒',
      cron_expression: '',
      schedule_type: 'once',
      run_at: new Date(Date.now() - 1_000).toISOString(),
      action_type: 'reminder',
      details: '不应补发',
      is_active: 1,
      status: 'active',
      created_at: new Date(Date.now() - 5_000).toISOString(),
      last_run: null,
      next_run: null,
    })

    await loadAndScheduleAllTasks()

    expect(rows.get('expired')?.is_active).toBe(0)
    expect(rows.get('expired')?.status).toBe('missed')
    expect(cronJobs).toHaveLength(0)
  })

  it('keeps legacy cron rows recurring after schema migration', async () => {
    rows.set('legacy', {
      id: 'legacy',
      name: '旧周期任务',
      cron_expression: '0 9 * * 1-5',
      action_type: 'reminder',
      details: '早安',
      is_active: 1,
      created_at: '2026-08-29T00:00:00.000Z',
      last_run: null,
      next_run: null,
    })

    await loadAndScheduleAllTasks()

    expect(cronJobs).toHaveLength(1)
    expect(getAllScheduledTasks()).toEqual([
      expect.objectContaining({
        id: 'legacy',
        scheduleType: 'recurring',
        cronExpression: '0 9 * * 1-5',
        status: 'active',
        isActive: true,
      }),
    ])
  })
})
