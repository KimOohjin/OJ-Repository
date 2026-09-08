/**
 * Prints generated programs for a few input combinations, so the rule engine's
 * output can be eyeballed without clicking through the app.
 * Usage: node scripts/preview-program.mjs [minutes] [days] [goal]
 */
import { createServer } from 'vite'

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
const { generateProgram } = await server.ssrLoadModule('/src/domain/generator/programGenerator.ts')
const catalogMod = await server.ssrLoadModule('/src/data/catalog.v1.json?raw')
const catalog = JSON.parse(catalogMod.default).exercises.map((e) => ({
  ...e,
  isCustom: false,
  createdAt: 0,
  updatedAt: 0,
}))
const byId = new Map(catalog.map((e) => [e.id, e]))

const combos = process.argv[2]
  ? [
      {
        sessionLengthMin: Number(process.argv[2]),
        daysPerWeek: Number(process.argv[3] ?? 4),
        goal: process.argv[4] ?? 'hypertrophy',
        experience: 'intermediate',
        priorityMuscle: 'deltsSide',
      },
    ]
  : [
      { daysPerWeek: 4, goal: 'hypertrophy', sessionLengthMin: 60, experience: 'intermediate', priorityMuscle: 'deltsSide' },
      { daysPerWeek: 4, goal: 'hypertrophy', sessionLengthMin: 90, experience: 'intermediate', priorityMuscle: 'deltsSide' },
      { daysPerWeek: 4, goal: 'strength', sessionLengthMin: 75, experience: 'intermediate' },
    ]

for (const input of combos) {
  const p = generateProgram(input, catalog)
  console.log(
    `\n${'='.repeat(64)}\n${p.name}  [${p.splitType}]  ${input.experience}` +
      (input.priorityMuscle ? `  우선:${input.priorityMuscle}` : ''),
  )
  for (const w of p.warnings) console.log(`  ⚠ ${w}`)
  const vol = new Map()
  for (const d of p.days) {
    console.log(`\n-- ${d.label}  (~${d.estDurationMin}분) --`)
    for (const e of d.exercises) {
      const ex = byId.get(e.exerciseId)
      const reps = e.setScheme.repLow === e.setScheme.repHigh
        ? `${e.setScheme.repLow}`
        : `${e.setScheme.repLow}-${e.setScheme.repHigh}`
      console.log(
        `   ${e.role.padEnd(9)} ${ex.nameKo.padEnd(22)} ${e.setScheme.sets}x${reps}` +
          `  rest ${e.setScheme.restSec}s  [${ex.pattern}]`,
      )
      vol.set(ex.primaryMuscle, (vol.get(ex.primaryMuscle) ?? 0) + e.setScheme.sets)
      for (const m of ex.secondaryMuscles) vol.set(m, (vol.get(m) ?? 0) + e.setScheme.sets * 0.5)
    }
  }
  console.log('\n주간 세트:')
  for (const [m, v] of [...vol.entries()].sort((a, b) => b[1] - a[1])) {
    const lo = p.mevByMuscle[m]
    const hi = p.mrvByMuscle[m]
    const range = lo != null ? ` (목표 ${lo}~${hi})` : ''
    const flag = lo != null && v < lo ? '  ← 부족' : lo != null && v > hi ? '  ← 과다' : ''
    console.log(`   ${m.padEnd(12)} ${String(v).padStart(5)}${range}${flag}`)
  }
}

await server.close()
