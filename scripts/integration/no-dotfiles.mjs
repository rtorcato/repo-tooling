#!/usr/bin/env node
// Integration test: a stranger's first run (#460, #829). The CLI runs the way a
// public consumer with none of the maintainer's machine meets it:
//
// - `HOME` is an empty temp dir, so no `~/.claude`, dotfiles, git identity or
//   pnpm store.
// - `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` mean no git config
//   from the runner or the maintainer.
// - The env is built from scratch rather than inherited, so `CI`, `GITHUB_*` and
//   the `npm_config_*` that a `pnpm run` parent exports never reach the CLI.
//   `CI` in particular silences the git-identity check (src/base/git-identity.ts).
//
// The CLI runs from the installed tarball's bin, not from dist/, so anything
// that only resolves inside this checkout fails here.
//
// Two runs:
// 1. No pnpm on PATH: `setup` must refuse before writing anything and tell the
//    stranger how to get pnpm (#825).
// 2. With pnpm: the README's one-liner (`setup --preset library -d ./my-lib
//    --yes`), installing for real, then the scaffold's own `pnpm verify` and
//    `pnpm build`, then `doctor` and `fix --yes`. Every exit code is asserted.
//
// Usage: node scripts/integration/no-dotfiles.mjs
// Requires: network access to the npm registry (`pnpm pack` + install).

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripAmbientGitEnv } from '../lib/git-env.mjs'
import { tarballHookEnv } from '../lib/tarball-hook.mjs'

// Before anything spawns git: this script runs git in temp projects, and under a
// hook GIT_DIR would redirect that into the real repo. See the helper.
stripAmbientGitEnv()

const REPO = process.cwd()
const REAL_HOME = os.homedir()

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `rt-stranger-${name}-`))
const toolDir = tmp('tool')
const fakeHome = tmp('home')
const packDir = tmp('pack')
const workDir = tmp('work')
const BIN = path.join(toolDir, 'node_modules', '.bin', 'repo-tooling')

let failed = false

function fail(msg) {
	console.error(`\n❌ ${msg}`)
	failed = true
}

function assert(cond, msg) {
	if (cond) console.log(`  ✅ ${msg}`)
	else fail(msg)
}

/** Under the real env: packing and installing the tool is not what this test is about. */
function run(cmd, args, cwd = REPO) {
	console.log(`\n$ ${cmd} ${args.join(' ')}${cwd !== REPO ? `  (cwd=${cwd})` : ''}`)
	execFileSync(cmd, args, { stdio: 'inherit', cwd })
}

/** Where a binary lives on the real PATH, or null. */
function which(bin) {
	for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
		if (dir && fs.existsSync(path.join(dir, bin))) return dir
	}
	return null
}

// 1. Pack the working tree and install it into a tool dir — the stand-in for
//    npx's cache, so the project itself starts empty.
run('pnpm', ['pack', '--pack-destination', packDir])
const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'))
if (!tgz) {
	console.error('\n❌ pnpm pack produced no tarball')
	process.exit(1)
}
const tarball = path.join(packDir, tgz)
fs.writeFileSync(
	path.join(toolDir, 'package.json'),
	`${JSON.stringify({ name: 'stranger-tool', private: true, devDependencies: { '@rtorcato/repo-tooling': `file:${tarball}` } }, null, 2)}\n`
)
run('pnpm', ['install', '--ignore-scripts'], toolDir)
if (!fs.existsSync(BIN)) {
	console.error(`\n❌ tarball installed but ${BIN} is missing`)
	process.exit(1)
}

// `setup`'s own install gets this branch's tarball (see the helper).
const hookEnv = tarballHookEnv(packDir, tarball)

// PATH holds node (with npm, npx and corepack beside it) and the system dirs —
// and pnpm's own dir only when the run wants it.
const nodeDir = path.dirname(process.execPath)
const basePath = [nodeDir, '/usr/bin', '/bin']
const pnpmDir = which('pnpm')

function strangerEnv(withPnpm) {
	return {
		HOME: fakeHome,
		USERPROFILE: fakeHome,
		PATH: [...(withPnpm ? [pnpmDir] : []), ...basePath].join(path.delimiter),
		TMPDIR: os.tmpdir(),
		LANG: 'C.UTF-8',
		GIT_CONFIG_GLOBAL: '/dev/null',
		GIT_CONFIG_NOSYSTEM: '1',
		...hookEnv,
	}
}

/**
 * Run under the stranger's env. The status comes back for the assertions to
 * judge instead of throwing and losing the captured output.
 */
function stranger(cmd, args, { cwd = workDir, withPnpm = true } = {}) {
	console.log(
		`\n$ ${cmd} ${args.join(' ')}   (cwd=${cwd}, HOME=${fakeHome}${withPnpm ? '' : ', no pnpm'})`
	)
	const res = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: strangerEnv(withPnpm) })
	if (res.error) throw res.error
	if (res.stdout) console.log(res.stdout)
	if (res.stderr) console.error(res.stderr)
	return { status: res.status ?? 1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' }
}

function parseJson(raw, what) {
	try {
		return JSON.parse(raw)
	} catch {
		fail(`${what} did not emit parseable JSON:\n${raw}`)
		return {}
	}
}

