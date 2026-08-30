import fs from 'node:fs/promises'
import path from 'node:path'

export type JournalFileOperation = {
  action: 'move' | 'copy' | 'rename'
  source: string
  destination: string
  completedAt: string
}

export type FileOperationJournalEntry = {
  operationId: string
  operations: JournalFileOperation[]
}

const MAX_ENTRIES = 50

function isValidOperation(value: unknown): value is JournalFileOperation {
  if (!value || typeof value !== 'object') return false
  const operation = value as Record<string, unknown>
  return (
    (operation.action === 'move' ||
      operation.action === 'copy' ||
      operation.action === 'rename') &&
    typeof operation.source === 'string' &&
    path.isAbsolute(operation.source) &&
    typeof operation.destination === 'string' &&
    path.isAbsolute(operation.destination) &&
    typeof operation.completedAt === 'string'
  )
}

/**
 * Persists the small, reversible file-operation journal independently from
 * the settings file. Only absolute paths and timestamps are stored; file
 * contents are never copied into the journal.
 */
export class FileOperationJournal {
  private readonly entries = new Map<string, JournalFileOperation[]>()
  private ready: Promise<void>
  private persistQueue: Promise<void> = Promise.resolve()

  constructor(private readonly filePath: string) {
    this.ready = this.load()
  }

  async waitUntilReady(): Promise<void> {
    await this.ready
  }

  get(operationId: string): JournalFileOperation[] | undefined {
    const operations = this.entries.get(operationId)
    return operations
      ? operations.map(operation => ({ ...operation }))
      : undefined
  }

  async set(
    operationId: string,
    operations: JournalFileOperation[]
  ): Promise<void> {
    await this.ready
    if (!operationId || !operations.length) return
    this.entries.set(
      operationId,
      operations.map(operation => ({ ...operation }))
    )
    while (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value
      if (typeof oldest !== 'string') break
      this.entries.delete(oldest)
    }
    await this.persist()
  }

  async delete(operationId: string): Promise<void> {
    await this.ready
    if (!this.entries.delete(operationId)) return
    await this.persist()
  }

  private async load(): Promise<void> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8')
      const parsed: unknown = JSON.parse(raw)
      if (!Array.isArray(parsed)) return
      for (const value of parsed.slice(-MAX_ENTRIES)) {
        if (!value || typeof value !== 'object') continue
        const entry = value as Record<string, unknown>
        const operationId = entry.operationId
        const operations = entry.operations
        if (
          typeof operationId !== 'string' ||
          !operationId ||
          !Array.isArray(operations) ||
          operations.length === 0
        ) {
          continue
        }
        const validOperations = operations.filter(isValidOperation)
        if (validOperations.length === operations.length) {
          this.entries.set(operationId, validOperations)
        }
      }
    } catch (error: any) {
      // A missing or corrupt journal should not prevent Alice from starting.
      // Keep the error visible for diagnostics, but begin with an empty log.
      if (error?.code !== 'ENOENT') {
        console.warn(
          '[FileOperationJournal] Ignoring unreadable journal:',
          error
        )
      }
    }
  }

  private async persist(): Promise<void> {
    const write = this.persistQueue.then(async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true })
      const payload = JSON.stringify(
        [...this.entries].map(([operationId, operations]) => ({
          operationId,
          operations,
        })),
        null,
        2
      )
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`
      try {
        await fs.writeFile(temporaryPath, payload, {
          encoding: 'utf8',
          mode: 0o600,
        })
        // Rename is atomic when replacing is supported by the platform. On
        // Windows an existing destination can reject rename, so remove only
        // this known journal file before retrying the rename.
        try {
          await fs.rename(temporaryPath, this.filePath)
        } catch (error: any) {
          if (error?.code !== 'EEXIST' && error?.code !== 'EPERM') throw error
          await fs.rm(this.filePath, { force: true })
          await fs.rename(temporaryPath, this.filePath)
        }
      } finally {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      }
    })
    this.persistQueue = write.catch(() => undefined)
    await write
  }
}

export const FILE_OPERATION_JOURNAL_MAX_ENTRIES = MAX_ENTRIES
