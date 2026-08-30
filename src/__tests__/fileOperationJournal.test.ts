import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import {
  FILE_OPERATION_JOURNAL_MAX_ENTRIES,
  FileOperationJournal,
  type JournalFileOperation,
} from '../../electron/main/fileOperationJournal'

const operation = (name: string): JournalFileOperation => ({
  action: 'move',
  source: `/tmp/${name}.txt`,
  destination: `/tmp/archive/${name}.txt`,
  completedAt: '2026-08-30T12:00:00.000Z',
})

const temporaryDirectories: string[] = []

async function createJournalPath(): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'alice-journal-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'alice-file-operation-history.json')
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map(directory => fs.rm(directory, { recursive: true, force: true }))
  )
})

describe('FileOperationJournal', () => {
  it('persists entries and restores them in a new process instance', async () => {
    const journalPath = await createJournalPath()
    const first = new FileOperationJournal(journalPath)
    await first.waitUntilReady()
    await first.set('operation-1', [operation('report')])

    const second = new FileOperationJournal(journalPath)
    await second.waitUntilReady()
    expect(second.get('operation-1')).toEqual([operation('report')])
  })

  it('removes an undone operation from disk', async () => {
    const journalPath = await createJournalPath()
    const journal = new FileOperationJournal(journalPath)
    await journal.set('operation-1', [operation('report')])
    await journal.delete('operation-1')

    const reloaded = new FileOperationJournal(journalPath)
    await reloaded.waitUntilReady()
    expect(reloaded.get('operation-1')).toBeUndefined()
  })

  it('ignores malformed entries without preventing startup', async () => {
    const journalPath = await createJournalPath()
    await fs.writeFile(
      journalPath,
      JSON.stringify([
        {
          operationId: 'bad',
          operations: [{ action: 'move', source: 'relative' }],
        },
        { operationId: 'good', operations: [operation('notes')] },
      ])
    )

    const journal = new FileOperationJournal(journalPath)
    await journal.waitUntilReady()
    expect(journal.get('bad')).toBeUndefined()
    expect(journal.get('good')).toEqual([operation('notes')])
  })

  it('retains only the newest bounded number of entries', async () => {
    const journalPath = await createJournalPath()
    const journal = new FileOperationJournal(journalPath)
    for (
      let index = 0;
      index < FILE_OPERATION_JOURNAL_MAX_ENTRIES + 2;
      index += 1
    ) {
      await journal.set(`operation-${index}`, [operation(`file-${index}`)])
    }

    expect(journal.get('operation-0')).toBeUndefined()
    expect(journal.get('operation-1')).toBeUndefined()
    expect(
      journal.get(`operation-${FILE_OPERATION_JOURNAL_MAX_ENTRIES + 1}`)
    ).toEqual([operation(`file-${FILE_OPERATION_JOURNAL_MAX_ENTRIES + 1}`)])
  })
})
