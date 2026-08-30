import * as cron from 'node-cron'
import { randomUUID } from 'node:crypto'
import { getDBInstance } from './thoughtVectorStore'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import { loadSettings } from './settingsManager'

const execAsync = promisify(exec)

export interface ScheduledTask {
  id: string
  name: string
  /** Five-field cron expression for recurring tasks (empty for one-time). */
  cronExpression: string
  /** Omitted by legacy callers; defaults to recurring. */
  scheduleType?: 'recurring' | 'once'
  /** Absolute ISO timestamp for one-time tasks. */
  runAt?: string
  actionType: 'command' | 'reminder'
  details: string
  isActive: boolean
  /** Omitted by legacy callers; inferred from isActive when persisted. */
  status?: 'active' | 'completed' | 'missed' | 'disabled'
  createdAt: string
  lastRun?: string
  nextRun?: string
}

const activeCronJobs = new Map<string, cron.ScheduledTask>()
type OneShotTimer = ReturnType<typeof setTimeout>
const activeOneShotTimers = new Map<string, OneShotTimer>()

const MAX_TIMER_DELAY_MS = 2_147_000_000

type SchedulerDbRow = {
  id: string
  name: string
  cron_expression: string | null
  schedule_type?: string | null
  run_at?: string | null
  action_type: string
  details: string
  is_active: number
  status?: string | null
  created_at: string
  last_run: string | null
  next_run: string | null
}

function normalizeScheduleType(value: unknown): 'recurring' | 'once' {
  return value === 'once' ? 'once' : 'recurring'
}

function normalizeTaskStatus(value: unknown): ScheduledTask['status'] {
  if (value === 'completed' || value === 'missed' || value === 'disabled') {
    return value
  }
  return 'active'
}

function rowToTask(row: SchedulerDbRow): ScheduledTask {
  const scheduleType = normalizeScheduleType(row.schedule_type)
  const isActive = row.is_active === 1
  let status = normalizeTaskStatus(row.status)
  if (isActive) {
    status = 'active'
  } else if (status === 'active') {
    // Legacy rows had no status column; inactive legacy tasks were manually
    // disabled and should not be presented as still active.
    status = 'disabled'
  }
  return {
    id: row.id,
    name: row.name,
    cronExpression: row.cron_expression || '',
    scheduleType,
    runAt: row.run_at || undefined,
    actionType: row.action_type as 'command' | 'reminder',
    details: row.details,
    isActive,
    status,
    createdAt: row.created_at,
    lastRun: row.last_run || undefined,
    nextRun: row.next_run || undefined,
  }
}

function clearActiveSchedule(taskId: string): void {
  const cronJob = activeCronJobs.get(taskId)
  if (cronJob) {
    try {
      cronJob.stop()
      cronJob.destroy()
    } catch (error) {
      console.warn(
        `[SchedulerManager] Failed to stop existing cron job ${taskId}:`,
        error
      )
    }
    activeCronJobs.delete(taskId)
  }

  const timer = activeOneShotTimers.get(taskId)
  if (timer) {
    clearTimeout(timer)
    activeOneShotTimers.delete(taskId)
  }
}

/**
 * Initialize the scheduler database table
 */
export function initializeSchedulerDB(): void {
  const db = getDBInstance()

  db.exec(`
    CREATE TABLE IF NOT EXISTS scheduled_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      cron_expression TEXT NOT NULL DEFAULT '',
      schedule_type TEXT NOT NULL DEFAULT 'recurring',
      run_at TEXT,
      action_type TEXT NOT NULL CHECK (action_type IN ('command', 'reminder')),
      details TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      last_run TEXT,
      next_run TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks (is_active);
    CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next_run ON scheduled_tasks (next_run);
  `)

  // Existing installations have the original cron-only schema. SQLite does
  // not support adding a column conditionally in CREATE TABLE, so migrate the
  // small set of scheduler metadata columns explicitly and keep old rows
  // recurring by default.
  const columns = db
    .prepare('PRAGMA table_info(scheduled_tasks)')
    .all() as Array<{ name: string }>
  const addColumnIfMissing = (name: string, definition: string) => {
    if (!columns.some(column => column.name === name)) {
      db.exec(`ALTER TABLE scheduled_tasks ADD COLUMN ${name} ${definition}`)
    }
  }
  addColumnIfMissing('cron_expression', "TEXT NOT NULL DEFAULT ''")
  addColumnIfMissing('schedule_type', "TEXT NOT NULL DEFAULT 'recurring'")
  addColumnIfMissing('run_at', 'TEXT')
  addColumnIfMissing('status', "TEXT NOT NULL DEFAULT 'active'")

  console.log('[SchedulerManager] Database table initialized')
}

