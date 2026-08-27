import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import { renderGitHubWorkflow } from '../../base/ci.js'
import { githubJobs, scriptsOf } from '../../languages/js/ci.js'
import { inferProjectConfig } from '../../languages/js/fixers.js'
import { PERL_GIT_HOOKS, runPerlChecks } from '../../languages/perl/checks.js'
import { readPerlProject, renderPerlWorkflow } from '../../languages/perl/ci.js'
import { PYTHON_GIT_HOOKS, runPythonChecks } from '../../languages/python/checks.js'
import { readPyproject, renderPythonWorkflow } from '../../languages/python/ci.js'
import { resolveLanguageModule } from '../../languages/registry.js'
import { SWIFT_GIT_HOOKS, runSwiftChecks } from '../../languages/swift/checks.js'
import { readSwiftPackage, renderSwiftWorkflow } from '../../languages/swift/ci.js'
import { type DetectedLanguage, detectLanguage } from '../utils/detect-language.js'
import { checkAgentUser } from '../../base/agent-user.js'
import { checkGitHubSettings } from '../../base/github-settings.js'
import { checkLoopLabels } from '../../base/labels.js'
import { checkMilestones } from '../../base/milestones.js'
import { checkGitIdentity, checkGitIdentityHistory } from '../../base/git-identity.js'
import { checkCopiedAssets } from '../utils/copied-assets.js'
import { type Lockfile, LOCKFILE_VERSION, readLockfile } from '../utils/lockfile.js'
import { declinedInLock, getFixTargetForCheck } from './fix-targets.js'
import {
	type BadgeAudience,
	checkAiSetup,
	checkBrand,
	checkCodeowners,
	checkClaudeSkills,
	checkCodeQL,
	checkCommunityHealth,
	checkCoverageUpload,
	checkDependabot,
	checkEditorConfig,
	checkFile,
	checkGitHooks,
	checkGitHubActions,
	checkGitLabCI,
	checkNestedLanguages,
	checkPrePushHook,
	checkReadmeBadges,
	checkRecommendedMcp,
	checkRequiredSkills,
	COMMITLINT_FILE_CHECK,
	type GitHooksProfile,
} from '../../base/checks.js'
import type { CheckResult, CheckStatus } from '../../base/types.js'
import {
	allDeps,
	checkAreTheTypesWrong,
	checkBiome,
	checkClaudeWorktreeSettings,
	checkConfigSchemaVersions,
	checkDocsSite,
	checkEnginesNode,
	checkGitDependencies,
	checkKnip,
	checkLintStaged,
	checkNodeVersionConsistency,
	checkNodeVersionPin,
	checkPackageJson,
	checkPackageManager,
	checkPublint,
	checkSemanticRelease,
	checkSizeLimit,
	checkTailwind,
	checkBuildApprovals,
	checkPnpmWorkspace,
	checkTreeshakeSetup,
	checkTurborepo,
	checkTypedoc,
	checkVerifyScript,
	checkVscodeExtensions,
	evaluateNodeVersion,
	FILE_CHECKS,
	findDocsAppDir,
	jsBadgeAudience,
	jsGitHooksProfile,
	type Pkg,
	readPackageJson,
} from '../../languages/js/checks.js'

export type { CheckResult, CheckStatus }
export { evaluateNodeVersion }

export interface DoctorOptions {
	directory?: string
	json?: boolean
	/** `--skills-dir`, mirroring `fix` — the read side of the same flag (#485). */
	skillsDir?: string
}

const PACKAGE = '@rtorcato/repo-tooling'

// Detects the broken-release-on-protected-main footgun: a workflow that runs
// semantic-release but only hands it GITHUB_TOKEN, which can't push the version
// commit + tag past branch protection. The fix is an admin PAT (RELEASE_TOKEN)
// with a GITHUB_TOKEN fallback.
async function checkReleaseToken(dir: string): Promise<CheckResult> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) {
		return { check: 'Release token', status: 'optional-missing', detail: 'no .github/workflows/' }
	}
	try {
		const files = await fs.readdir(workflowsDir)
		for (const f of files) {
			if (!(f.endsWith('.yml') || f.endsWith('.yaml'))) continue
			const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
			if (!/semantic-release/.test(content)) continue
			if (/RELEASE_TOKEN/.test(content)) {
				return {
					check: 'Release token',
					status: 'ok',
					detail: `${f} uses RELEASE_TOKEN (with GITHUB_TOKEN fallback)`,
				}
			}
			return {
				check: 'Release token',
				status: 'drift',
				detail: `${f} runs semantic-release with bare GITHUB_TOKEN`,
				hint: 'GITHUB_TOKEN cannot push to a protected main. Set the checkout `token:` and the semantic-release `GITHUB_TOKEN` env to `${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}` and add a RELEASE_TOKEN admin PAT secret',
			}
		}
		return {
			check: 'Release token',
			status: 'optional-missing',
			detail: 'no semantic-release workflow found',
		}
	} catch {
		return {
			check: 'Release token',
			status: 'optional-missing',
			detail: 'unable to read .github/workflows/',
		}
	}
}

