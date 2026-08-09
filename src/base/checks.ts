import path from 'node:path'
import fs from 'fs-extra'
import { BADGE_START, hasPublicOnlyBadges } from '../cli/generators/badges.js'
import { type DetectedLanguage, detectNestedLanguages } from '../cli/utils/detect-language.js'
import type { CheckResult } from './types.js'

/**
 * Root-only detection is the decision (#317), not an oversight — but it used to
 * be a *silent* one: a Swift repo with a TypeScript docs app audited as Swift
 * and never mentioned the half it skipped. This says so.
 *
 * Always `ok`. Nesting a second language is a legitimate repo shape, so failing
 * on it would break every monorepo's CI to report a limitation of ours.
 */
export async function checkNestedLanguages(
	dir: string,
	rootLanguage: DetectedLanguage
): Promise<CheckResult> {
	const check = 'Monorepo'
	const nested = await detectNestedLanguages(dir, rootLanguage)
	if (nested.length === 0) {
		return { check, status: 'ok', detail: 'single-language repo' }
	}
	const summary = nested.map((n) => `${n.dir} (${n.language})`).join(', ')
	return {
		check,
		status: 'ok',
		detail: `auditing the root only — ${summary} ${nested.length === 1 ? 'is' : 'are'} not audited`,
		hint: 'Run doctor with `--directory <path>` to audit a nested project on its own',
	}
}

/**
 * "Is one of these files present, and does it look like ours?" — the shape most
 * config checks take, in any language. Lives in base so the JS and Swift modules
 * share one implementation instead of two regex-and-fs loops (#286).
 */
export interface FileCheck {
	check: string
	candidates: string[]
	/** Phrased to read after the filename: `.swiftlint.yml ${expected}`. */
	expected: string
	matcher: RegExp
	optional?: boolean
	hint?: string
}

export async function checkFile(dir: string, spec: FileCheck): Promise<CheckResult> {
	for (const candidate of spec.candidates) {
		const filepath = path.join(dir, candidate)
		if (!(await fs.pathExists(filepath))) continue

		const contents = await fs.readFile(filepath, 'utf-8')
		if (spec.matcher.test(contents)) {
			return {
				check: spec.check,
				status: 'ok',
				detail: `${candidate} ${spec.expected}`,
			}
		}
		return {
			check: spec.check,
			status: 'drift',
			detail: `${candidate} found but does not ${spec.expected}`,
			hint: spec.hint,
		}
	}

	return {
		check: spec.check,
		status: spec.optional ? 'optional-missing' : 'missing',
		detail: `no ${spec.candidates.join(' / ')} found`,
		hint: spec.hint,
	}
}

export async function checkEditorConfig(dir: string): Promise<CheckResult> {
	const exists = await fs.pathExists(path.join(dir, '.editorconfig'))
	return {
		check: 'EditorConfig',
		status: exists ? 'ok' : 'optional-missing',
		detail: exists ? '.editorconfig found' : 'no .editorconfig',
		hint: exists ? undefined : 'Add an .editorconfig for cross-editor formatting consistency',
	}
}

export async function checkCodeowners(dir: string): Promise<CheckResult> {
	for (const candidate of ['CODEOWNERS', '.github/CODEOWNERS', 'docs/CODEOWNERS']) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			return {
				check: 'CODEOWNERS',
				status: 'ok',
				detail: `${candidate} found`,
			}
		}
	}
	return {
		check: 'CODEOWNERS',
		status: 'optional-missing',
		detail: 'no CODEOWNERS file',
		hint: 'Run `npx @rtorcato/repo-tooling fix codeowners` to scaffold .github/CODEOWNERS',
	}
}

export async function checkCommunityHealth(dir: string): Promise<CheckResult> {
	const anchors = ['CONTRIBUTING.md', 'SECURITY.md']
	const present = await Promise.all(anchors.map((f) => fs.pathExists(path.join(dir, f))))
	if (present.every(Boolean)) {
		return {
			check: 'Community health',
			status: 'ok',
			detail: 'CONTRIBUTING.md and SECURITY.md found',
		}
	}
	return {
		check: 'Community health',
		status: 'optional-missing',
		detail: 'missing community-health files (CONTRIBUTING/SECURITY/templates)',
		hint: 'Run `npx @rtorcato/repo-tooling fix community-health` to scaffold them',
	}
}

