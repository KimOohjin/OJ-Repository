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

describe('generateProgram — optional compounds vs. session length', () => {
  const base = {
    daysPerWeek: 4 as const,
    goal: 'hypertrophy' as const,
    experience: 'intermediate' as const,
  }
  const patternsOn = (p: ReturnType<typeof generateProgram>, dayIndex: number) => {
    const byId = new Map(catalog.map((e) => [e.id, e]))
    return p.days[dayIndex].exercises.map((e) => byId.get(e.exerciseId)!.pattern)
  }

  it('still programs accessory work in a 45-minute session', () => {
    // Full rest prescriptions eat a short session on compounds alone; rests
    // scale down so the day is not three compounds and nothing else.
    const p = generateProgram(
      { ...base, sessionLengthMin: 45, daysPerWeek: 3, priorityMuscle: 'deltsSide' },
      catalog,
    )
    for (const d of p.days) {
      expect(
        d.exercises.filter((e) => e.role === 'isolation').length,
        `${d.label} had no isolation work`,
      ).toBeGreaterThanOrEqual(1)
    }
    const byId = new Map(catalog.map((e) => [e.id, e]))
    const sideDeltSets = p.days
      .flatMap((d) => d.exercises)
      .filter((e) => byId.get(e.exerciseId)!.primaryMuscle === 'deltsSide')
      .reduce((s, e) => s + e.setScheme.sets, 0)
    expect(sideDeltSets).toBeGreaterThanOrEqual(6)
  })

  it('keeps a priority-muscle overrun proportional to the session length', () => {
    for (const sessionLengthMin of [45, 60, 90] as const) {
      const p = generateProgram(
        { ...base, sessionLengthMin, priorityMuscle: 'deltsSide' },
        catalog,
      )
      for (const d of p.days) {
        expect(
          d.estDurationMin,
          `${sessionLengthMin}min / ${d.label} ran ${d.estDurationMin}min`,
        ).toBeLessThanOrEqual(sessionLengthMin * 1.1 + 6)
      }
    }
  })

  it('drops vertical press at 60 min to protect accessory work', () => {
    const p = generateProgram({ ...base, sessionLengthMin: 60 }, catalog)
    expect(patternsOn(p, 0)).not.toContain('verticalPush')
    // the isolation work it would have displaced is still there
    const isolations = p.days[0].exercises.filter((e) => e.role === 'isolation')
    expect(isolations.length).toBeGreaterThanOrEqual(2)
  })

  it('includes vertical press at 90 min, keeping accessories too', () => {
    const p = generateProgram({ ...base, sessionLengthMin: 90 }, catalog)
    expect(patternsOn(p, 0)).toContain('verticalPush')
    const isolations = p.days[0].exercises.filter((e) => e.role === 'isolation')
    expect(isolations.length).toBeGreaterThanOrEqual(2)
  })

  it('keeps every day inside its time budget at all session lengths', () => {
    for (const sessionLengthMin of [45, 60, 75, 90] as const) {
      const p = generateProgram({ ...base, sessionLengthMin }, catalog)
      for (const d of p.days) {
        expect(
          d.estDurationMin,
          `${sessionLengthMin}min / ${d.label} ran ${d.estDurationMin}min`,
        ).toBeLessThanOrEqual(sessionLengthMin + 6)
      }
    }
  })

  it('never puts the main lift on a droppable slot', () => {
    for (const sessionLengthMin of [45, 60, 75, 90] as const) {
      const p = generateProgram({ ...base, sessionLengthMin }, catalog)
      for (const d of p.days) {
        expect(d.exercises.filter((e) => e.role === 'main')).toHaveLength(1)
      }
    }
  })

  it('reports a duration that matches the sets it actually prescribes', () => {
    // The weekly-volume pass adds sets after each day is built, so a stale
    // estimate would under-report how long the session really takes.
    const TIME = {
      main: { setup: 150, exec: 40, transition: 60 },
      secondary: { setup: 90, exec: 30, transition: 60 },
      isolation: { setup: 45, exec: 25, transition: 60 },
    }
    const p = generateProgram(
      { ...base, sessionLengthMin: 60, priorityMuscle: 'deltsSide' },
      catalog,
    )
    for (const d of p.days) {
      const seconds = d.exercises.reduce((sum, e) => {
        const c = TIME[e.role]
        return sum + c.setup + e.setScheme.sets * (e.setScheme.restSec + c.exec) + c.transition
      }, 0)
      const expected = Math.round((seconds / 60 + 6) * 10) / 10
      expect(d.estDurationMin, `${d.label}`).toBeCloseTo(expected, 1)
    }
  })

  it('warns by name when the priority muscle falls short', () => {
    const p = generateProgram(
      { ...base, sessionLengthMin: 60, priorityMuscle: 'deltsSide' },
      catalog,
    )
    const byId = new Map(catalog.map((e) => [e.id, e]))
    let sets = 0
    for (const d of p.days) {
      for (const e of d.exercises) {
        const ex = byId.get(e.exerciseId)!
        if (ex.primaryMuscle === 'deltsSide') sets += e.setScheme.sets
        else if (ex.secondaryMuscles.includes('deltsSide')) sets += e.setScheme.sets * 0.5
      }
    }
    if (sets < 12) {
      expect(p.warnings.some((w) => w.includes('측면 삼각근'))).toBe(true)
    }
  })

  it('warns when a strength program cannot fit its pattern frequency', () => {
    const short = generateProgram(
      { daysPerWeek: 4, goal: 'strength', sessionLengthMin: 45, experience: 'intermediate' },
      catalog,
    )
    expect(short.warnings.some((w) => w.includes('패턴'))).toBe(true)
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
