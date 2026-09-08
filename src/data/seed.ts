/**
 * First-run catalog seeding + helpers to persist a generated program.
 */

import catalogJson from '@/data/catalog.v1.json'
import type { Exercise, ProgramDraft } from '@/domain/types'
import {
  db,
  getSetting,
  setSetting,
  type BlockRecord,
  type ProgramDayRecord,
  type ProgramExerciseRecord,
  type ProgramRecord,
} from './db'

export function uid(): string {
  return crypto.randomUUID()
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

type CatalogEntry = Omit<Exercise, 'isCustom' | 'createdAt' | 'updatedAt'>

const CATALOG_VERSION: number = catalogJson.version

/** Upsert bundled catalog rows; never touches user-created (`isCustom`) rows. */
export async function seedCatalog(): Promise<void> {
  const have = await getSetting('catalogVersion')
  if (have >= CATALOG_VERSION && (await db.exercises.count()) > 0) return

  const now = Date.now()
  const rows: Exercise[] = (catalogJson.exercises as CatalogEntry[]).map((e) => ({
    ...e,
    isCustom: false,
    createdAt: now,
    updatedAt: now,
  }))
  await db.exercises.bulkPut(rows)
  await setSetting('catalogVersion', CATALOG_VERSION)
}

export async function getCatalog(): Promise<Exercise[]> {
  return db.exercises.orderBy('nameKo').toArray()
}

/**
 * Persist a `ProgramDraft` (from the rule engine or the AI generator) and make
 * it the active program. Returns the new program id.
 */
export async function saveProgramDraft(draft: ProgramDraft): Promise<string> {
  const programId = uid()
  const now = Date.now()

  const program: ProgramRecord = {
    id: programId,
    name: draft.name,
    goal: draft.goal,
    daysPerWeek: draft.daysPerWeek,
    sessionLengthMin: draft.sessionLengthMin,
    experience: draft.experience,
    priorityMuscle: draft.priorityMuscle,
    excludedEquipment: draft.excludedEquipment,
    splitType: draft.splitType,
    generatorVersion: draft.generatorVersion,
    source: draft.source,
    lengthWeeks: draft.lengthWeeks,
    accumulationWeeks: draft.accumulationWeeks,
    mevByMuscle: draft.mevByMuscle,
    mrvByMuscle: draft.mrvByMuscle,
    isActive: true,
    createdAt: now,
    updatedAt: now,
    warnings: draft.warnings,
  }

  const block: BlockRecord = {
    id: uid(),
    programId,
    blockIndex: 1,
    startDate: todayIso(),
    lengthWeeks: draft.lengthWeeks,
    accumulationWeeks: draft.accumulationWeeks,
    currentWeek: 1,
    status: 'active',
    mevByMuscle: draft.mevByMuscle,
    mrvByMuscle: draft.mrvByMuscle,
    createdAt: now,
  }

  const days: ProgramDayRecord[] = []
  const exercises: ProgramExerciseRecord[] = []
  for (const d of draft.days) {
    const dayId = uid()
    days.push({
      id: dayId,
      programId,
      dayIndex: d.dayIndex,
      label: d.label,
      pplFocus: d.pplFocus,
      targetMuscles: d.targetMuscles,
      estDurationMin: d.estDurationMin,
    })
    for (const e of d.exercises) {
      exercises.push({
        id: uid(),
        programDayId: dayId,
        exerciseId: e.exerciseId,
        order: e.order,
        role: e.role,
        setScheme: e.setScheme,
        progressionRule: e.progressionRule,
        progressionConfig: e.progressionConfig,
        startingWeightKg: e.startingWeightKg,
        supersetGroup: e.supersetGroup,
        techniqueTag: e.techniqueTag,
        warnings: e.warnings,
      })
    }
  }

  await db.transaction(
    'rw',
    [db.programs, db.blocks, db.programDays, db.programExercises],
    async () => {
      // Only one active program at a time. Dexie can't index booleans, so scan.
      await db.programs.toCollection().modify((p) => {
        p.isActive = false
      })
      await db.programs.add(program)
      await db.blocks.add(block)
      await db.programDays.bulkAdd(days)
      await db.programExercises.bulkAdd(exercises)
    },
  )

  return programId
}

export interface LoadedProgram {
  program: ProgramRecord
  block?: BlockRecord
  days: Array<ProgramDayRecord & { exercises: ProgramExerciseRecord[] }>
}

export async function loadActiveProgram(): Promise<LoadedProgram | null> {
  const all = await db.programs.toArray()
  const program = all.find((p) => p.isActive) ?? all.sort((a, b) => b.createdAt - a.createdAt)[0]
  if (!program) return null
  return loadProgram(program.id)
}

export async function loadProgram(programId: string): Promise<LoadedProgram | null> {
  const program = await db.programs.get(programId)
  if (!program) return null
  const block = (await db.blocks.where('programId').equals(programId).toArray()).sort(
    (a, b) => b.blockIndex - a.blockIndex,
  )[0]
  const dayRows = (await db.programDays.where('programId').equals(programId).toArray()).sort(
    (a, b) => a.dayIndex - b.dayIndex,
  )
  const days = []
  for (const d of dayRows) {
    const ex = (await db.programExercises.where('programDayId').equals(d.id).toArray()).sort(
      (a, b) => a.order - b.order,
    )
    days.push({ ...d, exercises: ex })
  }
  return { program, block, days }
}
