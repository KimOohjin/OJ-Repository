import { useState } from 'react'
import type {
  Equipment,
  Experience,
  GeneratorInput,
  Goal,
  Muscle,
  SessionLength,
} from '@/domain/types'
import { ALL_MUSCLES, MUSCLE_LABEL_KO } from '@/domain/types'
import { useAppStore } from '@/store/useAppStore'
import { Button, Card, Field, SegmentedControl } from './primitives'

const GOALS: Array<{ value: Goal; label: string }> = [
  { value: 'hypertrophy', label: '근비대 (근육량)' },
  { value: 'strength', label: '근력' },
  { value: 'fatLossRecomp', label: '체지방 감량·리컴프' },
]

const EXPERIENCE: Array<{ value: Experience; label: string }> = [
  { value: 'beginner', label: '초보 (<1년)' },
  { value: 'intermediate', label: '중급 (1~3년)' },
  { value: 'advanced', label: '상급 (3년+)' },
]

const DAYS: Array<{ value: 2 | 3 | 4 | 5 | 6; label: string }> = [
  { value: 2, label: '2일' },
  { value: 3, label: '3일' },
  { value: 4, label: '4일' },
  { value: 5, label: '5일' },
  { value: 6, label: '6일' },
]

const SESSION: Array<{ value: SessionLength; label: string }> = [
  { value: 45, label: '45분' },
  { value: 60, label: '60분' },
  { value: 75, label: '75분' },
  { value: 90, label: '90분' },
]

const EQUIPMENT: Array<{ value: Equipment; label: string }> = [
  { value: 'barbell', label: '바벨' },
  { value: 'dumbbell', label: '덤벨' },
  { value: 'machine', label: '머신' },
  { value: 'cable', label: '케이블' },
  { value: 'smith', label: '스미스' },
  { value: 'kettlebell', label: '케틀벨' },
  { value: 'bodyweight', label: '맨몸' },
]

export function GeneratorWizard() {
  const generateFromRules = useAppStore((s) => s.generateFromRules)
  const hasAiKey = useAppStore((s) => Boolean(s.settings.aiApiKey))

  const [mode, setMode] = useState<'rules' | 'ai'>('rules')
  const [daysPerWeek, setDays] = useState<2 | 3 | 4 | 5 | 6>(4)
  const [goal, setGoal] = useState<Goal>('hypertrophy')
  const [sessionLengthMin, setSession] = useState<SessionLength>(60)
  const [experience, setExperience] = useState<Experience>('intermediate')
  const [priorityMuscle, setPriority] = useState<Muscle | ''>('')
  const [excluded, setExcluded] = useState<Equipment[]>([])
  const [freeform, setFreeform] = useState('')
  const [busy, setBusy] = useState(false)

  const toggleEquip = (e: Equipment) =>
    setExcluded((cur) => (cur.includes(e) ? cur.filter((x) => x !== e) : [...cur, e]))

  const submit = async () => {
    setBusy(true)
    try {
      const input: GeneratorInput = {
        daysPerWeek,
        goal,
        sessionLengthMin,
        experience,
        priorityMuscle: priorityMuscle || null,
        excludedEquipment: excluded,
        freeformNotes: freeform.trim() || undefined,
      }
      // AI path lands here later; v1 always uses the rule engine.
      await generateFromRules(input)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">프로그램 만들기</h1>

      <SegmentedControl
        value={mode}
        onChange={(m) => setMode(m as 'rules' | 'ai')}
        options={[
          { value: 'rules', label: '규칙 엔진 (무료·오프라인)' },
          { value: 'ai', label: hasAiKey ? 'AI 생성' : 'AI 생성 (키 필요)' },
        ]}
      />
      {mode === 'ai' && (
        <Card className="text-sm text-amber-300">
          AI 생성은 설정에서 API 키를 넣으면 활성화됩니다. 지금은 규칙 엔진으로 생성돼요.
        </Card>
      )}

      <Card className="space-y-4">
        <Field label="주당 운동 일수">
          <SegmentedControl options={DAYS} value={daysPerWeek} onChange={setDays} />
        </Field>
        <Field label="1차 목표">
          <SegmentedControl options={GOALS} value={goal} onChange={setGoal} />
        </Field>
        <Field label="세션 길이">
          <SegmentedControl options={SESSION} value={sessionLengthMin} onChange={setSession} />
        </Field>
        <Field label="경력">
          <SegmentedControl options={EXPERIENCE} value={experience} onChange={setExperience} />
        </Field>
        <Field label="우선 부위 (선택)">
          <select
            value={priorityMuscle}
            onChange={(e) => setPriority(e.target.value as Muscle | '')}
            className="w-full min-h-12 px-3 rounded-xl bg-slate-900 ring-1 ring-slate-700 text-slate-100"
          >
            <option value="">없음</option>
            {ALL_MUSCLES.map((m) => (
              <option key={m} value={m}>
                {MUSCLE_LABEL_KO[m]}
              </option>
            ))}
          </select>
        </Field>
        <Field label="제외할 장비 (선택)">
          <div className="flex flex-wrap gap-2">
            {EQUIPMENT.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => toggleEquip(e.value)}
                className={`min-h-11 px-3 rounded-xl text-sm ring-1 ${
                  excluded.includes(e.value)
                    ? 'bg-rose-600/80 text-white ring-rose-500'
                    : 'bg-slate-800 text-slate-300 ring-slate-700'
                }`}
              >
                {e.label}
              </button>
            ))}
          </div>
        </Field>
        {mode === 'ai' && (
          <Field label="자유 서술 (AI 전용)">
            <textarea
              value={freeform}
              onChange={(e) => setFreeform(e.target.value)}
              rows={3}
              placeholder="예: 어깨가 안 좋아서 오버헤드 프레스는 빼줘. 주말에 시간이 더 있어."
              className="w-full p-3 rounded-xl bg-slate-900 ring-1 ring-slate-700 text-slate-100 text-sm"
            />
          </Field>
        )}
      </Card>

      <Button type="submit" onClick={submit} disabled={busy}>
        {busy ? '생성 중…' : '프로그램 생성'}
      </Button>
    </div>
  )
}
