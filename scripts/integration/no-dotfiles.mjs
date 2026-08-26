#!/usr/bin/env node
// Integration test: run the CLI the way a *public consumer with no dotfiles
// repo* does — `HOME` pointed at an empty temp dir, so there is no `~/.claude`,
// no stow symlinks and none of the maintainer's config (#460).
//
// The CLI runs from the installed tarball's bin, not from dist/, so anything
// that only resolves inside this checkout fails here.
//
// Asserts: nothing crashes, every reported write lands inside the project or the
// fake HOME, the machine's real HOME is untouched, and `--skills-dir` keeps
// `~/.claude` unused.
//
// Usage: node scripts/integration/no-dotfiles.mjs
// Requires: network access to the npm registry (`pnpm pack` + install).

import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripAmbientGitEnv } from '../lib/git-env.mjs'

// Before anything spawns git: this script runs `git init` in a temp project, and
// under a hook GIT_DIR would redirect that into the real repo. See the helper.
stripAmbientGitEnv()

const REPO = process.cwd()
const REAL_HOME = os.homedir()

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-nodots-project-'))
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-nodots-home-'))
const packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-nodots-pack-'))
const BIN = path.join(projectDir, 'node_modules', '.bin', 'repo-tooling')

let failed = false

function fail(msg) {
	console.error(`\n❌ ${msg}`)
	failed = true
}

function assert(cond, msg) {
	if (cond) console.log(`  ✅ ${msg}`)
	else fail(msg)
}

function run(cmd, args, cwd = REPO) {
	console.log(`\n$ ${cmd} ${args.join(' ')}${cwd !== REPO ? `  (cwd=${cwd})` : ''}`)
	execFileSync(cmd, args, { stdio: 'inherit', cwd })
}

/**
 * Run the CLI under the fake HOME. A non-zero exit is a legitimate outcome here
 * (doctor findings, the `--skills-dir` refusal), so the status comes back for the
 * assertions to judge instead of throwing and losing the captured output.
 */
function cli(...args) {
	const argv = [...args, '--directory', projectDir]
	console.log(`\n$ repo-tooling ${argv.join(' ')}   (HOME=${fakeHome})`)
	const res = spawnSync(BIN, argv, {
		cwd: projectDir,
		encoding: 'utf8',
		env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome },
	})
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

// In-repo fixers report project-relative paths; the one that writes user-global
// state reports absolute. Resolve both against the project so `contains` can
// judge them the same way — a relative `../escape` still lands outside.
const filesWritten = (payload) =>
	(payload.actions ?? [])
		.flatMap((a) => a.filesWritten ?? [])
		.map((f) => (path.isAbsolute(f) ? f : path.join(projectDir, f)))

// 1. Pack the working tree and install it into a bare project, the way a
//    consumer installs from npm. This step runs under the real HOME on purpose:
//    the package manager's store is not what this test is about.
run('pnpm', ['pack', '--pack-destination', packDir])
const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'))
if (!tgz) {
	console.error('\n❌ pnpm pack produced no tarball')
	process.exit(1)
}

fs.writeFileSync(
	path.join(projectDir, 'package.json'),
	`${JSON.stringify(
		{
			name: 'no-dotfiles-probe',
			version: '0.0.0',
			private: true,
			type: 'module',
			devDependencies: { '@rtorcato/repo-tooling': `file:${path.join(packDir, tgz)}` },
		},
		null,
		2
	)}\n`
)
run('git', ['init', '-q'], projectDir)
// --ignore-scripts: no husky yet, and nothing here needs a consumer's postinstall.
run('pnpm', ['install', '--ignore-scripts'], projectDir)
if (!fs.existsSync(BIN)) {
	console.error(`\n❌ tarball installed but ${BIN} is missing`)
	process.exit(1)
}

// Snapshot the real HOME so any escape from the fake one is caught at the end.
const homeBefore = fs.readdirSync(REAL_HOME).sort().join('\n')
const realSkill = path.join(REAL_HOME, '.claude', 'skills', 'ai-issue-loop', 'SKILL.md')
const realSkillBefore = fs.existsSync(realSkill) ? fs.readFileSync(realSkill, 'utf8') : null
const noUserClaude = () => !fs.existsSync(path.join(fakeHome, '.claude'))

// 2. setup — the first thing a consumer runs.
console.log('\n── setup ──')
const setup = cli('setup', '--preset', 'library', '--skip-install')
assert(setup.status === 0, 'setup exits 0 with an empty HOME')
assert(fs.existsSync(path.join(projectDir, 'biome.json')), 'setup scaffolded into the project')
assert(noUserClaude(), 'setup created no ~/.claude')

