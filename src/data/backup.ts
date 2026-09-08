/**
 * JSON export / import.
 *
 * This is the app's only durability guarantee: IndexedDB on iOS can be evicted
 * (see `platform/storage.ts`). Exports deliberately EXCLUDE the AI API key —
 * a backup file may be shared, and the key is a credential.
 */

import { db, SCHEMA_VERSION, setSetting } from './db'
import { uid } from './seed'

const SECRET_SETTING_KEYS = new Set(['aiApiKey'])

export interface BackupPayload {
  app: 'workout-app'
  schemaVersion: number
  exportedAt: number
  tables: Record<string, unknown[]>
}

const TABLE_NAMES = [
  'exercises',
  'programs',
  'blocks',
  'programDays',
  'programExercises',
  'workouts',
  'workoutSets',
  'readinessEntries',
  'bodyMetrics',
  'personalRecords',
  'settings',
  'stallEvents',
  'deloadEvents',
] as const

export async function buildBackup(): Promise<BackupPayload> {
  const tables: Record<string, unknown[]> = {}
  for (const name of TABLE_NAMES) {
    const rows = await db.table(name).toArray()
    tables[name] =
      name === 'settings'
        ? rows.filter((r: { key: string }) => !SECRET_SETTING_KEYS.has(r.key))
        : rows
  }
  return {
    app: 'workout-app',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: Date.now(),
    tables,
  }
}

export async function exportBackup(): Promise<void> {
  const payload = await buildBackup()
  const json = JSON.stringify(payload)
  const stamp = new Date().toISOString().slice(0, 10)
  const filename = `workout-backup-${stamp}.json`
  const blob = new Blob([json], { type: 'application/json' })

  // Keep a rolling in-app snapshot as a last resort.
  await db.backups.add({ id: uid(), createdAt: Date.now(), schemaVersion: SCHEMA_VERSION, json })
  const all = await db.backups.orderBy('createdAt').toArray()
  if (all.length > 3) {
    await db.backups.bulkDelete(all.slice(0, all.length - 3).map((b) => b.id))
  }

  const file = new File([blob], filename, { type: 'application/json' })
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean
    share?: (data: { files: File[]; title?: string }) => Promise<void>
  }
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: filename })
      await markBackedUp()
      return
    } catch {
      // user cancelled or share failed — fall through to download
    }
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
  await markBackedUp()
}

async function markBackedUp(): Promise<void> {
  await setSetting('lastBackupAt', Date.now())
  await setSetting('workoutsSinceBackup', 0)
}

export interface ImportSummary {
  counts: Record<string, number>
  schemaVersion: number
  exportedAt: number
}

export function inspectBackup(json: string): ImportSummary {
  const parsed = JSON.parse(json) as BackupPayload
  if (parsed.app !== 'workout-app') throw new Error('이 앱의 백업 파일이 아닙니다.')
  const counts: Record<string, number> = {}
  for (const [name, rows] of Object.entries(parsed.tables ?? {})) {
    counts[name] = Array.isArray(rows) ? rows.length : 0
  }
  return { counts, schemaVersion: parsed.schemaVersion, exportedAt: parsed.exportedAt }
}

export async function importBackup(json: string, mode: 'merge' | 'replace'): Promise<void> {
  const parsed = JSON.parse(json) as BackupPayload
  if (parsed.app !== 'workout-app') throw new Error('이 앱의 백업 파일이 아닙니다.')
  if (parsed.schemaVersion > SCHEMA_VERSION) {
    throw new Error('더 최신 버전에서 만든 백업입니다. 앱을 업데이트해 주세요.')
  }

  await db.transaction('rw', TABLE_NAMES.map((n) => db.table(n)), async () => {
    for (const name of TABLE_NAMES) {
      const rows = parsed.tables?.[name]
      if (!Array.isArray(rows)) continue
      if (mode === 'replace') await db.table(name).clear()
      // `bulkPut` upserts by primary key, which is what "merge" means here.
      await db.table(name).bulkPut(rows.filter((r) => {
        if (name !== 'settings') return true
        return !SECRET_SETTING_KEYS.has((r as { key: string }).key)
      }))
    }
  })
}