/**
 * `org/action@vN`, the only form the generators emit. Same shape as the scan in
 * tests/cli/generators/action-pins.test.ts — major-only, because that's the
 * granularity every emitted pin uses.
 */
const ACTION_PIN = /\b([a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*)@v(\d+)/g

function actionPins(yaml: string): Map<string, string> {
	const pins = new Map<string, string>()
	for (const [, action, major] of yaml.matchAll(ACTION_PIN)) {
		if (action && major) pins.set(action, major)
	}
	return pins
}

/**
 * @param preset the ci.yml this repo's generator would render right now, or null
 * for a language whose CI generator isn't wired up. Supplied by the caller
 * rather than rendered here: the JS preset needs a ProjectConfig and the Swift
 * one needs Package.swift, neither of which belongs in a base check.
 */
export async function checkGitHubActions(
	dir: string,
	preset: string | null = null
): Promise<CheckResult> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) {
		return {
			check: 'GitHub Actions',
			status: 'optional-missing',
			detail: 'no .github/workflows/',
			hint: 'Run `npx @rtorcato/repo-tooling setup` to scaffold a CI workflow',
		}
	}

	try {
		const files = await fs.readdir(workflowsDir)
		const workflows = files.filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
		if (workflows.length === 0) {
			return {
				check: 'GitHub Actions',
				status: 'optional-missing',
				detail: '.github/workflows/ is empty',
				hint: 'Add a workflow file (e.g. ci.yml) under .github/workflows/',
			}
		}

		// "A workflow exists" said nothing about whether it still matches the preset,
		// so doctor reported ok on a ci.yml that had drifted arbitrarily far — the
		// blind half of #349/#340. Compare action pins rather than the whole file: a
		// consuming repo is *expected* to add jobs and steps, so a byte diff is noise
		// on every customized repo, while a pin major that disagrees with the preset
		// is exactly the drift that loops (a bump here, a sync there, forever).
		const ciPath = path.join(workflowsDir, 'ci.yml')
		if (preset && (await fs.pathExists(ciPath))) {
			const ours = actionPins(preset)
			const deltas: string[] = []
			for (const [action, major] of actionPins(await fs.readFile(ciPath, 'utf-8'))) {
				const expected = ours.get(action)
				// Only the intersection is comparable — an action the repo runs but the
				// preset never emits is the consumer's own business.
				if (expected && expected !== major) {
					deltas.push(`${action}@v${major} (preset emits @v${expected})`)
				}
			}
			if (deltas.length > 0) {
				return {
					check: 'GitHub Actions',
					status: 'drift',
					detail: `ci.yml action pins disagree with the preset: ${deltas.join('; ')}`,
					hint: 'Run `npx @rtorcato/repo-tooling fix github-actions --diff` to see the delta before overwriting — a pin *ahead* of the preset means regenerating would downgrade it',
				}
			}
		}

		return {
			check: 'GitHub Actions',
			status: 'ok',
			detail: `${workflows.length} workflow${workflows.length === 1 ? '' : 's'} in .github/workflows/`,
		}
	} catch {
		return {
			check: 'GitHub Actions',
			status: 'optional-missing',
			detail: 'unable to read .github/workflows/',
		}
	}
}

