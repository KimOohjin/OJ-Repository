/**
 * Rest timer — foreground-first by design.
 *
 * iOS throttles/suspends JS timers when the tab is backgrounded and does not
 * reliably deliver local notifications from a backgrounded PWA (Web Push needs
 * an installed PWA *and* a push server, which this app deliberately does not
 * have). So we never trust a decrementing counter: we store an absolute
 * `endsAt` wall-clock timestamp and recompute remaining time whenever the page
 * becomes visible again.
 *
 * `NotificationScheduler` is the seam for a future push-server implementation.
 */

export interface NotificationScheduler {
  /** Called when the rest interval elapses while the page is visible. */
  notify(message: string): void
}

// --- audio -----------------------------------------------------------------
// iOS requires an AudioContext to be created/resumed inside a user gesture, so
// `unlockAudio` must be called from the first tap of a session.

let audioCtx: AudioContext | null = null

export function unlockAudio(): void {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return
    audioCtx ??= new Ctor()
    void audioCtx.resume()
  } catch {
    audioCtx = null
  }
}

function beep(): void {
  if (!audioCtx) return
  try {
    const now = audioCtx.currentTime
    const gain = audioCtx.createGain()
    gain.connect(audioCtx.destination)
    gain.gain.setValueAtTime(0.0001, now)
    for (let i = 0; i < 2; i++) {
      const t = now + i * 0.28
      const osc = audioCtx.createOscillator()
      osc.type = 'sine'
      osc.frequency.setValueAtTime(880, t)
      osc.connect(gain)
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22)
      osc.start(t)
      osc.stop(t + 0.24)
    }
  } catch {
    /* audio is a nicety, never a hard failure */
  }
}

export const foregroundScheduler: NotificationScheduler = {
  notify(message: string) {
    beep()
    try {
      navigator.vibrate?.([180, 90, 180]) // ignored by iOS Safari; harmless
    } catch {
      /* not supported */
    }
    // Best-effort only; core UX never depends on this being delivered.
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        new Notification(message)
      }
    } catch {
      /* not supported in this context */
    }
  },
}

// --- timer -----------------------------------------------------------------

export interface RestTimerState {
  /** Absolute wall-clock end time (epoch ms), or null when idle. */
  endsAt: number | null
  totalSec: number
  /** Seconds remaining, floored at 0. Recomputed, never accumulated. */
  remainingSec: number
  /** True once the interval has elapsed and the toast has not been cleared. */
  elapsed: boolean
}

export const IDLE_REST_TIMER: RestTimerState = {
  endsAt: null,
  totalSec: 0,
  remainingSec: 0,
  elapsed: false,
}

export function startRest(totalSec: number, now = Date.now()): RestTimerState {
  return {
    endsAt: now + totalSec * 1000,
    totalSec,
    remainingSec: totalSec,
    elapsed: false,
  }
}

/** Pure recomputation from the absolute timestamp — safe after JS suspension. */
export function tickRest(state: RestTimerState, now = Date.now()): RestTimerState {
  if (state.endsAt == null) return state
  const remainingSec = Math.max(0, Math.ceil((state.endsAt - now) / 1000))
  const elapsed = remainingSec === 0
  if (remainingSec === state.remainingSec && elapsed === state.elapsed) return state
  return { ...state, remainingSec, elapsed }
}

export function addRestSeconds(state: RestTimerState, delta: number): RestTimerState {
  if (state.endsAt == null) return state
  return {
    ...state,
    endsAt: state.endsAt + delta * 1000,
    totalSec: Math.max(0, state.totalSec + delta),
    elapsed: false,
  }
}

export function formatClock(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}
