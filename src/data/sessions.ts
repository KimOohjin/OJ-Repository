/**
 * Session lifecycle + everything derived from logged sets:
 * PR detection, per-exercise history for the progression engine, daily load
 * cache, weekly volume, and the deload evaluation.
 */

import {
  db,
  getSetting,
  type LoadDailyRecord,
  type PersonalRecordRecord,
  type ProgramExerciseRecord,
  type ReadinessEntryRecord,
  type WorkoutRecord,
  type WorkoutSetRecord,
} from './db'
import { uid } from './seed'
import { estimate1RM, isE1rmComputable, type E1rmFormula } from '@/domain/progression/e1rm'
import {
  detectStall,
  prescribeNext,
  type LoggedSet,
  type Prescription,
  type SessionHistory,
} from '@/domain/progression/progressionEngine'
import {
  computeAcwr,
  evaluateDeload,
  isoDate,
  srpeLoad,
  volumeLight,
  type AcwrResult,
  type DeloadRecommendation,
  type MuscleVolumeRow,
} from '@/domain/readiness/fatigueModel'
import type { Muscle } from '@/domain/types'
import { MAX_SESSION_MIN } from '@/domain/readiness/fatigueModel'

export function today(): string {
  return isoDate(new Date())
}

// ---------------------------------------------------------------------------
// Workout lifecycle
// ---------------------------------------------------------------------------

export async function startWorkout(args: {
  programId: string
  programDayId: string
  blockId?: string
  blockWeek?: number
  readinessScore?: number
}): Promise<WorkoutRecord> {
  const existing = await db.workouts.where('status').equals('inProgress').first()
  if (existing) return existing

  const now = Date.now()
  const workout: WorkoutRecord = {
    id: uid(),
    programId: args.programId,
    programDayId: args.programDayId,
    blockId: args.blockId,
    blockWeek: args.blockWeek,
    plannedDate: today(),
    startedAt: now,
    durationMin: 0,
    status: 'inProgress',
    readinessScoreAtStart: args.readinessScore,
    createdAt: now,
    updatedAt: now,
  }
  await db.workouts.add(workout)
  return workout
}

export async function getActiveWorkout(): Promise<WorkoutRecord | undefined> {
  return db.workouts.where('status').equals('inProgress').first()
}

export async function logSet(args: {
  workoutId: string
  exerciseId: string
  programExerciseId?: string
  setIndex: number
  weightKg: number
  reps: number
  rpe?: number
  restSecBefore?: number
}): Promise<{ set: WorkoutSetRecord; prs: PersonalRecordRecord[] }> {
  const formula = (await getSetting('e1rmFormula')) as E1rmFormula
  const now = Date.now()
  const count = await db.workoutSets.where('workoutId').equals(args.workoutId).count()

  const e1rm = isE1rmComputable(args.reps, args.rpe)
    ? estimate1RM(args.weightKg, args.reps, formula)
    : undefined

  const set: WorkoutSetRecord = {
    id: uid(),
    workoutId: args.workoutId,
    exerciseId: args.exerciseId,
    programExerciseId: args.programExerciseId,
    order: count,
    setIndex: args.setIndex,
    isWarmup: false,
    weightKg: args.weightKg,
    reps: args.reps,
    rpe: args.rpe,
    rir: args.rpe != null ? 10 - args.rpe : undefined,
    restSecBefore: args.restSecBefore,
    completedAt: now,
    e1rm,
    flags: [],
  }

  const prs = await detectPRs(set)
  set.isPrAtTime = prs.length > 0
  await db.workoutSets.add(set)
  if (prs.length > 0) {
    await db.personalRecords.bulkAdd(prs)
    // A new best means the lift is moving again — close any open stall so it
    // stops feeding the deload trigger.
    if (prs.some((p) => p.type === 'e1rm')) await resolveStalls(set.exerciseId)
  }
  return { set, prs }
}

export async function deleteSet(setId: string): Promise<void> {
  await db.workoutSets.delete(setId)
}

export async function finishWorkout(
  workoutId: string,
  sessionRpe: number,
): Promise<WorkoutRecord | undefined> {
  const w = await db.workouts.get(workoutId)
  if (!w) return undefined
  const endedAt = Date.now()
  const durationMin = Math.min(
    MAX_SESSION_MIN,
    Math.max(1, Math.round((endedAt - w.startedAt) / 60000)),
  )
  const updated: WorkoutRecord = {
    ...w,
    endedAt,
    durationMin,
    status: 'completed',
    sessionRpe,
    srpeLoad: srpeLoad(sessionRpe, durationMin),
    updatedAt: endedAt,
  }
  await db.workouts.put(updated)
  await rebuildLoadCache()
  await recordStalls(updated)
  return updated
}

