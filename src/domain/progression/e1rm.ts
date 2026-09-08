/**
 * Estimated 1RM formulas + the RPE -> %1RM lookup used by autoregulation and
 * block seeding. Single source of truth for PRs and strength charts.
 */

export type E1rmFormula = 'epley' | 'brzycki' | 'lombardi'

/** Only meaningful for working sets in a sane rep range. */
export function isE1rmComputable(reps: number, rpe: number | null | undefined): boolean {
  if (reps < 1 || reps > 12) return false
  if (rpe != null && rpe > 9.5) return false
  return true
}

export function estimate1RM(
  weightKg: number,
  reps: number,
  formula: E1rmFormula = 'epley',
): number {
  if (reps <= 1) return weightKg
  switch (formula) {
    case 'brzycki':
      return weightKg * (36 / (37 - Math.min(reps, 10)))
    case 'lombardi':
      return weightKg * Math.pow(reps, 0.1)
    case 'epley':
    default:
      return weightKg * (1 + reps / 30)
  }
}

/**
 * RPE-aware estimate: fold "reps in reserve" into effective reps.
 * Used only by autoregulation + stall math, never by PR detection.
 */
export function estimate1RMWithRpe(
  weightKg: number,
  reps: number,
  rpe: number,
  formula: E1rmFormula = 'epley',
): number {
  const effReps = Math.min(reps + (10 - rpe), 12)
  return estimate1RM(weightKg, effReps, formula)
}

/**
 * %1RM for a target reps x RPE. Grid is reps 1..10 (rows) x RPE 10,9,8,7 (cols),
 * values are fraction of 1RM. Linear interpolation between cells; clamps to the
 * grid edges outside 1..10 reps and RPE 7..10.
 */
const PCT_GRID: Record<number, [number, number, number, number]> = {
  // reps: [RPE10, RPE9, RPE8, RPE7]
  1: [1.0, 0.955, 0.922, 0.892],
  2: [0.955, 0.922, 0.892, 0.863],
  3: [0.922, 0.892, 0.863, 0.837],
  4: [0.892, 0.863, 0.837, 0.811],
  5: [0.863, 0.837, 0.811, 0.786],
  6: [0.837, 0.811, 0.786, 0.762],
  7: [0.811, 0.786, 0.762, 0.739],
  8: [0.786, 0.762, 0.739, 0.707],
  9: [0.762, 0.739, 0.707, 0.68],
  10: [0.739, 0.707, 0.68, 0.653],
}
const RPE_COLS = [10, 9, 8, 7]

export function pctOf1RM(reps: number, rpe: number): number {
  const r = Math.max(1, Math.min(10, Math.round(reps)))
  const row = PCT_GRID[r]
  const clampedRpe = Math.max(7, Math.min(10, rpe))
  // find bracketing columns
  for (let i = 0; i < RPE_COLS.length - 1; i++) {
    const hi = RPE_COLS[i]
    const lo = RPE_COLS[i + 1]
    if (clampedRpe <= hi && clampedRpe >= lo) {
      const t = (hi - clampedRpe) / (hi - lo)
      return row[i] * (1 - t) + row[i + 1] * t
    }
  }
  return row[0]
}

/** Suggested working weight to hit `reps` at `rpe`, given an estimated 1RM. */
export function workingWeightFor(
  estimated1RM: number,
  reps: number,
  rpe: number,
  roundToKg = 2.5,
): number {
  const raw = estimated1RM * pctOf1RM(reps, rpe)
  return Math.round(raw / roundToKg) * roundToKg
}
