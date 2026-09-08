import { useEffect, useState } from 'react'
import { db, type WorkoutRecord } from '@/data/db'
import { applyDeloadWeek, advanceWeek, startWorkout } from '@/data/sessions'
import { ACWR_LABEL_KO } from '@/domain/readiness/fatigueModel'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card } from './primitives'
import { ReadinessCheckIn } from './ReadinessCheckIn'

/** Pick the next program day: whichever has gone longest without a session. */
async function suggestNextDay(programId: string, dayIds: string[]): Promise<string | null> {
  if (dayIds.length === 0) return null
  const workouts = await db.workouts.where('programId').equals(programId).toArray()
  const lastByDay = new Map<string, number>()
  for (const w of workouts) {
    if (w.status !== 'completed' || !w.programDayId) continue
    const t = w.endedAt ?? w.startedAt
    if (t > (lastByDay.get(w.programDayId) ?? 0)) lastByDay.set(w.programDayId, t)
  }
  return [...dayIds].sort((a, b) => (lastByDay.get(a) ?? 0) - (lastByDay.get(b) ?? 0))[0]
}

export function TodayScreen({ onStarted }: { onStarted: (w: WorkoutRecord) => void }) {
  const program = useAppStore((s) => s.activeProgram)
  const readiness = useAppStore((s) => s.readinessToday)
  const acwr = useAppStore((s) => s.acwr)
  const deload = useAppStore((s) => s.deload)
  const refreshProgram = useAppStore((s) => s.refreshProgram)
  const refreshStatus = useAppStore((s) => s.refreshStatus)

  const [suggestedDayId, setSuggested] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!program) return
    void suggestNextDay(
      program.program.id,
      program.days.map((d) => d.id),
    ).then(setSuggested)
  }, [program])

  if (!program) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold">오늘</h1>
        <Card className="text-slate-400 text-sm">
          아직 프로그램이 없어요. <b className="text-slate-200">프로그램</b> 탭에서 먼저 만들어
          주세요.
        </Card>
      </div>
    )
  }

  const block = program.block
  const day =
    program.days.find((d) => d.id === suggestedDayId) ?? program.days[0]
  const isDeloadWeek =
    block != null && block.currentWeek > block.accumulationWeeks

  const start = async () => {
    setBusy(true)
    const w = await startWorkout({
      programId: program.program.id,
      programDayId: day.id,
      blockId: block?.id,
      blockWeek: block?.currentWeek,
      readinessScore: readiness?.score,
    })
    await refreshStatus()
    setBusy(false)
    onStarted(w)
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">오늘</h1>

      {deload?.recommend && (
        <Card className="ring-amber-500/50 bg-amber-500/10 space-y-2">
          <h2 className="font-semibold text-amber-300">디로드를 권장합니다</h2>
          <ul className="text-sm text-amber-100/90 space-y-1">
            {deload.reasons.map((r, i) => (
              <li key={i}>• {r}</li>
            ))}
          </ul>
          {block && (
            <Button
              variant="ghost"
              onClick={async () => {
                await applyDeloadWeek(block.id)
                await refreshProgram()
              }}
            >
              이번 주를 디로드로 바꾸기
            </Button>
          )}
        </Card>
      )}

      <ReadinessCheckIn existing={readiness} />

      <Card className="space-y-3">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">{day.label}</h2>
          <span className="text-xs text-slate-400">
            {block?.currentWeek ?? 1}주차{isDeloadWeek ? ' · 디로드' : ''} · 약{' '}
            {day.estDurationMin}분
          </span>
        </div>
        <ul className="text-sm text-slate-300 space-y-0.5">
          {day.exercises.slice(0, 6).map((e) => (
            <li key={e.id} className="truncate">
              · {useAppStore.getState().exercisesById.get(e.exerciseId)?.nameKo ?? e.exerciseId}{' '}
              <span className="text-slate-500">
                {e.setScheme.sets}×
                {e.setScheme.repLow === e.setScheme.repHigh
                  ? e.setScheme.repLow
                  : `${e.setScheme.repLow}–${e.setScheme.repHigh}`}
              </span>
            </li>
          ))}
        </ul>
        <Button onClick={start} disabled={busy}>
          {busy ? '시작 중…' : '운동 시작'}
        </Button>
        <div className="flex flex-wrap gap-2">
          {program.days.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setSuggested(d.id)}
              className={`min-h-10 px-3 rounded-lg text-xs ring-1 ${
                d.id === day.id
                  ? 'bg-slate-700 text-slate-100 ring-slate-600'
                  : 'bg-slate-900 text-slate-400 ring-slate-800'
              }`}
            >
              {d.label}
            </button>
          ))}
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="font-semibold text-sm">훈련 부하</h2>
        {acwr == null || acwr.state === 'building' ? (
          <p className="text-sm text-slate-400">
            기준선 형성 중 ({acwr?.daysOfHistory ?? 0}/28일) — 4주치 기록이 쌓이면 과부하 경고가
            켜집니다.
          </p>
        ) : (
          <>
            <p className="text-2xl font-bold tabular-nums">
              {acwr.acwr!.toFixed(2)}
              <span className="text-sm font-normal text-slate-400 ml-2">
                {ACWR_LABEL_KO[acwr.state]}
              </span>
            </p>
            <p className="text-xs text-slate-500">
              최근 7일 부하 {Math.round(acwr.atl7)} · 4주 평균 {Math.round(acwr.ctl28)}
            </p>
          </>
        )}
      </Card>

      {block && (
        <button
          type="button"
          onClick={async () => {
            await advanceWeek(block.id)
            await refreshProgram()
          }}
          className="text-xs text-slate-500 underline"
        >
          다음 주차로 넘기기 ({block.currentWeek}/{block.lengthWeeks}주)
        </button>
      )}
    </div>
  )
}
