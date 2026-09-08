/**
 * One-command deploy to GitHub Pages without needing a CI workflow or the
 * `workflow` OAuth scope: build with the repo's base path, then force-push the
 * `dist/` output to the `gh-pages` branch.
 *
 *   node scripts/deploy.mjs
 *
 * Pages must be set to serve from the `gh-pages` branch (root). The GitHub
 * Actions workflow in .github/workflows/ is the alternative once that scope is
 * granted — the two approaches are mutually exclusive; pick one.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { stdio: 'inherit', cwd: ROOT, ...opts })
const capture = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts }).trim()

const remote = capture('git', ['remote', 'get-url', 'origin'])
const sha = capture('git', ['rev-parse', '--short', 'HEAD'])
const repo = remote.replace(/^.*github\.com[:/]/, '').replace(/\.git$/, '')
const base = `/${repo.split('/')[1]}/`

console.log(`Building for ${repo}  (base ${base})`)
rmSync(resolve(ROOT, 'dist'), { recursive: true, force: true })
// Invoke vite's JS entry with the current node rather than `npx`: on Windows
// `npx` is a .cmd shim that execFileSync cannot spawn without a shell.
run(process.execPath, [resolve(ROOT, 'node_modules/vite/bin/vite.js'), 'build'], {
  env: { ...process.env, BASE_PATH: base },
})

// Assemble the branch contents in a throwaway worktree so nothing in the main
// checkout is disturbed.
const work = mkdtempSync(join(tmpdir(), 'wa-deploy-'))
cpSync(resolve(ROOT, 'dist'), work, { recursive: true })
writeFileSync(join(work, '.nojekyll'), '')
cpSync(join(work, 'index.html'), join(work, '404.html'))

run('git', ['init', '-q', '-b', 'gh-pages'], { cwd: work })
run('git', ['config', 'user.email', 'deploy@local'], { cwd: work })
run('git', ['config', 'user.name', 'deploy'], { cwd: work })
run('git', ['add', '-A'], { cwd: work })
run('git', ['commit', '-q', '-m', `Deploy ${sha}`], { cwd: work })
run('git', ['push', '-f', remote, 'gh-pages'], { cwd: work })
rmSync(work, { recursive: true, force: true })

console.log(`\nDeployed. Live in ~1 min at https://${repo.split('/')[0].toLowerCase()}.github.io/${repo.split('/')[1]}/`)