/**
 * After a session, re-check each main/secondary lift for a stall and persist a
 * `stallEvent`. The deload trigger reads these; without them its "main lift
 * stalled" condition could never fire.
 */
async function recordStalls(workout: WorkoutRecord): Promise<void> {
  if (!workout.programDayId) return
  const pes = await db.programExercises.where('programDayId').equals(workout.programDayId).toArray()
  const formula = (await getSetting('e1rmFormula')) as E1rmFormula
  const blockWeek = workout.blockWeek ?? 1
  const now = Date.now()

  for (const pe of pes) {
    if (pe.role === 'isolation') continue
    const history = await exerciseHistory(pe.exerciseId)
    const stall = detectStall(history, pe.setScheme, pe.progressionConfig, blockWeek, formula)
    if (stall.severity !== 'confirmed') continue

    // One open event per exercise — don't pile up duplicates each session.
    const existing = await db.stallEvents.where('exerciseId').equals(pe.exerciseId).toArray()
    if (existing.some((s) => s.severity === 'confirmed' && s.resolvedAt == null)) continue

    await db.stallEvents.add({
      id: uid(),
      exerciseId: pe.exerciseId,
      programExerciseId: pe.id,
      detectedAt: now,
      windowWorkoutIds: history.slice(-pe.progressionConfig.stallWindow).map((h) => h.workoutId),
      severity: 'confirmed',
      actionTaken: 'backoff',
    })
  }
}

/** Clear an open stall once the lift sets a new best. Called on PR detection. */
async function resolveStalls(exerciseId: string): Promise<void> {
  const open = (await db.stallEvents.where('exerciseId').equals(exerciseId).toArray()).filter(
    (s) => s.resolvedAt == null,
  )
  if (open.length === 0) return
  await db.stallEvents.bulkPut(open.map((s) => ({ ...s, resolvedAt: Date.now() })))
}

export async function abandonWorkout(workoutId: string): Promise<void> {
  const sets = await db.workoutSets.where('workoutId').equals(workoutId).count()
  if (sets === 0) {
    await db.workouts.delete(workoutId)
    return
  }
  await db.workouts.update(workoutId, { status: 'skipped', updatedAt: Date.now() })
}

// ---------------------------------------------------------------------------
// PR detection
// ---------------------------------------------------------------------------

async function detectPRs(set: WorkoutSetRecord): Promise<PersonalRecordRecord[]> {
  const out: PersonalRecordRecord[] = []
  const prior = await db.personalRecords.where('exerciseId').equals(set.exerciseId).toArray()
  const bestOf = (type: PersonalRecordRecord['type'], bucket?: number) => {
    const rows = prior.filter((p) => p.type === type && (bucket == null || p.repBucket === bucket))
    return rows.length ? Math.max(...rows.map((p) => p.value)) : 0
  }

  const mk = (
    type: PersonalRecordRecord['type'],
    value: number,
    previousValue: number,
    repBucket?: number,
  ): PersonalRecordRecord => ({
    id: uid(),
    exerciseId: set.exerciseId,
    type,
    repBucket,
    weightKg: set.weightKg,
    reps: set.reps,
    e1rm: set.e1rm,
    value,
    workoutId: set.workoutId,
    workoutSetId: set.id,
    achievedAt: set.completedAt,
    previousValue,
  })

  if (set.e1rm != null) {
    const best = bestOf('e1rm')
    if (set.e1rm > best * 1.005) out.push(mk('e1rm', set.e1rm, best))
  }
  const bestWeight = bestOf('maxWeight')
  if (set.weightKg > bestWeight) out.push(mk('maxWeight', set.weightKg, bestWeight))

  const bucket = Math.min(set.reps, 12)
  const bestForReps = bestOf('weightForReps', bucket)
  if (set.weightKg > bestForReps) {
    out.push(mk('weightForReps', set.weightKg, bestForReps, bucket))
  }
  return out
}

export async function currentPRs(exerciseId: string): Promise<{
  e1rm?: PersonalRecordRecord
  maxWeight?: PersonalRecordRecord
}> {
  const rows = await db.personalRecords.where('exerciseId').equals(exerciseId).toArray()
  const top = (type: PersonalRecordRecord['type']) =>
    rows.filter((r) => r.type === type).sort((a, b) => b.value - a.value)[0]
  return { e1rm: top('e1rm'), maxWeight: top('maxWeight') }
}

// ---------------------------------------------------------------------------
// Per-exercise history -> next prescription
// ---------------------------------------------------------------------------