// Flags a release workflow still authenticating npm publish with a long-lived
// NPM_TOKEN secret instead of OIDC trusted publishing (#201). npm is deprecating
// 2FA-bypass tokens; OIDC needs no secret and adds provenance for free. Only
// relevant for public packages that actually publish to npm.
async function checkNpmOidcPublish(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const check = 'npm OIDC publish'
	if (!pkg || pkg.private === true) {
		return { check, status: 'optional-missing', detail: 'private package — no npm publish' }
	}
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) {
		return { check, status: 'optional-missing', detail: 'no .github/workflows/' }
	}
	try {
		const files = await fs.readdir(workflowsDir)
		for (const f of files) {
			if (!(f.endsWith('.yml') || f.endsWith('.yaml'))) continue
			const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
			if (!/semantic-release/.test(content)) continue
			if (/secrets\.NPM_TOKEN/.test(content)) {
				return {
					check,
					status: 'drift',
					detail: `${f} authenticates npm publish with NPM_TOKEN`,
					hint: 'Migrate to OIDC trusted publishing: add a Trusted Publisher for each published package on npmjs.com (Settings → Trusted Publisher), then run `fix github-actions` to drop NPM_TOKEN (the release job keeps `id-token: write`). npm is deprecating 2FA-bypass tokens.',
				}
			}
			return { check, status: 'ok', detail: `${f} publishes via OIDC (no NPM_TOKEN)` }
		}
		return { check, status: 'optional-missing', detail: 'no semantic-release workflow found' }
	} catch {
		return { check, status: 'optional-missing', detail: 'unable to read .github/workflows/' }
	}
}

function checkLockfile(lock: Lockfile | null): CheckResult {
	if (!lock) {
		return {
			check: 'lockfile',
			status: 'optional-missing',
			detail: 'no .repo-tooling.json — doctor cannot tell intentional opt-outs from drift',
			hint: 'Run `npx @rtorcato/repo-tooling fix lockfile` to record current choices',
		}
	}
	if (lock.version > LOCKFILE_VERSION) {
		return {
			check: 'lockfile',
			status: 'drift',
			detail: `.repo-tooling.json version ${lock.version} is newer than this CLI supports (v${LOCKFILE_VERSION})`,
			hint: 'Upgrade @rtorcato/repo-tooling to a release that supports this lockfile version',
		}
	}
	// Not drift: nothing is wrong, a newer capability (e.g. v3 asset-drift
	// tracking) is just dormant until the file is rewritten (#531).
	if (lock.version < LOCKFILE_VERSION) {
		return {
			check: 'lockfile',
			status: 'optional-missing',
			detail: `.repo-tooling.json is v${lock.version}; this CLI writes v${LOCKFILE_VERSION} — newer doctor capabilities stay dormant until it's migrated`,
			hint: 'Run `npx @rtorcato/repo-tooling fix lockfile` to migrate it in place',
		}
	}
	return {
		check: 'lockfile',
		status: 'ok',
		detail: `.repo-tooling.json v${lock.version} (written by ${lock.writtenBy})`,
	}
}

// Lockfile-driven demotion: if the lock records an intentional opt-out for a
// check that's currently optional-missing, demote it to ok with a clear detail.
function demoteDeclined(results: CheckResult[], lock: Lockfile | null): CheckResult[] {
	if (!lock) return results
	return results.map((r) => {
		if (r.status !== 'optional-missing') return r
		if (!declinedInLock(lock, r.check)) return r
		return {
			check: r.check,
			status: 'ok',
			detail: 'intentionally declined (.repo-tooling.json)',
		}
	})
}

