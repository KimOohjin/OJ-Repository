/**
 * Exercise selection: fill each day template's slots from the catalog.
 *
 * Deterministic — given the same catalog + input, always returns the same
 * picks (ties broken by a stable equipment preference then exercise id). This
 * keeps the generator unit-testable with plain snapshots.
 */

import type { Equipment, Exercise, GeneratorInput, Muscle } from '@/domain/types'
import type { DaySlot, DayTemplate, SplitTemplate } from './data'
import { SCHEMES, VOLUME_LANDMARKS } from './data'

export interface SlotPick {
  slot: DaySlot
  exercise: Exercise
}

export interface SelectedDay {
  template: DayTemplate
  picks: SlotPick[]
}

const MAIN_EQUIPMENT_ORDER: Equipment[] = [
  'barbell',
  'dumbbell',
  'smith',
  'machine',
  'cable',
  'kettlebell',
  'bodyweight',
]
const ISO_EQUIPMENT_ORDER: Equipment[] = [
  'machine',
  'cable',
  'dumbbell',
  'barbell',
  'kettlebell',
  'bodyweight',
  'smith',
]

function equipmentRank(eq: Equipment, isIsolation: boolean): number {
  const order = isIsolation ? ISO_EQUIPMENT_ORDER : MAIN_EQUIPMENT_ORDER
  const i = order.indexOf(eq)
  return i === -1 ? order.length : i
}

interface WeekState {
  /** exercise id -> times chosen this week */
  usedExercise: Map<string, number>
  /** pattern -> times used this week */
  usedPattern: Map<string, number>
  /** muscle -> approximate running set contribution this week */
  muscleSets: Map<Muscle, number>
}

function landmarkLow(muscle: Muscle, input: GeneratorInput): number {
  return VOLUME_LANDMARKS[input.experience][muscle][0]
}

function scoreCandidate(
  ex: Exercise,
  slot: DaySlot,
  state: WeekState,
  input: GeneratorInput,
): number {
  let score = 0

  if (ex.primaryMuscle === slot.target) score += 10

  // Secondary muscles that are still under their weekly floor.
  for (const m of ex.secondaryMuscles) {
    const have = state.muscleSets.get(m) ?? 0
    if (have < landmarkLow(m, input)) score += 3
  }

  if (slot.role !== 'isolation' && ex.movementType === 'compound') score += 1.5

  if (input.priorityMuscle) {
    if (ex.primaryMuscle === input.priorityMuscle) score += 5
    if (ex.secondaryMuscles.includes(input.priorityMuscle)) score += 2
  }

  const timesUsed = state.usedExercise.get(ex.id) ?? 0
  score -= 4 * timesUsed

  const patternUses = state.usedPattern.get(ex.pattern) ?? 0
  if (patternUses >= 2) score -= 2

  if (input.experience === 'beginner') {
    score -= 2 * ex.skillDemand
    if ((slot.role === 'main' || slot.role === 'secondary') && ex.skillDemand >= 3) {
      score -= 4
    }
  }

  if (input.sessionLengthMin === 45) score -= ex.stabilityDemand

  // Prefer exercises whose natural rep range matches the slot's prescription —
  // keeps low-rep lifts (e.g. deadlift 3-6) out of 8-12 accessory slots.
  const scheme = SCHEMES[input.goal][slot.role]
  const exMid = (ex.defaultRepRange[0] + ex.defaultRepRange[1]) / 2
  const schemeMid = (scheme.repLow + scheme.repHigh) / 2
  score -= 0.4 * Math.min(6, Math.abs(exMid - schemeMid))

  // Stable equipment-preference tie-break folded in as a small term.
  score -= 0.1 * equipmentRank(ex.equipment, slot.role === 'isolation')

  return score
}