export async function exerciseHistory(
  exerciseId: string,
  limit = 8,
): Promise<SessionHistory[]> {
  const sets = await db.workoutSets.where('exerciseId').equals(exerciseId).toArray()
  if (sets.length === 0) return []
  const workoutIds = [...new Set(sets.map((s) => s.workoutId))]
  const workouts = await db.workouts.bulkGet(workoutIds)
  const completed = new Map(
    workouts
      .filter((w): w is WorkoutRecord => !!w && w.status === 'completed')
      .map((w) => [w.id, w]),
  )

  const byWorkout = new Map<string, LoggedSet[]>()
  for (const s of sets) {
    if (!completed.has(s.workoutId)) continue
    const list = byWorkout.get(s.workoutId) ?? []
    list.push({
      weightKg: s.weightKg,
      reps: s.reps,
      rpe: s.rpe,
      isWarmup: s.isWarmup,
      completedAt: s.completedAt,
    })
    byWorkout.set(s.workoutId, list)
  }

  return [...byWorkout.entries()]
    .map(([workoutId, list]) => ({
      workoutId,
      completedAt: completed.get(workoutId)!.endedAt ?? completed.get(workoutId)!.startedAt,
      sets: list,
    }))
    .sort((a, b) => a.completedAt - b.completedAt)
    .slice(-limit)
}