// Declared exceptions (#558): a failing check the lock names is reported as
// `declared` with its reason — shown, never hidden, but no longer failing the
// run. An exception naming a check this run doesn't know is itself drift:
// otherwise a typo silently does nothing and a check rename silently
// un-suppresses a finding, and both are invisible.
function applyExceptions(results: CheckResult[], lock: Lockfile | null): CheckResult[] {
	const exceptions = lock?.exceptions
	if (!exceptions) return results
	const known = new Set(results.map((r) => r.check))
	const overlaid: CheckResult[] = results.map((r) => {
		const reason = exceptions[r.check]
		if (!reason || r.status === 'ok') return r
		// Hint deliberately dropped: the deviation is declared, so "how to fix it"
		// is exactly the noise the exception exists to retire.
		return {
			check: r.check,
			status: 'declared',
			detail: `${r.detail} — declared exception: ${reason}`,
		}
	})
	for (const name of Object.keys(exceptions)) {
		if (known.has(name)) continue
		overlaid.push({
			check: 'Declared exceptions',
			status: 'drift',
			detail: `.repo-tooling.json declares an exception for "${name}", which is not a check this run knows`,
			hint: 'A typo, or a check that was renamed or removed — fix or delete the entry in `exceptions`',
		})
	}
	return overlaid
}

/**
 * The per-language inputs the base suite needs. Git hooks, commit linting and
 * README badges are repo concerns whose *evidence* is language-shaped (#309), so
 * the module hands the shape in rather than forking the check.
 */
interface BaseCheckOptions {
	/** Null for a language whose hook convention isn't encoded yet. */
	hooks: GitHooksProfile | null
	badges: { audience: BadgeAudience; fixTarget: string | null }
	/**
	 * The ci.yml this module's generator would render right now, so the CI check
	 * can spot a workflow that has drifted from it (#349). Null for a language
	 * with no CI generator — nothing to compare against.
	 */
	presetWorkflow: string | null
	/** The root's detected language, so the monorepo notice can name what it skips (#317). */
	language: DetectedLanguage
	/** The module's `codeqlLanguages`; empty means CodeQL can't analyse it (#289). */
	codeqlLanguages: readonly string[]
	/**
	 * The run's `--skills-dir` — the one field here that isn't language-shaped.
	 * It rides along because it is the only way the user-global skills check
	 * hears about the flag, and threading it as a separate parameter reformats
	 * every call site for no gain (#485).
	 */
	skillsDir?: string
}

// The language-agnostic checks (src/base): repo hygiene, git hooks, CI,
// security, and GitHub repo-settings that apply to any repo regardless of
// language. Declared once and run for every project — a language module layers
// its own checks on top rather than re-listing these.
async function runBaseChecks(
	dir: string,
	lock: Lockfile | null,
	opts: BaseCheckOptions
): Promise<CheckResult[]> {
	const results: CheckResult[] = []
	results.push(checkLockfile(lock))
	// Any language can have copied presets (swiftlint, ruff, perlcriticrc), so
	// this rides with the base suite rather than a module's (#428).
	results.push(await checkCopiedAssets(dir))
	results.push(await checkNestedLanguages(dir, opts.language))
	results.push(await checkGitIdentity(dir))
	// The retrospective half (#557): commits already made with a bad identity.
	results.push(await checkGitIdentityHistory(dir))
	results.push(await checkEditorConfig(dir))
	results.push(await checkFile(dir, COMMITLINT_FILE_CHECK))
	if (opts.hooks) {
		results.push(await checkGitHooks(dir, opts.hooks))
		results.push(await checkPrePushHook(dir, opts.hooks))
	}
	results.push(await checkGitHubActions(dir, opts.presetWorkflow))
	results.push(await checkDependabot(dir))
	results.push(await checkCodeQL(dir, opts.codeqlLanguages))
	// GitHub repo-settings drift (branch protection, merge settings, workflow
	// permissions). Read-only; self-skips as `ok` outside a live GitHub repo.
	results.push(...(await checkGitHubSettings(dir)))
	// Milestone hygiene (#397) — same seam, same self-skip.
	results.push(await checkMilestones(dir))
	// ai-issue-loop label colours/descriptions (#446) — same seam, same self-skip.
	results.push(await checkLoopLabels(dir))
	// aiLoop.agentUser assignability (#530) — same seam, same self-skip.
	results.push(await checkAgentUser(dir, lock?.aiLoop?.agentUser))
	results.push(await checkGitLabCI(dir))
	results.push(await checkCodeowners(dir))
	results.push(await checkCommunityHealth(dir))
	results.push(await checkBrand(dir))
	results.push(await checkAiSetup(dir))
	// User-global, not repo state — see checkClaudeSkills on why it never returns drift.
	results.push(await checkClaudeSkills(opts.skillsDir))
	// #533: gated on `aiLoop`, which is already the "this repo uses the pipeline"
	// signal, so a repo that doesn't gets no line at all rather than an empty one.
	if (lock?.aiLoop && lock.requiredSkills?.length) {
		results.push(await checkRequiredSkills(lock.requiredSkills, opts.skillsDir))
	}
	// #534: advisory. Absent `mcp.recommended` means the repo has nothing to say
	// about MCP, which is not a finding.
	if (lock?.mcp?.recommended?.length) {
		results.push(await checkRecommendedMcp(dir, lock.mcp.recommended))
	}
	results.push(await checkReadmeBadges(dir, opts.badges.audience, opts.badges.fixTarget))
	results.push(await checkCoverageUpload(dir))
	return results
}

