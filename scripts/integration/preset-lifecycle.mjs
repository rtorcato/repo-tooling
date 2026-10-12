#!/usr/bin/env node
// Integration test: scaffold a preset with the CURRENT working tree, then run
// the full consumer lifecycle (install → build → verify) against it. Catches
// scaffold defects that only surface on a real install/build — the class of
// bug tracked in #91–#99 that no unit test exercises.
//
// The scaffold's `@rtorcato/repo-tooling` dep is repointed at a `pnpm pack`
// tarball of this repo, so the test validates THIS branch's generated output +
// presets, not whatever `latest` is on npm.
//
// swift-library has no such dep and no npm lifecycle at all, so it runs its own
// step list (`swift build` → `swift test` → `swiftlint`) — see swiftLifecycle.
//
// Usage: node scripts/integration/preset-lifecycle.mjs [preset]   (default: library)
// Requires: `pnpm build-cli` first, and network access to the npm registry.
// swift-library additionally requires a Swift toolchain on PATH.

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { stripAmbientGitEnv } from '../lib/git-env.mjs'

// Before anything spawns git: this script runs `git init` in a temp project, and
// under a hook GIT_DIR would redirect that into the real repo. See the helper.
stripAmbientGitEnv()

const REPO = process.cwd()
const CLI = path.join(REPO, 'dist', 'cli', 'index.js')
const PRESET = process.argv[2] ?? 'library'

function run(cmd, args, cwd) {
	console.log(`\n$ ${cmd} ${args.join(' ')}${cwd && cwd !== REPO ? `  (cwd=${cwd})` : ''}`)
	execFileSync(cmd, args, { stdio: 'inherit', cwd: cwd ?? REPO })
}

function fail(msg) {
	console.error(`\n❌ ${msg}`)
	process.exit(1)
}

/**
 * Per-preset lifecycle. Nothing is seeded: `setup` writes its own entry module,
 * test and runtime deps (#821), so this tests exactly what a user gets — a gap
 * there fails here rather than being papered over. `swift: true` opts out of the
 * JS lifecycle entirely.
 */
const PRESETS = {
	// bundler: 'none' — no build script to run.
	minimal: { build: false },
	library: { build: true },
	'node-api': { build: true },
	'web-app': { build: true },
	'react-app': { build: true },
	// bundler: 'none' — the preset emits no build script, so there is nothing to
	// run here. Wiring up `next build` would be testing Next.js, not the scaffold.
	'nextjs-app': { build: false },
	// The whole JS lifecycle is inapplicable: no package.json to repoint, no
	// pnpm, no biome, no `pnpm verify`. See swiftLifecycle below (#312).
	'swift-library': { swift: true },
}

const spec = PRESETS[PRESET]
if (!spec)
	fail(
		`preset "${PRESET}" is not wired for integration yet (have: ${Object.keys(PRESETS).join(', ')})`
	)
if (!fs.existsSync(CLI)) fail(`CLI not built at ${CLI} — run "pnpm build-cli" first`)

let packDir = ''
const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), `jst-${PRESET}-`))

const onPath = (bin) => {
	try {
		execFileSync('command', ['-v', bin], { stdio: 'ignore', shell: true })
		return true
	} catch {
		return false
	}
}

/**
 * Swift diverges from every JS preset: the scaffold writes its own source and
 * test target (SwiftPM refuses to build an empty one), but there is no
 * `@rtorcato/repo-tooling` dep to repoint and nothing to install. The
 * lifecycle is the gate the scaffold's own CI and pre-push hook run.
 */
function swiftLifecycle() {
	run('swift', ['build'], projectDir)
	run('swift', ['test'], projectDir)
	// SwiftLint is a separate install, not part of a Swift toolchain. Say when it
	// didn't run rather than reporting a lint gate that was never exercised.
	if (onPath('swiftlint')) run('swiftlint', ['lint', '--strict'], projectDir)
	else console.log('\n⚠️  swiftlint not on PATH — lint gate NOT exercised')
}