// 3. doctor — read-only; must report the absent skills dir rather than crash.
console.log('\n── doctor ──')
const doctor = cli('doctor', '--json')
const report = parseJson(doctor.stdout, 'doctor --json')
assert(Array.isArray(report.results) && report.results.length > 0, 'doctor emits a report')
const skillsCheck = (report.results ?? []).find((r) => r.check === 'Claude skills')
assert(skillsCheck?.status === 'optional-missing', 'doctor reports Claude skills optional-missing')
assert(noUserClaude(), 'doctor created no ~/.claude')

// 4. The whole fix matrix. `claude-skills` is explicitOnly, so this must skip it:
//    a bare `fix` never writes outside the repo.
console.log('\n── fix --yes (full matrix) ──')
const fixAll = cli('fix', '--yes', '--json')
const fixReport = parseJson(fixAll.stdout, 'fix --yes --json')
assert(Array.isArray(fixReport.actions), 'fix --yes emits an action report')
const strayed = filesWritten(fixReport).filter((f) => !contains(projectDir, f))
if (strayed.length > 0) fail(`fix --yes wrote outside the project:\n  ${strayed.join('\n  ')}`)
assert(strayed.length === 0, 'fix --yes wrote only inside the project')
assert(noUserClaude(), 'a bare fix --yes left ~/.claude alone (claude-skills is opt-in)')

// 5. `fix claude-skills` with nothing to resolve and no prompt available must
//    refuse in a way a --json consumer can read, not guess at a directory (#411).
console.log('\n── fix claude-skills (no ~/.claude, no --skills-dir) ──')
const refused = cli('fix', 'claude-skills', '--yes', '--json')
assert(refused.status !== 0, 'fix claude-skills fails when no skills dir resolves')
assert(
	parseJson(refused.stdout, 'the refusal').error === 'no-skills-dir',
	'the refusal names no-skills-dir in JSON'
)
assert(noUserClaude(), 'the refusal created no ~/.claude')

// 6. `--skills-dir` is the documented escape hatch: honoured, and `~/.claude`
//    stays unused while it is set.
console.log('\n── fix claude-skills --skills-dir ──')
const customDir = path.join(fakeHome, 'elsewhere', 'skills')
fs.mkdirSync(customDir, { recursive: true })
const custom = cli('fix', 'claude-skills', '--yes', '--json', '--skills-dir', customDir)
assert(custom.status === 0, 'fix claude-skills --skills-dir exits 0')
assert(
	fs.existsSync(path.join(customDir, 'ai-issue-loop', 'SKILL.md')),
	'--skills-dir received the skill'
)
assert(noUserClaude(), '--skills-dir wrote nothing to ~/.claude')

// 7. The default path on a machine with a plain (non-stow) ~/.claude/skills: an
//    ordinary write naming a path inside the user's own HOME, and no symlink
//    notice — the case the stow handling must not leak into.
console.log('\n── fix claude-skills (plain ~/.claude/skills) ──')
const userDir = path.join(fakeHome, '.claude', 'skills')
fs.mkdirSync(userDir, { recursive: true })
const installed = cli('fix', 'claude-skills', '--yes', '--json')
assert(installed.status === 0, 'fix claude-skills exits 0 once ~/.claude/skills exists')
const skillFile = path.join(userDir, 'ai-issue-loop', 'SKILL.md')
assert(fs.existsSync(skillFile), 'the skill landed in ~/.claude/skills')
assert(
	fs.existsSync(skillFile) && !fs.lstatSync(skillFile).isSymbolicLink(),
	'the installed skill is a real file, not a link'
)
assert(!installed.stderr.includes('wrote through a symlink'), 'no symlink notice on the plain path')
const written = filesWritten(parseJson(installed.stdout, 'fix claude-skills'))
assert(written.length > 0, 'the run reports the file it wrote')
for (const f of written) {
	assert(fs.existsSync(f), `reported path exists: ${f}`)
	assert(contains(fakeHome, f), `reported path is inside the fake HOME: ${f}`)
}

// 8. Nothing leaked into the machine's real HOME.
assert(
	fs.readdirSync(REAL_HOME).sort().join('\n') === homeBefore,
	'the real HOME gained no entries'
)
assert(
	(fs.existsSync(realSkill) ? fs.readFileSync(realSkill, 'utf8') : null) === realSkillBefore,
	"the machine's own installed skill is unchanged"
)

if (failed) {
	// Leave the throwaway dirs in place on failure for debugging.
	console.error(`\n❌ no-dotfiles lifecycle failed. Inspect: ${projectDir} (HOME=${fakeHome})`)
	process.exit(1)
}
console.log('\n✅ no-dotfiles lifecycle passed')
for (const dir of [packDir, projectDir, fakeHome]) fs.rmSync(dir, { recursive: true, force: true })
