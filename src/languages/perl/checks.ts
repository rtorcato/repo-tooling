/**
 * Perl language module — checks (#289), on the same template as Swift (#286)
 * and Python (#290).
 *
 * The standard encoded here is Perl::Critic (lint) and perltidy (format), with
 * prove/Test::More as the runner. Deliberately *not* checked:
 *
 * - **A `pre-commit` framework config** — the hooks in `./git-hooks.ts` call
 *   the tools directly, exactly as CI does, rather than adding a second config
 *   file and a second pinned-tool source to keep in sync.
 * - **`Perl::Tidy` as a lint rule** (`CodeLayout::RequireTidyCode`) — running
 *   the formatter from inside the linter reports "this file is untidy" without
 *   saying how, and it makes a perlcritic run depend on perltidy being
 *   installed. The CI job runs perltidy directly and shows the diff instead.
 * - **A pinned interpreter file** — the floor is declared once in the
 *   distribution's metadata, and CI derives its matrix from that. A root file
 *   would be a second place to keep in sync.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type FileCheck, type GitHooksProfile, checkFile } from '../../base/checks.js'
import type { CheckResult } from '../../base/types.js'
import { PERL_METADATA_FILES, declaredPerlFloor, readPerlMetadata } from './ci.js'
import { PERL_HOOKS_DIR } from './git-hooks.js'
import { PERL_GITIGNORE_SENTINELS } from './gitignore.js'

const PERL_FILE_CHECKS: FileCheck[] = [
	{
		check: 'Perl::Critic',
		// Both spellings are read by perlcritic; the dotted one is conventional.
		candidates: ['.perlcriticrc', 'perlcriticrc'],
		expected: 'is a valid Perl::Critic configuration',
		// A `severity`/`verbose`-style setting, or a `[Policy::Name]` block.
		matcher:
			/^\s*(severity|verbose|theme|only|include|exclude|profile-strictness)\s*=|^\s*\[[-\w:]+\]/m,
		hint: 'Run `npx @rtorcato/repo-tooling fix perlcritic` to scaffold',
	},
	{
		check: 'perltidy',
		candidates: ['.perltidyrc', 'perltidyrc'],
		expected: 'is a valid perltidy configuration',
		// perltidyrc is a list of command-line switches, one per line.
		matcher: /^\s*-{1,2}[a-zA-Z]/m,
		hint: 'Run `npx @rtorcato/repo-tooling fix perltidy` to scaffold',
	},
]

/**
 * Distribution metadata, the Perl shape of the `Package.swift` and
 * `pyproject.toml` checks. Both signals are things no tool infers for you:
 * without a metadata file there is nothing for cpanm to resolve dependencies
 * from, and without a declared perl floor cpanm installs the distribution on
 * an interpreter that cannot compile it — the failure lands on the user, at
 * `use` time, as a syntax error rather than a version complaint.
 */
export async function checkPerlDistribution(dir: string): Promise<CheckResult> {
	const check = 'Perl distribution'
	const metadata = await readPerlMetadata(dir)

	if (!metadata) {
		return {
			check,
			status: 'missing',
			detail: `no ${PERL_METADATA_FILES.join(' / ')}`,
			hint: "Add a `cpanfile` declaring the distribution's dependencies — `requires 'perl', '5.036';` at minimum",
		}
	}

	const floor = declaredPerlFloor(metadata.contents)
	if (!floor) {
		return {
			check,
			status: 'drift',
			detail: `${metadata.file} declares no minimum perl version`,
			hint:
				metadata.file === 'cpanfile'
					? "Add `requires 'perl', '5.036';` — without it cpanm installs on interpreters that cannot compile the code"
					: 'Declare a minimum perl (`MIN_PERL_VERSION` in Makefile.PL, `perl` under [Prereqs] in dist.ini) — without it cpanm installs on interpreters that cannot compile the code',
		}
	}

	return {
		check,
		status: 'ok',
		detail: `${metadata.file} declares a minimum perl of ${floor}`,
	}
}

