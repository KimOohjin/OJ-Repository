/**
 * Rule-engine program generator.
 *
 * Pipeline (deterministic):
 *   selectSplit -> selectExercisesForWeek -> assignSchemes -> budgetToTime
 *   -> balanceWeeklyVolume -> mesocycle metadata -> attachProgression
 *
 * Produces a `ProgramDraft` identical in shape to what the AI generator returns,
 * so both flow into the same editor / persistence path.
 */

import {
  GENERATOR_VERSION,
  MUSCLE_LABEL_KO,
  type Experience,
  type ExerciseRole,
  type Exercise,
  type GeneratorInput,
  type Goal,
  type Muscle,
  type ProgramDayDraft,
  type ProgramDraft,
  type ProgramExerciseDraft,
  type ProgressionRule,
} from '@/domain/types'
import {
  SCHEMES,
  TIME_COST,
  USABLE_SECONDS,
  VOLUME_LANDMARKS,
  frequencyWarnings,
  selectSplit,
  type SchemeSpec,
} from './data'
import { selectExercisesForWeek, type SlotPick } from './exerciseSelection'

const ACCUMULATION_WEEKS = 3
const BLOCK_WEEKS = 4

function midRep(spec: SchemeSpec): number {
  return Math.round((spec.repLow + spec.repHigh) / 2)
}

function schemeFor(
  goal: Goal,
  role: ExerciseRole,
  experience: Experience,
): { sets: number; repLow: number; repHigh: number; targetRpeByWeek: number[]; restSec: number } {
  const spec = SCHEMES[goal][role]
  if (experience === 'beginner') {
    const mid = midRep(spec)
    return {
      sets: Math.max(2, spec.setRange[0]),
      repLow: mid,
      repHigh: mid,
      targetRpeByWeek: spec.targetRpeByWeek.map((r) => Math.min(8, r - 1)),
      restSec: spec.restSec,
    }
  }
  // intermediate sits at the low end of each range; advanced at the top;
  // the main lift gets the range midpoint regardless.
  const sets =
    experience === 'advanced'
      ? spec.setRange[1]
      : role === 'main'
        ? Math.round((spec.setRange[0] + spec.setRange[1]) / 2)
        : spec.setRange[0]
  return {
    sets,
    repLow: spec.repLow,
    repHigh: spec.repHigh,
    targetRpeByWeek: [...spec.targetRpeByWeek],
    restSec: spec.restSec,
  }
}

/** setup + sets*(rest+exec) + transition */
function exerciseSeconds(role: ExerciseRole, sets: number, restSec: number): number {
  const c = TIME_COST[role]
  return c.setupSec + sets * (restSec + c.execPerSetSec) + c.transitionSec
}

function progressionRuleFor(role: ExerciseRole, experience: Experience): ProgressionRule {
  if (experience === 'beginner' && role !== 'isolation') return 'linearLoad'
  if (role === 'isolation') return 'doubleProgression'
  return 'doubleProgression'
}

function incrementKgFor(ex: Exercise, role: ExerciseRole): number {
  const lowerBody =
    ex.pattern === 'squat' || ex.pattern === 'hinge' || ex.pattern === 'lunge'
  if (role === 'isolation') return 2.5
  return lowerBody ? 5 : 2.5
}

/**
 * Decide each pick's role. The template slot carries an intent, but we promote
 * the first e1rm-eligible compound of the day to `main` and demote the rest.
 */
function assignRoles(picks: SlotPick[]): ExerciseRole[] {
  const roles: ExerciseRole[] = picks.map((p) =>
    p.slot.role === 'isolation' || p.exercise.movementType === 'isolation'
      ? 'isolation'
      : 'secondary',
  )
  // The main lift must sit on a required slot — an optional one can be dropped
  // by the time budget, which would leave the day with no main at all.
  const canBeMain = (p: SlotPick, i: number) => roles[i] !== 'isolation' && !p.slot.optional
  const mainIdx = picks.findIndex(
    (p, i) => canBeMain(p, i) && p.exercise.movementType === 'compound' && p.exercise.e1rmEligible,
  )
  const promote = mainIdx === -1 ? picks.findIndex(canBeMain) : mainIdx
  if (promote !== -1) roles[promote] = 'main'
  return roles
}

