/**
 * Constant tables that encode the training methodology used by the rule engine.
 *
 * These are the "coefficients" — volume landmarks, rep/RPE/rest schemes, split
 * choices, time-budget costs. They are deliberately kept as plain data so they
 * can be tuned (e.g. from a Python notebook against real logs) without touching
 * the pipeline logic in `programGenerator.ts`.
 */

import type {
  Experience,
  ExerciseRole,
  Goal,
  Muscle,
  MovementPattern,
  SessionLength,
} from '@/domain/types'

// ---------------------------------------------------------------------------
// Weekly set-volume landmarks (hard sets at RPE >= 7), per muscle.
// [MEV, MRV] — minimum effective volume .. maximum recoverable volume.
// Also reused by the fatigue model's per-muscle traffic light.
// ---------------------------------------------------------------------------

export type VolumeLandmarks = Record<Muscle, [number, number]>

export const VOLUME_LANDMARKS: Record<Experience, VolumeLandmarks> = {
  beginner: {
    chest: [8, 10],
    backLats: [10, 12],
    backUpper: [8, 12],
    traps: [4, 8],
    quads: [8, 10],
    hamstrings: [6, 8],
    glutes: [6, 8],
    adductors: [2, 6],
    deltsFront: [0, 4],
    deltsSide: [6, 8],
    deltsRear: [4, 6],
    biceps: [5, 8],
    triceps: [5, 8],
    forearms: [0, 4],
    calves: [6, 8],
    abs: [0, 6],
  },
  intermediate: {
    chest: [10, 18],
    backLats: [12, 20],
    backUpper: [10, 20],
    traps: [6, 14],
    quads: [10, 16],
    hamstrings: [8, 14],
    glutes: [8, 14],
    adductors: [4, 10],
    deltsFront: [4, 10],
    deltsSide: [12, 18],
    deltsRear: [6, 14],
    biceps: [8, 14],
    triceps: [8, 14],
    forearms: [4, 10],
    calves: [8, 12],
    abs: [6, 12],
  },
  advanced: {
    chest: [12, 22],
    backLats: [14, 25],
    backUpper: [12, 25],
    traps: [8, 18],
    quads: [12, 20],
    hamstrings: [10, 18],
    glutes: [10, 16],
    adductors: [6, 12],
    deltsFront: [6, 12],
    deltsSide: [16, 26],
    deltsRear: [8, 16],
    biceps: [10, 20],
    triceps: [10, 18],
    forearms: [6, 12],
    calves: [10, 16],
    abs: [8, 16],
  },
}

// ---------------------------------------------------------------------------
// Rep / RPE / rest / set defaults, by goal x role.
// targetRpeByWeek is indexed by accumulation week (0-based).
// ---------------------------------------------------------------------------

export interface SchemeSpec {
  repLow: number
  repHigh: number
  targetRpeByWeek: number[]
  restSec: number
  /** [min, max] working sets; the generator picks within this range. */
  setRange: [number, number]
}

export const SCHEMES: Record<Goal, Record<ExerciseRole, SchemeSpec>> = {
  strength: {
    main: { repLow: 3, repHigh: 6, targetRpeByWeek: [7, 8, 8.5], restSec: 210, setRange: [4, 5] },
    secondary: { repLow: 5, repHigh: 8, targetRpeByWeek: [7, 8, 8.5], restSec: 165, setRange: [3, 4] },
    isolation: { repLow: 8, repHigh: 12, targetRpeByWeek: [8, 8.5, 9], restSec: 90, setRange: [2, 3] },
  },
  hypertrophy: {
    main: { repLow: 5, repHigh: 8, targetRpeByWeek: [7, 8, 9], restSec: 180, setRange: [3, 5] },
    secondary: { repLow: 8, repHigh: 12, targetRpeByWeek: [7, 8, 9], restSec: 120, setRange: [3, 4] },
    isolation: { repLow: 12, repHigh: 20, targetRpeByWeek: [8, 9, 10], restSec: 75, setRange: [2, 4] },
  },
  fatLossRecomp: {
    main: { repLow: 5, repHigh: 8, targetRpeByWeek: [7, 8, 8.5], restSec: 150, setRange: [3, 4] },
    secondary: { repLow: 8, repHigh: 12, targetRpeByWeek: [7, 8, 9], restSec: 105, setRange: [3, 3] },
    isolation: { repLow: 12, repHigh: 20, targetRpeByWeek: [8, 9, 9.5], restSec: 60, setRange: [2, 3] },
  },
}