/**
 * Load all active tasks from database and schedule them
 */
export async function loadAndScheduleAllTasks(): Promise<void> {
  const db = getDBInstance()

  try {
    const activeTasks = db
      .prepare('SELECT * FROM scheduled_tasks WHERE is_active = 1')
      .all() as SchedulerDbRow[]

    console.log(`[SchedulerManager] Loading ${activeTasks.length} active tasks`)

    for (const task of activeTasks) {
      const scheduledTask = rowToTask(task)

      if (scheduledTask.scheduleType === 'once') {
        const runAtMs = new Date(scheduledTask.runAt || '').getTime()
        if (!Number.isFinite(runAtMs) || runAtMs <= Date.now()) {
          markOneShotTaskMissed(scheduledTask.id)
          console.log(
            `[SchedulerManager] Marked expired one-time task as missed: ${scheduledTask.name} (${scheduledTask.id})`
          )
          continue
        }
      }

      await scheduleTask(scheduledTask, false)
    }

    console.log('[SchedulerManager] All active tasks loaded and scheduled')
  } catch (error) {
    console.error('[SchedulerManager] Failed to load tasks:', error)
  }
}

/**
 * Schedule a single task
 */
export async function scheduleTask(
  task: ScheduledTask,
  saveToDb: boolean = true
): Promise<boolean> {
  let persisted = false
  try {
    // Re-scheduling the same task ID must first tear down its previous
    // runtime handle. This matters during settings reloads and prevents a
    // reminder from firing twice after a task is restored.
    clearActiveSchedule(task.id)

    if (task.scheduleType === 'once') {
      const runAtMs = new Date(task.runAt || '').getTime()
      if (!Number.isFinite(runAtMs)) {
        console.error(
          `[SchedulerManager] Invalid one-time runAt: ${task.runAt || ''}`
        )
        return false
      }
      if (runAtMs <= Date.now()) {
        if (saveToDb) {
          return false
        }
        markOneShotTaskMissed(task.id)
        return false
      }
    } else if (!task.cronExpression || !cron.validate(task.cronExpression)) {
      console.error(
        `[SchedulerManager] Invalid cron expression: ${task.cronExpression}`
      )
      return false
    }

    // Persist a newly-created task before arming its runtime handle. This
    // closes a tiny race where a very near one-time timer could fire before
    // its INSERT completed and leave an active row behind.
    if (saveToDb) {
      await saveTaskToDb(task)
      persisted = true
    }

    if (task.scheduleType === 'once') {
      const runAtMs = new Date(task.runAt || '').getTime()

      const armTimer = () => {
        const remaining = runAtMs - Date.now()
        if (remaining <= 0) {
          activeOneShotTimers.delete(task.id)
          void executeOneShotTask(task)
          return
        }
        const timer = setTimeout(
          armTimer,
          Math.min(remaining, MAX_TIMER_DELAY_MS)
        )
        activeOneShotTimers.set(task.id, timer)
      }
      armTimer()
    } else {
      const cronJob = cron.createTask(
        task.cronExpression,
        async () => {
          console.log(`[SchedulerManager] Executing task: ${task.name}`)
          await executeTask(task)

          const now = new Date().toISOString()
          updateTaskLastRun(task.id, now)
        },
        {
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }
      )

      cronJob.start()
      activeCronJobs.set(task.id, cronJob)
    }

    console.log(
      `[SchedulerManager] Task scheduled: ${task.name} (${task.scheduleType === 'once' ? task.runAt : task.cronExpression})`
    )
    return true
  } catch (error) {
    clearActiveSchedule(task.id)
    if (persisted) {
      try {
        getDBInstance()
          .prepare('DELETE FROM scheduled_tasks WHERE id = ?')
          .run(task.id)
      } catch (cleanupError) {
        console.error(
          '[SchedulerManager] Failed to roll back a task after scheduling error:',
          cleanupError
        )
      }
    }
    console.error(
      `[SchedulerManager] Failed to schedule task ${task.name}:`,
      error
    )
    return false
  }
}

/**
 * Execute a scheduled task
 */
