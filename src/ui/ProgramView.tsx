import { MUSCLE_LABEL_KO } from '@/domain/types'
import type { ExerciseRole } from '@/domain/types'
import { useAppStore } from '@/store/useAppStore'
import type { LoadedProgram } from '@/data/seed'
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
  const { program, block, days } = loaded

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{program.name}</h1>
          <p className="text-sm text-slate-400 mt-1">
            {program.splitType} · {program.experience} ·{' '}
            {program.source === 'rules' ? '규칙 엔진' : program.source} 생성
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
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{ex?.nameKo ?? e.exerciseId}</p>
                    <p className="text-xs text-slate-400">
                      {s.sets}세트 × {s.repLow === s.repHigh ? s.repLow : `${s.repLow}–${s.repHigh}`}회
                      {' · '}RPE {s.targetRpeByWeek.join('→')}
                      {' · '}휴식 {s.restSec}s
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>
      ))}
    </div>
  )
}
