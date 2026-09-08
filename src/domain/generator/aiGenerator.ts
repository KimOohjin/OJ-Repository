/**
 * AI program generation (optional, bring-your-own-key).
 *
 * A serverless PWA cannot ship an API key — anyone could read it — and a proxy
 * would mean a backend and running costs. So each user pastes their own key and
 * the request goes device -> provider directly, on their own quota.
 *
 * The model's output is validated against a schema and then sanity-checked with
 * the rule engine's own hard rules. Anything that fails falls back to the rule
 * engine, so this path can never leave the user without a program.
 */

import { z } from 'zod'
import {
  GENERATOR_VERSION,
  type Exercise,
  type ExerciseRole,
  type GeneratorInput,
  type Muscle,
  type ProgramDraft,
  type ProgramExerciseDraft,
} from '@/domain/types'
import { MUSCLE_LABEL_KO } from '@/domain/types'
import { SCHEMES, USABLE_SECONDS, VOLUME_LANDMARKS } from './data'
import { generateProgram } from './programGenerator'

export type AiProvider = 'gemini' | 'anthropic' | 'openai'

export interface LLMProvider {
  id: AiProvider
  label: string
  /** True when the provider has a free tier that needs no card. */
  free: boolean
  keyUrl: string
  generate(prompt: string, apiKey: string, signal?: AbortSignal): Promise<string>
}

// ---------------------------------------------------------------------------
// Draft schema the model must produce
// ---------------------------------------------------------------------------

const AiExercise = z.object({
  exerciseId: z.string(),
  role: z.enum(['main', 'secondary', 'isolation']),
  sets: z.number().int().min(1).max(8),
  repLow: z.number().int().min(1).max(30),
  repHigh: z.number().int().min(1).max(40),
  restSec: z.number().int().min(20).max(400),
})

const AiDay = z.object({
  label: z.string().min(1).max(40),
  exercises: z.array(AiExercise).min(2).max(10),
})

const AiProgram = z.object({
  name: z.string().min(1).max(60),
  splitType: z.string().min(1).max(40),
  days: z.array(AiDay).min(2).max(6),
  rationale: z.string().max(600).optional(),
})

export type AiProgramShape = z.infer<typeof AiProgram>

/** JSON Schema mirror of `AiProgram`, for providers with structured output. */
const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  required: ['name', 'splitType', 'days'],
  properties: {
    name: { type: 'string' },
    splitType: { type: 'string' },
    rationale: { type: 'string' },
    days: {
      type: 'array',
      items: {
        type: 'object',
        required: ['label', 'exercises'],
        properties: {
          label: { type: 'string' },
          exercises: {
            type: 'array',
            items: {
              type: 'object',
              required: ['exerciseId', 'role', 'sets', 'repLow', 'repHigh', 'restSec'],
              properties: {
                exerciseId: { type: 'string' },
                role: { type: 'string', enum: ['main', 'secondary', 'isolation'] },
                sets: { type: 'integer' },
                repLow: { type: 'integer' },
                repHigh: { type: 'integer' },
                restSec: { type: 'integer' },
              },
            },
          },
        },
      },
    },
  },
} as const

// ---------------------------------------------------------------------------
// Prompt — injects the rule engine's own methodology so the model works inside
// the same frame rather than inventing its own.
// ---------------------------------------------------------------------------

const GOAL_KO = {
  hypertrophy: '근비대(근육량 증가)',
  strength: '근력',
  fatLossRecomp: '체지방 감량·리컴프',
} as const

const EXPERIENCE_KO = {
  beginner: '초보(1년 미만)',
  intermediate: '중급(1~3년)',
  advanced: '상급(3년 이상)',
} as const