async function executeTask(task: ScheduledTask): Promise<void> {
  try {
    if (task.actionType === 'command') {
      const command = task.details.trim()
      const commandName = command.split(/\s+/)[0]?.split(/[\\/]/).pop() || ''
      const approvedCommands = (await loadSettings())?.approvedCommands || []
      if (!approvedCommands.includes(commandName)) {
        console.warn(
          `[SchedulerManager] Blocked unapproved scheduled command: ${commandName}`
        )
        return
      }
      console.log(`[SchedulerManager] Executing command: ${task.details}`)
      const { stdout, stderr } = await execAsync(task.details)

      if (stderr) {
        console.warn(`[SchedulerManager] Command stderr: ${stderr}`)
      }
      if (stdout) {
        console.log(`[SchedulerManager] Command stdout: ${stdout}`)
      }
    } else if (task.actionType === 'reminder') {
      console.log(`[SchedulerManager] Sending reminder: ${task.details}`)
      const { webContents } = await import('electron')
      const allWindows = webContents.getAllWebContents()

      for (const wc of allWindows) {
        if (!wc.isDestroyed()) {
          wc.send('scheduler:reminder', {
            taskId: task.id,
            taskName: task.name,
            message: task.details,
            timestamp: new Date().toISOString(),
          })
        }
      }
    }
  } catch (error) {
    console.error(
      `[SchedulerManager] Failed to execute task ${task.name}:`,
      error
    )
  }
}

/**
 * Save task to database
 */