export async function checkDependabot(dir: string): Promise<CheckResult> {
	for (const candidate of ['.github/dependabot.yml', '.github/dependabot.yaml']) {
		const candidatePath = path.join(dir, candidate)
		if (await fs.pathExists(candidatePath)) {
			// The canonical standard (apps/docs/docs/guides/dependabot-strategy.md) is
			// the safe-tier + major-tier grouping plus the auto-merge workflow that
			// depends on it. Flag any config that predates it so `fix dependabot` can
			// bring the pair up to standard.
			const content = await fs.readFile(candidatePath, 'utf8')
			const deltas: string[] = []
			for (const group of ['production-minor', 'dev-minor', 'major-updates']) {
				if (!new RegExp(`^\\s*${group}:`, 'm').test(content)) {
					deltas.push(`missing \`${group}\` group`)
				}
			}
			const automergePath = path.join(dir, '.github', 'workflows', 'dependabot-automerge.yml')
			if (!(await fs.pathExists(automergePath))) {
				deltas.push('missing dependabot-automerge workflow')
			}
			if (deltas.length > 0) {
				return {
					check: 'Dependabot',
					status: 'drift',
					detail: `${candidate} drifts from canonical (${deltas.join('; ')})`,
					hint: 'Run `npx @rtorcato/repo-tooling fix dependabot` to apply the canonical grouping + auto-merge workflow',
				}
			}
			return {
				check: 'Dependabot',
				status: 'ok',
				detail: `${candidate} + auto-merge workflow`,
			}
		}
	}
	for (const candidate of [
		'renovate.json',
		'renovate.json5',
		'.github/renovate.json',
		'.github/renovate.json5',
		'.renovaterc',
		'.renovaterc.json',
	]) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			return {
				check: 'Dependabot',
				status: 'ok',
				detail: `${candidate} found (Renovate)`,
			}
		}
	}
	return {
		check: 'Dependabot',
		status: 'optional-missing',
		detail: 'no Dependabot or Renovate config',
		hint: 'Run `npx @rtorcato/repo-tooling fix dependabot` (or `fix renovate`) to scaffold weekly dep updates',
	}
}

export async function checkCodeQL(dir: string): Promise<CheckResult> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) {
		return {
			check: 'CodeQL',
			status: 'optional-missing',
			detail: 'no .github/workflows/',
			hint: 'Run `npx @rtorcato/repo-tooling fix codeql` to scaffold CodeQL security scanning',
		}
	}
	for (const candidate of ['codeql.yml', 'codeql.yaml']) {
		if (await fs.pathExists(path.join(workflowsDir, candidate))) {
			return {
				check: 'CodeQL',
				status: 'ok',
				detail: `.github/workflows/${candidate} found`,
			}
		}
	}
	try {
		const files = await fs.readdir(workflowsDir)
		for (const f of files) {
			if (!(f.endsWith('.yml') || f.endsWith('.yaml'))) continue
			const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
			if (/github\/codeql-action/.test(content)) {
				return {
					check: 'CodeQL',
					status: 'ok',
					detail: `codeql-action referenced in ${f}`,
				}
			}
		}
	} catch {
		// fall through to optional-missing
	}
	return {
		check: 'CodeQL',
		status: 'optional-missing',
		detail: 'no codeql workflow found',
		hint: 'Run `npx @rtorcato/repo-tooling fix codeql` to scaffold CodeQL security scanning',
	}
}

// A README that advertises a Codecov badge but a CI that never uploads coverage
// leaves the badge permanently red. Only flags when the badge is actually present
// (no badge → nothing to back, so it's not applicable).
export async function checkCoverageUpload(dir: string): Promise<CheckResult> {
	const readmePath = path.join(dir, 'README.md')
	const readme = (await fs.pathExists(readmePath)) ? await fs.readFile(readmePath, 'utf8') : ''
	if (!/codecov\.io/.test(readme)) {
		return {
			check: 'Coverage upload',
			status: 'ok',
			detail: 'no coverage badge in README (nothing to back)',
		}
	}

	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		try {
			const files = (await fs.readdir(workflowsDir)).filter(
				(f) => f.endsWith('.yml') || f.endsWith('.yaml')
			)
			for (const f of files) {
				const content = await fs.readFile(path.join(workflowsDir, f), 'utf-8')
				if (/codecov\/codecov-action/.test(content)) {
					return {
						check: 'Coverage upload',
						status: 'ok',
						detail: `coverage badge backed by codecov-action in .github/workflows/${f}`,
					}
				}
			}
		} catch {
			// fall through to drift
		}
	}

	return {
		check: 'Coverage upload',
		status: 'drift',
		detail: 'README has a Codecov badge but no CI step uploads coverage (badge stays red)',
		hint: 'Run `npx @rtorcato/repo-tooling fix github-actions` to regenerate ci.yml with a Codecov upload step',
	}
}

