/**
 * Swift language module — checks (#286).
 *
 * The standard encoded here is the one `swift-common` actually runs: SwiftLint
 * (lint + `--fix` in pre-commit, `--strict` in CI) and Periphery for dead code.
 * Deliberately *not* checked:
 *
 * - SwiftFormat (the Nick Lockwood one) — SwiftLint's `--fix` does the
 *   formatting; a second *rewriting* formatter would fight it. Apple's
 *   `swift-format` is checked as of #311, but only as an optional slot: a repo
 *   that opts into it runs it *instead of* `swiftlint --fix`.
 * - `.swift-version` — the toolchain is pinned in CI (`setup-xcode`) and the
 *   package declares `// swift-tools-version:`, so a root file would be a third
 *   place to keep in sync.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type FileCheck, type GitHooksProfile, checkFile } from '../../base/checks.js'
import type { CheckResult } from '../../base/types.js'
import { parsePackageSwift } from './ci.js'
import { SWIFT_HOOKS_DIR } from './git-hooks.js'

const SWIFT_FILE_CHECKS: FileCheck[] = [
	{
		check: 'SwiftLint',
		candidates: ['.swiftlint.yml', '.swiftlint.yaml'],
		// SwiftLint configs are project-owned — there's no `extends` mechanism to
		// point at ours, so any file declaring real config counts as ok.
		expected: 'is a valid SwiftLint configuration',
		matcher: /^(disabled_rules|opt_in_rules|only_rules|included|excluded|analyzer_rules):/m,
		hint: 'Run `npx @rtorcato/repo-tooling fix swiftlint` to scaffold',
	},
	{
		check: 'Periphery',
		candidates: ['.periphery.yml', '.periphery.yaml'],
		expected: 'is a valid Periphery configuration',
		matcher: /^(retain_public|project|schemes|targets|index_exclude):/m,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling fix periphery` to scaffold a dead-code scan config',
	},
	{
		// Apple's swift-format, the formatter slot (#311) — not a second linter.
		// Optional because SwiftLint's `--fix` already formats: a repo runs one,
		// the other, or both, so its absence is a choice rather than drift.
		check: 'swift-format',
		candidates: ['.swift-format', '.swift-format.json'],
		expected: 'is a valid swift-format configuration',
		matcher: /"(version|lineLength|indentation|rules)"\s*:/,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling fix swift-format` to scaffold one (SwiftLint `--fix` formats without it)',
	},
]

/**
 * Build artefacts that must never be committed. `.build` and `DerivedData` are
 * the expensive ones — a single stray commit of either adds hundreds of MB.
 */
const REQUIRED_GITIGNORE_ENTRIES = ['.build', 'DerivedData', 'xcuserdata']