// ---------------------------------------------------------------------------
// Session time budget: usable seconds after a fixed 6-minute general warm-up.
// ---------------------------------------------------------------------------

export const USABLE_SECONDS: Record<SessionLength, number> = {
  45: 2340,
  60: 3240,
  75: 4140,
  90: 5040,
}

/** Per-exercise time cost model: setup + sets * (rest + exec) + transition. */
export interface TimeCostSpec {
  setupSec: number
  execPerSetSec: number
  transitionSec: number
}

export const TIME_COST: Record<ExerciseRole, TimeCostSpec> = {
  main: { setupSec: 150, execPerSetSec: 40, transitionSec: 60 },
  secondary: { setupSec: 90, execPerSetSec: 30, transitionSec: 60 },
  isolation: { setupSec: 45, execPerSetSec: 25, transitionSec: 60 },
}

// ---------------------------------------------------------------------------
// Split selection. Each split is an ordered list of day templates; each day
// template is an ordered list of slots. A slot names the role it wants and the
// muscle it primarily targets; `patterns` narrows exercise selection.
// ---------------------------------------------------------------------------

export interface DaySlot {
  role: ExerciseRole
  target: Muscle
  patterns: MovementPattern[]
  /**
   * Nice-to-have compound: included only when the session is long enough to
   * still leave room for accessory work. Non-optional compounds define the
   * split's structure and its per-muscle frequency, so they are never dropped.
   */
  optional?: boolean
}

export interface DayTemplate {
  label: string
  pplFocus: string
  slots: DaySlot[]
}

export interface SplitTemplate {
  /** Stable id used as `program.splitType`. */
  id: string
  days: DayTemplate[]
}

// Slot builders keep the day templates readable.
const P = {
  hPush: (role: ExerciseRole, target: Muscle = 'chest'): DaySlot => ({
    role,
    target,
    patterns: ['horizontalPush'],
  }),
  vPush: (role: ExerciseRole, target: Muscle = 'deltsFront'): DaySlot => ({
    role,
    target,
    patterns: ['verticalPush'],
  }),
  hPull: (role: ExerciseRole, target: Muscle = 'backUpper'): DaySlot => ({
    role,
    target,
    patterns: ['horizontalPull'],
  }),
  vPull: (role: ExerciseRole, target: Muscle = 'backLats'): DaySlot => ({
    role,
    target,
    patterns: ['verticalPull'],
  }),
  squat: (role: ExerciseRole, target: Muscle = 'quads'): DaySlot => ({
    role,
    target,
    patterns: ['squat', 'lunge'],
  }),
  hinge: (role: ExerciseRole, target: Muscle = 'hamstrings'): DaySlot => ({
    role,
    target,
    patterns: ['hinge'],
  }),
  iso: (target: Muscle): DaySlot => ({ role: 'isolation', target, patterns: ['isolation'] }),
}

// Day templates are 1 main + 2 secondary + 3 isolation (6 slots). The time
// budget then trims isolations for shorter sessions; the weekly-volume pass
// tops muscles up toward their landmarks.
// The three required compounds are horizontal push / horizontal pull /
// vertical pull. Across two upper days that gives chest, upper back and lats
// two sessions each — the frequency floor. Vertical pressing is added on top
// whenever the session is long enough to keep the accessory work as well.
const UPPER = (letter: string): DayTemplate => ({
  label: `상체 ${letter}`,
  pplFocus: 'upper',
  slots: [
    P.hPush('main', 'chest'),
    P.hPull('secondary', 'backUpper'),
    P.vPull('secondary', 'backLats'),
    { ...P.vPush('secondary', 'deltsFront'), optional: true },
    P.iso('deltsSide'),
    letter === 'A' ? P.iso('triceps') : P.iso('deltsRear'),
    P.iso('biceps'),
  ],
})