export async function runDoctor(dir: string, skillsDir?: string): Promise<CheckResult[]> {
	const targetDir = path.resolve(dir)

	const lock = await readLockfile(targetDir)

	// Per-module dispatch (#285): the base checks (repo hygiene, CI, security,
	// GitHub settings) apply to any repo and run for every language. A supported
	// module layers its own checks on top. 'unknown' (bare dir mid-setup)
	// resolves to JS so a fresh repo runs the full suite.
	const language = await detectLanguage(targetDir)
	const languageModule = resolveLanguageModule(language)
	// Every language in the registry has a module as of #289, so nothing reaches
	// this today. It stays as the on-ramp: a language is added to the registry
	// with `supported: false` first, and until its module lands its repos get the
	// full base suite rather than the wholesale skip this replaced.
	if (!languageModule.supported) {
		const results: CheckResult[] = [
			{
				check: 'language',
				status: 'ok',
				detail: `detected ${languageModule.label} — running language-agnostic checks; ${languageModule.label}-specific checks land with its module (#139)`,
			},
			// hooks: null — guessing a hook convention would nag every repo with a
			// fix target that doesn't exist.
			...(await runBaseChecks(targetDir, lock, {
				hooks: null,
				badges: { audience: 'public', fixTarget: null },
				presetWorkflow: null,
				language,
				codeqlLanguages: languageModule.codeqlLanguages,
				skillsDir,
			})),
		]
		return applyExceptions(demoteDeclined(results, lock), lock)
	}

	// Swift suite (#286): base checks plus the module's own. Swift repos have no
	// package.json, so nothing JS-shaped runs.
	if (languageModule.id === 'swift') {
		const results: CheckResult[] = [
			{
				check: 'language',
				status: 'ok',
				detail: 'detected Swift (Package.swift)',
			},
			...(await runBaseChecks(targetDir, lock, {
				hooks: SWIFT_GIT_HOOKS,
				// A SwiftPM package is distributed as public source over git tags, so
				// badges always apply. No fixer: `fix badges` derives the block from
				// package.json name/repository, which a Swift repo hasn't got.
				badges: { audience: 'public', fixTarget: null },
				presetWorkflow: renderSwiftWorkflow(await readSwiftPackage(targetDir)),
				language,
				codeqlLanguages: languageModule.codeqlLanguages,
				skillsDir,
			})),
			...(await runSwiftChecks(targetDir)),
		]
		return applyExceptions(demoteDeclined(results, lock), lock)
	}

	// Python suite (#290): same shape as Swift — base checks plus the module's
	// own, and nothing JS-shaped, because a Python repo has no package.json.
	if (languageModule.id === 'python') {
		const results: CheckResult[] = [
			{
				check: 'language',
				status: 'ok',
				detail: 'detected Python (pyproject.toml / setup.py)',
			},
			...(await runBaseChecks(targetDir, lock, {
				hooks: PYTHON_GIT_HOOKS,
				// A Python package on PyPI is public by default, so badges apply. No
				// fixer: `fix badges` derives the block from package.json name and
				// repository, which a Python repo hasn't got.
				badges: { audience: 'public', fixTarget: null },
				presetWorkflow: renderPythonWorkflow(await readPyproject(targetDir)),
				language,
				codeqlLanguages: languageModule.codeqlLanguages,
				skillsDir,
			})),
			...(await runPythonChecks(targetDir)),
		]
		return applyExceptions(demoteDeclined(results, lock), lock)
	}

	// Perl suite (#289): same shape as Swift and Python — base checks plus the
	// module's own, and nothing JS-shaped, because a distribution has no
	// package.json. CodeQL self-reports as not applicable: it ships no Perl
	// analyzer, which `codeqlLanguages: []` in the registry encodes.
	if (languageModule.id === 'perl') {
		const results: CheckResult[] = [
			{
				check: 'language',
				status: 'ok',
				detail: 'detected Perl (cpanfile / Makefile.PL / dist.ini)',
			},
			...(await runBaseChecks(targetDir, lock, {
				hooks: PERL_GIT_HOOKS,
				// A distribution released to CPAN is public by definition, so badges
				// apply. No fixer: `fix badges` derives the block from package.json
				// name and repository, which a Perl repo hasn't got.
				badges: { audience: 'public', fixTarget: null },
				presetWorkflow: renderPerlWorkflow(await readPerlProject(targetDir)),
				language,
				codeqlLanguages: languageModule.codeqlLanguages,
				skillsDir,
			})),
			...(await runPerlChecks(targetDir)),
		]
		return applyExceptions(demoteDeclined(results, lock), lock)
	}

	// JS suite: the module's own checks, then the shared base ones. Only the
	// JS-shaped checks are listed here — re-listing the base suite is what made
	// any new base check silently skip JS repos (#309).
	const pkg = await readPackageJson(targetDir)
	const results: CheckResult[] = []

	results.push(evaluateNodeVersion(process.version))
	results.push(checkPackageJson(pkg))
	results.push(checkEnginesNode(pkg))
	results.push(await checkPackageManager(targetDir, pkg))
	results.push(await checkConfigSchemaVersions(targetDir, pkg))
	results.push(checkGitDependencies(pkg))
	results.push(await checkVscodeExtensions(targetDir))
	results.push(await checkNodeVersionPin(targetDir))
	results.push(await checkNodeVersionConsistency(targetDir, pkg))
	for (const spec of FILE_CHECKS) {
		// Biome is the one spec that needs the directory as well as the file
		// contents — it compares the `$schema` version against the installed
		// CLI (#424). Dispatched here so it keeps its place in the output.
		results.push(
			spec.check === 'Biome' ? await checkBiome(targetDir) : await checkFile(targetDir, spec)
		)
	}
	results.push(await checkLintStaged(targetDir, pkg))
	results.push(await checkVerifyScript(targetDir, pkg))
	results.push(await checkSemanticRelease(targetDir, pkg))
	results.push(await checkKnip(targetDir, pkg))
	results.push(await checkSizeLimit(targetDir, pkg))
	results.push(await checkReleaseToken(targetDir))
	results.push(await checkNpmOidcPublish(targetDir, pkg))
	results.push(await checkTypedoc(targetDir, pkg))
	results.push(await checkAreTheTypesWrong(targetDir, pkg))
	results.push(await checkPublint(targetDir, pkg))
	results.push(await checkTreeshakeSetup(targetDir, pkg))
	results.push(await checkPnpmWorkspace(targetDir, pkg))
	results.push(await checkBuildApprovals(targetDir, pkg))
	results.push(await checkClaudeWorktreeSettings(targetDir))
	// Turborepo is monorepo-only — only surface the check when a workspace exists.
	if (await fs.pathExists(path.join(targetDir, 'pnpm-workspace.yaml'))) {
		results.push(await checkTurborepo(targetDir))
	}
	// Docs site is opt-in — only surface the check when a Docusaurus site exists.
	const docsAppDir = await findDocsAppDir(targetDir)
	if (docsAppDir) {
		results.push(await checkDocsSite(targetDir, docsAppDir))
	}
	// Tailwind is opt-in — only surface the check when the repo actually depends on it.
	if ('tailwindcss' in allDeps(pkg)) {
		results.push(await checkTailwind(targetDir, pkg))
	}

	results.push(
		...(await runBaseChecks(targetDir, lock, {
			hooks: jsGitHooksProfile(pkg),
			badges: { audience: jsBadgeAudience(pkg), fixTarget: 'badges' },
			// Same `scripts` gating the fixer applies, or the workflow doctor
			// compares against would reference steps the fixer never writes (#364).
			presetWorkflow: renderGitHubWorkflow(
				githubJobs(inferProjectConfig(pkg), { scripts: scriptsOf(pkg) })
			),
			language,
			codeqlLanguages: languageModule.codeqlLanguages,
			skillsDir,
		}))
	)

	return applyExceptions(demoteDeclined(results, lock), lock)
}

