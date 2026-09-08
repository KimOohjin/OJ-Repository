/**
 * Progression engine — turns logged sets into the next session's prescription.
 *
 * Pure functions over plain records so they can be unit-tested and, later,
 * re-tuned against real logs (e.g. from a Python notebook) without touching
 * persistence or UI.
 */

import type { ProgressionConfig, ProgressionRule, SetScheme } from '@/domain/types'
import { estimate1RM, isE1rmComputable, pctOf1RM, type E1rmFormula } from './e1rm'

/** Minimal shape of a logged working set that the engine needs. */
export interface LoggedSet {
  weightKg: number
  reps: number
  rpe?: number
  isWarmup: boolean
  completedAt: number
}

/** One past session's worth of sets for a single exercise. */
export interface SessionHistory {
  workoutId: string
  completedAt: number
  sets: LoggedSet[]
}

export interface Prescription {
  weightKg: number | null
  repLow: number
  repHigh: number
  sets: number
  targetRpe: number
  /** Human-readable Korean explanation shown above the set table. */
  note: string
  /** Non-null when the engine backed the load off. */
  action: 'hold' | 'increase' | 'backoff' | 'stallBackoff' | 'seed'
}

export interface StallState {
  severity: 'none' | 'mini' | 'confirmed'
  /** Sessions in the window with no new best e1RM. */
  staleSessions: number
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

export function workingSets(sets: LoggedSet[]): LoggedSet[] {
  return sets.filter((s) => !s.isWarmup && s.reps > 0)
}

/** Best (highest e1RM) working set of a session, or null. */
export function bestSet(sets: LoggedSet[], formula: E1rmFormula = 'epley'): LoggedSet | null {
  let best: LoggedSet | null = null
  let bestE = -Infinity
  for (const s of workingSets(sets)) {
    if (!isE1rmComputable(s.reps, s.rpe)) continue
    const e = estimate1RM(s.weightKg, s.reps, formula)
    if (e > bestE) {
      best = s
      bestE = e
    }
  }
  return best
}

export function sessionBestE1rm(
  session: SessionHistory,
  formula: E1rmFormula = 'epley',
): number | null {
  const b = bestSet(session.sets, formula)
  return b ? estimate1RM(b.weightKg, b.reps, formula) : null
}

/** Target RPE for the given block week (1-based), clamped to the array. */
export function rpeForWeek(scheme: SetScheme, blockWeek: number): number {
  const arr = scheme.targetRpeByWeek
  if (arr.length === 0) return 8
  return arr[Math.min(Math.max(blockWeek, 1), arr.length) - 1]
}

function roundTo(value: number, step: number): number {
  return Math.round(value / step) * step
}

/** Increment capped so heavy lifts don't jump more than ~2.5% at a time. */
function cappedIncrement(weightKg: number, cfg: ProgressionConfig): number {
  return Math.min(cfg.incrementKg, Math.max(1, roundTo(weightKg * 0.025, 0.5)))
}

// ---------------------------------------------------------------------------
// stall detection
// ---------------------------------------------------------------------------

/**
 * Rolling window over the last `stallWindow` sessions' best e1RM.
 *
 * - mini      : 2 sessions with no new best -> hold, add a back-off set
 * - confirmed : `stallWindow` sessions with no new best AND (mean top-set RPE
 *               at/over target+0.5 OR a rep-range miss) -> cut the load
 */
export function detectStall(
  history: SessionHistory[],
  scheme: SetScheme,
  cfg: ProgressionConfig,
  blockWeek: number,
  formula: E1rmFormula = 'epley',
): StallState {
  if (history.length < 2) return { severity: 'none', staleSessions: 0 }

  const sorted = [...history].sort((a, b) => a.completedAt - b.completedAt)
  const e1rms = sorted.map((s) => sessionBestE1rm(s, formula))

  // Count trailing sessions that failed to beat the best e1RM seen before them.
  let stale = 0
  for (let i = e1rms.length - 1; i >= 1; i--) {
    const current = e1rms[i]
    const priorBest = Math.max(...(e1rms.slice(0, i).filter((v): v is number => v != null) ?? [0]))
    if (current == null || !Number.isFinite(priorBest)) break
    if (current > priorBest * 1.001) break
    stale++
  }

  if (stale === 0) return { severity: 'none', staleSessions: 0 }

  if (stale >= cfg.stallWindow) {
    const recent = sorted.slice(-cfg.stallWindow)
    const target = rpeForWeek(scheme, blockWeek)
    const topRpes: number[] = []
    let missedRange = false
    for (const s of recent) {
      const ws = workingSets(s.sets)
      if (ws.length === 0) continue
      if (ws.some((x) => x.reps < scheme.repLow)) missedRange = true
      const top = bestSet(s.sets, formula) ?? ws[0]
      if (top.rpe != null) topRpes.push(top.rpe)
    }
    const meanRpe = topRpes.length ? topRpes.reduce((a, b) => a + b, 0) / topRpes.length : null
    const grinding = meanRpe != null && meanRpe >= target + 0.5
    if (grinding || missedRange) {
      return { severity: 'confirmed', staleSessions: stale }
    }
  }

  if (stale >= 2) return { severity: 'mini', staleSessions: stale }
  return { severity: 'none', staleSessions: stale }
}

// ---------------------------------------------------------------------------
// next prescription
// ---------------------------------------------------------------------------

export interface PrescribeArgs {
  rule: ProgressionRule
  scheme: SetScheme
  config: ProgressionConfig
  /** Past sessions for this exercise, any order. */
  history: SessionHistory[]
  blockWeek: number
  /** True when this week is a deload — load is held, volume is halved. */
  isDeload: boolean
  startingWeightKg: number | null
  roundToKg: number
  formula?: E1rmFormula
}

export function prescribeNext(args: PrescribeArgs): Prescription {
  const {
    rule,
    scheme,
    config,
    history,
    blockWeek,
    isDeload,
    startingWeightKg,
    roundToKg,
    formula = 'epley',
  } = args

  const targetRpe = rpeForWeek(scheme, blockWeek)
  const sorted = [...history].sort((a, b) => a.completedAt - b.completedAt)
  const last = sorted[sorted.length - 1]
  const lastWorking = last ? workingSets(last.sets) : []
  const lastWeight = lastWorking.length
    ? Math.max(...lastWorking.map((s) => s.weightKg))
    : startingWeightKg

  // Deload week: hold ~90% of the last working load, halve the sets, cap RPE.
  if (isDeload) {
    const w = lastWeight != null ? roundTo(lastWeight * 0.9, roundToKg) : null
    return {
      weightKg: w,
      repLow: scheme.repLow,
      repHigh: Math.max(scheme.repLow, Math.round(scheme.repLow + (scheme.repHigh - scheme.repLow) * 0.6)),
      sets: Math.max(2, Math.round(scheme.sets * 0.5)),
      targetRpe: Math.min(6, targetRpe),
      note: '디로드 주 — 무게 약 90%, 세트 절반, RPE 6 이하로 가볍게.',
      action: 'hold',
    }
  }

  // No history yet: seed from the starting weight if we have one.
  if (!last || lastWorking.length === 0 || lastWeight == null) {
    return {
      weightKg: startingWeightKg,
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: '첫 세션 — 목표 RPE에 맞는 무게를 직접 정하세요. 다음부터 자동으로 제안됩니다.',
      action: 'seed',
    }
  }

  const stall = detectStall(sorted, scheme, config, blockWeek, formula)
  if (stall.severity === 'confirmed') {
    return {
      weightKg: roundTo(lastWeight * (1 - config.deloadPct), roundToKg),
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: `${stall.staleSessions}세션 연속 기록 정체 — 무게를 ${Math.round(config.deloadPct * 100)}% 낮추고 다시 쌓아 올립니다.`,
      action: 'stallBackoff',
    }
  }

  if (rule === 'rpeAutoregulated') {
    const b = bestSet(last.sets, formula)
    const est =
      b && isE1rmComputable(b.reps, b.rpe)
        ? estimate1RM(b.weightKg, b.reps, formula)
        : lastWeight / pctOf1RM(scheme.repLow, targetRpe)
    const w = roundTo(est * pctOf1RM(scheme.repHigh, targetRpe), roundToKg)
    return {
      weightKg: w,
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: `추정 1RM ${est.toFixed(1)}kg 기준 RPE ${targetRpe} 목표 무게입니다.`,
      action: 'hold',
    }
  }

  const topSet = bestSet(last.sets, formula) ?? lastWorking[0]
  const missedRange = lastWorking.some((s) => s.reps < scheme.repLow)
  // Filling the whole rep range means there are no reps left to add, so we go
  // up on weight. RPE only vetoes this when the last set was a true grinder —
  // slightly over the week's target is expected and fine.
  const hitTop =
    lastWorking.filter((s) => s.weightKg >= lastWeight).every((s) => s.reps >= scheme.repHigh) &&
    (topSet.rpe == null || topSet.rpe <= targetRpe + 1)

  if (missedRange) {
    return {
      weightKg: roundTo(lastWeight * 0.925, roundToKg),
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: `목표 최소 ${scheme.repLow}회를 못 채웠어요 — 무게를 7.5% 낮춥니다.`,
      action: 'backoff',
    }
  }

  if (rule === 'linearLoad') {
    const allDone = lastWorking.every((s) => s.reps >= scheme.repLow)
    const easy = topSet.rpe == null || topSet.rpe <= 8
    if (allDone && easy) {
      const inc = config.incrementKg
      return {
        weightKg: roundTo(lastWeight + inc, roundToKg),
        repLow: scheme.repLow,
        repHigh: scheme.repHigh,
        sets: scheme.sets,
        targetRpe,
        note: `지난 세션 목표 달성 — +${inc}kg 증량합니다.`,
        action: 'increase',
      }
    }
    return {
      weightKg: roundTo(lastWeight, roundToKg),
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: '같은 무게로 한 번 더 — 목표 횟수를 모두 채우면 다음에 증량합니다.',
      action: 'hold',
    }
  }

  // doubleProgression (default): fill the rep range, then add weight.
  if (hitTop) {
    const inc = cappedIncrement(lastWeight, config)
    // Round first, then describe the *actual* jump — the rounding step can
    // differ from the nominal increment and the note must match the number
    // the user is about to load on the bar.
    const target = Math.max(
      roundTo(lastWeight + inc, roundToKg),
      lastWeight + roundToKg,
    )
    const applied = Math.round((target - lastWeight) * 100) / 100
    return {
      weightKg: target,
      repLow: scheme.repLow,
      repHigh: scheme.repHigh,
      sets: scheme.sets,
      targetRpe,
      note: `모든 세트에서 ${scheme.repHigh}회를 채웠어요 — +${applied}kg 증량하고 ${scheme.repLow}회부터 다시 쌓습니다.`,
      action: 'increase',
    }
  }

  const extraSet = stall.severity === 'mini' ? 1 : 0
  return {
    weightKg: roundTo(lastWeight, roundToKg),
    repLow: scheme.repLow,
    repHigh: scheme.repHigh,
    sets: scheme.sets + extraSet,
    targetRpe,
    note:
      stall.severity === 'mini'
        ? '2세션째 기록이 제자리예요 — 같은 무게로 백오프 세트를 하나 더 넣습니다. 수면과 자세를 점검해 보세요.'
        : `같은 무게로 횟수를 1회 더 늘려보세요. 전 세트 ${scheme.repHigh}회를 채우면 증량합니다.`,
    action: 'hold',
  }
}

// ---------------------------------------------------------------------------
// block seeding
// ---------------------------------------------------------------------------

/**
 * Starting weight for the next block: best e1RM of the finished block scaled to
 * the new block's week-1 target reps x RPE.
 */
export function seedNextBlockWeight(
  bestE1rm: number,
  scheme: SetScheme,
  roundToKg: number,
): number {
  const targetRpe = rpeForWeek(scheme, 1)
  return roundTo(bestE1rm * pctOf1RM(scheme.repHigh, targetRpe), roundToKg)
}
