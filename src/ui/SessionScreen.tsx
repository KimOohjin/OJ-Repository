import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ProgramExerciseRecord, WorkoutRecord, WorkoutSetRecord } from '@/data/db'
import { db } from '@/data/db'
import {
  abandonWorkout,
  deleteSet,
  exerciseHistory,
  finishWorkout,
  logSet,
  nextPrescription,
} from '@/data/sessions'
import { noteWorkoutCompleted } from '@/platform/storage'
import { releaseWakeLock, requestWakeLock } from '@/platform/wakeLock'
import { IDLE_REST_TIMER, startRest, unlockAudio, type RestTimerState } from '@/platform/restTimer'
import type { Prescription } from '@/domain/progression/progressionEngine'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card } from './primitives'
import { RestTimerBar } from './RestTimerBar'

interface ExerciseCardState {
  pe: ProgramExerciseRecord
  prescription: Prescription
  lastSessionSets: Array<{ weightKg: number; reps: number }>
}

export function SessionScreen({
  workout,
  onExit,
}: {
  workout: WorkoutRecord
  onExit: () => void
}) {
  const byId = useAppStore((s) => s.exercisesById)
  const activeProgram = useAppStore((s) => s.activeProgram)
  const refreshStatus = useAppStore((s) => s.refreshStatus)
  const wakeLockEnabled = useAppStore((s) => s.settings.wakeLockEnabled)

  const [cards, setCards] = useState<ExerciseCardState[] | null>(null)
  const [sets, setSets] = useState<WorkoutSetRecord[]>([])
  const [rest, setRest] = useState<RestTimerState>(IDLE_REST_TIMER)
  const [toast, setToast] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [sessionRpe, setSessionRpe] = useState(8)

  const day = activeProgram?.days.find((d) => d.id === workout.programDayId)
  const blockWeek = workout.blockWeek ?? activeProgram?.block?.currentWeek ?? 1
  const isDeload =
    (activeProgram?.block?.accumulationWeeks ?? 3) < blockWeek

  // Load prescriptions + previous-session values for prefill.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      if (!day) return
      const built: ExerciseCardState[] = []
      for (const pe of day.exercises) {
        const [prescription, history] = await Promise.all([
          nextPrescription(pe, blockWeek, isDeload),
          exerciseHistory(pe.exerciseId, 1),
        ])
        const last = history[history.length - 1]
        built.push({
          pe,
          prescription,
          lastSessionSets:
            last?.sets
              .filter((s) => !s.isWarmup)
              .map((s) => ({ weightKg: s.weightKg, reps: s.reps })) ?? [],
        })
      }
      if (!cancelled) setCards(built)
    })()
    return () => {
      cancelled = true
    }
  }, [day, blockWeek, isDeload])

  const reloadSets = useCallback(async () => {
    setSets(await db.workoutSets.where('workoutId').equals(workout.id).toArray())
  }, [workout.id])

  useEffect(() => {
    void reloadSets()
  }, [reloadSets])

  useEffect(() => {
    if (wakeLockEnabled) void requestWakeLock()
    return () => {
      void releaseWakeLock()
    }
  }, [wakeLockEnabled])

  useEffect(() => {
    if (!toast) return
    const id = setTimeout(() => setToast(null), 3200)
    return () => clearTimeout(id)
  }, [toast])

  const setsByExercise = useMemo(() => {
    const m = new Map<string, WorkoutSetRecord[]>()
    for (const s of sets) {
      const list = m.get(s.exerciseId) ?? []
      list.push(s)
      m.set(s.exerciseId, list)
    }
    for (const list of m.values()) list.sort((a, b) => a.setIndex - b.setIndex)
    return m
  }, [sets])

  const totalVolume = useMemo(
    () => sets.reduce((sum, s) => sum + s.weightKg * s.reps, 0),
    [sets],
  )

  const handleLog = async (
    card: ExerciseCardState,
    weightKg: number,
    reps: number,
    rpe: number | undefined,
  ) => {
    unlockAudio()
    const done = setsByExercise.get(card.pe.exerciseId)?.length ?? 0
    const { prs } = await logSet({
      workoutId: workout.id,
      exerciseId: card.pe.exerciseId,
      programExerciseId: card.pe.id,
      setIndex: done + 1,
      weightKg,
      reps,
      rpe,
      restSecBefore: card.pe.setScheme.restSec,
    })
    await reloadSets()
    setRest(startRest(card.pe.setScheme.restSec))
    if (prs.length > 0 && !isDeload) {
      const best = prs.find((p) => p.type === 'e1rm') ?? prs[0]
      const name = byId.get(card.pe.exerciseId)?.nameKo ?? ''
      setToast(
        best.type === 'e1rm'
          ? `🎉 ${name} 추정 1RM 신기록! ${best.e1rm?.toFixed(1)}kg`
          : `🎉 ${name} 신기록! ${best.weightKg}kg × ${best.reps}회`,
      )
    }
  }

  const handleFinish = async () => {
    setFinishing(true)
    await finishWorkout(workout.id, sessionRpe)
    await noteWorkoutCompleted()
    await releaseWakeLock()
    await refreshStatus()
    onExit()
  }

  const handleAbandon = async () => {
    await abandonWorkout(workout.id)
    await releaseWakeLock()
    await refreshStatus()
    onExit()
  }

  if (!day) {
    return (
      <div className="space-y-4">
        <Card className="text-slate-400">이 세션의 프로그램 정보를 찾을 수 없어요.</Card>
        <Button variant="ghost" onClick={handleAbandon}>
          세션 종료
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{day.label}</h1>
          <p className="text-sm text-slate-400 mt-0.5">
            {blockWeek}주차{isDeload ? ' · 디로드' : ''} · 총 볼륨{' '}
            {Math.round(totalVolume).toLocaleString()}kg
          </p>
        </div>
        <button type="button" onClick={handleAbandon} className="text-sm text-slate-500 underline">
          중단
        </button>
      </div>

      {isDeload && (
        <Card className="text-sm text-sky-300">
          디로드 주입니다 — 무게와 세트를 줄여 회복에 집중하세요.
        </Card>
      )}

      {cards === null ? (
        <p className="text-slate-400">준비 중…</p>
      ) : (
        cards.map((card) => (
          <ExerciseCard
            key={card.pe.id}
            card={card}
            logged={setsByExercise.get(card.pe.exerciseId) ?? []}
            onLog={(w, r, rpe) => handleLog(card, w, r, rpe)}
            onDeleteSet={async (id) => {
              await deleteSet(id)
              await reloadSets()
            }}
          />
        ))
      )}

      <Card className="space-y-3">
        <h2 className="font-semibold">세션 마무리</h2>
        <div>
          <p className="text-sm text-slate-400 mb-2">
            오늘 세션은 전체적으로 얼마나 힘들었나요? (세션 RPE)
          </p>
          <div className="flex flex-wrap gap-1.5">
            {[4, 5, 6, 7, 8, 9, 10].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setSessionRpe(v)}
                className={`w-11 h-11 rounded-xl text-sm font-semibold ring-1 ${
                  sessionRpe === v
                    ? 'bg-indigo-500 text-white ring-indigo-400'
                    : 'bg-slate-800 text-slate-300 ring-slate-700'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
        <Button onClick={handleFinish} disabled={finishing || sets.length === 0}>
          {finishing ? '저장 중…' : '운동 완료'}
        </Button>
        {sets.length === 0 && (
          <p className="text-xs text-slate-500">세트를 하나 이상 기록해야 완료할 수 있어요.</p>
        )}
      </Card>

      {toast && (
        <div className="fixed top-4 inset-x-0 max-w-lg mx-auto px-4 z-30">
          <div className="rounded-xl bg-amber-500 text-slate-900 font-semibold px-4 py-3 shadow-lg">
            {toast}
          </div>
        </div>
      )}

      <RestTimerBar
        state={rest}
        onChange={setRest}
        onDismiss={() => setRest(IDLE_REST_TIMER)}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function ExerciseCard({
  card,
  logged,
  onLog,
  onDeleteSet,
}: {
  card: ExerciseCardState
  logged: WorkoutSetRecord[]
  onLog: (weightKg: number, reps: number, rpe: number | undefined) => void
  onDeleteSet: (id: string) => void
}) {
  const byId = useAppStore((s) => s.exercisesById)
  const step = useAppStore((s) => s.settings.minPlateIncrementKg ?? 2.5)
  const ex = byId.get(card.pe.exerciseId)
  const p = card.prescription

  // Prefill priority: what you just did this session > the prescription >
  // the matching set from last session. Empty (not "0") when nothing is known,
  // so the field reads as something to fill in rather than a real zero.
  const nextIndex = logged.length
  const lastThisSession = logged[logged.length - 1]
  const prior = card.lastSessionSets[nextIndex] ?? card.lastSessionSets[card.lastSessionSets.length - 1]
  const suggestedWeight = lastThisSession?.weightKg ?? p.weightKg ?? prior?.weightKg ?? null
  const suggestedReps = lastThisSession?.reps ?? p.repHigh

  const [weight, setWeight] = useState<string>(suggestedWeight == null ? '' : String(suggestedWeight))
  const [reps, setReps] = useState<string>(String(suggestedReps))
  const [rpe, setRpe] = useState<number | undefined>(undefined)
  const [touched, setTouched] = useState(false)

  // Re-prefill after each logged set unless the user has typed their own value.
  useEffect(() => {
    if (touched) return
    setWeight(suggestedWeight == null ? '' : String(suggestedWeight))
    setReps(String(suggestedReps))
  }, [nextIndex, suggestedWeight, suggestedReps, touched])

  const done = logged.length >= p.sets
  const w = Number(weight) || 0
  const r = Number(reps) || 0

  const bump = (delta: number) => {
    setTouched(true)
    setWeight(String(Math.max(0, Math.round((w + delta) * 100) / 100)))
  }

  return (
    <Card className={`space-y-3 ${done ? 'opacity-70' : ''}`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">{ex?.nameKo ?? card.pe.exerciseId}</h2>
        <span className="text-xs text-slate-400 shrink-0">
          {logged.length}/{p.sets}세트
        </span>
      </div>

      <p className="text-xs text-slate-400">
        목표 {p.repLow === p.repHigh ? `${p.repLow}회` : `${p.repLow}–${p.repHigh}회`} · RPE{' '}
        {p.targetRpe} · 휴식 {card.pe.setScheme.restSec}초
      </p>
      {/* The prescription note describes what to do *before* the first set; once
          sets are in, it's stale advice, so drop it. */}
      {logged.length === 0 && <p className="text-xs text-indigo-300">{p.note}</p>}

      {logged.length > 0 && (
        <ul className="space-y-1">
          {logged.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-2 text-sm bg-slate-900/60 rounded-lg px-3 py-1.5"
            >
              <span className="text-slate-500 w-6">{s.setIndex}</span>
              <span className="font-medium tabular-nums">
                {s.weightKg}kg × {s.reps}
              </span>
              {s.rpe != null && <span className="text-slate-400 text-xs">RPE {s.rpe}</span>}
              {s.isPrAtTime && <span className="text-amber-400 text-xs">PR</span>}
              <button
                type="button"
                onClick={() => onDeleteSet(s.id)}
                className="ml-auto text-slate-500 text-xs underline"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-end gap-2">
        <div className="flex-1">
          <span className="block text-[11px] text-slate-500 mb-1">무게 (kg)</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => bump(-step)}
              className="w-11 h-12 rounded-l-xl bg-slate-700 text-xl font-bold"
            >
              −
            </button>
            <input
              type="text"
              inputMode="decimal"
              value={weight}
              placeholder="무게"
              aria-label="무게 (kg)"
              onChange={(e) => {
                setTouched(true)
                setWeight(e.target.value)
              }}
              className="w-full h-12 text-center bg-slate-900 ring-1 ring-slate-700 text-lg font-semibold tabular-nums placeholder:text-slate-600 placeholder:font-normal placeholder:text-base"
            />
            <button
              type="button"
              onClick={() => bump(step)}
              className="w-11 h-12 rounded-r-xl bg-slate-700 text-xl font-bold"
            >
              +
            </button>
          </div>
        </div>
        <div className="w-28">
          <span className="block text-[11px] text-slate-500 mb-1">횟수</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                setTouched(true)
                setReps(String(Math.max(0, r - 1)))
              }}
              className="w-9 h-12 rounded-l-xl bg-slate-700 text-xl font-bold"
            >
              −
            </button>
            <input
              type="text"
              inputMode="numeric"
              value={reps}
              aria-label="횟수"
              onChange={(e) => {
                setTouched(true)
                setReps(e.target.value)
              }}
              className="w-full h-12 text-center bg-slate-900 ring-1 ring-slate-700 text-lg font-semibold tabular-nums"
            />
            <button
              type="button"
              onClick={() => {
                setTouched(true)
                setReps(String(r + 1))
              }}
              className="w-9 h-12 rounded-r-xl bg-slate-700 text-xl font-bold"
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-[11px] text-slate-500 mr-1">RPE</span>
        {[6, 7, 8, 9, 10].map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setRpe(rpe === v ? undefined : v)}
            className={`w-10 h-10 rounded-lg text-sm ring-1 ${
              rpe === v
                ? 'bg-indigo-500 text-white ring-indigo-400'
                : 'bg-slate-800 text-slate-400 ring-slate-700'
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      <Button
        onClick={() => {
          onLog(w, r, rpe)
          setTouched(false)
          setRpe(undefined)
        }}
        disabled={w <= 0 || r <= 0}
      >
        {logged.length + 1}세트 기록 + 휴식 시작
      </Button>
    </Card>
  )
}