async function saveTaskToDb(task: ScheduledTask): Promise<void> {
  const db = getDBInstance()

  try {
    const stmt = db.prepare(`
      INSERT INTO scheduled_tasks 
      (id, name, cron_expression, schedule_type, run_at, action_type, details, is_active, status, created_at, last_run, next_run)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    stmt.run(
      task.id,
      task.name,
      task.cronExpression,
      task.scheduleType || 'recurring',
      task.runAt || null,
      task.actionType,
      task.details,
      task.isActive ? 1 : 0,
      task.status || (task.isActive ? 'active' : 'disabled'),
      task.createdAt,
      task.lastRun || null,
      task.nextRun || null
    )

    console.log(`[SchedulerManager] Task saved to database: ${task.id}`)
  } catch (error) {
    console.error('[SchedulerManager] Failed to save task to database:', error)
    throw error
  }
}

/**
 * Update task's last run time
 */
function updateTaskLastRun(taskId: string, lastRun: string): void {
  const db = getDBInstance()

  try {
    const stmt = db.prepare(
      'UPDATE scheduled_tasks SET last_run = ? WHERE id = ?'
    )
    stmt.run(lastRun, taskId)
  } catch (error) {
    console.error('[SchedulerManager] Failed to update last run time:', error)
  }
}

function updateOneShotStatus(
  taskId: string,
  status: 'completed' | 'missed',
  timestamp: string = new Date().toISOString()
): boolean {
  const db = getDBInstance()
  try {
    const result = db
      .prepare(
        'UPDATE scheduled_tasks SET is_active = 0, status = ?, last_run = ?, next_run = NULL WHERE id = ? AND is_active = 1'
      )
      .run(status, timestamp, taskId)
    return Number(result?.changes || 0) > 0
  } catch (error) {
    console.error(
      `[SchedulerManager] Failed to mark one-time task ${status}:`,
      error
    )
    return false
  }
}

function markOneShotTaskMissed(taskId: string): void {
  clearActiveSchedule(taskId)
  updateOneShotStatus(taskId, 'missed')
}

async function executeOneShotTask(task: ScheduledTask): Promise<void> {
  // Mark before invoking the action so a crash/reload during execution cannot
  // cause the same one-time reminder or command to run again.
  if (!updateOneShotStatus(task.id, 'completed')) {
    console.log(
      `[SchedulerManager] Skipping one-time task that is no longer active: ${task.id}`
    )
    return
  }
  console.log(`[SchedulerManager] Executing one-time task: ${task.name}`)
  await executeTask(task)
}

/**
 * Create a new scheduled task
 */
export async function createScheduledTask(
  name: string,
  cronExpression: string,
  actionType: 'command' | 'reminder',
  details: string,
  options: {
    scheduleType?: 'recurring' | 'once'
    runAt?: string
  } = {}
): Promise<{ success: boolean; taskId?: string; error?: string }> {
  try {
    const scheduleType = normalizeScheduleType(options.scheduleType)
    const parsedRunAt = options.runAt ? new Date(options.runAt) : null
    const normalizedRunAt =
      parsedRunAt && Number.isFinite(parsedRunAt.getTime())
        ? parsedRunAt.toISOString()
        : undefined
    if (scheduleType === 'once') {
      if (
        !normalizedRunAt ||
        new Date(normalizedRunAt).getTime() <= Date.now()
      ) {
        return {
          success: false,
          error: '一次性计划必须提供晚于当前时间的 runAt。',
        }
      }
    } else if (!cronExpression || !cron.validate(cronExpression)) {
      return { success: false, error: '周期计划的 cron 表达式无效。' }
    }

    const task: ScheduledTask = {
      id: randomUUID(),
      name: name.trim(),
      cronExpression: scheduleType === 'once' ? '' : cronExpression.trim(),
      scheduleType,
      runAt: normalizedRunAt,
      actionType,
      details,
      isActive: true,
      status: 'active',
      createdAt: new Date().toISOString(),
      nextRun: normalizedRunAt,
    }

    const success = await scheduleTask(task, true)

    if (success) {
      return { success: true, taskId: task.id }
    } else {
      return { success: false, error: '创建计划任务失败。' }
    }
  } catch (error) {
    console.error('[SchedulerManager] Failed to create task:', error)
    return { success: false, error: String(error) }
  }
}

/**
 * Get all scheduled tasks
 */
export function getAllScheduledTasks(): ScheduledTask[] {
  const db = getDBInstance()

  try {
    const tasks = db
      .prepare('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
      .all() as SchedulerDbRow[]

    return tasks.map(rowToTask)
  } catch (error) {
    console.error('[SchedulerManager] Failed to get tasks:', error)
    return []
  }
}

/**
 * Delete a scheduled task
 */
export async function deleteScheduledTask(taskId: string): Promise<boolean> {
  try {
    clearActiveSchedule(taskId)

    const db = getDBInstance()
    const stmt = db.prepare('DELETE FROM scheduled_tasks WHERE id = ?')
    const result = stmt.run(taskId)

    if (result.changes > 0) {
      console.log(`[SchedulerManager] Task deleted: ${taskId}`)
      return true
    } else {
      console.log(`[SchedulerManager] Task not found: ${taskId}`)
      return false
    }
  } catch (error) {
    console.error('[SchedulerManager] Failed to delete task:', error)
    return false
  }
}

/**
 * Toggle task active status
 */
export async function toggleTaskStatus(taskId: string): Promise<boolean> {
  try {
    const db = getDBInstance()

    const task = db
      .prepare('SELECT * FROM scheduled_tasks WHERE id = ?')
      .get(taskId) as any
    if (!task) {
      return false
    }

    const newStatus = task.is_active === 1 ? 0 : 1
    const scheduleType = normalizeScheduleType(task.schedule_type)

    const stmt = db.prepare(
      'UPDATE scheduled_tasks SET is_active = ?, status = ? WHERE id = ?'
    )
    stmt.run(newStatus, newStatus === 1 ? 'active' : 'disabled', taskId)

    if (newStatus === 1) {
      const scheduledTask: ScheduledTask = {
        id: task.id,
        name: task.name,
        cronExpression: task.cron_expression || '',
        scheduleType,
        runAt: task.run_at || undefined,
        actionType: task.action_type,
        details: task.details,
        isActive: true,
        status: 'active',
        createdAt: task.created_at,
        lastRun: task.last_run || undefined,
        nextRun: task.next_run || undefined,
      }
      const scheduled = await scheduleTask(scheduledTask, false)
      if (!scheduled) {
        const current = db
          .prepare('SELECT status, is_active FROM scheduled_tasks WHERE id = ?')
          .get(taskId) as { status?: string; is_active?: number } | undefined
        if (current?.status !== 'missed') {
          db.prepare(
            'UPDATE scheduled_tasks SET is_active = 0, status = ? WHERE id = ?'
          ).run('disabled', taskId)
        }
        return false
      }
    } else {
      clearActiveSchedule(taskId)
    }

    console.log(
      `[SchedulerManager] Task ${taskId} ${newStatus === 1 ? 'activated' : 'deactivated'}`
    )
    return true
  } catch (error) {
    console.error('[SchedulerManager] Failed to toggle task status:', error)
    return false
  }
}

/**
 * Shutdown all scheduled tasks
 */
export function shutdownScheduler(): void {
  console.log('[SchedulerManager] Shutting down scheduler...')

  for (const [taskId, cronJob] of activeCronJobs) {
    try {
      cronJob.stop()
      cronJob.destroy()
      console.log(`[SchedulerManager] Stopped task: ${taskId}`)
    } catch (error) {
      console.error(`[SchedulerManager] Error stopping task ${taskId}:`, error)
    }
  }

  activeCronJobs.clear()
  for (const [taskId, timer] of activeOneShotTimers) {
    try {
      clearTimeout(timer)
      console.log(`[SchedulerManager] Stopped one-time task: ${taskId}`)
    } catch (error) {
      console.error(
        `[SchedulerManager] Error stopping one-time task ${taskId}:`,
        error
      )
    }
  }
  activeOneShotTimers.clear()
  console.log('[SchedulerManager] Scheduler shutdown complete')
}