const STATUS_ICONS: Record<CheckStatus, string> = {
	ok: chalk.green('✅'),
	drift: chalk.yellow('⚠️ '),
	missing: chalk.red('❌'),
	'optional-missing': chalk.gray('➖'),
	declared: chalk.blue('📝'),
}

function statusLabel(status: CheckStatus): string {
	switch (status) {
		case 'ok':
			return chalk.green('ok')
		case 'drift':
			return chalk.yellow('drift')
		case 'missing':
			return chalk.red('missing')
		case 'optional-missing':
			return chalk.gray('not configured')
		case 'declared':
			return chalk.blue('declared')
	}
}

const MAX_NEXT_STEP_SUGGESTIONS = 8

export function nextStepSuggestions(results: CheckResult[], language?: string): string[] {
	const fixable = results.filter(
		(r) => r.status === 'drift' || r.status === 'missing' || r.status === 'optional-missing'
	)
	const lines: string[] = []
	let overflow = 0
	for (const r of fixable) {
		const target = getFixTargetForCheck(r.check, language)
		if (!target) continue
		if (lines.length >= MAX_NEXT_STEP_SUGGESTIONS) {
			overflow++
			continue
		}
		const verb = r.status === 'drift' ? 'align' : 'scaffold'
		lines.push(`Run \`npx @rtorcato/repo-tooling fix ${target}\` to ${verb} ${r.check}`)
	}
	if (overflow > 0) {
		lines.push(
			`...and ${overflow} more — run \`npx @rtorcato/repo-tooling fix\` to walk all findings`
		)
	} else if (lines.length > 0) {
		lines.push('Run `npx @rtorcato/repo-tooling fix` to walk all findings interactively')
	}
	return lines
}

