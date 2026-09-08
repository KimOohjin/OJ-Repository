import { describe, expect, it } from 'vitest'
import {
  computeAcwr,
  evaluateDeload,
  isoDate,
  readinessScore,
  srpeLoad,
  volumeLight,
} from './fatigueModel'

const TODAY = new Date('2026-03-15T09:00:00')

function datesBack(n: number, offset = 0): string[] {
  const out: string[] = []
  for (let i = offset; i < offset + n; i++) {
    const d = new Date(TODAY)
    d.setDate(d.getDate() - i)
    out.push(isoDate(d))
  }
  return out
}

describe('readinessScore', () => {
  it('scores a great day near the top of the green band', () => {
    const { score, band } = readinessScore({
      sleepQuality: 5,
      sleepHours: 8,
      soreness: 1,
      energy: 5,
      stress: 1,
      motivation: 5,
    })
    expect(score).toBe(100)
    expect(band).toBe('green')
  })

  it('scores a poor-sleep, sore, stressed day in the orange band', () => {
    const { score, band } = readinessScore({
      sleepQuality: 3,
      sleepHours: 6,
      soreness: 4,
      energy: 3,
      stress: 4,
      motivation: 3,
    })
    expect(score).toBeGreaterThanOrEqual(35)
    expect(score).toBeLessThanOrEqual(45)
    expect(band).toBe('orange')
  })

  it('treats an all-neutral day as yellow — train as planned', () => {
    const { score, band } = readinessScore({
      sleepQuality: 3,
      soreness: 3,
      energy: 3,
      stress: 3,
      motivation: 3,
    })
    expect(score).toBe(50)
    expect(band).toBe('yellow')
  })

  it('only reaches red when the day is genuinely bad', () => {
    const { band } = readinessScore({
      sleepQuality: 1,
      sleepHours: 4,
      soreness: 5,
      energy: 1,
      stress: 5,
      motivation: 2,
    })
    expect(band).toBe('red')
  })

  it('redistributes the sleep-hours weight when hours are missing', () => {
    const withHours = readinessScore({
      sleepQuality: 4,
      sleepHours: 7.4,
      soreness: 2,
      energy: 4,
      stress: 2,
      motivation: 4,
    })
    const without = readinessScore({
      sleepQuality: 4,
      soreness: 2,
      energy: 4,
      stress: 2,
      motivation: 4,
    })
    expect(Math.abs(withHours.score - without.score)).toBeLessThanOrEqual(3)
  })

  it('penalises a high ACWR', () => {
    const input = {
      sleepQuality: 4,
      sleepHours: 8,
      soreness: 2,
      energy: 4,
      stress: 2,
      motivation: 4,
    }
    const calm = readinessScore(input, { acwr: 1.0 })
    const spiked = readinessScore(input, { acwr: 1.9 })
    expect(calm.score - spiked.score).toBe(20)
  })
})

describe('srpeLoad + computeAcwr', () => {
  it('multiplies session RPE by capped duration', () => {
    expect(srpeLoad(8, 62)).toBe(496)
    expect(srpeLoad(8, 999)).toBe(8 * 150)
  })

  it('reports "building" until 28 days of history exist', () => {
    const daily = datesBack(10).map((date) => ({ date, load: 400 }))
    const r = computeAcwr(daily, TODAY)
    expect(r.state).toBe('building')
    expect(r.acwr).toBeNull()
  })

  it('sits in the green band for steady training', () => {
    const daily = datesBack(28).map((date, i) => ({ date, load: i % 2 === 0 ? 500 : 0 }))
    const r = computeAcwr(daily, TODAY)
    expect(r.acwr).not.toBeNull()
    expect(r.acwr!).toBeGreaterThan(0.8)
    expect(r.acwr!).toBeLessThan(1.3)
    expect(r.state).toBe('green')
  })

  it('flags a spike when the last week jumps', () => {
    const daily = datesBack(28).map((date, i) => ({
      date,
      load: i < 7 ? 900 : i % 2 === 0 ? 300 : 0,
    }))
    const r = computeAcwr(daily, TODAY)
    expect(r.acwr!).toBeGreaterThan(1.5)
    expect(['orange', 'red']).toContain(r.state)
  })
})

describe('volumeLight', () => {
  it('maps sets to the four bands around MEV/MAV/MRV', () => {
    expect(volumeLight(8, 10, 18)).toBe('under')
    expect(volumeLight(12, 10, 18)).toBe('onTarget')
    expect(volumeLight(16, 10, 18)).toBe('high')
    expect(volumeLight(20, 10, 18)).toBe('over')
  })
})

describe('evaluateDeload', () => {
  const quiet = {
    currentWeek: 2,
    blockLengthWeeks: 4,
    readinessByDate: new Map(datesBack(14).map((d) => [d, 78])),
    acwrByDate: new Map(datesBack(5).map((d) => [d, 1.05])),
    mainLiftStalledRecently: false,
    sorenessByDate: new Map(datesBack(7).map((d) => [d, 2])),
    today: TODAY,
    isDeloadWeek: false,
  }

  it('stays quiet mid-block when everything is fine', () => {
    expect(evaluateDeload(quiet).recommend).toBe(false)
  })

  it('fires on the scheduled final week', () => {
    const r = evaluateDeload({ ...quiet, currentWeek: 4 })
    expect(r.recommend).toBe(true)
    expect(r.codes).toContain('scheduled')
  })

  it('fires on a sustained readiness drop', () => {
    const readinessByDate = new Map<string, number>()
    for (const d of datesBack(7)) readinessByDate.set(d, 52)
    for (const d of datesBack(7, 7)) readinessByDate.set(d, 80)
    const r = evaluateDeload({ ...quiet, readinessByDate })
    expect(r.codes).toContain('readinessDrop')
  })

  it('fires on an ACWR spike', () => {
    const acwrByDate = new Map(datesBack(5).map((d) => [d, 1.7]))
    const r = evaluateDeload({ ...quiet, acwrByDate })
    expect(r.codes).toContain('acwrSpike')
  })

  it('fires on a main-lift stall plus persistent soreness', () => {
    const sorenessByDate = new Map(datesBack(7).map((d) => [d, 4]))
    const r = evaluateDeload({ ...quiet, mainLiftStalledRecently: true, sorenessByDate })
    expect(r.codes).toContain('stallPlusSoreness')
  })

  it('never re-suggests during a deload week', () => {
    const r = evaluateDeload({ ...quiet, currentWeek: 4, isDeloadWeek: true })
    expect(r.recommend).toBe(false)
  })
})
