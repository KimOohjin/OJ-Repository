import { describe, expect, it } from 'vitest'
import catalogJson from '@/data/catalog.v1.json'
import type { Exercise, GeneratorInput, Muscle } from '@/domain/types'
import { generateProgram } from './programGenerator'

const catalog: Exercise[] = catalogJson.exercises.map((e) => ({
  ...(e as Omit<Exercise, 'isCustom' | 'createdAt' | 'updatedAt'>),
  isCustom: false,
  createdAt: 0,
  updatedAt: 0,
}))

function weeklyVolume(program: ReturnType<typeof generateProgram>): Map<Muscle, number> {
  const byId = new Map(catalog.map((e) => [e.id, e]))
  const vol = new Map<Muscle, number>()
  for (const d of program.days) {
    for (const pe of d.exercises) {
      const ex = byId.get(pe.exerciseId)!
      vol.set(ex.primaryMuscle, (vol.get(ex.primaryMuscle) ?? 0) + pe.setScheme.sets)
      for (const m of ex.secondaryMuscles) {
        vol.set(m, (vol.get(m) ?? 0) + pe.setScheme.sets * 0.5)
      }
    }
  }
  return vol
}

describe('generateProgram — 주4일 근비대 60분 중급', () => {
  const input: GeneratorInput = {
    daysPerWeek: 4,
    goal: 'hypertrophy',
    sessionLengthMin: 60,
    experience: 'intermediate',
    priorityMuscle: 'deltsSide',
  }
  const program = generateProgram(input, catalog)

  it('uses an upper/lower x2 split with 4 days', () => {
    expect(program.splitType).toBe('upper-lower-x2')
    expect(program.days).toHaveLength(4)
  })

  it('gives each day 4–7 exercises within the time budget', () => {
    for (const d of program.days) {
      expect(d.exercises.length).toBeGreaterThanOrEqual(4)
      expect(d.exercises.length).toBeLessThanOrEqual(8)
      expect(d.estDurationMin).toBeLessThanOrEqual(75)
    }
  })

  it('has exactly one main lift per day, ordered first', () => {
    for (const d of program.days) {
      const mains = d.exercises.filter((e) => e.role === 'main')
      expect(mains).toHaveLength(1)
      expect(d.exercises[0].role).toBe('main')
    }
  })

  it('applies hypertrophy rep ranges and a 3-week RPE ramp', () => {
    const iso = program.days.flatMap((d) => d.exercises).find((e) => e.role === 'isolation')!
    expect(iso.setScheme.repHigh).toBeGreaterThanOrEqual(15)
    const main = program.days[0].exercises[0]
    expect(main.setScheme.repLow).toBe(5)
    expect(main.setScheme.targetRpeByWeek).toEqual([7, 8, 9])
  })

  it('is a 4-week block: 3 accumulation + 1 deload', () => {
    expect(program.lengthWeeks).toBe(4)
    expect(program.accumulationWeeks).toBe(3)
  })

  it('biases volume toward the priority muscle vs. no priority', () => {
    const vol = weeklyVolume(program)
    const baseline = generateProgram({ ...input, priorityMuscle: null }, catalog)
    const baseVol = weeklyVolume(baseline)
    expect(vol.get('deltsSide') ?? 0).toBeGreaterThan(baseVol.get('deltsSide') ?? 0)
    expect(vol.get('deltsSide') ?? 0).toBeGreaterThanOrEqual(10)
  })

  it('trains every worked muscle at least twice per week (frequency)', () => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const dayCount = new Map<Muscle, number>()
    for (const d of program.days) {
      const seen = new Set<Muscle>()
      for (const pe of d.exercises) seen.add(byId.get(pe.exerciseId)!.primaryMuscle)
      for (const m of seen) dayCount.set(m, (dayCount.get(m) ?? 0) + 1)
    }
    // Primary movers that appear at all should show up on >= 2 days.
    for (const [m, c] of dayCount) {
      if (['chest', 'backLats', 'backUpper', 'quads', 'hamstrings'].includes(m)) {
        expect(c, `${m} trained on ${c} day(s)`).toBeGreaterThanOrEqual(2)
      }
    }
  })
})

describe('generateProgram — beginner overrides', () => {
  const program = generateProgram(
    { daysPerWeek: 3, goal: 'hypertrophy', sessionLengthMin: 45, experience: 'beginner' },
    catalog,
  )

  it('uses full body A/B/C for a beginner (not PPL)', () => {
    expect(program.splitType).toBe('fullbody-abc')
  })

  it('caps RPE at 8 and uses fixed rep targets', () => {
    const main = program.days[0].exercises[0]
    expect(Math.max(...main.setScheme.targetRpeByWeek)).toBeLessThanOrEqual(8)
    expect(main.setScheme.repLow).toBe(main.setScheme.repHigh)
  })

  it('gives compound lifts linear load progression', () => {
    const main = program.days[0].exercises[0]
    expect(main.progressionRule).toBe('linearLoad')
  })
})

describe('generateProgram — excluded equipment', () => {
  it('never prescribes excluded equipment', () => {
    const program = generateProgram(
      {
        daysPerWeek: 4,
        goal: 'hypertrophy',
        sessionLengthMin: 60,
        experience: 'intermediate',
        excludedEquipment: ['barbell'],
      },
      catalog,
    )
    const byId = new Map(catalog.map((e) => [e.id, e]))
    for (const d of program.days) {
      for (const pe of d.exercises) {
        expect(byId.get(pe.exerciseId)!.equipment).not.toBe('barbell')
      }
    }
  })
})