function orderPicks(picks: SlotPick[], roles: ExerciseRole[]): number[] {
  // compound-first, then higher stability demand, then bigger muscle.
  const roleRank: Record<ExerciseRole, number> = { main: 0, secondary: 1, isolation: 2 }
  return picks
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = roleRank[roles[a]]
      const rb = roleRank[roles[b]]
      if (ra !== rb) return ra - rb
      const sa = picks[a].exercise.stabilityDemand
      const sb = picks[b].exercise.stabilityDemand
      if (sa !== sb) return sb - sa
      return picks[a].exercise.id < picks[b].exercise.id ? -1 : 1
    })
}

/** Lower = fill this isolation first (priority muscle work goes in earliest). */
function isoPriorityRank(pick: SlotPick, input: GeneratorInput): number {
  const p = input.priorityMuscle
  if (!p) return 1
  if (pick.exercise.primaryMuscle === p || pick.slot.target === p) return 0
  if (pick.exercise.secondaryMuscles.includes(p)) return 1
  return 2
}

function weeklyVolume(days: ProgramDayDraft[], catalogById: Map<string, Exercise>): Map<Muscle, number> {
  const vol = new Map<Muscle, number>()
  for (const d of days) {
    for (const pe of d.exercises) {
      const ex = catalogById.get(pe.exerciseId)
      if (!ex) continue
      vol.set(ex.primaryMuscle, (vol.get(ex.primaryMuscle) ?? 0) + pe.setScheme.sets)
      for (const m of ex.secondaryMuscles) {
        vol.set(m, (vol.get(m) ?? 0) + pe.setScheme.sets * 0.5)
      }
    }
  }
  return vol
}