export async function checkAiSetup(dir: string): Promise<CheckResult> {
	// Consider AI setup present if AGENTS.md carries the js-tooling block or the
	// Claude skill is installed — the two primary markers `fix ai` writes.
	const agentsPath = path.join(dir, 'AGENTS.md')
	const hasAgentsBlock =
		(await fs.pathExists(agentsPath)) &&
		(await fs.readFile(agentsPath, 'utf8')).includes('<!-- js-tooling:start -->')
	const hasSkill =
		(await fs.pathExists(path.join(dir, '.claude', 'skills', 'repo-tooling.md'))) ||
		// Pre-rename name — still counts as present until `fix` migrates it.
		(await fs.pathExists(path.join(dir, '.claude', 'skills', 'js-tooling.md')))
	if (hasAgentsBlock || hasSkill) {
		return {
			check: 'AI setup',
			status: 'ok',
			detail: hasAgentsBlock ? 'AGENTS.md has the js-tooling block' : '.claude skill installed',
		}
	}
	return {
		check: 'AI setup',
		status: 'optional-missing',
		detail: 'no AI agent files (AGENTS.md, CLAUDE.md, Cursor/Copilot rules, Claude skill)',
		hint: 'Run `npx @rtorcato/repo-tooling fix ai` to scaffold agent rules for every AI tool',
	}
}

/**
 * Conventional Commits is a repo convention, not a JavaScript one — the config
 * file is the same in any repo that has node available to run commitlint, so
 * the spec lives here rather than in the JS module's FILE_CHECKS (#309).
 */
export const COMMITLINT_FILE_CHECK: FileCheck = {
	check: 'Commitlint',
	candidates: ['commitlint.config.js', 'commitlint.config.mjs', 'commitlint.config.cjs'],
	expected: 'exports "@rtorcato/repo-tooling/commitlint/config"',
	matcher: /@rtorcato\/(?:js|repo)-tooling\/commitlint\/config/,
	optional: true,
}

/**
 * How one language wires git hooks (#309). Hooks and a pre-push gate are repo
 * concerns — the *evidence* differs per language, the requirement doesn't — so
 * the check bodies live here and each module supplies the shape.
 */
export interface GitHooksProfile {
	/** Committed hooks directory this language's tooling installs into. */
	dir: string
	/**
	 * Committed wiring that makes git run the hooks on a fresh clone, or null
	 * when the language has none. Swift points git at `.githooks` with
	 * `core.hooksPath` — per-clone local config, not repo drift — so it passes
	 * null rather than making doctor fail CI on an unconfigured checkout.
	 */
	install: { present: boolean; label: string } | null
	/** The gate a pre-push hook must run — and what the check greps for. */
	verifyCommand: string
	/** `fix` target that scaffolds/aligns the hooks. */
	fixTarget: string
}

/**
 * True when a shell hook has an uncommented line matching `pattern`. A
 * commented-out line (e.g. `# pnpm verify`) doesn't count — the command never
 * runs, so it isn't real wiring.
 */
export function hookHasUncommented(contents: string, pattern: RegExp): boolean {
	return contents.split('\n').some((line) => {
		const trimmed = line.trim()
		return trimmed.length > 0 && !trimmed.startsWith('#') && pattern.test(trimmed)
	})
}

/** `swift test` → /\bswift\s+test\b/, so extra whitespace in a hook still matches. */
function commandMatcher(command: string): RegExp {
	const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+')
	return new RegExp(`\\b${escaped}\\b`)
}

export async function checkGitHooks(dir: string, p: GitHooksProfile): Promise<CheckResult> {
	const check = 'Git hooks'
	const hint = `Run \`npx @rtorcato/repo-tooling fix ${p.fixTarget}\` to enable git hooks`
	const hooksDir = await fs.pathExists(path.join(dir, p.dir))
	// With no committed install signal, the hooks directory itself is the whole
	// answer — there's no second half that can drift out of sync with it.
	const installed = p.install === null ? hooksDir : p.install.present

	if (hooksDir && installed) {
		return {
			check,
			status: 'ok',
			detail: p.install ? `${p.dir}/ and ${p.install.label} configured` : `${p.dir}/ found`,
		}
	}
	if (hooksDir || installed) {
		return {
			check,
			status: 'drift',
			detail: hooksDir
				? `${p.dir}/ exists but no ${p.install?.label}`
				: `${p.install?.label} set but no ${p.dir}/ directory`,
			hint: `${hint} (scaffolds both halves)`,
		}
	}
	return { check, status: 'optional-missing', detail: 'git hooks not configured', hint }
}

