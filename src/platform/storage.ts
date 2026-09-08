/**
 * Storage durability safeguards for an iOS PWA.
 *
 * WebKit evicts script-writable storage after 7 days without first-party
 * interaction *unless the PWA is installed to the Home Screen*. Even installed,
 * it is still evictable under disk pressure and wiped by "Clear History and
 * Website Data". So: request persistence, detect the standalone/tab state, and
 * nudge the user to export backups.
 */

import { getSetting, setSetting } from '@/data/db'

export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return window.matchMedia('(display-mode: standalone)').matches || iosStandalone
}

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent)
}

/**
 * Ask the browser to mark our storage persistent. Must be called after a real
 * user interaction to have a chance of being granted.
 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false
    const already = (await navigator.storage.persisted?.()) ?? false
    const granted = already || (await navigator.storage.persist())
    await setSetting('persistentStorageGranted', granted)
    return granted
  } catch {
    return false
  }
}

export interface StorageEstimateInfo {
  usageBytes: number
  quotaBytes: number
  persisted: boolean
}

export async function getStorageInfo(): Promise<StorageEstimateInfo | null> {
  try {
    if (!navigator.storage?.estimate) return null
    const est = await navigator.storage.estimate()
    const persisted = (await navigator.storage.persisted?.()) ?? false
    return { usageBytes: est.usage ?? 0, quotaBytes: est.quota ?? 0, persisted }
  } catch {
    return null
  }
}

const DAY_MS = 86_400_000

/**
 * Whether to show the "export a backup" banner. Deliberately quiet at the very
 * start — nagging after a single workout trains people to ignore the banner.
 */
export async function shouldNudgeBackup(): Promise<boolean> {
  const [since, lastAt, days] = await Promise.all([
    getSetting('workoutsSinceBackup'),
    getSetting('lastBackupAt'),
    getSetting('backupReminderDays'),
  ])
  if (since >= 5) return true
  // Never backed up: wait until there's enough logged to be worth losing.
  if (lastAt === 0) return since >= 3
  return Date.now() - lastAt > days * DAY_MS
}

export async function noteWorkoutCompleted(): Promise<void> {
  const n = await getSetting('workoutsSinceBackup')
  await setSetting('workoutsSinceBackup', n + 1)
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}
