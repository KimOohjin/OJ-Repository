import { useState } from 'react'
import { db, type ProgramExerciseRecord } from '@/data/db'
import type { LoadedProgram } from '@/data/seed'
import { uid } from '@/data/seed'
import { MUSCLE_LABEL_KO, type Exercise, type ExerciseRole } from '@/domain/types'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card } from './primitives'

const ROLE_LABEL: Record<ExerciseRole, string> = {
  main: '메인',
  secondary: '보조',
  isolation: '고립',
}
const ROLE_STYLE: Record<ExerciseRole, string> = {
  main: 'bg-indigo-500/20 text-indigo-300 ring-indigo-500/40',
  secondary: 'bg-sky-500/20 text-sky-300 ring-sky-500/40',
  isolation: 'bg-slate-500/20 text-slate-300 ring-slate-500/40',
}

export function ProgramView({
  loaded,
  onRegenerate,
}: {
  loaded: LoadedProgram
  onRegenerate: () => void
}) {
  const byId = useAppStore((s) => s.exercisesById)
  const refreshProgram = useAppStore((s) => s.refreshProgram)
  const { program, block, days } = loaded

  const [editing, setEditing] = useState<ProgramExerciseRecord | null>(null)
  const [addingToDay, setAddingToDay] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{program.name}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {program.splitType} ·{' '}
            {program.source === 'rules' ? '규칙 엔진' : `AI (${program.source.split(':')[1]})`} 생성
          </p>
        </div>
        <Button variant="ghost" onClick={onRegenerate}>
          다시 만들기
        </Button>
      </div>

      <Card className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="text-slate-400">블록</span> {block?.lengthWeeks ?? program.lengthWeeks}주
          (축적 {program.accumulationWeeks} + 디로드 1)
        </span>
        <span>
          <span className="text-slate-400">현재</span> {block?.currentWeek ?? 1}주차
        </span>
        {program.priorityMuscle && (
          <span>
            <span className="text-slate-400">우선</span>{' '}
            {MUSCLE_LABEL_KO[program.priorityMuscle]}
          </span>
        )}
      </Card>

      {program.warnings.length > 0 && (
        <Card className="text-sm text-amber-300 space-y-1">
          {program.warnings.map((w, i) => (
            <p key={i}>⚠ {w}</p>
          ))}
        </Card>
      )}

      {days.map((d) => (
        <Card key={d.id} className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold">
              {d.dayIndex + 1}일차 · {d.label}
            </h2>
            <span className="text-xs text-slate-400">약 {d.estDurationMin}분</span>
          </div>
          <ul className="divide-y divide-slate-700/60">
            {d.exercises.map((e) => {
              const ex = byId.get(e.exerciseId)
              const s = e.setScheme
              return (
                <li key={e.id} className="py-2.5 flex items-center gap-3">
                  <span
                    className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-md ring-1 ${ROLE_STYLE[e.role]}`}
                  >
                    {ROLE_LABEL[e.role]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(e)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <p className="font-medium truncate">{ex?.nameKo ?? e.exerciseId}</p>
                    <p className="text-xs text-slate-400">
                      {s.sets}세트 ×{' '}
                      {s.repLow === s.repHigh ? s.repLow : `${s.repLow}–${s.repHigh}`}회 · RPE{' '}
                      {s.targetRpeByWeek.join('→')} · 휴식 {s.restSec}s
                    </p>
                    {e.warnings?.length ? (
                      <p className="text-[11px] text-amber-400 mt-0.5">⚠ {e.warnings[0]}</p>
                    ) : null}
                  </button>
                  <span className="text-slate-600 text-xs shrink-0">편집</span>
                </li>
              )
            })}
          </ul>
          <button
            type="button"
            onClick={() => setAddingToDay(d.id)}
            className="text-sm text-indigo-400 underline"
          >
            + 종목 추가
          </button>
        </Card>
      ))}

      {editing && (
        <EditExerciseSheet
          pe={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refreshProgram()
          }}
        />
      )}
      {addingToDay && (
        <PickExerciseSheet
          onClose={() => setAddingToDay(null)}
          onPick={async (ex) => {
            const siblings = days.find((d) => d.id === addingToDay)?.exercises ?? []
            const template = siblings.find((s) => s.role === 'isolation') ?? siblings[0]
            await db.programExercises.add({
              id: uid(),
              programDayId: addingToDay,
              exerciseId: ex.id,
              order: siblings.length,
              role: ex.movementType === 'compound' ? 'secondary' : 'isolation',
              setScheme: template
                ? { ...template.setScheme }
                : {
                    sets: 3,
                    repLow: ex.defaultRepRange[0],
                    repHigh: ex.defaultRepRange[1],
                    targetRpeByWeek: [7, 8, 9],
                    restSec: 90,
                  },
              progressionRule: 'doubleProgression',
              progressionConfig: { incrementKg: 2.5, deloadPct: 0.1, stallWindow: 3 },
              startingWeightKg: null,
              supersetGroup: null,
              techniqueTag: 'straight',
            })
            setAddingToDay(null)
            await refreshProgram()
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Sheet({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60">
      <div className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-t-3xl bg-slate-900 ring-1 ring-slate-700 p-4 pb-8 space-y-4">
        {children}
        <Button variant="ghost" onClick={onClose}>
          닫기
        </Button>
      </div>
    </div>
  )
}

function NumberRow({
  label,
  value,
  step,
  min,
  onChange,
}: {
  label: string
  value: number
  step: number
  min: number
  onChange: (v: number) => void
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-slate-300">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - step))}
          className="w-11 h-11 rounded-l-xl bg-slate-700 text-xl font-bold"
        >
          −
        </button>
        <span className="w-16 h-11 flex items-center justify-center bg-slate-800 tabular-nums font-semibold">
          {value}
        </span>
        <button
          type="button"
          onClick={() => onChange(value + step)}
          className="w-11 h-11 rounded-r-xl bg-slate-700 text-xl font-bold"
        >
          +
        </button>
      </div>
    </div>
  )
}

function EditExerciseSheet({
  pe,
  onClose,
  onSaved,
}: {
  pe: ProgramExerciseRecord
  onClose: () => void
  onSaved: () => void
}) {
  const byId = useAppStore((s) => s.exercisesById)
  const [scheme, setScheme] = useState({ ...pe.setScheme })
  const [swapping, setSwapping] = useState(false)
  const ex = byId.get(pe.exerciseId)

  if (swapping) {
    return (
      <PickExerciseSheet
        onClose={() => setSwapping(false)}
        onPick={async (picked) => {
          await db.programExercises.update(pe.id, { exerciseId: picked.id })
          onSaved()
        }}
      />
    )
  }

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-lg font-bold">{ex?.nameKo ?? pe.exerciseId}</h2>
      <p className="text-xs text-slate-400">
        {ex ? `${MUSCLE_LABEL_KO[ex.primaryMuscle]} · ${ex.equipment}` : ''}
      </p>

      <div className="space-y-3">
        <NumberRow
          label="세트 수"
          value={scheme.sets}
          step={1}
          min={1}
          onChange={(sets) => setScheme((s) => ({ ...s, sets }))}
        />
        <NumberRow
          label="최소 횟수"
          value={scheme.repLow}
          step={1}
          min={1}
          onChange={(repLow) => setScheme((s) => ({ ...s, repLow, repHigh: Math.max(repLow, s.repHigh) }))}
        />
        <NumberRow
          label="최대 횟수"
          value={scheme.repHigh}
          step={1}
          min={1}
          onChange={(repHigh) => setScheme((s) => ({ ...s, repHigh, repLow: Math.min(repHigh, s.repLow) }))}
        />
        <NumberRow
          label="휴식 (초)"
          value={scheme.restSec}
          step={15}
          min={20}
          onChange={(restSec) => setScheme((s) => ({ ...s, restSec }))}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          onClick={async () => {
            await db.programExercises.update(pe.id, { setScheme: scheme })
            onSaved()
          }}
        >
          저장
        </Button>
        <Button variant="ghost" onClick={() => setSwapping(true)}>
          종목 교체
        </Button>
        <Button
          variant="danger"
          onClick={async () => {
            await db.programExercises.delete(pe.id)
            onSaved()
          }}
        >
          삭제
        </Button>
      </div>
    </Sheet>
  )
}

function PickExerciseSheet({
  onClose,
  onPick,
}: {
  onClose: () => void
  onPick: (ex: Exercise) => void
}) {
  const catalog = useAppStore((s) => s.catalog)
  const [q, setQ] = useState('')
  const filtered = catalog.filter(
    (e) =>
      q.trim() === '' ||
      e.nameKo.includes(q) ||
      e.nameEn.toLowerCase().includes(q.toLowerCase()) ||
      MUSCLE_LABEL_KO[e.primaryMuscle].includes(q),
  )

  return (
    <Sheet onClose={onClose}>
      <h2 className="text-lg font-bold">종목 선택</h2>
      <input
        type="text"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="이름 또는 부위로 검색"
        className="w-full min-h-12 px-3 rounded-xl bg-slate-800 ring-1 ring-slate-700 text-slate-100"
      />
      <ul className="divide-y divide-slate-800">
        {filtered.map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onPick(e)}
              className="w-full text-left py-3 flex items-center gap-3"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium truncate">{e.nameKo}</p>
                <p className="text-xs text-slate-500">
                  {MUSCLE_LABEL_KO[e.primaryMuscle]} · {e.equipment} ·{' '}
                  {e.movementType === 'compound' ? '복합' : '고립'}
                </p>
              </div>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