function jsLifecycle() {
	// 2. Pack the working tree so the scaffold tests local code, not npm's latest.
	packDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jst-pack-'))
	run('pnpm', ['pack', '--pack-destination', packDir])
	const tgz = fs.readdirSync(packDir).find((f) => f.endsWith('.tgz'))
	if (!tgz) fail('pnpm pack produced no tarball')
	const tarball = path.join(packDir, tgz)

	// 3. Repoint @rtorcato/repo-tooling at the local tarball.
	const pkgPath = path.join(projectDir, 'package.json')
	const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
	if (!pkg.devDependencies?.['@rtorcato/repo-tooling'])
		fail('scaffold has no @rtorcato/repo-tooling devDependency')
	pkg.devDependencies['@rtorcato/repo-tooling'] = `file:${tarball}`
	fs.writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

	// 4. git init so husky's `prepare` hook has a repo to attach to.
	run('git', ['init', '-q'], projectDir)

	// 5. Install (fresh scaffold has no lockfile, so not --frozen).
	run('pnpm', ['install'], projectDir)

	// 5b. Run the CLI *from the installed tarball*. Up to here the tarball is
	//     only ever a dependency — never executed — so #345 shipped: dist/base/
	//     was missing from the `files` allowlist and every command died at load
	//     with ERR_MODULE_NOT_FOUND, with all five preset lifecycles still green.
	//     `--version` is enough: the crash was an unresolved static import, which
	//     happens before any command runs.
	//     ponytail: this catches missing *modules* only. A tooling/ asset the CLI
	//     reads at runtime could still be absent from the tarball — run a real
	//     command here if that ever bites.
	run('pnpm', ['exec', 'repo-tooling', '--version'], projectDir)

	// 6. Format generated files — mirrors what `setup` does post-install, and
	//    what its --skip-install warning tells the user to run.
	//    Both config names are accepted: the scaffold settled on biome.json (#365),
	//    and a repo predating that still has biome.jsonc. Testing only one name
	//    silently falls through to prettier, which the biome presets don't install.
	const usesBiome = ['biome.json', 'biome.jsonc'].some((name) =>
		fs.existsSync(path.join(projectDir, name))
	)
	const formatter = usesBiome
		? ['exec', 'biome', 'check', '--write', '.']
		: ['exec', 'prettier', '--write', '.']
	run('pnpm', formatter, projectDir)

	// 7. Build.
	if (spec.build) run('pnpm', ['build'], projectDir)
	else console.log(`\nℹ️  ${PRESET} has no build script (bundler: none) — skipping build`)

	// 8. Every path the package advertises (main/module/types/exports) must exist
	//    on disk after the build — the #92 exports/output mismatch class.
	const built = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
	const advertised = new Set()
	for (const field of ['main', 'module', 'types']) {
		if (typeof built[field] === 'string') advertised.add(built[field])
	}
	const collect = (v) => {
		if (typeof v === 'string') {
			if (v.startsWith('./')) advertised.add(v)
		} else if (v && typeof v === 'object') {
			for (const inner of Object.values(v)) collect(inner)
		}
	}
	collect(built.exports)
	const missing = [...advertised].filter((rel) => !fs.existsSync(path.join(projectDir, rel)))
	if (missing.length > 0)
		fail(`package.json points at files that don't exist after build:\n  ${missing.join('\n  ')}`)
	// App presets advertise nothing (they're not published), so this check is
	// vacuous for them — say so rather than printing a reassuring "all 0".
	console.log(
		advertised.size > 0
			? `\n✅ all ${advertised.size} advertised entry paths exist`
			: `\nℹ️  ${PRESET} advertises no entry paths (not a published package) — nothing to check`
	)

	// 9. Full verify chain (typecheck + lint + test, plus publint/attw on library).
	run('pnpm', ['verify'], projectDir)
}

try {
	// 1. Scaffold the preset (files only; the JS path installs itself once the dep
	//    is repointed, and the Swift path has nothing to install).
	run('node', [CLI, 'setup', '--preset', PRESET, '--directory', projectDir, '--skip-install'])

	if (spec.swift) swiftLifecycle()
	else jsLifecycle()

	console.log(`\n✅ ${PRESET} preset lifecycle passed`)
	if (packDir) fs.rmSync(packDir, { recursive: true, force: true })
	fs.rmSync(projectDir, { recursive: true, force: true })
} catch (err) {
	// Leave the throwaway dirs in place on failure for debugging.
	console.error(`\n❌ ${PRESET} preset lifecycle failed. Inspect: ${projectDir}`)
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
}