export function buildPrompt(input: GeneratorInput, catalog: Exercise[]): string {
  const landmarks = VOLUME_LANDMARKS[input.experience]
  const excluded = new Set(input.excludedEquipment ?? [])
  const usable = catalog.filter((e) => !excluded.has(e.equipment))

  const catalogLines = usable
    .map(
      (e) =>
        `${e.id} | ${e.nameKo} | 주동근:${e.primaryMuscle} | 보조:${e.secondaryMuscles.join(',') || '-'} | ${e.equipment} | ${e.movementType} | ${e.pattern}`,
    )
    .join('\n')

  const volumeLines = (Object.keys(landmarks) as Muscle[])
    .map((m) => `${MUSCLE_LABEL_KO[m]}(${m}): ${landmarks[m][0]}~${landmarks[m][1]}세트`)
    .join(', ')

  const schemeLines = (['main', 'secondary', 'isolation'] as ExerciseRole[])
    .map((role) => {
      const s = SCHEMES[input.goal][role]
      return `${role}: ${s.repLow}~${s.repHigh}회, 휴식 ${s.restSec}초, ${s.setRange[0]}~${s.setRange[1]}세트`
    })
    .join(' / ')

  return `당신은 근력운동 프로그램을 설계하는 코치입니다. 아래 조건과 방법론에 맞는 4주 메소사이클(3주 축적 + 1주 디로드)의 **1주차 주간 루틴**을 설계하세요.

## 사용자 조건
- 주당 운동 일수: ${input.daysPerWeek}일 (반드시 정확히 ${input.daysPerWeek}개의 day를 만들 것)
- 1차 목표: ${GOAL_KO[input.goal]}
- 1회 운동 시간: 약 ${input.sessionLengthMin}분 (워밍업 6분 제외 실제 운동 가능 시간 약 ${Math.round((USABLE_SECONDS[input.sessionLengthMin as 60] ?? 3240) / 60)}분)
- 경력: ${EXPERIENCE_KO[input.experience]}
${input.priorityMuscle ? `- 우선 발달 부위: ${MUSCLE_LABEL_KO[input.priorityMuscle]} (${input.priorityMuscle}) — 주간 세트를 다른 부위보다 많이 배정할 것` : ''}
${excluded.size ? `- 사용 불가 장비: ${[...excluded].join(', ')} — 해당 장비 종목은 절대 넣지 말 것` : ''}
${input.freeformNotes ? `\n### 사용자의 추가 요청 (가장 중요, 반드시 반영)\n"""\n${input.freeformNotes}\n"""` : ''}

## 반드시 지킬 방법론
1. 모든 주요 근육은 주 2회 이상 자극할 것.
2. 세션당 복합운동(compound)을 먼저 배치하고, 고립운동(isolation)은 뒤에 배치할 것.
3. 세션당 종목 수는 시간 예산에 맞출 것 (대략 45분→4개, 60분→5~6개, 75분→6~7개, 90분→7~8개).
4. 역할별 처방: ${schemeLines}
5. 주간 근육군별 총 세트 목표 범위(주동근 1세트, 보조근 0.5세트로 계산): ${volumeLines}
6. 각 day에는 role이 "main"인 종목이 정확히 1개 있어야 하며, 그것은 복합운동이어야 함.

## 종목 카탈로그 (이 목록의 exerciseId만 사용할 것. 목록에 없는 id를 지어내지 말 것)
${catalogLines}

## 출력
JSON만 출력하세요. 설명 문장을 JSON 밖에 쓰지 마세요.`
}

// ---------------------------------------------------------------------------
// Providers
// ---------------------------------------------------------------------------

async function readError(res: Response): Promise<string> {
  const text = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403) return 'API 키가 올바르지 않습니다.'
  if (res.status === 429) return '요청 한도에 도달했습니다. 잠시 후 다시 시도하세요.'
  return `요청 실패 (${res.status}) ${text.slice(0, 200)}`
}

export const geminiProvider: LLMProvider = {
  id: 'gemini',
  label: 'Google Gemini',
  free: true,
  keyUrl: 'https://aistudio.google.com/apikey',
  async generate(prompt, apiKey, signal) {
    const res = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
        signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_JSON_SCHEMA,
            temperature: 0.4,
          },
        }),
      },
    )
    if (!res.ok) throw new Error(await readError(res))
    const data = (await res.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
    }
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    if (!text) throw new Error('모델이 빈 응답을 반환했습니다.')
    return text
  },
}

export const anthropicProvider: LLMProvider = {
  id: 'anthropic',
  label: 'Anthropic Claude',
  free: false,
  keyUrl: 'https://console.anthropic.com/settings/keys',
  async generate(prompt, apiKey, signal) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      signal,
      body: JSON.stringify({
        model: 'claude-sonnet-4-5',
        max_tokens: 4096,
        tools: [
          {
            name: 'emit_program',
            description: '설계한 프로그램을 반환합니다.',
            input_schema: RESPONSE_JSON_SCHEMA,
          },
        ],
        tool_choice: { type: 'tool', name: 'emit_program' },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const data = (await res.json()) as {
      content?: Array<{ type: string; input?: unknown }>
    }
    const tool = data.content?.find((c) => c.type === 'tool_use')
    if (!tool?.input) throw new Error('모델이 프로그램을 반환하지 않았습니다.')
    return JSON.stringify(tool.input)
  },
}

export const openaiProvider: LLMProvider = {
  id: 'openai',
  label: 'OpenAI',
  free: false,
  keyUrl: 'https://platform.openai.com/api-keys',
  async generate(prompt, apiKey, signal) {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      signal,
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'program', schema: RESPONSE_JSON_SCHEMA, strict: false },
        },
        messages: [{ role: 'user', content: prompt }],
      }),
    })
    if (!res.ok) throw new Error(await readError(res))
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const text = data.choices?.[0]?.message?.content ?? ''
    if (!text) throw new Error('모델이 빈 응답을 반환했습니다.')
    return text
  },
}

export const PROVIDERS: Record<AiProvider, LLMProvider> = {
  gemini: geminiProvider,
  anthropic: anthropicProvider,
  openai: openaiProvider,
}

// ---------------------------------------------------------------------------
// Draft conversion + hard-rule sanity check
// ---------------------------------------------------------------------------

function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    // Some models wrap JSON in prose or a code fence.
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start === -1 || end <= start) throw new Error('응답을 JSON으로 해석할 수 없습니다.')
    return JSON.parse(text.slice(start, end + 1))
  }
}

export function aiShapeToDraft(
  shape: AiProgramShape,
  input: GeneratorInput,
  catalog: Exercise[],
  providerId: AiProvider,
): ProgramDraft {
  const byId = new Map(catalog.map((e) => [e.id, e]))
  const excluded = new Set(input.excludedEquipment ?? [])
  const warnings: string[] = []
  const landmarks = VOLUME_LANDMARKS[input.experience]

  const days = shape.days.map((d, dayIndex) => {
    const exercises: ProgramExerciseDraft[] = []
    d.exercises.forEach((e) => {
      const ex = byId.get(e.exerciseId)
      if (!ex) {
        warnings.push(`AI가 존재하지 않는 종목 "${e.exerciseId}"을(를) 제안해 제외했습니다.`)
        return
      }
      if (excluded.has(ex.equipment)) {
        warnings.push(`제외한 장비(${ex.equipment})의 "${ex.nameKo}"을(를) 빼고 구성했습니다.`)
        return
      }
      const spec = SCHEMES[input.goal][e.role]
      exercises.push({
        exerciseId: ex.id,
        order: exercises.length,
        role: e.role,
        setScheme: {
          sets: e.sets,
          repLow: Math.min(e.repLow, e.repHigh),
          repHigh: Math.max(e.repLow, e.repHigh),
          targetRpeByWeek: [...spec.targetRpeByWeek],
          restSec: e.restSec,
        },
        progressionRule: input.experience === 'beginner' && e.role !== 'isolation'
          ? 'linearLoad'
          : 'doubleProgression',
        progressionConfig: {
          incrementKg:
            e.role === 'isolation' ||
            !['squat', 'hinge', 'lunge'].includes(ex.pattern)
              ? 2.5
              : 5,
          deloadPct: 0.1,
          stallWindow: 3,
        },
        startingWeightKg: null,
        supersetGroup: null,
        techniqueTag: 'straight',
      })
    })

    const mains = exercises.filter((e) => e.role === 'main')
    if (mains.length === 0 && exercises.length > 0) {
      exercises[0].role = 'main'
      warnings.push(`"${d.label}"에 메인 리프트가 없어 첫 종목을 메인으로 지정했습니다.`)
    } else if (mains.length > 1) {
      mains.slice(1).forEach((m) => (m.role = 'secondary'))
    }

    const targetMuscles = [...new Set(exercises.map((e) => byId.get(e.exerciseId)!.primaryMuscle))]
    const estSec = exercises.reduce(
      (sum, e) => sum + 90 + e.setScheme.sets * (e.setScheme.restSec + 30) + 60,
      0,
    )
    return {
      dayIndex,
      label: d.label,
      pplFocus: 'ai',
      targetMuscles,
      estDurationMin: Math.round((estSec / 60 + 6) * 10) / 10,
      exercises,
    }
  })

  // --- hard rules -------------------------------------------------------
  if (days.length !== input.daysPerWeek) {
    warnings.push(`요청한 주 ${input.daysPerWeek}일과 다르게 ${days.length}일로 생성됐습니다.`)
  }
  const budgetMin = (USABLE_SECONDS[input.sessionLengthMin as 60] ?? 3240) / 60 + 6
  for (const d of days) {
    if (d.estDurationMin > budgetMin * 1.25) {
      warnings.push(`"${d.label}"은 예상 ${Math.round(d.estDurationMin)}분으로 목표 시간보다 깁니다.`)
    }
  }
  const freq = new Map<Muscle, number>()
  for (const d of days) for (const m of d.targetMuscles) freq.set(m, (freq.get(m) ?? 0) + 1)
  const under = [...freq.entries()].filter(
    ([m, c]) => c < 2 && ['chest', 'backLats', 'backUpper', 'quads', 'hamstrings'].includes(m),
  )
  for (const [m] of under) {
    warnings.push(`${MUSCLE_LABEL_KO[m]}이(가) 주 1회만 배정됐습니다 (권장: 주 2회 이상).`)
  }

  const mev: Partial<Record<Muscle, number>> = {}
  const mrv: Partial<Record<Muscle, number>> = {}
  for (const d of days) {
    for (const e of d.exercises) {
      const ex = byId.get(e.exerciseId)!
      mev[ex.primaryMuscle] = landmarks[ex.primaryMuscle][0]
      mrv[ex.primaryMuscle] = landmarks[ex.primaryMuscle][1]
    }
  }

  return {
    name: shape.name,
    goal: input.goal,
    daysPerWeek: days.length,
    sessionLengthMin: input.sessionLengthMin,
    experience: input.experience,
    priorityMuscle: input.priorityMuscle ?? null,
    excludedEquipment: input.excludedEquipment ?? [],
    splitType: shape.splitType,
    generatorVersion: GENERATOR_VERSION,
    source: `ai:${providerId}`,
    lengthWeeks: 4,
    accumulationWeeks: 3,
    mevByMuscle: mev,
    mrvByMuscle: mrv,
    days,
    warnings,
  }
}

export interface AiGenerateResult {
  draft: ProgramDraft
  /** True when generation failed and the rule engine produced this instead. */
  fellBack: boolean
  error?: string
}

/**
 * Generate via the model, validating and retrying once. Any failure falls back
 * to the rule engine so the user always ends up with a program.
 */
export async function generateWithAi(
  input: GeneratorInput,
  catalog: Exercise[],
  provider: LLMProvider,
  apiKey: string,
  signal?: AbortSignal,
): Promise<AiGenerateResult> {
  const prompt = buildPrompt(input, catalog)
  let lastError = ''

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const text = await provider.generate(
        attempt === 0
          ? prompt
          : `${prompt}\n\n(이전 응답이 형식에 맞지 않았습니다: ${lastError}. 스키마를 정확히 지켜 JSON만 출력하세요.)`,
        apiKey,
        signal,
      )
      const parsed = AiProgram.safeParse(parseJsonLoose(text))
      if (!parsed.success) {
        lastError = parsed.error.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')
        continue
      }
      const draft = aiShapeToDraft(parsed.data, input, catalog, provider.id)
      if (draft.days.every((d) => d.exercises.length === 0)) {
        lastError = '유효한 종목이 하나도 없습니다.'
        continue
      }
      return { draft, fellBack: false }
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e)
      if (signal?.aborted) break
    }
  }

  const fallback = generateProgram(input, catalog)
  fallback.warnings = [
    `AI 생성에 실패해 규칙 엔진으로 만들었습니다. (${lastError})`,
    ...fallback.warnings,
  ]
  return { draft: fallback, fellBack: true, error: lastError }
}