/**
 * The pre-push gate. Only asserts that the hook runs the language's verify
 * command — whether that command itself is well-formed is the language module's
 * business (JS keeps a `verify script` check for exactly that).
 */
export async function checkPrePushHook(dir: string, p: GitHooksProfile): Promise<CheckResult> {
	const check = 'Pre-push hook'
	if (!(await fs.pathExists(path.join(dir, p.dir)))) {
		return {
			check,
			status: 'optional-missing',
			detail: 'git hooks not configured',
			hint: `Run \`npx @rtorcato/repo-tooling fix ${p.fixTarget}\` to enable git hooks (includes pre-push)`,
		}
	}
	const hookPath = path.join(dir, p.dir, 'pre-push')
	if (!(await fs.pathExists(hookPath))) {
		return {
			check,
			status: 'optional-missing',
			detail: `no ${p.dir}/pre-push`,
			hint: `Run \`npx @rtorcato/repo-tooling fix ${p.fixTarget}\` to scaffold a pre-push hook that runs \`${p.verifyCommand}\``,
		}
	}
	const contents = await fs.readFile(hookPath, 'utf-8')
	if (hookHasUncommented(contents, commandMatcher(p.verifyCommand))) {
		return { check, status: 'ok', detail: `${p.dir}/pre-push runs \`${p.verifyCommand}\`` }
	}
	return {
		check,
		status: 'drift',
		detail: `${p.dir}/pre-push exists but does not run \`${p.verifyCommand}\``,
		hint: `Run \`npx @rtorcato/repo-tooling fix ${p.fixTarget}\` to align the hook with \`${p.verifyCommand}\``,
	}
}

/**
 * Who the README's badges are for. The language module decides: a private npm
 * package and a SwiftPM library disagree on whether npm/coverage badges would
 * 404, but "does the README carry status badges" is the same question either way.
 */
export type BadgeAudience = 'public' | 'private' | 'not-applicable'

export async function checkReadmeBadges(
	dir: string,
	audience: BadgeAudience,
	/** `fix` target that rebuilds the badge block, or null when the language has none. */
	fixTarget: string | null
): Promise<CheckResult> {
	const check = 'README badges'
	const hint = fixTarget
		? `Run \`npx @rtorcato/repo-tooling fix ${fixTarget}\` to add CI/npm/coverage/license badges`
		: 'Add CI and license badges to README.md'
	const readmePath = path.join(dir, 'README.md')
	const readme = (await fs.pathExists(readmePath)) ? await fs.readFile(readmePath, 'utf8') : ''

	if (audience === 'private') {
		// Only a problem if a private/app repo carries badges that would 404.
		if (readme && hasPublicOnlyBadges(readme)) {
			return {
				check,
				status: 'drift',
				detail: 'README has npm/coverage badges but the package is private (they 404)',
				hint: fixTarget
					? `Run \`npx @rtorcato/repo-tooling fix ${fixTarget}\` to rebuild badges for a private repo`
					: 'Remove the npm/coverage badges — they 404 for a private package',
			}
		}
		return { check, status: 'ok', detail: 'not applicable (private package)' }
	}
	if (audience === 'not-applicable') {
		return { check, status: 'ok', detail: 'not applicable (no published exports)' }
	}

	const hasBadges =
		readme.includes(BADGE_START) ||
		/img\.shields\.io|badge\.svg|badge\.fury\.io|codecov\.io/.test(readme)
	if (hasBadges) {
		return { check, status: 'ok', detail: 'README carries status badges' }
	}
	return { check, status: 'optional-missing', detail: 'no status badges in README', hint }
}

export async function checkGitLabCI(dir: string): Promise<CheckResult> {
	for (const candidate of ['.gitlab-ci.yml', '.gitlab-ci.yaml']) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			return {
				check: 'GitLab CI',
				status: 'ok',
				detail: `${candidate} found`,
			}
		}
	}
	return {
		check: 'GitLab CI',
		status: 'optional-missing',
		detail: 'no .gitlab-ci.yml',
		hint: 'Run `npx @rtorcato/repo-tooling fix gitlab-ci` to scaffold a starter GitLab pipeline',
	}
}