export async function nextPrescription(
  pe: ProgramExerciseRecord,
  blockWeek: number,
  isDeload: boolean,
): Promise<Prescription> {
  const [history, roundToKg] = await Promise.all([
    exerciseHistory(pe.exerciseId),
    getSetting('minPlateIncrementKg'),
  ])
  const formula = (await getSetting('e1rmFormula')) as E1rmFormula
  return prescribeNext({
    rule: pe.progressionRule,
    scheme: pe.setScheme,
    config: pe.progressionConfig,
    history,
    blockWeek,
    isDeload,
    startingWeightKg: pe.startingWeightKg,
    roundToKg,
    formula,
  })
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export async function saveReadiness(entry: ReadinessEntryRecord): Promise<void> {
  await db.readinessEntries.put(entry)
  await rebuildLoadCache()
}

export async function todaysReadiness(): Promise<ReadinessEntryRecord | undefined> {
  return db.readinessEntries.get(today())
}

// ---------------------------------------------------------------------------
// Daily load cache (recomputed over the trailing 35 days on any write)
// ---------------------------------------------------------------------------

export async function rebuildLoadCache(days = 35): Promise<void> {
  const workouts = await db.workouts.where('status').equals('completed').toArray()
  const readiness = await db.readinessEntries.toArray()
  const readinessByDate = new Map(readiness.map((r) => [r.date, r.score]))

  const loadByDate = new Map<string, number>()
  for (const w of workouts) {
    const date = w.plannedDate ?? isoDate(new Date(w.startedAt))
    loadByDate.set(date, (loadByDate.get(date) ?? 0) + (w.srpeLoad ?? 0))
  }

  const firstDate = [...loadByDate.keys(), ...readinessByDate.keys()].sort()[0]
  const now = new Date()
  const rows: LoadDailyRecord[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(now)
    d.setDate(d.getDate() - i)
    const date = isoDate(d)
    const daily = [...loadByDate.entries()].map(([k, v]) => ({ date: k, load: v }))
    const { atl7, ctl28, acwr } = computeAcwr(daily, d, firstDate)
    rows.push({
      date,
      srpeLoad: loadByDate.get(date) ?? 0,
      atl7,
      ctl28,
      acwr: acwr ?? 0,
      readinessScore: readinessByDate.get(date),
    })
  }
  await db.loadDaily.bulkPut(rows)
}

export async function currentAcwr(): Promise<AcwrResult> {
  const workouts = await db.workouts.where('status').equals('completed').toArray()
  const loadByDate = new Map<string, number>()
  for (const w of workouts) {
    const date = w.plannedDate ?? isoDate(new Date(w.startedAt))
    loadByDate.set(date, (loadByDate.get(date) ?? 0) + (w.srpeLoad ?? 0))
  }
  const readiness = await db.readinessEntries.toArray()
  const firstDate = [...loadByDate.keys(), ...readiness.map((r) => r.date)].sort()[0]
  const daily = [...loadByDate.entries()].map(([date, load]) => ({ date, load }))
  return computeAcwr(daily, new Date(), firstDate)
}

// ---------------------------------------------------------------------------
// Weekly volume per muscle
// ---------------------------------------------------------------------------

function startOfIsoWeek(d = new Date()): Date {
  const out = new Date(d)
  const day = (out.getDay() + 6) % 7 // Monday = 0
  out.setDate(out.getDate() - day)
  out.setHours(0, 0, 0, 0)
  return out
}

export async function weeklyMuscleVolume(
  mev: Partial<Record<Muscle, number>>,
  mrv: Partial<Record<Muscle, number>>,
): Promise<MuscleVolumeRow[]> {
  const weekStart = startOfIsoWeek().getTime()
  const sets = await db.workoutSets.where('completedAt').above(weekStart).toArray()
  const exercises = await db.exercises.toArray()
  const byId = new Map(exercises.map((e) => [e.id, e]))

  const actual = new Map<Muscle, number>()
  for (const s of sets) {
    if (s.isWarmup) continue
    if (s.rpe != null && s.rpe < 7) continue
    const ex = byId.get(s.exerciseId)
    if (!ex) continue
    actual.set(ex.primaryMuscle, (actual.get(ex.primaryMuscle) ?? 0) + 1)
    for (const m of ex.secondaryMuscles) actual.set(m, (actual.get(m) ?? 0) + 0.5)
  }

  // Planned volume comes from the active program's prescriptions.
  const planned = new Map<Muscle, number>()
  const programs = await db.programs.toArray()
  const active = programs.find((p) => p.isActive)
  if (active) {
    const days = await db.programDays.where('programId').equals(active.id).toArray()
    for (const d of days) {
      const pes = await db.programExercises.where('programDayId').equals(d.id).toArray()
      for (const pe of pes) {
        const ex = byId.get(pe.exerciseId)
        if (!ex) continue
        planned.set(ex.primaryMuscle, (planned.get(ex.primaryMuscle) ?? 0) + pe.setScheme.sets)
        for (const m of ex.secondaryMuscles) {
          planned.set(m, (planned.get(m) ?? 0) + pe.setScheme.sets * 0.5)
        }
      }
    }
  }

  const muscles = new Set<Muscle>([
    ...(Object.keys(mev) as Muscle[]),
    ...actual.keys(),
    ...planned.keys(),
  ])
  return [...muscles]
    .map((muscle) => {
      const lo = mev[muscle] ?? 0
      const hi = mrv[muscle] ?? Math.max(lo * 2, 10)
      const actualSets = Math.round((actual.get(muscle) ?? 0) * 10) / 10
      return {
        muscle,
        actualSets,
        plannedSets: Math.round((planned.get(muscle) ?? 0) * 10) / 10,
        mev: lo,
        mrv: hi,
        light: volumeLight(actualSets, lo, hi),
      }
    })
    .sort((a, b) => b.plannedSets - a.plannedSets)
}

// ---------------------------------------------------------------------------
// Deload evaluation
// ---------------------------------------------------------------------------

export async function evaluateDeloadNow(args: {
  currentWeek: number
  blockLengthWeeks: number
  accumulationWeeks: number
}): Promise<DeloadRecommendation> {
  const [readiness, loadRows, stalls] = await Promise.all([
    db.readinessEntries.toArray(),
    db.loadDaily.toArray(),
    db.stallEvents.where('severity').equals('confirmed').toArray(),
  ])

  const tenDaysAgo = Date.now() - 10 * 86_400_000
  return evaluateDeload({
    currentWeek: args.currentWeek,
    blockLengthWeeks: args.blockLengthWeeks,
    readinessByDate: new Map(readiness.map((r) => [r.date, r.score])),
    acwrByDate: new Map(loadRows.filter((r) => r.acwr > 0).map((r) => [r.date, r.acwr])),
    mainLiftStalledRecently: stalls.some((s) => s.detectedAt >= tenDaysAgo),
    sorenessByDate: new Map(readiness.map((r) => [r.date, r.soreness])),
    today: new Date(),
    isDeloadWeek: args.currentWeek > args.accumulationWeeks,
  })
}

/** Move the active block into (or out of) its deload week. */
export async function applyDeloadWeek(blockId: string): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block) return
  const targetWeek = block.lengthWeeks
  await db.blocks.update(blockId, { currentWeek: targetWeek })
  await db.deloadEvents.add({
    id: uid(),
    blockId,
    programId: block.programId,
    triggeredAt: Date.now(),
    reasons: ['manual-or-recommended'],
    accepted: true,
    appliedToWeek: targetWeek,
  })
}

export async function advanceWeek(blockId: string): Promise<void> {
  const block = await db.blocks.get(blockId)
  if (!block) return
  const next = block.currentWeek + 1
  if (next > block.lengthWeeks) {
    // Finish the block and open the next one, seeded from this block's results.
    await db.blocks.update(blockId, { status: 'completed', endDate: today() })
    await db.blocks.add({
      id: uid(),
      programId: block.programId,
      blockIndex: block.blockIndex + 1,
      startDate: today(),
      lengthWeeks: block.lengthWeeks,
      accumulationWeeks: block.accumulationWeeks,
      currentWeek: 1,
      status: 'active',
      mevByMuscle: block.mevByMuscle,
      mrvByMuscle: block.mrvByMuscle,
      seededFromBlockId: block.id,
      createdAt: Date.now(),
    })
    return
  }
  await db.blocks.update(blockId, { currentWeek: next })
}