export function summarize(results: CheckResult[]): {
	ok: number
	drift: number
	missing: number
	optionalMissing: number
	declared: number
} {
	return {
		ok: results.filter((r) => r.status === 'ok').length,
		drift: results.filter((r) => r.status === 'drift').length,
		missing: results.filter((r) => r.status === 'missing').length,
		optionalMissing: results.filter((r) => r.status === 'optional-missing').length,
		declared: results.filter((r) => r.status === 'declared').length,
	}
}

export async function doctorCommand(options: DoctorOptions = {}) {
	const dir = options.directory ?? process.cwd()
	const results = await runDoctor(dir, options.skillsDir)

	if (options.json) {
		console.log(JSON.stringify({ directory: path.resolve(dir), results }, null, 2))
	} else {
		console.log(chalk.cyan(`\n🩺 Diagnosing ${path.resolve(dir)} against ${PACKAGE} presets...\n`))
		for (const r of results) {
			console.log(`  ${STATUS_ICONS[r.status]} ${chalk.bold(r.check)} — ${statusLabel(r.status)}`)
			console.log(`     ${chalk.gray(r.detail)}`)
			if (r.hint && r.status !== 'ok') {
				console.log(`     ${chalk.dim('hint:')} ${chalk.dim(r.hint)}`)
			}
		}
		const summary = summarize(results)
		console.log()
		console.log(
			`  Summary: ${chalk.green(`${summary.ok} ok`)}, ${chalk.yellow(`${summary.drift} drift`)}, ${chalk.red(`${summary.missing} missing`)}, ${chalk.gray(`${summary.optionalMissing} not configured`)}, ${chalk.blue(`${summary.declared} declared`)}\n`
		)
		const suggestions = nextStepSuggestions(results, await detectLanguage(dir))
		if (suggestions.length > 0) {
			console.log(chalk.bold('  Next steps:'))
			for (const s of suggestions) {
				console.log(`    ${chalk.gray('-')} ${s}`)
			}
			console.log()
		}
	}

	const summary = summarize(results)
	const exitCode = summary.drift > 0 || summary.missing > 0 ? 1 : 0
	process.exitCode = exitCode
}
