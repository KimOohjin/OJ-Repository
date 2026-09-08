import { useEffect, useState } from 'react'
import { db, type WorkoutRecord, type WorkoutSetRecord } from '@/data/db'
import { useAppStore } from '@/store/useAppStore'
import { Card } from './primitives'

interface Row {
  workout: WorkoutRecord
  sets: WorkoutSetRecord[]
  label: string
}

export function HistoryScreen() {
  const byId = useAppStore((s) => s.exercisesById)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const workouts = (await db.workouts.toArray())
        .filter((w) => w.status === 'completed')
        .sort((a, b) => (b.endedAt ?? b.startedAt) - (a.endedAt ?? a.startedAt))
        .slice(0, 40)
      const days = await db.programDays.toArray()
      const dayLabel = new Map(days.map((d) => [d.id, d.label]))
      const out: Row[] = []
      for (const w of workouts) {
        out.push({
          workout: w,
          sets: await db.workoutSets.where('workoutId').equals(w.id).toArray(),
          label: (w.programDayId && dayLabel.get(w.programDayId)) || '운동',
        })
      }
      setRows(out)
    })()
  }, [])

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">기록</h1>
      {rows == null ? (
        <p className="text-slate-400">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <Card className="text-slate-400 text-sm">아직 완료한 운동이 없어요.</Card>
      ) : (
        rows.map(({ workout, sets, label }) => {
          const volume = sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0)
          const date = new Date(workout.endedAt ?? workout.startedAt)
          const expanded = open === workout.id
          return (
            <Card key={workout.id} className="space-y-2">
              <button
                type="button"
                onClick={() => setOpen(expanded ? null : workout.id)}
                className="w-full text-left"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">{label}</span>
                  <span className="text-xs text-slate-400 shrink-0">
                    {date.getMonth() + 1}/{date.getDate()}
                  </span>
                </div>
                <p className="text-xs text-slate-400 mt-0.5">
                  {sets.length}세트 · {Math.round(volume).toLocaleString()}kg ·{' '}
                  {workout.durationMin}분
                  {workout.sessionRpe != null && ` · 세션 RPE ${workout.sessionRpe}`}
                </p>
              </button>
              {expanded && (
                <ul className="text-sm space-y-1 pt-1 border-t border-slate-700/60">
                  {sets
                    .sort((a, b) => a.order - b.order)
                    .map((s) => (
                      <li key={s.id} className="flex gap-2 text-slate-300">
                        <span className="flex-1 truncate">
                          {byId.get(s.exerciseId)?.nameKo ?? s.exerciseId}
                        </span>
                        <span className="tabular-nums shrink-0">
                          {s.weightKg}kg × {s.reps}
                          {s.rpe != null && (
                            <span className="text-slate-500"> @{s.rpe}</span>
                          )}
                          {s.isPrAtTime && <span className="text-amber-400"> PR</span>}
                        </span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
          )
        })
      )}
    </div>
  )
}