export async function checkSwiftGitignore(dir: string): Promise<CheckResult> {
	const filepath = path.join(dir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		return {
			check: 'Swift .gitignore',
			status: 'missing',
			detail: 'no .gitignore',
			hint: 'Run `npx @rtorcato/repo-tooling fix swift-gitignore` to scaffold the Swift template',
		}
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	const missing = REQUIRED_GITIGNORE_ENTRIES.filter((entry) => !contents.includes(entry))
	if (missing.length > 0) {
		return {
			check: 'Swift .gitignore',
			status: 'drift',
			detail: `.gitignore missing Swift build artefacts: ${missing.join(', ')}`,
			hint: 'Run `npx @rtorcato/repo-tooling fix swift-gitignore` to append the missing entries',
		}
	}

	return {
		check: 'Swift .gitignore',
		status: 'ok',
		detail: '.gitignore covers .build, DerivedData and xcuserdata',
	}
}

/**
 * Package.swift hygiene. Both signals are things SwiftPM will not infer for
 * you: without a tools-version comment the manifest doesn't parse at all, and
 * without `platforms:` SwiftPM assumes the oldest deployment target it supports,
 * which silently rejects modern APIs at build time.
 */
export async function checkPackageSwift(dir: string): Promise<CheckResult> {
	const filepath = path.join(dir, 'Package.swift')
	if (!(await fs.pathExists(filepath))) {
		return {
			check: 'Package.swift',
			status: 'missing',
			detail: 'no Package.swift',
			hint: 'Run `swift package init` to create a SwiftPM manifest',
		}
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	const toolsVersion = contents.match(/^\/\/\s*swift-tools-version:\s*([\d.]+)/m)?.[1]
	if (!toolsVersion) {
		return {
			check: 'Package.swift',
			status: 'drift',
			detail: 'Package.swift has no `// swift-tools-version:` comment',
			hint: 'Add `// swift-tools-version: 5.9` as the first line — SwiftPM requires it',
		}
	}

	if (!/\bplatforms:\s*\[/.test(contents)) {
		return {
			check: 'Package.swift',
			status: 'drift',
			detail: `Package.swift (tools ${toolsVersion}) declares no \`platforms:\``,
			hint: 'Add a `platforms:` clause — without it SwiftPM assumes the oldest supported deployment target',
		}
	}

	return {
		check: 'Package.swift',
		status: 'ok',
		detail: `Package.swift declares tools ${toolsVersion} and explicit platforms`,
	}
}

/** Subdirectory names of `<dir>/<root>`, or none when that root doesn't exist. */
async function subdirectories(dir: string, root: string): Promise<string[]> {
	try {
		const entries = await fs.readdir(path.join(dir, root), { withFileTypes: true })
		return entries.filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return []
	}
}

/**
 * Directory names under `Sources/`. For a SwiftPM package these are the target
 * names — a target's sources and its DocC catalogue live in the same folder,
 * so this is where both the check and the `docc` fixer have to look.
 */
export async function swiftSourceTargets(dir: string): Promise<string[]> {
	return subdirectories(dir, 'Sources')
}

/** Where SwiftPM looks for a target's sources when the manifest gives no `path:`. */
const TARGET_ROOTS = ['Sources', 'Tests']

/**
 * Sources that belong to no declared target (#575). SwiftPM silently ignores a
 * directory under `Sources/` that no `.target(` names — so `swift build` and
 * `swift test` both exit 0 while the code in it is never compiled and the tests
 * in it are never run. There is no red X anywhere, which is the whole reason
 * this check exists: a renamed target, a dropped `.target(...)` line, or a
 * generator that rewrote the manifest all leave the same invisible hole.
 *
 * No fixer: repairing it means either adding a target or deleting the
 * directory, and nothing outside the project can tell which.
 */
export async function checkSwiftTargets(dir: string): Promise<CheckResult> {
	const check = 'Swift targets'
	const filepath = path.join(dir, 'Package.swift')
	if (!(await fs.pathExists(filepath))) {
		return { check, status: 'missing', detail: 'no Package.swift' }
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	// A custom `path:` puts a target's sources anywhere, so directory names stop
	// meaning target names and every comparison below becomes a guess. Bail out
	// rather than report something we can't stand behind. Deliberately crude:
	// `.package(path:)` for a local dependency trips this too, which costs a
	// skipped check on repos that use one — cheaper than a false accusation.
	if (/\bpath:\s*"/.test(contents)) {
		return {
			check,
			status: 'ok',
			detail:
				'not checked — Package.swift uses a custom `path:`, so directories need not match targets',
		}
	}

	const declared = new Set(parsePackageSwift(contents).targets)
	const orphans: string[] = []
	let scanned = 0
	for (const root of TARGET_ROOTS) {
		for (const name of await subdirectories(dir, root)) {
			scanned++
			if (!declared.has(name)) orphans.push(`${root}/${name}`)
		}
	}

	if (scanned === 0) {
		return { check, status: 'ok', detail: 'no directories under Sources/ or Tests/' }
	}
	if (orphans.length > 0) {
		return {
			check,
			status: 'drift',
			detail: `no target declares ${orphans.join(', ')} — SwiftPM ignores them, so \`swift build\` passes without building them`,
			hint: `Add a target named after each directory to Package.swift, or delete the directory: ${orphans.join(', ')}`,
		}
	}
	return {
		check,
		status: 'ok',
		detail: `all ${scanned} source directories are declared as targets`,
	}
}

async function findDoccCatalogue(dir: string): Promise<string | null> {
	for (const target of await swiftSourceTargets(dir)) {
		const entries = await fs.readdir(path.join(dir, 'Sources', target))
		const catalogue = entries.find((e) => e.endsWith('.docc'))
		if (catalogue) return `Sources/${target}/${catalogue}`
	}
	return null
}

/**
 * DocC, the Swift shape of the TypeDoc check (#311). Two halves have to line
 * up: a `.docc` catalogue holds the prose, and `swift-docc-plugin` is what
 * makes `swift package generate-documentation` exist — either alone is docs
 * that nobody can build, or a build command with nothing to say.
 */
export async function checkDocC(dir: string): Promise<CheckResult> {
	const check = 'DocC'
	const hint = 'Run `npx @rtorcato/repo-tooling fix docc` to scaffold a DocC catalogue'
	const manifest = path.join(dir, 'Package.swift')
	const contents = (await fs.pathExists(manifest)) ? await fs.readFile(manifest, 'utf-8') : ''
	const hasPlugin = contents.includes('swift-docc-plugin')
	const catalogue = await findDoccCatalogue(dir)

	if (catalogue && hasPlugin) {
		return { check, status: 'ok', detail: `${catalogue} with swift-docc-plugin declared` }
	}
	if (catalogue) {
		return {
			check,
			status: 'drift',
			detail: `${catalogue} found but Package.swift declares no swift-docc-plugin`,
			hint: 'Add `.package(url: "https://github.com/apple/swift-docc-plugin", from: "1.4.0")` to Package.swift',
		}
	}
	if (hasPlugin) {
		return {
			check,
			status: 'drift',
			detail: 'swift-docc-plugin declared but no .docc catalogue under Sources/',
			hint,
		}
	}
	return { check, status: 'optional-missing', detail: 'DocC not configured', hint }
}

/**
 * The test setup (#311). SwiftPM has no test-runner config file to check — the
 * suite is declared in the manifest and run by `swift test` — so the two facts
 * worth asserting are that a test target exists at all and that CI runs it. A
 * green pipeline over a package with no `.testTarget(` proves nothing.
 */
export async function checkSwiftTests(dir: string): Promise<CheckResult> {
	const check = 'Swift tests'
	const manifest = path.join(dir, 'Package.swift')
	if (!(await fs.pathExists(manifest))) {
		return { check, status: 'missing', detail: 'no Package.swift' }
	}
	if (!/\.testTarget\(/.test(await fs.readFile(manifest, 'utf-8'))) {
		return {
			check,
			status: 'missing',
			detail: 'Package.swift declares no `.testTarget(`',
			hint: 'Add a `.testTarget(name: "<Target>Tests", dependencies: ["<Target>"])` to Package.swift',
		}
	}

	const candidates: string[] = ['.gitlab-ci.yml', '.gitlab-ci.yaml']
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		const files = (await fs.readdir(workflowsDir)).filter(
			(f) => f.endsWith('.yml') || f.endsWith('.yaml')
		)
		candidates.unshift(...files.map((f) => path.join('.github', 'workflows', f)))
	}
	for (const candidate of candidates) {
		const filepath = path.join(dir, candidate)
		if (!(await fs.pathExists(filepath))) continue
		if (/\bswift\s+test\b/.test(await fs.readFile(filepath, 'utf-8'))) {
			return { check, status: 'ok', detail: `test target declared and run by ${candidate}` }
		}
	}
	return {
		check,
		status: 'drift',
		detail: 'test target declared but no CI job runs `swift test`',
		hint: 'Run `npx @rtorcato/repo-tooling fix swift-ci` to regenerate a workflow that runs `swift test`',
	}
}

/**
 * Release automation for a SwiftPM package (#310). There is no publish step to
 * look for — a release *is* a semver git tag consumers resolve with
 * `.package(url:from:)` — so "configured" means a workflow that fires on a tag
 * push. semantic-release is deliberately not accepted as evidence: its pipeline
 * is npm end to end, and a Swift repo running it is publishing the wrong thing.
 *
 * Only the trigger section is searched (everything above `jobs:`), because
 * `tags:` also appears inside job steps — docker/metadata-action emits one — and
 * a step that mentions tags is not a release trigger.
 */
export async function checkSwiftRelease(dir: string): Promise<CheckResult> {
	const check = 'Release automation'
	const hint =
		'Run `npx @rtorcato/repo-tooling fix swift-release` to scaffold a tag-triggered release workflow'
	const workflowsDir = path.join(dir, '.github', 'workflows')

	if (await fs.pathExists(workflowsDir)) {
		const files = (await fs.readdir(workflowsDir)).filter(
			(f) => f.endsWith('.yml') || f.endsWith('.yaml')
		)
		for (const file of files) {
			const contents = await fs.readFile(path.join(workflowsDir, file), 'utf-8')
			const triggers = contents.split(/^jobs:/m)[0] ?? ''
			if (/^\s+tags:/m.test(triggers)) {
				return {
					check,
					status: 'ok',
					detail: `.github/workflows/${file} releases on a tag push`,
				}
			}
		}
	}

	return {
		check,
		status: 'optional-missing',
		detail: 'no workflow triggered by a version tag',
		hint,
	}
}

/**
 * The Swift shape of the base `Git hooks` / `Pre-push hook` checks (#309).
 * `install` is null because the wiring — `git config core.hooksPath` — is
 * per-clone local state that nothing commits; flagging its absence would fail
 * every fresh CI checkout for something that isn't repo drift.
 */
export const SWIFT_GIT_HOOKS: GitHooksProfile = {
	dir: SWIFT_HOOKS_DIR,
	install: null,
	verifyCommand: 'swift test',
	fixTarget: 'swift-git-hooks',
}

/** The Swift module's suite, layered on top of the base checks by doctor. */
export async function runSwiftChecks(dir: string): Promise<CheckResult[]> {
	return [
		await checkPackageSwift(dir),
		...(await Promise.all(SWIFT_FILE_CHECKS.map((spec) => checkFile(dir, spec)))),
		await checkSwiftGitignore(dir),
		await checkSwiftTargets(dir),
		await checkSwiftTests(dir),
		await checkDocC(dir),
		await checkSwiftRelease(dir),
	]
}
