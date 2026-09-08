/**
 * Screen Wake Lock manager.
 *
 * Safari iOS 16.4+ supports `navigator.wakeLock`. The lock is released
 * automatically whenever the document is hidden, so we re-acquire on return to
 * visibility. Always release when a workout finishes — holding it drains battery.
 */

type WakeLockSentinelLike = { released: boolean; release: () => Promise<void> }

let sentinel: WakeLockSentinelLike | null = null
let wanted = false
let listening = false

export function isWakeLockSupported(): boolean {
  return typeof navigator !== 'undefined' && 'wakeLock' in navigator
}

async function acquire(): Promise<void> {
  if (!wanted || !isWakeLockSupported() || document.visibilityState !== 'visible') return
  if (sentinel && !sentinel.released) return
  try {
    const nav = navigator as Navigator & {
      wakeLock: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    sentinel = await nav.wakeLock.request('screen')
  } catch {
    // Denied (low battery, permissions policy). Non-fatal — the UI tells the
    // user to keep the screen on manually.
    sentinel = null
  }
}

function ensureListener(): void {
  if (listening || typeof document === 'undefined') return
  listening = true
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void acquire()
  })
}

/** Request that the screen stays awake until `releaseWakeLock` is called. */
export async function requestWakeLock(): Promise<void> {
  wanted = true
  ensureListener()
  await acquire()
}

export async function releaseWakeLock(): Promise<void> {
  wanted = false
  const s = sentinel
  sentinel = null
  if (s && !s.released) {
    try {
      await s.release()
    } catch {
      /* already gone */
    }
  }
}
