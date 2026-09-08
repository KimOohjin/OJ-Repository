/**
 * Shared domain types for the workout app.
 *
 * These describe the *conceptual* model used by the rule engine, progression
 * engine and fatigue model. The persistence layer (`src/data/db.ts`) stores
 * these shapes directly in IndexedDB, so keep them serialisable (no class
 * instances, no `Date` — use epoch ms `number` or `YYYY-MM-DD` strings).
 */

// ---------------------------------------------------------------------------
// Enums (as string unions — cheap to store, easy to diff)
// ---------------------------------------------------------------------------

export type Muscle =
  | 'chest'
  | 'backLats'
  | 'backUpper'
  | 'traps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'adductors'
  | 'deltsFront'
  | 'deltsSide'
  | 'deltsRear'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'calves'
  | 'abs'

export const ALL_MUSCLES: Muscle[] = [
  'chest',
  'backLats',
  'backUpper',
  'traps',
  'quads',
  'hamstrings',
  'glutes',
  'adductors',
  'deltsFront',
  'deltsSide',
  'deltsRear',
  'biceps',
  'triceps',
  'forearms',
  'calves',
  'abs',
]

/** Human-facing Korean labels for muscles. */
export const MUSCLE_LABEL_KO: Record<Muscle, string> = {
  chest: '가슴',
  backLats: '광배',
  backUpper: '상부 등',
  traps: '승모근',
  quads: '대퇴사두',
  hamstrings: '햄스트링',
  glutes: '둔근',
  adductors: '내전근',
  deltsFront: '전면 삼각근',
  deltsSide: '측면 삼각근',
  deltsRear: '후면 삼각근',
  biceps: '이두',
  triceps: '삼두',
  forearms: '전완',
  calves: '종아리',
  abs: '복근',
}

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'machine'
  | 'cable'
  | 'smith'
  | 'kettlebell'
  | 'bodyweight'

export type MovementType = 'compound' | 'isolation'

export type PplClass = 'push' | 'pull' | 'legs' | 'core'

export type MovementPattern =
  | 'squat'
  | 'hinge'
  | 'lunge'
  | 'horizontalPush'
  | 'verticalPush'
  | 'horizontalPull'
  | 'verticalPull'
  | 'carry'
  | 'isolation'

export type Goal = 'hypertrophy' | 'strength' | 'fatLossRecomp'

export type Experience = 'beginner' | 'intermediate' | 'advanced'

export type SessionLength = 45 | 60 | 75 | 90

export type ExerciseRole = 'main' | 'secondary' | 'isolation'

export type ProgressionRule =
  | 'doubleProgression'
  | 'linearLoad'
  | 'rpeAutoregulated'
  | 'fixed'

export type TechniqueTag = 'straight' | 'myoRep' | 'dropSet' | 'restPause'

// ---------------------------------------------------------------------------
// Exercise catalog
// ---------------------------------------------------------------------------

export interface Exercise {
  id: string
  nameKo: string
  nameEn: string
  primaryMuscle: Muscle
  secondaryMuscles: Muscle[]
  equipment: Equipment
  movementType: MovementType
  pplClass: PplClass
  pattern: MovementPattern
  unilateral: boolean
  /** 1 = very stable (machine), 3 = high balance demand (free-standing barbell). */
  stabilityDemand: 1 | 2 | 3
  /** 1 = trivial, 3 = high technical skill (snatch-grip, olympic). */
  skillDemand: 1 | 2 | 3
  /** Whether an estimated 1RM is meaningful for this lift. */
  e1rmEligible: boolean
  defaultRepRange: [number, number]
  tags: string[]
  isCustom: boolean
  createdAt: number
  updatedAt: number
}

// ---------------------------------------------------------------------------
// Program generation inputs / outputs
// ---------------------------------------------------------------------------

export interface GeneratorInput {
  daysPerWeek: 2 | 3 | 4 | 5 | 6
  goal: Goal
  sessionLengthMin: SessionLength
  experience: Experience
  /** Optional muscle to bias volume + exercise selection toward. */
  priorityMuscle?: Muscle | null
  /** Equipment the user cannot / does not want to use. */
  excludedEquipment?: Equipment[]
  /** Free-form request text — only consumed by the AI generator. */
  freeformNotes?: string
}

export interface SetScheme {
  sets: number
  repLow: number
  repHigh: number
  /** Target RPE per accumulation week, e.g. [7, 8, 9]. */
  targetRpeByWeek: number[]
  restSec: number
}

export interface ProgressionConfig {
  incrementKg: number
  deloadPct: number
  stallWindow: number
}

export interface ProgramExerciseDraft {
  exerciseId: string
  order: number
  role: ExerciseRole
  setScheme: SetScheme
  progressionRule: ProgressionRule
  progressionConfig: ProgressionConfig
  startingWeightKg: number | null
  supersetGroup: string | null
  techniqueTag: TechniqueTag
  /** Set when a hard-rule check flags this line (e.g. from an AI draft). */
  warnings?: string[]
}

export interface ProgramDayDraft {
  dayIndex: number
  label: string
  pplFocus: string
  targetMuscles: Muscle[]
  estDurationMin: number
  exercises: ProgramExerciseDraft[]
}

export interface ProgramDraft {
  name: string
  goal: Goal
  daysPerWeek: number
  sessionLengthMin: number
  experience: Experience
  priorityMuscle: Muscle | null
  excludedEquipment: Equipment[]
  splitType: string
  generatorVersion: number
  /** 'rules' | 'ai:<provider>' */
  source: string
  /** Mesocycle shape. */
  lengthWeeks: number
  accumulationWeeks: number
  mevByMuscle: Partial<Record<Muscle, number>>
  mrvByMuscle: Partial<Record<Muscle, number>>
  days: ProgramDayDraft[]
  /** Non-fatal issues surfaced to the user after generation. */
  warnings: string[]
}

export const GENERATOR_VERSION = 1
