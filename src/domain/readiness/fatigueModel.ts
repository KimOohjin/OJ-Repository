/**
 * Fatigue / readiness model.
 *
 * Three independent signals feed one recommendation:
 *   1. daily readiness check-in  -> 0..100 score + band
 *   2. session RPE x duration    -> sRPE load -> ATL / CTL / ACWR
 *   3. weekly sets per muscle    -> MEV/MRV traffic light
 * Any of them (plus the scheduled block week) can trigger a deload suggestion.
 */

import type { Muscle } from '@/domain/types'

// ---------------------------------------------------------------------------
// 1. Readiness check-in
// ---------------------------------------------------------------------------

export interface ReadinessInput {
  /** 1..5, higher is better */
  sleepQuality: number
  /** optional hours; 5h -> 0, 8h+ -> 1 */
  sleepHours?: number
  /** 1..5, higher = MORE sore */
  soreness: number
  /** 1..5, higher is better */
  energy: number
  /** 1..5, higher = MORE stressed */
  stress: number
  /** 1..5, higher is better */
  motivation: number
}

export type ReadinessBand = 'green' | 'yellow' | 'orange' | 'red'

export const READINESS_WEIGHTS = {
  sleepQuality: 0.25,
  sleepHours: 0.1,
  soreness: 0.2,
  energy: 0.2,
  stress: 0.15,
  motivation: 0.1,
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const norm5 = (v: number) => clamp((v - 1) / 4, 0, 1)
const invNorm5 = (v: number) => clamp((5 - v) / 4, 0, 1)

export interface ReadinessAdjustments {
  acwr?: number | null
  /** last 7 days' sRPE sum vs the 7 days before that */
  recentLoadSum?: number
  priorLoadSum?: number
}

export function readinessScore(
  input: ReadinessInput,
  adj: ReadinessAdjustments = {},
): { score: number; band: ReadinessBand } {
  const w = { ...READINESS_WEIGHTS }
  const hasHours = input.sleepHours != null && Number.isFinite(input.sleepHours)
  if (!hasHours) {
    // Redistribute the sleep-hours weight into sleep quality.
    w.sleepQuality += w.sleepHours
    w.sleepHours = 0
  }

  const parts =
    w.sleepQuality * norm5(input.sleepQuality) +
    w.sleepHours * (hasHours ? clamp((input.sleepHours! - 5) / 3, 0, 1) : 0) +
    w.soreness * invNorm5(input.soreness) +
    w.energy * norm5(input.energy) +
    w.stress * invNorm5(input.stress) +
    w.motivation * norm5(input.motivation)

  let score = 100 * parts

  if (adj.acwr != null) {
    if (adj.acwr > 1.5) score -= 10
    if (adj.acwr > 1.8) score -= 10
  }
  if (
    adj.recentLoadSum != null &&
    adj.priorLoadSum != null &&
    adj.priorLoadSum > 0 &&
    adj.recentLoadSum > adj.priorLoadSum * 1.3
  ) {
    score -= 5
  }

  score = Math.round(clamp(score, 0, 100))
  return { score, band: bandFor(score) }
}

/**
 * Band thresholds are calibrated so that answering the middle of every scale
 * (a genuinely unremarkable day) scores 50 and lands in `yellow` — "train as
 * planned". Advice to cut intensity should require the day to be actually bad,
 * otherwise the app cries wolf and people stop reading it.
 */
export function bandFor(score: number): ReadinessBand {
  if (score >= 75) return 'green'
  if (score >= 50) return 'yellow'
  if (score >= 30) return 'orange'
  return 'red'
}

export const BAND_LABEL_KO: Record<ReadinessBand, string> = {
  green: '좋음 — 계획대로 진행하세요',
  yellow: '보통 — 계획대로 진행하세요',
  orange: '주의 — 상단 세트 RPE를 1 낮추고 보조 운동 마지막 세트는 빼세요',
  red: '나쁨 — 가벼운 기술 세션이나 휴식을 권장합니다',
}

/** How the session should be adjusted for today's band. */
export interface ReadinessAdjustment {
  rpeDelta: number
  dropLastAccessorySet: boolean
  suggestRest: boolean
}

export function adjustmentFor(band: ReadinessBand): ReadinessAdjustment {
  switch (band) {
    case 'green':
      return { rpeDelta: 0.5, dropLastAccessorySet: false, suggestRest: false }
    case 'yellow':
      return { rpeDelta: 0, dropLastAccessorySet: false, suggestRest: false }
    case 'orange':
      return { rpeDelta: -1, dropLastAccessorySet: true, suggestRest: false }
    case 'red':
      return { rpeDelta: -1, dropLastAccessorySet: true, suggestRest: true }
  }
}

// ---------------------------------------------------------------------------
// 2. Session load, ATL / CTL / ACWR
// ---------------------------------------------------------------------------

export const MAX_SESSION_MIN = 150

export function srpeLoad(sessionRpe: number, durationMin: number): number {
  return clamp(sessionRpe, 0, 10) * clamp(durationMin, 0, MAX_SESSION_MIN)
}

export interface DailyLoad {
  date: string // YYYY-MM-DD
  load: number
}

export type AcwrState = 'building' | 'low' | 'green' | 'yellow' | 'orange' | 'red'

export interface AcwrResult {
  atl7: number
  ctl28: number
  acwr: number | null
  state: AcwrState
  /** Days of history available, for the "building baseline" message. */
  daysOfHistory: number
}

function sumWindow(loads: Map<string, number>, endDate: Date, days: number): number {
  let total = 0
  for (let i = 0; i < days; i++) {
    const d = new Date(endDate)
    d.setDate(d.getDate() - i)
    total += loads.get(isoDate(d)) ?? 0
  }
  return total
}

export function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function computeAcwr(
  daily: DailyLoad[],
  today: Date,
  firstEverDate?: string,
): AcwrResult {
  const loads = new Map(daily.map((d) => [d.date, d.load]))
  const atl7 = sumWindow(loads, today, 7)
  const ctl28 = sumWindow(loads, today, 28) / 4

  const first = firstEverDate ?? daily.map((d) => d.date).sort()[0]
  const daysOfHistory = first
    ? Math.floor((today.getTime() - new Date(first).getTime()) / 86_400_000) + 1
    : 0

  if (daysOfHistory < 28 || ctl28 <= 0) {
    return { atl7, ctl28, acwr: null, state: 'building', daysOfHistory }
  }

  const acwr = atl7 / ctl28
  let state: AcwrState
  if (acwr > 2.0) state = 'red'
  else if (acwr > 1.5) state = 'orange'
  else if (acwr > 1.3) state = 'yellow'
  else if (acwr < 0.8) state = 'low'
  else state = 'green'

  return { atl7, ctl28, acwr, state, daysOfHistory }
}

export const ACWR_LABEL_KO: Record<AcwrState, string> = {
  building: '기준선 형성 중',
  low: '부하 낮음 (디트레이닝 주의)',
  green: '적정 구간',
  yellow: '부하 증가 빠름',
  orange: '과부하 주의',
  red: '과부하 위험',
}

// ---------------------------------------------------------------------------
// 3. Weekly sets per muscle -> traffic light
// ---------------------------------------------------------------------------

export type VolumeLight = 'under' | 'onTarget' | 'high' | 'over'

export function volumeLight(sets: number, mev: number, mrv: number): VolumeLight {
  const mav = (mev + mrv) / 2
  if (sets < mev) return 'under'
  if (sets <= mav) return 'onTarget'
  if (sets <= mrv) return 'high'
  return 'over'
}

export const VOLUME_LIGHT_LABEL_KO: Record<VolumeLight, string> = {
  under: '부족',
  onTarget: '적정',
  high: '높음',
  over: '과다',
}

export interface MuscleVolumeRow {
  muscle: Muscle
  actualSets: number
  plannedSets: number
  mev: number
  mrv: number
  light: VolumeLight
}

// ---------------------------------------------------------------------------
// 4. Deload trigger
// ---------------------------------------------------------------------------

export interface DeloadTriggerInput {
  /** 1-based week within the current block. */
  currentWeek: number
  blockLengthWeeks: number
  /** Readiness scores keyed by YYYY-MM-DD for at least the last 14 days. */
  readinessByDate: Map<string, number>
  /** ACWR values keyed by date for at least the last 5 days. */
  acwrByDate: Map<string, number>
  /** True if a main lift confirmed-stalled within the last 10 days. */
  mainLiftStalledRecently: boolean
  /** Soreness (1..5) keyed by date for the last 7 days. */
  sorenessByDate: Map<string, number>
  today: Date
  /** Already in a deload week — never re-suggest. */
  isDeloadWeek: boolean
}

export interface DeloadRecommendation {
  recommend: boolean
  reasons: string[]
  /** Stable codes for persistence / analytics. */
  codes: string[]
}

function lastNDates(today: Date, n: number, offset = 0): string[] {
  const out: string[] = []
  for (let i = offset; i < offset + n; i++) {
    const d = new Date(today)
    d.setDate(d.getDate() - i)
    out.push(isoDate(d))
  }
  return out
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

export function evaluateDeload(input: DeloadTriggerInput): DeloadRecommendation {
  const reasons: string[] = []
  const codes: string[] = []
  if (input.isDeloadWeek) return { recommend: false, reasons, codes }

  // 1. scheduled
  if (input.currentWeek >= input.blockLengthWeeks) {
    codes.push('scheduled')
    reasons.push(`블록 ${input.blockLengthWeeks}주차 — 예정된 디로드 주입니다.`)
  }

  // 2. readiness drop
  const recent7 = lastNDates(input.today, 7)
    .map((d) => input.readinessByDate.get(d))
    .filter((v): v is number => v != null)
  const prior7 = lastNDates(input.today, 7, 7)
    .map((d) => input.readinessByDate.get(d))
    .filter((v): v is number => v != null)
  const mRecent = mean(recent7)
  const mPrior = mean(prior7)
  if (mRecent != null && mPrior != null && mRecent <= mPrior - 15 && mRecent < 60) {
    codes.push('readinessDrop')
    reasons.push(
      `최근 7일 컨디션 평균 ${Math.round(mRecent)}점 — 지난주(${Math.round(mPrior)}점)보다 크게 떨어졌어요.`,
    )
  }

  // 3. ACWR spike
  const last5 = lastNDates(input.today, 5)
    .map((d) => input.acwrByDate.get(d))
    .filter((v): v is number => v != null)
  const over15 = last5.filter((v) => v > 1.5).length
  const last2 = lastNDates(input.today, 2)
    .map((d) => input.acwrByDate.get(d))
    .filter((v): v is number => v != null)
  if (over15 >= 3 || (last2.length === 2 && last2.every((v) => v > 1.8))) {
    codes.push('acwrSpike')
    reasons.push('최근 훈련 부하가 평소 대비 급격히 높습니다 (ACWR 과부하 구간).')
  }

  // 4. main-lift stall + persistent soreness
  const sore7 = lastNDates(input.today, 7)
    .map((d) => input.sorenessByDate.get(d))
    .filter((v): v is number => v != null)
  if (input.mainLiftStalledRecently && sore7.filter((v) => v >= 4).length >= 3) {
    codes.push('stallPlusSoreness')
    reasons.push('메인 리프트 기록 정체 + 근육통이 계속되고 있어요.')
  }

  // 5. repeated red days
  const redDays = recent7.filter((v) => v < 40).length
  if (redDays >= 2) {
    codes.push('redDays')
    reasons.push(`최근 7일 중 컨디션 '나쁨'이 ${redDays}일 있었어요.`)
  }

  return { recommend: codes.length > 0, reasons, codes }
}
