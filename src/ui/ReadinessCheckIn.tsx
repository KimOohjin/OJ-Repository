import { useState } from 'react'
import type { ReadinessEntryRecord } from '@/data/db'
import { saveReadiness, today } from '@/data/sessions'
import {
  BAND_LABEL_KO,
  readinessScore,
  type ReadinessBand,
} from '@/domain/readiness/fatigueModel'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card } from './primitives'

const BAND_COLOR: Record<ReadinessBand, string> = {
  green: 'text-emerald-400',
  yellow: 'text-lime-400',
  orange: 'text-amber-400',
  red: 'text-rose-400',
}

const SCALES: Array<{
  key: 'sleepQuality' | 'soreness' | 'energy' | 'stress' | 'motivation'
  label: string
  lowLabel: string
  highLabel: string
}> = [
  { key: 'sleepQuality', label: '수면의 질', lowLabel: '나쁨', highLabel: '좋음' },
  { key: 'soreness', label: '근육통', lowLabel: '없음', highLabel: '심함' },
  { key: 'energy', label: '에너지', lowLabel: '없음', highLabel: '충만' },
  { key: 'stress', label: '스트레스', lowLabel: '없음', highLabel: '심함' },
  { key: 'motivation', label: '운동 의욕', lowLabel: '없음', highLabel: '높음' },
]

export function ReadinessCheckIn({ existing }: { existing: ReadinessEntryRecord | null }) {
  const acwr = useAppStore((s) => s.acwr)
  const refreshStatus = useAppStore((s) => s.refreshStatus)

  // Defaults describe an ordinary decent day, so the common case is one tap
  // (저장) and only a bad day needs adjusting.
  const [values, setValues] = useState({
    sleepQuality: existing?.sleepQuality ?? 4,
    soreness: existing?.soreness ?? 2,
    energy: existing?.energy ?? 4,
    stress: existing?.stress ?? 2,
    motivation: existing?.motivation ?? 4,
  })
  const [sleepHours, setSleepHours] = useState<string>(
    existing?.sleepHours != null ? String(existing.sleepHours) : '',
  )
  const [editing, setEditing] = useState(existing == null)
  const [saving, setSaving] = useState(false)

  const hours = sleepHours.trim() === '' ? undefined : Number(sleepHours)
  const preview = readinessScore(
    { ...values, sleepHours: Number.isFinite(hours) ? hours : undefined },
    { acwr: acwr?.acwr ?? null },
  )

  const save = async () => {
    setSaving(true)
    const now = Date.now()
    const entry: ReadinessEntryRecord = {
      date: today(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      ...values,
      sleepHours: Number.isFinite(hours) ? hours : undefined,
      score: preview.score,
      band: preview.band,
    }
    await saveReadiness(entry)
    await refreshStatus()
    setEditing(false)
    setSaving(false)
  }

  if (!editing && existing) {
    return (
      <Card className="space-y-1">
        <div className="flex items-baseline justify-between">
          <h2 className="font-semibold">오늘의 컨디션</h2>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-slate-400 underline"
          >
            수정
          </button>
        </div>
        <p className={`text-3xl font-bold ${BAND_COLOR[existing.band]}`}>{existing.score}</p>
        <p className="text-sm text-slate-400">{BAND_LABEL_KO[existing.band]}</p>
      </Card>
    )
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">오늘의 컨디션 체크</h2>
        <span className={`text-2xl font-bold ${BAND_COLOR[preview.band]}`}>{preview.score}</span>
      </div>

      {SCALES.map((s) => (
        <div key={s.key}>
          <div className="flex justify-between text-xs text-slate-400 mb-1.5">
            <span className="font-medium text-slate-300">{s.label}</span>
            <span>
              {s.lowLabel} → {s.highLabel}
            </span>
          </div>
          <div className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setValues((cur) => ({ ...cur, [s.key]: v }))}
                className={`flex-1 h-11 rounded-xl text-sm font-semibold ring-1 ${
                  values[s.key] === v
                    ? 'bg-indigo-500 text-white ring-indigo-400'
                    : 'bg-slate-800 text-slate-400 ring-slate-700'
                }`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div>
        <span className="block text-xs font-medium text-slate-300 mb-1.5">수면 시간 (선택)</span>
        <input
          type="text"
          inputMode="decimal"
          value={sleepHours}
          onChange={(e) => setSleepHours(e.target.value)}
          placeholder="예: 7.5"
          className="w-full h-12 px-3 rounded-xl bg-slate-900 ring-1 ring-slate-700 tabular-nums"
        />
      </div>

      <p className="text-sm text-slate-400">{BAND_LABEL_KO[preview.band]}</p>
      <Button onClick={save} disabled={saving}>
        {saving ? '저장 중…' : '저장'}
      </Button>
    </Card>
  )
}
