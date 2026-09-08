/**
 * End-to-end smoke test against the real app in a mobile-sized Chromium:
 * generate a program -> start a session -> log sets -> finish -> check the
 * history, analytics and readiness screens render with the data.
 *
 * Run the dev server first, then: `node scripts/smoke.mjs`
 */
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SHOTS = resolve(ROOT, 'shots')
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/'

mkdirSync(SHOTS, { recursive: true })

const errors = []
const steps = []
function step(name) {
  steps.push(name)
  console.log(`▶ ${name}`)
}

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, // iPhone 14
  deviceScaleFactor: 2,
  locale: 'ko-KR',
})
const page = await ctx.newPage()
page.on('pageerror', (e) =>
  errors.push(`pageerror: ${e.name}: ${e.message}\n${(e.stack ?? '').split('\n').slice(0, 6).join('\n')}`),
)
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

const shot = async (name) => page.screenshot({ path: resolve(SHOTS, `${name}.png`) })

try {
  step('load app')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByText('오늘', { exact: true }).first().waitFor()

  step('go to 프로그램 tab and generate a rule-engine program')
  await page.getByRole('button', { name: /프로그램/ }).click()
  await page.getByRole('button', { name: '4일', exact: true }).click()
  await page.getByRole('button', { name: '근비대 (근육량)', exact: true }).click()
  await page.getByRole('button', { name: '60분', exact: true }).click()
  await page.getByRole('button', { name: '중급 (1~3년)', exact: true }).click()
  await page.getByLabel('우선 부위').selectOption({ label: '측면 삼각근' })
  await page.getByRole('button', { name: '프로그램 생성' }).click()
  await page.getByText('1일차').waitFor({ timeout: 10_000 })
  await shot('01-program')

  const dayCount = await page.locator('h2', { hasText: /일차 ·/ }).count()
  if (dayCount !== 4) throw new Error(`expected 4 program days, got ${dayCount}`)

  step('edit an exercise (change sets)')
  const firstDayCard = page
    .locator('h2', { hasText: '1일차' })
    .locator('xpath=ancestor::div[contains(@class,"rounded-2xl")][1]')
  await firstDayCard.locator('li button').first().click()
  await page.getByText('세트 수').waitFor()
  const setsRow = page.getByText('세트 수').locator('xpath=ancestor::div[1]')
  const before = (await setsRow.locator('span.tabular-nums').textContent())?.trim()
  await setsRow.getByRole('button', { name: '+' }).click()
  await page.getByRole('button', { name: '저장', exact: true }).click()
  // Wait for the sheet to close — the day card is visible behind it, so
  // waiting on the card alone would race the re-render.
  await page.getByText('세트 수').waitFor({ state: 'detached' })
  const after = (await firstDayCard.locator('li p.text-xs').first().textContent()) ?? ''
  if (!after.startsWith(`${Number(before) + 1}세트`)) {
    throw new Error(`set edit did not persist: was ${before}, card now reads "${after}"`)
  }

  step('start a workout from 오늘')
  await page.getByRole('button', { name: /오늘/ }).click()
  await page.getByText('오늘의 컨디션 체크').waitFor()
  await shot('02-today')
  await page.getByRole('button', { name: '저장', exact: true }).click()
  await page.getByText('오늘의 컨디션', { exact: true }).waitFor()
  await page.getByRole('button', { name: '운동 시작' }).click()

  step('log three sets on the first exercise')
  await page.getByRole('button', { name: /1세트 기록/ }).first().waitFor({ timeout: 10_000 })
  await shot('03-session')
  // First ever session for this lift has no suggested weight — type one, then
  // the remaining sets should prefill from it.
  await page.getByLabel('무게 (kg)').first().fill('60')
  for (let i = 1; i <= 3; i++) {
    const btn = page.getByRole('button', { name: new RegExp(`${i}세트 기록`) }).first()
    await btn.click()
    await page.waitForTimeout(400)
  }
  const loggedRows = await page.getByText(/kg × /).count()
  if (loggedRows < 3) throw new Error(`expected >=3 logged sets, saw ${loggedRows}`)
  await shot('04-session-logged')

  step('rest timer appears and counts down')
  const restVisible = await page.getByText('휴식 중').isVisible().catch(() => false)
  if (!restVisible) throw new Error('rest timer did not appear after logging a set')

  step('finish the workout')
  await page.getByRole('button', { name: '운동 완료' }).scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '운동 완료' }).click()
  await page.getByText('오늘의 컨디션', { exact: true }).waitFor({ timeout: 10_000 })

  step('second session on the same day suggests progression (the core promise)')
  // Session 1 filled the whole 5–8 rep range at 60kg, so double progression
  // should now prescribe more weight and prefill it.
  await page.getByRole('button', { name: '상체 A', exact: true }).click()
  await page.getByRole('button', { name: '운동 시작' }).click()
  await page.getByRole('button', { name: /1세트 기록/ }).first().waitFor({ timeout: 10_000 })
  const suggested = Number(await page.getByLabel('무게 (kg)').first().inputValue())
  if (!(suggested > 60)) {
    throw new Error(`expected a heavier prescription than 60kg, got ${suggested}`)
  }
  const note = (await page.locator('p.text-indigo-300').first().textContent()) ?? ''
  if (!note.includes('증량')) throw new Error(`expected an increase note, got "${note}"`)
  await shot('08-progression')
  console.log(`   → 60kg 세션 후 다음 처방: ${suggested}kg ("${note.trim()}")`)
  await page.getByText('중단').click()
  await page.getByText('오늘의 컨디션', { exact: true }).waitFor()

  step('history shows the finished session')
  await page.getByRole('button', { name: /기록/ }).click()
  await page.getByText(/세트 · /).first().waitFor({ timeout: 10_000 })
  await shot('05-history')

  step('analytics renders volume + charts')
  await page.getByRole('button', { name: /분석/ }).click()
  await page.getByText('이번 주 근육군별 세트').waitFor({ timeout: 15_000 })
  await page.getByText('종목별 추정 1RM').waitFor()
  await page.waitForTimeout(800)
  await shot('06-analytics')

  step('settings renders backup + AI sections')
  await page.getByRole('button', { name: /설정/ }).click()
  await page.getByText('데이터 백업').waitFor()
  await page.getByText('AI 프로그램 생성 (선택)').waitFor()
  await shot('07-settings')

  step('reload keeps the data (IndexedDB persistence)')
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /기록/ }).click()
  await page.getByText(/세트 · /).first().waitFor({ timeout: 10_000 })
} catch (e) {
  errors.push(`FAILED at "${steps[steps.length - 1]}": ${e.message}`)
  await shot('99-failure')
} finally {
  await browser.close()
}

console.log('\n--- smoke result ---')
if (errors.length) {
  console.log(`FAIL (${errors.length} issue(s))`)
  for (const e of errors) console.log(' •', e)
  process.exit(1)
}
console.log(`PASS — ${steps.length} steps, screenshots in shots/`)
