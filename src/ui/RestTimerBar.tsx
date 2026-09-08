import { useEffect, useState } from 'react'
import {
  addRestSeconds,
  foregroundScheduler,
  formatClock,
  tickRest,
  type RestTimerState,
} from '@/platform/restTimer'

/**
 * Floating rest bar. Time is always recomputed from the absolute `endsAt`, so
 * an iOS suspension while backgrounded can't drift the clock.
 */
export function RestTimerBar({
  state,
  onChange,
  onDismiss,
}: {
  state: RestTimerState
  onChange: (s: RestTimerState) => void
  onDismiss: () => void
}) {
  const [notified, setNotified] = useState(false)

  useEffect(() => {
    if (state.endsAt == null) return
    const id = setInterval(() => onChange(tickRest(state)), 250)
    const onVisible = () => {
      if (document.visibilityState === 'visible') onChange(tickRest(state))
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [state, onChange])

  useEffect(() => {
    if (state.elapsed && !notified) {
      setNotified(true)
      if (document.visibilityState === 'visible') {
        foregroundScheduler.notify('휴식 완료 — 다음 세트!')
      }
    }
    if (!state.elapsed && notified) setNotified(false)
  }, [state.elapsed, notified])

  if (state.endsAt == null) return null

  const pct = state.totalSec > 0 ? 1 - state.remainingSec / state.totalSec : 1
  const done = state.elapsed

  return (
    <div className="safe-bottom fixed bottom-3 inset-x-0 max-w-lg mx-auto px-4 z-20">
      <div
        className={`rounded-2xl ring-1 overflow-hidden ${
          done ? 'bg-emerald-600 ring-emerald-400' : 'bg-slate-800 ring-slate-600'
        }`}
      >
        <div className="h-1 bg-slate-700">
          <div
            className={done ? 'h-full bg-emerald-300' : 'h-full bg-indigo-400'}
            style={{ width: `${Math.min(100, pct * 100)}%` }}
          />
        </div>
        <div className="flex items-center gap-2 px-3 py-2.5">
          <span className="text-xl font-bold tabular-nums w-16">
            {done ? '완료' : formatClock(state.remainingSec)}
          </span>
          <span className="text-xs text-slate-300 flex-1">
            {done ? '휴식이 끝났어요' : '휴식 중'}
          </span>
          {!done && (
            <>
              <button
                type="button"
                onClick={() => onChange(addRestSeconds(state, -15))}
                className="min-h-10 px-2.5 rounded-lg bg-slate-700 text-sm"
              >
                −15s
              </button>
              <button
                type="button"
                onClick={() => onChange(addRestSeconds(state, 15))}
                className="min-h-10 px-2.5 rounded-lg bg-slate-700 text-sm"
              >
                +15s
              </button>
            </>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="min-h-10 px-3 rounded-lg bg-slate-900/60 text-sm font-semibold"
          >
            {done ? '확인' : '건너뛰기'}
          </button>
        </div>
      </div>
    </div>
  )
}