function pickForSlot(
  slot: DaySlot,
  catalog: Exercise[],
  state: WeekState,
  input: GeneratorInput,
): Exercise | null {
  const excluded = new Set(input.excludedEquipment ?? [])
  let candidates = catalog.filter((ex) => {
    if (excluded.has(ex.equipment)) return false
    if (slot.role === 'isolation') {
      if (ex.movementType !== 'isolation') return false
    } else {
      // main / secondary slots want the slot's movement patterns
      if (!slot.patterns.includes(ex.pattern)) return false
    }
    // isolation slots: match by target muscle (primary or secondary)
    if (slot.role === 'isolation') {
      return ex.primaryMuscle === slot.target || ex.secondaryMuscles.includes(slot.target)
    }
    return true
  })

  if (candidates.length === 0) {
    // Fallback for compound slots emptied by equipment exclusions: allow any
    // compound hitting the target muscle regardless of pattern.
    if (slot.role !== 'isolation') {
      candidates = catalog.filter(
        (ex) =>
          !excluded.has(ex.equipment) &&
          ex.movementType === 'compound' &&
          (ex.primaryMuscle === slot.target || ex.secondaryMuscles.includes(slot.target)),
      )
    }
    if (candidates.length === 0) return null
  }

  // Drop lifts whose usable rep range doesn't reach the slot's prescription at
  // all — a conventional deadlift belongs at 3-6, never as an 8-12 accessory.
  // Only applied when something else can do the job.
  const scheme = SCHEMES[input.goal][slot.role]
  const overlapping = candidates.filter(
    (ex) => ex.defaultRepRange[0] <= scheme.repHigh && ex.defaultRepRange[1] >= scheme.repLow,
  )
  if (overlapping.length > 0) candidates = overlapping

  let best: Exercise | null = null
  let bestScore = -Infinity
  for (const ex of candidates) {
    const s = scoreCandidate(ex, slot, state, input)
    if (s > bestScore || (s === bestScore && best && ex.id < best.id)) {
      best = ex
      bestScore = s
    }
  }
  return best
}

function registerPick(ex: Exercise, setsGuess: number, state: WeekState): void {
  state.usedExercise.set(ex.id, (state.usedExercise.get(ex.id) ?? 0) + 1)
  state.usedPattern.set(ex.pattern, (state.usedPattern.get(ex.pattern) ?? 0) + 1)
  state.muscleSets.set(
    ex.primaryMuscle,
    (state.muscleSets.get(ex.primaryMuscle) ?? 0) + setsGuess,
  )
  for (const m of ex.secondaryMuscles) {
    state.muscleSets.set(m, (state.muscleSets.get(m) ?? 0) + setsGuess * 0.5)
  }
}

/**
 * Inject one extra isolation slot for the priority muscle into whichever day
 * already trains it (or the first day otherwise).
 */
function withPriorityInjection(
  days: DayTemplate[],
  priority: Muscle | null | undefined,
): DayTemplate[] {
  if (!priority) return days
  const extra: DaySlot = { role: 'isolation', target: priority, patterns: ['isolation'] }
  let injected = false
  const out = days.map((d) => {
    if (injected) return d
    const trains = d.slots.some(
      (s) => s.target === priority || s.patterns.includes('isolation'),
    )
    if (trains && d.slots.some((s) => s.target === priority)) {
      injected = true
      return { ...d, slots: [...d.slots, extra] }
    }
    return d
  })
  if (!injected && out.length > 0) {
    out[0] = { ...out[0], slots: [...out[0].slots, extra] }
  }
  return out
}

export function selectExercisesForWeek(
  split: SplitTemplate,
  catalog: Exercise[],
  input: GeneratorInput,
): SelectedDay[] {
  const state: WeekState = {
    usedExercise: new Map(),
    usedPattern: new Map(),
    muscleSets: new Map(),
  }
  // Rough per-exercise set guess used only to steer selection ordering.
  const setsGuess = input.goal === 'strength' ? 4 : 3

  const days = withPriorityInjection(split.days, input.priorityMuscle)
  const result: SelectedDay[] = []

  for (const template of days) {
    const picks: SlotPick[] = []
    const chosenThisDay = new Set<string>()
    for (const slot of template.slots) {
      let ex = pickForSlot(slot, catalog, state, input)
      // Avoid duplicating an exercise within the same day when possible.
      if (ex && chosenThisDay.has(ex.id)) {
        const alt = pickForSlot(
          slot,
          catalog.filter((c) => !chosenThisDay.has(c.id)),
          state,
          input,
        )
        if (alt) ex = alt
      }
      if (!ex) continue
      chosenThisDay.add(ex.id)
      registerPick(ex, setsGuess, state)
      picks.push({ slot, exercise: ex })
    }
    result.push({ template, picks })
  }

  return result
}
