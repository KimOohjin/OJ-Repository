import { useEffect, useMemo, useState } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { db } from '@/data/db'
import { weeklyMuscleVolume } from '@/data/sessions'
import {
  VOLUME_LIGHT_LABEL_KO,
  type MuscleVolumeRow,
  type VolumeLight,
} from '@/domain/readiness/fatigueModel'
import { MUSCLE_LABEL_KO } from '@/domain/types'
import { useAppStore } from '@/store/useAppStore'
import { Card } from './primitives'

const LIGHT_COLOR: Record<VolumeLight, string> = {
  under: 'bg-sky-500',
  onTarget: 'bg-emerald-500',
  high: 'bg-amber-500',
  over: 'bg-rose-500',
}

interface E1rmPoint {
  date: string
  e1rm: number
}

export function AnalyticsScreen() {
  const program = useAppStore((s) => s.activeProgram)
  const byId = useAppStore((s) => s.exercisesById)

  const [volume, setVolume] = useState<MuscleVolumeRow[] | null>(null)
  const [showAllMuscles, setShowAllMuscles] = useState(false)
  const [trend, setTrend] = useState<Array<{ date: string; readiness?: number; acwr?: number }>>([])
  const [exerciseIds, setExerciseIds] = useState<string[]>([])
  const [selected, setSelected] = useState<string>('')
  const [e1rmSeries, setE1rmSeries] = useState<E1rmPoint[]>([])

  useEffect(() => {
    void (async () => {
      const rows = await weeklyMuscleVolume(
        program?.program.mevByMuscle ?? {},
        program?.program.mrvByMuscle ?? {},
      )
      // Muscles you've actually trained this week first — that's the part you
      // act on; the untouched rest is reference.
      setVolume(
        rows
          .filter((r) => r.plannedSets > 0 || r.actualSets > 0)
          .sort((a, b) => b.actualSets - a.actualSets || b.plannedSets - a.plannedSets),
      )

      const loads = await db.loadDaily.toArray()
      setTrend(
        loads
          .sort((a, b) => a.date.localeCompare(b.date))
          .slice(-28)
          .map((l) => ({
            date: l.date.slice(5),
            readiness: l.readinessScore,
            acwr: l.acwr > 0 ? Math.round(l.acwr * 100) : undefined,
          })),
      )

      const sets = await db.workoutSets.toArray()
      const ids = [...new Set(sets.filter((s) => s.e1rm != null).map((s) => s.exerciseId))]
      setExerciseIds(ids)
      setSelected((cur) => cur || ids[0] || '')
    })()
  }, [program])

  useEffect(() => {
    if (!selected) {
      setE1rmSeries([])
      return
    }
    void (async () => {
      const sets = await db.workoutSets.where('exerciseId').equals(selected).toArray()
      const bestPerDay = new Map<string, number>()
      for (const s of sets) {
        if (s.e1rm == null) continue
        const d = new Date(s.completedAt).toISOString().slice(0, 10)
        bestPerDay.set(d, Math.max(bestPerDay.get(d) ?? 0, s.e1rm))
      }
      setE1rmSeries(
        [...bestPerDay.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([date, e1rm]) => ({ date: date.slice(5), e1rm: Math.round(e1rm * 10) / 10 })),
      )
    })()
  }, [selected])

  const hasTrend = useMemo(
    () => trend.some((t) => t.readiness != null || t.acwr != null),
    [trend],
  )

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">분석</h1>

      <Card className="space-y-3">
        <h2 className="font-semibold">이번 주 근육군별 세트</h2>
        {volume == null ? (
          <p className="text-slate-400 text-sm">계산 중…</p>
        ) : volume.length === 0 ? (
          <p className="text-slate-400 text-sm">아직 기록이 없어요.</p>
        ) : (
          <ul className="space-y-2">
            {(showAllMuscles ? volume : volume.slice(0, 8)).map((r) => {
              const scale = Math.max(r.mrv, r.actualSets, r.plannedSets, 1)
              return (
                <li key={r.muscle} className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">{MUSCLE_LABEL_KO[r.muscle]}</span>
                    <span className="text-slate-400 tabular-nums">
                      {r.actualSets} / 계획 {r.plannedSets}
                      <span className="text-slate-600"> · 목표 {r.mev}~{r.mrv}</span>
                      <span className="ml-1.5 text-slate-300">
                        {VOLUME_LIGHT_LABEL_KO[r.light]}
                      </span>
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-900 overflow-hidden relative">
                    <div
                      className={`h-full ${LIGHT_COLOR[r.light]}`}
                      style={{ width: `${Math.min(100, (r.actualSets / scale) * 100)}%` }}
                    />
                    <div
                      className="absolute top-0 h-full w-px bg-slate-400/70"
                      style={{ left: `${Math.min(100, (r.mev / scale) * 100)}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {volume && volume.length > 8 && (
          <button
            type="button"
            onClick={() => setShowAllMuscles((v) => !v)}
            className="text-sm text-indigo-400 underline"
          >
            {showAllMuscles ? '접기' : `나머지 ${volume.length - 8}개 부위 보기`}
          </button>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">종목별 추정 1RM</h2>
        {exerciseIds.length === 0 ? (
          <p className="text-slate-400 text-sm">
            복합운동을 기록하면 추정 1RM 추이가 여기에 표시됩니다.
          </p>
        ) : (
          <>
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="w-full min-h-12 px-3 rounded-xl bg-slate-900 ring-1 ring-slate-700 text-slate-100"
            >
              {exerciseIds.map((id) => (
                <option key={id} value={id}>
                  {byId.get(id)?.nameKo ?? id}
                </option>
              ))}
            </select>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={e1rmSeries} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                  <CartesianGrid stroke="#1e293b" />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                  <YAxis stroke="#64748b" fontSize={11} domain={['auto', 'auto']} />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid #334155',
                      borderRadius: 12,
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="e1rm"
                    name="추정 1RM"
                    stroke="#818cf8"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">컨디션 · 부하 추세 (28일)</h2>
        {!hasTrend ? (
          <p className="text-slate-400 text-sm">컨디션 체크와 운동 기록이 쌓이면 표시됩니다.</p>
        ) : (
          <div className="h-52">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trend} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="#1e293b" />
                <XAxis dataKey="date" stroke="#64748b" fontSize={11} />
                <YAxis stroke="#64748b" fontSize={11} />
                <Tooltip
                  contentStyle={{
                    background: '#0f172a',
                    border: '1px solid #334155',
                    borderRadius: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="readiness"
                  name="컨디션"
                  stroke="#34d399"
                  strokeWidth={2}
                  connectNulls
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="acwr"
                  name="ACWR×100"
                  stroke="#fbbf24"
                  strokeWidth={2}
                  connectNulls
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </div>
  )
}
