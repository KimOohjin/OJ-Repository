/**
 * IndexedDB persistence (Dexie). All records are plain serialisable objects.
 * Weights are always stored in kg; the UI converts for display.
 */

import Dexie, { type EntityTable } from 'dexie'
import type {
  Equipment,
  Exercise,
  ExerciseRole,
  Experience,
  Goal,
  Muscle,
  ProgressionConfig,
  ProgressionRule,
  SetScheme,
  TechniqueTag,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Stored record shapes
// ---------------------------------------------------------------------------

export interface ProgramRecord {
  id: string
  name: string
  goal: Goal
  daysPerWeek: number
  sessionLengthMin: number
  experience: Experience
  priorityMuscle: Muscle | null
  excludedEquipment: Equipment[]
  splitType: string
  generatorVersion: number
  source: string
  lengthWeeks: number
  accumulationWeeks: number
  mevByMuscle: Partial<Record<Muscle, number>>
  mrvByMuscle: Partial<Record<Muscle, number>>
  isActive: boolean
  createdAt: number
  updatedAt: number
  warnings: string[]
}

export interface BlockRecord {
  id: string
  programId: string
  blockIndex: number
  startDate: string // YYYY-MM-DD
  endDate?: string
  lengthWeeks: number
  accumulationWeeks: number
  currentWeek: number
  status: 'active' | 'completed' | 'aborted'
  mevByMuscle: Partial<Record<Muscle, number>>
  mrvByMuscle: Partial<Record<Muscle, number>>
  seededFromBlockId?: string
  createdAt: number
}

export interface ProgramDayRecord {
  id: string
  programId: string
  dayIndex: number
  label: string
  pplFocus: string
  targetMuscles: Muscle[]
  estDurationMin: number
}

export interface ProgramExerciseRecord {
  id: string
  programDayId: string
  exerciseId: string
  order: number
  role: ExerciseRole
  setScheme: SetScheme
  progressionRule: ProgressionRule
  progressionConfig: ProgressionConfig
  startingWeightKg: number | null
  supersetGroup: string | null
  techniqueTag: TechniqueTag
  warnings?: string[]
}

export interface WorkoutRecord {
  id: string
  programId?: string
  programDayId?: string
  blockId?: string
  blockWeek?: number
  plannedDate?: string
  startedAt: number
  endedAt?: number
  durationMin: number
  status: 'planned' | 'inProgress' | 'completed' | 'skipped'
  sessionRpe?: number
  srpeLoad?: number
  readinessScoreAtStart?: number
  bodyweightKg?: number
  notes?: string
  createdAt: number
  updatedAt: number
}

export interface WorkoutSetRecord {
  id: string
  workoutId: string
  exerciseId: string
  programExerciseId?: string
  order: number
  setIndex: number
  isWarmup: boolean
  weightKg: number
  reps: number
  rpe?: number
  rir?: number
  restSecBefore?: number
  completedAt: number
  e1rm?: number
  isPrAtTime?: boolean
  flags: string[]
}

export interface ReadinessEntryRecord {
  date: string // PK, YYYY-MM-DD
  createdAt: number
  updatedAt: number
  sleepQuality: number
  sleepHours?: number
  soreness: number
  energy: number
  stress: number
  motivation: number
  bodyweightKg?: number
  restingHr?: number
  score: number
  band: 'green' | 'yellow' | 'orange' | 'red'
  notes?: string
}

export interface BodyMetricRecord {
  id: string
  date: string
  type: string
  value: number
  unit: 'kg' | 'cm' | 'pct'
  notes?: string
  createdAt: number
}

export interface PersonalRecordRecord {
  id: string
  exerciseId: string
  type: 'e1rm' | 'maxWeight' | 'weightForReps'
  repBucket?: number
  weightKg?: number
  reps?: number
  e1rm?: number
  value: number
  workoutId: string
  workoutSetId?: string
  achievedAt: number
  previousValue?: number
}

export interface SettingRecord {
  key: string
  value: unknown
}

export interface LoadDailyRecord {
  date: string
  srpeLoad: number
  atl7: number
  ctl28: number
  acwr: number
  readinessScore?: number
}

export interface StallEventRecord {
  id: string
  exerciseId: string
  programExerciseId?: string
  detectedAt: number
  windowWorkoutIds: string[]
  severity: 'mini' | 'confirmed'
  actionTaken: string
  resolvedAt?: number
}

export interface DeloadEventRecord {
  id: string
  blockId: string
  programId: string
  triggeredAt: number
  reasons: string[]
  accepted: boolean
  appliedToWeek: number
}

export interface BackupRecord {
  id: string
  createdAt: number
  schemaVersion: number
  json: string
}

// ---------------------------------------------------------------------------
// Database
// ---------------------------------------------------------------------------

export const SCHEMA_VERSION = 1

export class WorkoutDB extends Dexie {
  exercises!: EntityTable<Exercise, 'id'>
  programs!: EntityTable<ProgramRecord, 'id'>
  blocks!: EntityTable<BlockRecord, 'id'>
  programDays!: EntityTable<ProgramDayRecord, 'id'>
  programExercises!: EntityTable<ProgramExerciseRecord, 'id'>
  workouts!: EntityTable<WorkoutRecord, 'id'>
  workoutSets!: EntityTable<WorkoutSetRecord, 'id'>
  readinessEntries!: EntityTable<ReadinessEntryRecord, 'date'>
  bodyMetrics!: EntityTable<BodyMetricRecord, 'id'>
  personalRecords!: EntityTable<PersonalRecordRecord, 'id'>
  settings!: EntityTable<SettingRecord, 'key'>
  loadDaily!: EntityTable<LoadDailyRecord, 'date'>
  stallEvents!: EntityTable<StallEventRecord, 'id'>
  deloadEvents!: EntityTable<DeloadEventRecord, 'id'>
  backups!: EntityTable<BackupRecord, 'id'>

  constructor() {
    super('workout-app')
    this.version(1).stores({
      exercises:
        'id, nameEn, nameKo, primaryMuscle, movementType, pplClass, equipment, isCustom, *secondaryMuscles',
      programs: 'id, createdAt, isActive, goal',
      blocks: 'id, programId, [programId+blockIndex], status',
      programDays: 'id, programId, [programId+dayIndex]',
      programExercises: 'id, programDayId, exerciseId, [programDayId+order]',
      workouts:
        'id, startedAt, status, programId, blockId, [programId+startedAt], [blockId+blockWeek]',
      workoutSets: 'id, workoutId, exerciseId, [workoutId+order], [exerciseId+completedAt]',
      readinessEntries: 'date, createdAt',
      bodyMetrics: 'id, date, type, [type+date]',
      personalRecords: 'id, exerciseId, type, [exerciseId+type], achievedAt',
      settings: 'key',
      loadDaily: 'date',
      stallEvents: 'id, exerciseId, detectedAt, severity',
      deloadEvents: 'id, blockId, triggeredAt',
      backups: 'id, createdAt',
    })
  }
}

export const db = new WorkoutDB()

// ---------------------------------------------------------------------------
// Settings helpers (typed key-value)
// ---------------------------------------------------------------------------

export const DEFAULT_SETTINGS = {
  units: 'kg' as 'kg' | 'lb',
  minPlateIncrementKg: 2.5,
  dumbbellStepKg: 2,
  e1rmFormula: 'epley' as 'epley' | 'brzycki' | 'lombardi',
  restTimerSound: true,
  wakeLockEnabled: true,
  persistentStorageGranted: false,
  lastBackupAt: 0,
  workoutsSinceBackup: 0,
  backupReminderDays: 7,
  catalogVersion: 0,
  acwrMethod: 'rolling' as 'rolling' | 'ewma',
  locale: 'ko',
  aiProvider: 'gemini' as 'gemini' | 'anthropic' | 'openai',
  aiApiKey: '',
  onboardingComplete: false,
}

export type SettingsShape = typeof DEFAULT_SETTINGS

export async function getSetting<K extends keyof SettingsShape>(
  key: K,
): Promise<SettingsShape[K]> {
  const row = await db.settings.get(key as string)
  return (row?.value as SettingsShape[K]) ?? DEFAULT_SETTINGS[key]
}

export async function setSetting<K extends keyof SettingsShape>(
  key: K,
  value: SettingsShape[K],
): Promise<void> {
  await db.settings.put({ key: key as string, value })
}

export async function getAllSettings(): Promise<SettingsShape> {
  const rows = await db.settings.toArray()
  const out = { ...DEFAULT_SETTINGS }
  for (const r of rows) {
    if (r.key in out) (out as Record<string, unknown>)[r.key] = r.value
  }
  return out
}