export function generateProgram(input: GeneratorInput, catalog: Exercise[]): ProgramDraft {
  const warnings = [...frequencyWarnings(input)]
  const split = selectSplit(input.daysPerWeek, input.goal, input.experience)
  const selected = selectExercisesForWeek(split, catalog, input)
  const catalogById = new Map(catalog.map((e) => [e.id, e]))
  const landmarks = VOLUME_LANDMARKS[input.experience]

  const budget = USABLE_SECONDS[input.sessionLengthMin as keyof typeof USABLE_SECONDS] ?? USABLE_SECONDS[60]

  const days: ProgramDayDraft[] = selected.map((day, dayIndex) => {
    const roles = assignRoles(day.picks)
    const order = orderPicks(day.picks, roles)

    const build = (pi: number, position: number): ProgramExerciseDraft => {
      const pick = day.picks[pi]
      const role = roles[pi]
      const s = schemeFor(input.goal, role, input.experience)
      return {
        exerciseId: pick.exercise.id,
        order: position,
        role,
        setScheme: {
          sets: s.sets,
          repLow: s.repLow,
          repHigh: s.repHigh,
          targetRpeByWeek: s.targetRpeByWeek,
          restSec: s.restSec,
        },
        progressionRule: progressionRuleFor(role, input.experience),
        progressionConfig: {
          incrementKg: incrementKgFor(pick.exercise, role),
          deloadPct: 0.1,
          stallWindow: 3,
        },
        startingWeightKg: null,
        supersetGroup: null,
        techniqueTag: 'straight',
      }
    }

    const dayCost = (list: ProgramExerciseDraft[]) =>
      list.reduce((sum, e) => sum + exerciseSeconds(e.role, e.setScheme.sets, e.setScheme.restSec), 0)
    const setFloor = (role: ExerciseRole) => (role === 'main' ? 3 : 2)

    // Cost of one floored isolation set block, used to reserve accessory room.
    const isoScheme = SCHEMES[input.goal].isolation
    const isoFloorCost = exerciseSeconds('isolation', setFloor('isolation'), isoScheme.restSec)
    // Strength days run few accessories by design; hypertrophy needs them.
    const reservedIsoSlots = input.goal === 'strength' ? 1 : 2

    const isRequired = (pi: number) => roles[pi] !== 'isolation' && !day.picks[pi].slot.optional
    const requiredIdx = order.filter(isRequired)
    const optionalIdx = order.filter((pi) => roles[pi] !== 'isolation' && day.picks[pi].slot.optional)
    const isoIdx = order
      .filter((pi) => roles[pi] === 'isolation')
      .sort((a, b) => isoPriorityRank(day.picks[a], input) - isoPriorityRank(day.picks[b], input))

    // 1. Required compounds are always kept — the split's structure and its
    //    per-muscle frequency depend on them. On overflow we trim their set
    //    counts (from the last one backward) down to a floor.
    const exercises: ProgramExerciseDraft[] = requiredIdx.map((pi, i) => build(pi, i))
    for (let i = exercises.length - 1; i >= 0 && dayCost(exercises) > budget; i--) {
      const e = exercises[i]
      while (e.setScheme.sets > setFloor(e.role) && dayCost(exercises) > budget) {
        e.setScheme.sets -= 1
      }
    }

    // 2. Optional compounds join only if the day can still afford its reserved
    //    accessory slots afterwards — otherwise a long compound would silently
    //    eat the isolation work the volume targets depend on.
    for (const pi of optionalIdx) {
      const e = build(pi, exercises.length)
      if (dayCost([...exercises, e]) + reservedIsoSlots * isoFloorCost > budget) continue
      exercises.push(e)
    }

    // 3. Fill the remaining time with isolations; trim a candidate to its floor
    //    before giving up on it, and stop once even a floored set won't fit.
    for (const pi of isoIdx) {
      const e = build(pi, exercises.length)
      while (e.setScheme.sets > setFloor('isolation') && dayCost([...exercises, e]) > budget) {
        e.setScheme.sets -= 1
      }
      if (dayCost([...exercises, e]) > budget) continue
      exercises.push(e)
    }

    const spent = dayCost(exercises)
    const targetMuscles = [...new Set(exercises.map((e) => catalogById.get(e.exerciseId)!.primaryMuscle))]
    return {
      dayIndex,
      label: day.template.label,
      pplFocus: day.template.pplFocus,
      targetMuscles,
      estDurationMin: Math.round((spent / 60 + 6) * 10) / 10,
      exercises,
    }
  })

  // --- weekly volume balance -------------------------------------------
  // Bring under-dosed muscles up toward MEV and trim over-MRV muscles. The
  // priority muscle gets a 25% higher floor and is allowed to borrow a little
  // extra session time (one set's worth) to reach it.
  for (const muscle of Object.keys(landmarks) as Muscle[]) {
    const [mev, mrv] = landmarks[muscle]
    const isPriority = input.priorityMuscle === muscle
    const floor = isPriority ? Math.round(mev * 1.25) : mev
    const slackAllowance = isPriority ? 260 : 0

    for (let added = 0; added < 8; added++) {
      const have = weeklyVolume(days, catalogById).get(muscle) ?? 0
      if (have <= 0 || have >= floor) break
      const cand = pickAddSetTarget(days, catalogById, muscle, budget + slackAllowance)
      if (!cand) break
      cand.setScheme.sets += 1
    }
    for (let removed = 0; removed < 8; removed++) {
      const have = weeklyVolume(days, catalogById).get(muscle) ?? 0
      if (have <= mrv) break
      const cand = pickRemoveSetTarget(days, catalogById, muscle)
      if (!cand || cand.setScheme.sets <= 2) break
      cand.setScheme.sets -= 1
    }
  }

  // Balancing changed set counts, so the per-day estimate computed during
  // construction is stale — recompute it or the app under-reports how long a
  // session actually takes.
  for (const day of days) {
    const spent = day.exercises.reduce(
      (sum, e) => sum + exerciseSeconds(e.role, e.setScheme.sets, e.setScheme.restSec),
      0,
    )
    day.estDurationMin = Math.round((spent / 60 + 6) * 10) / 10
  }

  // --- under-dosed muscles -------------------------------------------------
  // The time budget can leave real gaps (4x60min simply cannot reach every
  // hypertrophy floor). Say which muscles fell short instead of shipping a
  // program that quietly under-delivers.
  {
    const vol = weeklyVolume(days, catalogById)
    const under = (Object.keys(landmarks) as Muscle[])
      .filter((m) => (vol.get(m) ?? 0) > 0 && (vol.get(m) ?? 0) < landmarks[m][0])
      .sort((a, b) => landmarks[b][0] - (vol.get(b) ?? 0) - (landmarks[a][0] - (vol.get(a) ?? 0)))
    if (under.length >= 3) {
      const named = under.slice(0, 4).map((m) => MUSCLE_LABEL_KO[m]).join(', ')
      warnings.push(
        `주 ${input.daysPerWeek}일 × ${input.sessionLengthMin}분으로는 ${named}${under.length > 4 ? ' 등' : ''}의 주간 세트가 권장 최소치에 못 미쳐요. 세션을 늘리거나 운동 일수를 늘리면 채워집니다.`,
      )
    }
    // The priority muscle is the user's explicit ask, so call it out by name.
    const p = input.priorityMuscle
    if (p && (vol.get(p) ?? 0) < landmarks[p][0]) {
      warnings.push(
        `우선 부위인 ${MUSCLE_LABEL_KO[p]}에 주 ${vol.get(p)}세트까지만 배정됐어요 (권장 ${landmarks[p][0]}세트 이상). 시간 안에서 최대한 늘린 결과입니다 — 더 필요하면 세션을 길게 잡으세요.`,
      )
    }
  }

  // --- pattern coverage ---------------------------------------------------
  // Strength training wants each main pattern twice a week. When the session
  // length can't fit that, say so rather than quietly shipping a gap.
  if (input.goal === 'strength') {
    const freq = new Map<string, number>()
    for (const d of days) {
      const seen = new Set<string>()
      for (const pe of d.exercises) {
        const ex = catalogById.get(pe.exerciseId)
        if (ex && pe.role !== 'isolation') seen.add(ex.pattern)
      }
      for (const p of seen) freq.set(p, (freq.get(p) ?? 0) + 1)
    }
    const missing = (['verticalPush', 'horizontalPush', 'squat', 'hinge'] as const).filter(
      (p) => (freq.get(p) ?? 0) < 2,
    )
    if (missing.length > 0) {
      warnings.push(
        `${input.sessionLengthMin}분 세션에는 ${missing.map(patternLabel).join('·')} 패턴을 주 2회 넣기 어려워요. 세션을 75분 이상으로 늘리면 자동으로 포함됩니다.`,
      )
    }
  }

  // --- mesocycle metadata --------------------------------------------------
  const finalVol = weeklyVolume(days, catalogById)
  const mevByMuscle: Partial<Record<Muscle, number>> = {}
  const mrvByMuscle: Partial<Record<Muscle, number>> = {}
  for (const muscle of Object.keys(landmarks) as Muscle[]) {
    if ((finalVol.get(muscle) ?? 0) > 0) {
      mevByMuscle[muscle] = landmarks[muscle][0]
      mrvByMuscle[muscle] = landmarks[muscle][1]
    }
  }

  return {
    name: buildName(input),
    goal: input.goal,
    daysPerWeek: input.daysPerWeek,
    sessionLengthMin: input.sessionLengthMin,
    experience: input.experience,
    priorityMuscle: input.priorityMuscle ?? null,
    excludedEquipment: input.excludedEquipment ?? [],
    splitType: split.id,
    generatorVersion: GENERATOR_VERSION,
    source: 'rules',
    lengthWeeks: BLOCK_WEEKS,
    accumulationWeeks: ACCUMULATION_WEEKS,
    mevByMuscle,
    mrvByMuscle,
    days,
    warnings,
  }
}