const LOWER = (letter: string): DayTemplate => ({
  label: `하체 ${letter}`,
  pplFocus: 'lower',
  slots: [
    P.squat('main', 'quads'),
    P.hinge('secondary', 'hamstrings'),
    P.squat('secondary', 'quads'),
    P.iso('hamstrings'),
    letter === 'A' ? P.iso('quads') : P.iso('glutes'),
    P.iso('calves'),
    // Last in the slot order, so the time budget drops it first on short days.
    P.iso('abs'),
  ],
})

const PUSH: DayTemplate = {
  label: 'Push',
  pplFocus: 'push',
  slots: [
    P.hPush('main', 'chest'),
    P.vPush('secondary', 'deltsFront'),
    P.hPush('secondary', 'chest'),
    P.iso('deltsSide'),
    P.iso('triceps'),
    P.iso('triceps'),
  ],
}

const PULL: DayTemplate = {
  label: 'Pull',
  pplFocus: 'pull',
  slots: [
    P.vPull('main', 'backLats'),
    P.hPull('secondary', 'backUpper'),
    P.hPull('secondary', 'backLats'),
    P.iso('deltsRear'),
    P.iso('biceps'),
    P.iso('biceps'),
  ],
}

const LEGS: DayTemplate = {
  label: 'Legs',
  pplFocus: 'legs',
  slots: [
    P.squat('main', 'quads'),
    P.hinge('secondary', 'hamstrings'),
    P.squat('secondary', 'glutes'),
    P.iso('quads'),
    P.iso('hamstrings'),
    P.iso('calves'),
  ],
}

const FULL = (letter: string): DayTemplate => ({
  label: `전신 ${letter}`,
  pplFocus: 'full',
  slots: [
    P.squat('main', 'quads'),
    P.hPush('main', 'chest'),
    P.hPull('secondary', 'backUpper'),
    P.hinge('secondary', 'hamstrings'),
    P.vPush('secondary', 'deltsFront'),
    P.iso('biceps'),
    P.iso('calves'),
  ],
})

/**
 * Returns the split template for the given inputs.
 * Mirrors the table in the plan (section 2.1).
 */
export function selectSplit(
  daysPerWeek: number,
  goal: Goal,
  experience: Experience,
): SplitTemplate {
  const fb2: SplitTemplate = { id: 'fullbody-ab', days: [FULL('A'), FULL('B')] }
  const fb3: SplitTemplate = { id: 'fullbody-abc', days: [FULL('A'), FULL('B'), FULL('C')] }
  const ppl: SplitTemplate = { id: 'ppl', days: [PUSH, PULL, LEGS] }
  const ul4: SplitTemplate = {
    id: 'upper-lower-x2',
    days: [UPPER('A'), LOWER('A'), UPPER('B'), LOWER('B')],
  }

  switch (daysPerWeek) {
    case 2:
      return fb2
    case 3:
      if (goal === 'hypertrophy' && experience !== 'beginner') return ppl
      return fb3
    case 4:
      return ul4
    case 5:
      if (goal === 'strength') {
        return {
          id: 'ul-ul-weakpoint',
          days: [UPPER('A'), LOWER('A'), UPPER('B'), LOWER('B'), { ...UPPER('C'), label: '약점 보완' }],
        }
      }
      return {
        id: 'ulppl',
        days: [UPPER('A'), LOWER('A'), PUSH, PULL, LEGS],
      }
    case 6:
      return {
        id: 'ppl-x2',
        days: [
          { ...PUSH, label: 'Push A' },
          { ...PULL, label: 'Pull A' },
          { ...LEGS, label: 'Legs A' },
          { ...PUSH, label: 'Push B' },
          { ...PULL, label: 'Pull B' },
          { ...LEGS, label: 'Legs B' },
        ],
      }
    default:
      return ul4
  }
}

/** Non-fatal warnings surfaced for aggressive frequency choices. */
export function frequencyWarnings(input: {
  daysPerWeek: number
  experience: Experience
}): string[] {
  const w: string[] = []
  if (input.experience === 'beginner' && input.daysPerWeek >= 5) {
    w.push('초보자에게 주 5일 이상은 회복이 벅찰 수 있어요. 주 3~4일을 권장합니다.')
  }
  if (input.daysPerWeek === 6) {
    w.push('주 6일은 일정을 지키기 어렵고 회복 여유가 적어요. 주 4일도 충분히 효과적입니다.')
  }
  return w
}