export async function checkPerlGitignore(dir: string): Promise<CheckResult> {
	const check = 'Perl .gitignore'
	const filepath = path.join(dir, '.gitignore')
	if (!(await fs.pathExists(filepath))) {
		return {
			check,
			status: 'missing',
			detail: 'no .gitignore',
			hint: 'Run `npx @rtorcato/repo-tooling fix perl-gitignore` to scaffold the Perl template',
		}
	}

	const contents = await fs.readFile(filepath, 'utf-8')
	const missing = PERL_GITIGNORE_SENTINELS.filter((entry) => !contents.includes(entry))
	if (missing.length > 0) {
		return {
			check,
			status: 'drift',
			detail: `.gitignore missing Perl build artefacts: ${missing.join(', ')}`,
			hint: 'Run `npx @rtorcato/repo-tooling fix perl-gitignore` to append the missing entries',
		}
	}

	return {
		check,
		status: 'ok',
		detail: `.gitignore covers ${PERL_GITIGNORE_SENTINELS.join(', ')}`,
	}
}

/** CI files that could be running the test suite, most likely first. */
async function ciFiles(dir: string): Promise<string[]> {
	const candidates: string[] = ['.gitlab-ci.yml', '.gitlab-ci.yaml']
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		const files = (await fs.readdir(workflowsDir)).filter(
			(f) => f.endsWith('.yml') || f.endsWith('.yaml')
		)
		candidates.unshift(...files.map((f) => path.join('.github', 'workflows', f)))
	}
	return candidates
}

/**
 * The test setup. Same two halves as the Swift and Python versions: a suite has
 * to exist, and CI has to run it. `t/` is the universal convention — prove and
 * every build system default to it — so unlike Python there is no second layout
 * to look for. `xt/` counts too: author tests are still tests.
 */
export async function checkPerlTests(dir: string): Promise<CheckResult> {
	const check = 'Perl tests'
	let tests: string | null = null
	for (const candidate of ['t', 'xt']) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			tests = `${candidate}/`
			break
		}
	}

	if (!tests) {
		return {
			check,
			status: 'missing',
			detail: 'no t/ directory',
			hint: 'Add a `t/` directory of `.t` files — `prove -lr t` is what CI runs',
		}
	}

	for (const candidate of await ciFiles(dir)) {
		const filepath = path.join(dir, candidate)
		if (!(await fs.pathExists(filepath))) continue
		// `prove` is the harness; `make test` / `dzil test` are the build systems'
		// wrappers around the same thing, and all three count as running the suite.
		if (/\b(prove|make test|dzil test)\b/.test(await fs.readFile(filepath, 'utf-8'))) {
			return { check, status: 'ok', detail: `${tests} found and run by ${candidate}` }
		}
	}

	return {
		check,
		status: 'drift',
		detail: `${tests} found but no CI job runs the test suite`,
		hint: 'Run `npx @rtorcato/repo-tooling fix perl-ci` to regenerate a workflow that runs `prove`',
	}
}

/**
 * The Perl shape of the base `Git hooks` / `Pre-push hook` checks (#309).
 * `install` is null for the same reason Swift's and Python's are: the wiring —
 * `git config core.hooksPath` — is per-clone local state that nothing commits,
 * so flagging its absence would fail every fresh CI checkout.
 */
export const PERL_GIT_HOOKS: GitHooksProfile = {
	dir: PERL_HOOKS_DIR,
	install: null,
	verifyCommand: 'prove -lr t',
	fixTarget: 'perl-git-hooks',
}

/** The Perl module's suite, layered on top of the base checks by doctor. */
export async function runPerlChecks(dir: string): Promise<CheckResult[]> {
	return [
		await checkPerlDistribution(dir),
		...(await Promise.all(PERL_FILE_CHECKS.map((spec) => checkFile(dir, spec)))),
		await checkPerlGitignore(dir),
		await checkPerlTests(dir),
	]
}