function pickAddSetTarget(
  days: ProgramDayDraft[],
  catalogById: Map<string, Exercise>,
  muscle: Muscle,
  budget: number,
): ProgramExerciseDraft | null {
  let best: ProgramExerciseDraft | null = null
  let bestSlack = -Infinity
  for (const d of days) {
    const used = d.exercises.reduce(
      (sum, e) => sum + exerciseSeconds(e.role, e.setScheme.sets, e.setScheme.restSec),
      0,
    )
    for (const e of d.exercises) {
      const ex = catalogById.get(e.exerciseId)
      if (!ex || ex.primaryMuscle !== muscle) continue
      // marginal cost of one more set on this exercise
      const marginal = e.setScheme.restSec + TIME_COST[e.role].execPerSetSec
      const slack = budget - used - marginal
      if (slack >= 0 && slack > bestSlack && e.setScheme.sets < 6) {
        best = e
        bestSlack = slack
      }
    }
  }
  return best
}

function pickRemoveSetTarget(
  days: ProgramDayDraft[],
  catalogById: Map<string, Exercise>,
  muscle: Muscle,
): ProgramExerciseDraft | null {
  let best: ProgramExerciseDraft | null = null
  for (const d of days) {
    for (const e of d.exercises) {
      const ex = catalogById.get(e.exerciseId)
      if (!ex) continue
      if (ex.primaryMuscle === muscle && e.role === 'isolation') {
        if (!best || e.setScheme.sets > best.setScheme.sets) best = e
      }
    }
  }
  return best
}

function patternLabel(pattern: string): string {
  const labels: Record<string, string> = {
    verticalPush: '수직 밀기',
    horizontalPush: '수평 밀기',
    verticalPull: '수직 당기기',
    horizontalPull: '수평 당기기',
    squat: '스쿼트',
    hinge: '힌지',
  }
  return labels[pattern] ?? pattern
}

function goalLabel(goal: Goal): string {
  return goal === 'hypertrophy' ? '근비대' : goal === 'strength' ? '근력' : '체지방 감량'
}

function buildName(input: GeneratorInput): string {
  return `주 ${input.daysPerWeek}일 · ${goalLabel(input.goal)} · ${input.sessionLengthMin}분`
}
