import { describe, expect, it } from 'vitest'
import type { ProgressionConfig, SetScheme } from '@/domain/types'
import { detectStall, prescribeNext, seedNextBlockWeight, type SessionHistory } from './progressionEngine'

const scheme: SetScheme = {
  sets: 3,
  repLow: 8,
  repHigh: 12,
  targetRpeByWeek: [7, 8, 9],
  restSec: 120,
}
const config: ProgressionConfig = { incrementKg: 2.5, deloadPct: 0.1, stallWindow: 3 }

const DAY = 86_400_000

function session(day: number, sets: Array<[number, number, number?]>): SessionHistory {
  return {
    workoutId: `w${day}`,
    completedAt: day * DAY,
    sets: sets.map(([weightKg, reps, rpe]) => ({
      weightKg,
      reps,
      rpe,
      isWarmup: false,
      completedAt: day * DAY,
    })),
  }
}

const base = {
  rule: 'doubleProgression' as const,
  scheme,
  config,
  blockWeek: 1,
  isDeload: false,
  startingWeightKg: null,
  roundToKg: 2.5,
}

describe('prescribeNext — doubleProgression', () => {
  it('seeds when there is no history', () => {
    const p = prescribeNext({ ...base, history: [], startingWeightKg: 40 })
    expect(p.action).toBe('seed')
    expect(p.weightKg).toBe(40)
  })

  it('holds the weight and asks for one more rep mid-range', () => {
    const p = prescribeNext({ ...base, history: [session(1, [[50, 9, 8], [50, 9, 8], [50, 8, 8]])] })
    expect(p.action).toBe('hold')
    expect(p.weightKg).toBe(50)
    expect(p.sets).toBe(3)
  })

  it('increases once every set hits the top of the range', () => {
    const p = prescribeNext({
      ...base,
      history: [session(1, [[50, 12, 8], [50, 12, 8], [50, 12, 8]])],
    })
    expect(p.action).toBe('increase')
    expect(p.weightKg).toBe(52.5)
  })

  it('caps the jump at ~2.5% for heavy lifts', () => {
    const heavy: ProgressionConfig = { ...config, incrementKg: 5 }
    const p = prescribeNext({
      ...base,
      config: heavy,
      scheme: { ...scheme, repLow: 5, repHigh: 8 },
      history: [session(1, [[60, 8, 8], [60, 8, 8], [60, 8, 8]])],
    })
    // 2.5% of 60 = 1.5, so the jump is capped well below the nominal +5kg
    expect(p.weightKg).toBe(62.5)
  })

  it('states the actual rounded jump in the note, not the nominal increment', () => {
    const p = prescribeNext({
      ...base,
      config: { ...config, incrementKg: 5 },
      scheme: { ...scheme, repLow: 5, repHigh: 8 },
      history: [session(1, [[60, 8, 8], [60, 8, 8], [60, 8, 8]])],
    })
    expect(p.weightKg).toBe(62.5)
    expect(p.note).toContain('+2.5kg')
  })

  it('never suggests the same weight when progressing', () => {
    // A small nominal increment could round back down to the current weight.
    const p = prescribeNext({
      ...base,
      config: { ...config, incrementKg: 0.5 },
      roundToKg: 5,
      history: [session(1, [[100, 12, 8], [100, 12, 8], [100, 12, 8]])],
    })
    expect(p.action).toBe('increase')
    expect(p.weightKg).toBe(105)
  })

  it('backs off 7.5% when reps fall under the range', () => {
    const p = prescribeNext({ ...base, history: [session(1, [[80, 6, 9], [80, 5, 10]])] })
    expect(p.action).toBe('backoff')
    expect(p.weightKg).toBe(75)
  })
})

describe('prescribeNext — deload week', () => {
  it('holds ~90% load, halves sets, caps RPE at 6', () => {
    const p = prescribeNext({
      ...base,
      isDeload: true,
      blockWeek: 4,
      scheme: { ...scheme, sets: 4 },
      history: [session(1, [[100, 10, 8]])],
    })
    expect(p.weightKg).toBe(90)
    expect(p.sets).toBe(2)
    expect(p.targetRpe).toBeLessThanOrEqual(6)
  })
})

describe('prescribeNext — linearLoad (beginner)', () => {
  it('adds the full increment after a completed easy session', () => {
    const p = prescribeNext({
      ...base,
      rule: 'linearLoad',
      config: { ...config, incrementKg: 5 },
      history: [session(1, [[60, 8, 7], [60, 8, 7], [60, 8, 8]])],
    })
    expect(p.action).toBe('increase')
    expect(p.weightKg).toBe(65)
  })

  it('holds when the last top set was already hard', () => {
    const p = prescribeNext({
      ...base,
      rule: 'linearLoad',
      history: [session(1, [[60, 8, 9], [60, 8, 9.5]])],
    })
    expect(p.action).toBe('hold')
    expect(p.weightKg).toBe(60)
  })
})

describe('detectStall', () => {
  const flat = [
    session(1, [[80, 8, 8]]),
    session(3, [[80, 8, 9]]),
    session(5, [[80, 8, 9]]),
    session(7, [[80, 8, 9]]),
  ]

  it('reports none while e1RM keeps climbing', () => {
    const rising = [session(1, [[80, 8, 8]]), session(3, [[82.5, 8, 8]]), session(5, [[85, 8, 8]])]
    expect(detectStall(rising, scheme, config, 1).severity).toBe('none')
  })

  it('reports mini after two stale sessions', () => {
    expect(detectStall(flat.slice(0, 3), scheme, config, 1).severity).toBe('mini')
  })

  it('confirms a stall when grinding at high RPE', () => {
    // week 1 target RPE is 7; logged 9s are well over target + 0.5
    expect(detectStall(flat, scheme, config, 1).severity).toBe('confirmed')
  })

  it('cuts the load 10% on a confirmed stall', () => {
    const p = prescribeNext({ ...base, history: flat })
    expect(p.action).toBe('stallBackoff')
    expect(p.weightKg).toBe(72.5)
  })
})

describe('seedNextBlockWeight', () => {
  it('scales the block best e1RM to week-1 reps x RPE', () => {
    const w = seedNextBlockWeight(100, scheme, 2.5)
    // 12 reps @ RPE 7 sits well under 1RM
    expect(w).toBeGreaterThan(50)
    expect(w).toBeLessThan(80)
    expect(w % 2.5).toBe(0)
  })
})
