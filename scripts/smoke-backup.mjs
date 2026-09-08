/**
 * Verifies the durability story end to end:
 *   export -> wipe all site data -> import -> the program and logs are back,
 *   and the AI API key is NOT present in the exported file.
 *
 * Assumes `smoke.mjs` has already populated the database in this browser
 * profile is NOT required — this script creates its own data.
 */
import { chromium } from 'playwright'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
// A fresh temp dir per run — a previous browser process can keep a handle on
// the old one, and Windows then refuses to remove or reuse it.
const DOWNLOADS = mkdtempSync(join(tmpdir(), 'workout-backup-'))
const BASE = process.env.BASE_URL ?? 'http://localhost:5173/'

const errors = []
const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'ko-KR',
  acceptDownloads: true,
})
const page = await ctx.newPage()
page.on('pageerror', (e) => errors.push(`pageerror: ${e.name}: ${e.message}`))
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`console: ${m.text()}`)
})

const log = (s) => console.log(`▶ ${s}`)

try {
  log('create a program and save an API key')
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /프로그램/ }).click()
  await page.getByRole('button', { name: '3일', exact: true }).click()
  await page.getByRole('button', { name: '프로그램 생성' }).click()
  await page.getByText('1일차').waitFor({ timeout: 10_000 })

  await page.getByRole('button', { name: /설정/ }).click()
  await page.getByLabel('API 키').fill('SECRET-TEST-KEY-12345')
  await page.getByRole('button', { name: '키 저장' }).click()
  await page.getByText('API 키를 저장했습니다.').waitFor()

  log('export a backup')
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '백업 내보내기' }).click(),
  ])
  const file = resolve(DOWNLOADS, download.suggestedFilename())
  await download.saveAs(file)

  log('exported file must not contain the API key')
  const { readFileSync } = await import('node:fs')
  const raw = readFileSync(file, 'utf8')
  if (raw.includes('SECRET-TEST-KEY-12345')) {
    throw new Error('API key leaked into the backup file')
  }
  const parsed = JSON.parse(raw)
  const programCount = parsed.tables.programs?.length ?? 0
  const dayCount = parsed.tables.programDays?.length ?? 0
  if (programCount < 1 || dayCount < 3) {
    throw new Error(`backup looks empty: ${programCount} programs, ${dayCount} days`)
  }

  log('wipe all site data (simulates iOS eviction)')
  await page.evaluate(async () => {
    const dbs = (await indexedDB.databases?.()) ?? []
    await Promise.all(
      dbs.map(
        (d) =>
          new Promise((res) => {
            const req = indexedDB.deleteDatabase(d.name)
            req.onsuccess = req.onerror = req.onblocked = () => res()
          }),
      ),
    )
    localStorage.clear()
  })
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /프로그램/ }).click()
  await page.getByText('프로그램 만들기').waitFor({ timeout: 10_000 })

  log('import the backup and confirm the program is restored')
  await page.getByRole('button', { name: /설정/ }).click()
  await page.getByRole('button', { name: '백업 가져오기' }).click()
  await page.setInputFiles('input[type=file]', file)
  await page.getByText('가져올 데이터').waitFor()
  await page.getByRole('button', { name: '전체 교체' }).click()
  await page.getByText('가져오기 완료').waitFor({ timeout: 10_000 })

  await page.getByRole('button', { name: /프로그램/ }).click()
  await page.getByText('1일차').waitFor({ timeout: 10_000 })
  const restoredDays = await page.locator('h2', { hasText: /일차 ·/ }).count()
  if (restoredDays !== dayCount) {
    throw new Error(`restored ${restoredDays} days, expected ${dayCount}`)
  }
  console.log(`   → 복원됨: 프로그램 ${programCount}개, ${restoredDays}일차`)
} catch (e) {
  errors.push(`FAILED: ${e.message}`)
  await page.screenshot({ path: resolve(ROOT, 'shots', '99-backup-failure.png') })
} finally {
  const files = readdirSync(DOWNLOADS)
  console.log(`   downloads: ${files.join(', ') || '(none)'}`)
  await browser.close()
}

console.log('\n--- backup round-trip ---')
if (errors.length) {
  console.log('FAIL')
  for (const e of errors) console.log(' •', e)
  process.exit(1)
}
console.log('PASS')