/** True when `file` resolves to somewhere under `dir`. Both must exist. */
function contains(dir, file) {
	if (!fs.existsSync(file)) return false
	const rel = path.relative(fs.realpathSync(dir), fs.realpathSync(file))
	return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

// Snapshot the real HOME so any escape from the fake one is caught at the end.
const homeBefore = fs.readdirSync(REAL_HOME).sort().join('\n')
const noUserClaude = () => !fs.existsSync(path.join(fakeHome, '.claude'))

// 2. No pnpm on PATH — refuse before writing, and say how to get it.
console.log('\n── setup without pnpm ──')
const noPnpmProbe = stranger('sh', ['-c', 'command -v pnpm || echo none'], { withPnpm: false })
if (noPnpmProbe.stdout.trim() !== 'none') {
	console.error(`\n❌ pnpm still resolves without its dir on PATH: ${noPnpmProbe.stdout.trim()}`)
	process.exit(1)
}
const bare = path.join(workDir, 'no-pnpm')
const noPnpm = stranger(BIN, ['setup', '--preset', 'library', '-d', bare, '--yes'], {
	withPnpm: false,
})
assert(noPnpm.status === 1, 'setup exits 1 without pnpm')
assert(
	/corepack enable/.test(noPnpm.stderr + noPnpm.stdout),
	'setup tells the user to run corepack enable'
)
assert(
	!fs.existsSync(bare) || fs.readdirSync(bare).length === 0,
	'setup wrote nothing without pnpm'
)

// 3. With pnpm — the README one-liner, installing for real.
console.log('\n── setup --preset library ──')
if (!pnpmDir) {
	console.error('\n❌ pnpm is not on PATH; the second run needs it')
	process.exit(1)
}
const projectDir = path.join(workDir, 'my-lib')
const setup = stranger(BIN, ['setup', '--preset', 'library', '-d', projectDir, '--yes'])
assert(setup.status === 0, 'setup exits 0 with an empty HOME and no git config')
assert(fs.existsSync(path.join(projectDir, 'biome.json')), 'setup scaffolded into the project')
assert(fs.existsSync(path.join(projectDir, 'node_modules')), 'setup installed dependencies')
assert(
	fs.readFileSync(path.join(projectDir, 'pnpm-lock.yaml'), 'utf8').includes(tgz),
	"setup's install used this branch's tarball"
)
assert(noUserClaude(), 'setup created no ~/.claude')

// 4. The scaffold's own gates, as the stranger runs them next.
console.log('\n── pnpm verify / pnpm build ──')
assert(stranger('pnpm', ['verify'], { cwd: projectDir }).status === 0, 'pnpm verify exits 0')
assert(stranger('pnpm', ['build'], { cwd: projectDir }).status === 0, 'pnpm build exits 0')

// 5. doctor — read-only; a fresh scaffold has nothing to fix. `git init` first,
//    as the stranger would before a first commit, so the git checks run for real.
console.log('\n── git init + doctor ──')
assert(stranger('git', ['init', '-q'], { cwd: projectDir }).status === 0, 'git init exits 0')
const doctor = stranger(BIN, ['doctor', '--json', '--directory', projectDir], { cwd: projectDir })
const report = parseJson(doctor.stdout, 'doctor --json')
assert(Array.isArray(report.results) && report.results.length > 0, 'doctor emits a report')
const findings = (report.results ?? []).filter(
	(r) => r.status === 'drift' || r.status === 'missing'
)
assert(
	doctor.status === 0,
	`doctor exits 0 on a fresh scaffold${findings.length ? ` (got: ${findings.map((r) => r.check).join(', ')})` : ''}`
)
// No git identity under GIT_CONFIG_GLOBAL=/dev/null: reported, but never an exit-code failure.
const identity = (report.results ?? []).find((r) => r.check === 'Git identity')
assert(
	identity?.status === 'optional-missing',
	'doctor reports the missing git identity (CI is not set)'
)
assert(noUserClaude(), 'doctor created no ~/.claude')

// 6. The whole fix matrix. A bare `fix` never writes outside the repo.
console.log('\n── fix --yes (full matrix) ──')
const fixAll = stranger(BIN, ['fix', '--yes', '--json', '--directory', projectDir], {
	cwd: projectDir,
})
const fixReport = parseJson(fixAll.stdout, 'fix --yes --json')
assert(fixAll.status === 0, 'fix --yes exits 0')
assert(Array.isArray(fixReport.actions), 'fix --yes emits an action report')
// In-repo fixers report project-relative paths; one that writes user-global
// state reports absolute. Resolve both against the project so `contains` judges
// them the same way — a relative `../escape` still lands outside.
const written = (fixReport.actions ?? [])
	.flatMap((a) => a.filesWritten ?? [])
	.map((f) => (path.isAbsolute(f) ? f : path.join(projectDir, f)))
const strayed = written.filter((f) => !contains(projectDir, f))
if (strayed.length > 0) fail(`fix --yes wrote outside the project:\n  ${strayed.join('\n  ')}`)
assert(strayed.length === 0, 'fix --yes wrote only inside the project')
assert(noUserClaude(), 'a bare fix --yes left ~/.claude alone')

// 7. Nothing leaked into the machine's real HOME.
assert(
	fs.readdirSync(REAL_HOME).sort().join('\n') === homeBefore,
	'the real HOME gained no entries'
)

if (failed) {
	// Leave the throwaway dirs in place on failure for debugging.
	console.error(`\n❌ stranger first run failed. Inspect: ${workDir} (HOME=${fakeHome})`)
	process.exit(1)
}
console.log('\n✅ stranger first run passed')
for (const dir of [toolDir, packDir, workDir, fakeHome])
	fs.rmSync(dir, { recursive: true, force: true })
