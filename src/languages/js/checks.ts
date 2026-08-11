import path from 'node:path'
import fs from 'fs-extra'
import type { BadgeAudience, FileCheck, GitHooksProfile } from '../../base/checks.js'
import { hookHasUncommented } from '../../base/checks.js'
import {
	CLAUDE_SETTINGS_FILE,
	readClaudeSettings,
	worktreeSymlinkDirs,
} from '../../cli/generators/agent-rules.js'
import {
	WORKSPACE_FILE,
	dependsOnEsbuild,
	familyGlob,
	missingPnpmSettings,
} from '../../cli/generators/pnpm-workspace.js'
import type { CheckResult } from '../../base/types.js'

const PACKAGE = '@rtorcato/repo-tooling'

const NODE_MIN_MAJOR = 22
const NODE_LTS_REQUIREMENTS: Record<number, { minor: number; patch: number }> = {
	22: { minor: 22, patch: 2 },
	24: { minor: 15, patch: 0 },
}

function parseNodeVersion(version: string): [number, number, number] {
	const clean = version.replace(/^v/, '').split('-')[0] ?? ''
	const [maj, min, pat] = clean.split('.').map((n) => Number.parseInt(n, 10) || 0)
	return [maj ?? 0, min ?? 0, pat ?? 0]
}

export function evaluateNodeVersion(version: string): CheckResult {
	const [major, minor, patch] = parseNodeVersion(version)
	const display = `v${major}.${minor}.${patch}`

	if (major < NODE_MIN_MAJOR) {
		return {
			check: 'Node',
			status: 'missing',
			detail: `${display} is below required Node ${NODE_MIN_MAJOR}+`,
			hint: `Install Node ${NODE_MIN_MAJOR} LTS or newer (https://nodejs.org)`,
		}
	}

	const lts = NODE_LTS_REQUIREMENTS[major]
	if (lts) {
		const meets = minor > lts.minor || (minor === lts.minor && patch >= lts.patch)
		if (!meets) {
			return {
				check: 'Node',
				status: 'drift',
				detail: `${display} — npm may emit EBADENGINE warnings from transitive deps`,
				hint: `Upgrade to Node ${major}.${lts.minor}.${lts.patch}+ (or 26+) to silence transitive engine warnings`,
			}
		}
	}

	return {
		check: 'Node',
		status: 'ok',
		detail: display,
	}
}

/**
 * JSONC → object, or null when it genuinely won't parse. `biome.jsonc` is a
 * declared candidate and the format allows comments and trailing commas, so
 * bare `JSON.parse` would reject configs Biome itself accepts.
 *
 * The first alternative consumes whole string literals, so a `//` or `/*`
 * inside one (a `$schema` URL, most obviously) is never mistaken for a comment.
 */
function parseJsonc(text: string): Record<string, any> | null {
	const withoutComments = text.replace(
		/("(?:\\.|[^"\\])*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g,
		(_, str: string | undefined) => str ?? ''
	)
	try {
		return JSON.parse(withoutComments.replace(/,(\s*[}\]])/g, '$1')) as Record<string, any>
	} catch {
		return null
	}
}

const BIOME_PRESET_REF = /@rtorcato\/(?:js|repo)-tooling\/biome/

/**
 * Both shapes of a `biome.json` this package produces (#378): the thin
 * `extends` pointer `fix biome` writes, and the whole preset inlined, which is
 * what `copy biome` drops — it carries no `extends` at all, so matching only
 * the first left every `copy biome` repo permanently drifted with no way out.
 *
 * Read structurally, not as text. Accepting the inline form on the presence of
 * a `$schema` URL and a `preset` key alone would pass a config that keeps both
 * markers and turns the linter off — the very drift this check exists to catch
 * — and the markers could even sit in a `biome.jsonc` comment. So the config is
 * parsed, `linter.enabled: false` disqualifies either shape, and anything
 * unparseable counts as drift rather than being waved through.
 */
function matchesBiomeConfig(contents: string): boolean {
	const config = parseJsonc(contents)
	if (!config) return false

	const linter = config.linter as { enabled?: unknown; rules?: Record<string, unknown> } | undefined
	if (linter?.enabled === false) return false

	if (BIOME_PRESET_REF.test(JSON.stringify(config.extends ?? ''))) return true

	// The inlined preset: biome's own `$schema` plus the `linter.rules.preset`
	// key the shipped `tooling/biome/biome.json` sets.
	const schema = config.$schema
	return (
		typeof schema === 'string' &&
		schema.includes('biomejs.dev/schemas/') &&
		linter?.rules?.preset !== undefined
	)
}

const TS_PRESET_REF = /@rtorcato\/(?:js|repo)-tooling\/typescript\//

/**
 * Options `tooling/typescript/tsconfig.base.json` sets that a tsconfig written
 * by hand is unlikely to carry all of. `strict` alone is far too common to
 * conclude anything from.
 */
const TS_PRESET_STRICTNESS = [
	'strict',
	'noUncheckedIndexedAccess',
	'noImplicitOverride',
	'noPropertyAccessFromIndexSignature',
] as const

/**
 * `strict` and every flag it implies. TypeScript lets any one of these be
 * switched off individually while `strict: true` is still literally present —
 * the explicit override wins — so a config can keep every marker this check
 * looks for and still ship with type safety off. Any of them explicitly
 * `false` is drift.
 */
const TS_STRICT_FLAGS = [
	'strict',
	'noImplicitAny',
	'strictNullChecks',
	'strictFunctionTypes',
	'strictBindCallApply',
	'strictPropertyInitialization',
	'noImplicitThis',
	'useUnknownInCatchVariables',
	'alwaysStrict',
] as const

/**
 * The same two shapes as `matchesBiomeConfig`, for the same reason (#385): the
 * `extends` pointer `fix tsconfig` writes, and the whole preset inlined, which
 * is what `copy tsconfig` drops — `tooling/typescript/tsconfig.base.json` *is*
 * the preset, so it names it nowhere, and every `copy tsconfig` repo was
 * reported as drifted with no way out. This check isn't optional, so that read
 * as a real problem rather than an optional one.
 *
 * Structural rather than textual, and for the same reason: `strict: false` is
 * drift whichever shape the config takes, a marker sitting in a comment proves
 * nothing, and unparseable counts as drift rather than being waved through.
 */
function matchesTsConfig(contents: string): boolean {
	const config = parseJsonc(contents)
	if (!config) return false

	const compilerOptions = (config.compilerOptions ?? {}) as Record<string, unknown>
	// Naming the preset and then switching strictness off is precisely the drift
	// this check exists to catch, so it disqualifies either shape — `strict`
	// itself or any single flag it implies.
	if (TS_STRICT_FLAGS.some((key) => compilerOptions[key] === false)) return false

	if (TS_PRESET_REF.test(JSON.stringify(config.extends ?? ''))) return true

	// The inlined preset: a `${configDir}`-anchored rootDir — how a preset meant
	// to be extended resolves against the consuming repo — plus the strict block
	// the shipped preset sets.
	const rootDir = compilerOptions.rootDir
	return (
		typeof rootDir === 'string' &&
		rootDir.includes('${configDir}') &&
		TS_PRESET_STRICTNESS.every((key) => compilerOptions[key] === true)
	)
}

export const FILE_CHECKS: FileCheck[] = [
	{
		check: 'TypeScript',
		candidates: ['tsconfig.json'],
		expected: `extends "${PACKAGE}/typescript/*" or inlines the preset, with strict on`,
		matcher: matchesTsConfig,
		hint: 'Run `npx @rtorcato/repo-tooling fix tsconfig` to scaffold',
	},
	{
		check: 'Biome',
		candidates: ['biome.json', 'biome.jsonc'],
		expected: `extends "${PACKAGE}/biome" or inlines the preset, with the linter on`,
		matcher: matchesBiomeConfig,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling fix biome` to scaffold',
	},
	{
		check: 'ESLint',
		candidates: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'],
		expected: `imports "${PACKAGE}/eslint/*"`,
		matcher: /@rtorcato\/(?:js|repo)-tooling\/eslint\//,
		optional: true,
		hint: 'Import from @rtorcato/repo-tooling/eslint/base in eslint.config.mjs',
	},
	{
		check: 'Prettier',
		candidates: ['prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs'],
		expected: `imports "${PACKAGE}/prettier"`,
		matcher: /@rtorcato\/(?:js|repo)-tooling\/prettier/,
		optional: true,
		hint: `Re-export from "${PACKAGE}/prettier" in prettier.config.mjs`,
	},
	{
		check: 'Vitest',
		candidates: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'],
		expected: `imports "${PACKAGE}/vitest/config"`,
		matcher: /@rtorcato\/(?:js|repo)-tooling\/vitest\/config/,
		optional: true,
	},
	{
		check: 'Oxlint',
		candidates: ['.oxlintrc.json', 'oxlintrc.json'],
		// Oxlint configs are project-owned (extends from npm packages isn't
		// reliably supported), so any well-formed file counts as ok.
		expected: 'is a valid Oxlint configuration',
		matcher: /"(rules|plugins|categories|extends)"/,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling copy oxlint` to scaffold',
	},
	{
		check: 'Changesets',
		candidates: ['.changeset/config.json'],
		expected: 'is a valid Changesets configuration',
		matcher: /"(changelog|access|baseBranch)"/,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling copy changesets` to scaffold',
	},
	{
		check: 'Release Please',
		candidates: ['release-please-config.json'],
		expected: 'is a valid Release Please configuration',
		matcher: /"(packages|release-type|bootstrap-sha)"/,
		optional: true,
		hint: 'Run `npx @rtorcato/repo-tooling fix release-please` to scaffold',
	},
]

export type Pkg = Record<string, unknown>

/** Merged dependencies + devDependencies of a package.json, for presence checks. */
export function allDeps(pkg: Pkg | null): Record<string, string> {
	if (!pkg) return {}
	return {
		...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
	}
}

export async function readPackageJson(dir: string): Promise<Pkg | null> {
	const filepath = path.join(dir, 'package.json')
	if (!(await fs.pathExists(filepath))) return null
	try {
		return (await fs.readJson(filepath)) as Pkg
	} catch {
		return null
	}
}

export function checkPackageJson(pkg: Pkg | null): CheckResult {
	if (!pkg) {
		return {
			check: 'package.json',
			status: 'missing',
			detail: 'no package.json found',
		}
	}

	const deps = {
		...((pkg.dependencies as Record<string, string>) ?? {}),
		...((pkg.devDependencies as Record<string, string>) ?? {}),
	}

	if (deps[PACKAGE]) {
		return {
			check: 'package.json',
			status: 'ok',
			detail: `${PACKAGE}@${deps[PACKAGE]} in dependencies`,
		}
	}

	return {
		check: 'package.json',
		status: 'drift',
		detail: `${PACKAGE} not in dependencies or devDependencies`,
		hint: `Run \`pnpm add -D ${PACKAGE}\``,
	}
}

/**
 * Whether the repo installs with pnpm. Three independent signals, any of which
 * is enough: the workspace file, the lockfile, or a `packageManager` that
 * already names pnpm. Shared so `packageManager` and `pnpm settings` agree on
 * what "a pnpm repo" means.
 */
export async function usesPnpm(dir: string, pkg: Pkg | null): Promise<boolean> {
	return (
		(await fs.pathExists(path.join(dir, WORKSPACE_FILE))) ||
		(await fs.pathExists(path.join(dir, 'pnpm-lock.yaml'))) ||
		((pkg?.packageManager as string | undefined) ?? '').startsWith('pnpm')
	)
}

/**
 * `packageManager` pins the pnpm that `pnpm/action-setup` resolves (#364). The
 * generated workflow passes no `version:` input, so a pnpm repo without this
 * field fails CI at setup — before a single check runs (#372).
 */
export async function checkPackageManager(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const check = 'packageManager'
	if (!(await usesPnpm(dir, pkg))) {
		return { check, status: 'ok', detail: 'not a pnpm repo' }
	}
	const declared = (pkg?.packageManager as string | undefined) ?? ''
	if (declared.trim() !== '') {
		return { check, status: 'ok', detail: `packageManager = ${declared}` }
	}
	return {
		check,
		status: 'drift',
		detail: 'packageManager not set in package.json',
		hint: `Run \`npx ${PACKAGE} fix engines\` to pin the pnpm version CI resolves`,
	}
}

export function checkEnginesNode(pkg: Pkg | null): CheckResult {
	if (!pkg) {
		return {
			check: 'engines.node',
			status: 'missing',
			detail: 'no package.json',
		}
	}
	const engines = (pkg.engines as Record<string, string> | undefined) ?? {}
	if (!engines.node) {
		return {
			check: 'engines.node',
			status: 'drift',
			detail: 'engines.node not set in package.json',
			hint: `Add \`"engines": { "node": ">=${NODE_MIN_MAJOR}" }\` to package.json`,
		}
	}
	return {
		check: 'engines.node',
		status: 'ok',
		detail: `engines.node = ${engines.node}`,
	}
}

// Maps a present tool-config file to the VS Code extension that should be
// recommended for it. Mirrors recommendedExtensions() in the generator, but
// keyed off files on disk (doctor audits an existing repo, not a config object).
const EXTENSION_SIGNALS: Array<{ candidates: string[]; ext: string }> = [
	{ candidates: ['.editorconfig'], ext: 'EditorConfig.EditorConfig' },
	{ candidates: ['biome.json', 'biome.jsonc'], ext: 'biomejs.biome' },
	{
		candidates: ['eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs'],
		ext: 'dbaeumer.vscode-eslint',
	},
	{
		candidates: ['prettier.config.js', 'prettier.config.mjs', 'prettier.config.cjs'],
		ext: 'esbenp.prettier-vscode',
	},
	{ candidates: ['.oxlintrc.json', 'oxlintrc.json'], ext: 'oxc.oxc-vscode' },
	{
		candidates: ['vitest.config.ts', 'vitest.config.js', 'vitest.config.mjs'],
		ext: 'vitest.explorer',
	},
	{ candidates: ['playwright.config.ts', 'playwright.config.js'], ext: 'ms-playwright.playwright' },
]

export async function checkVscodeExtensions(dir: string): Promise<CheckResult> {
	const wanted: string[] = []
	for (const { candidates, ext } of EXTENSION_SIGNALS) {
		for (const c of candidates) {
			if (await fs.pathExists(path.join(dir, c))) {
				wanted.push(ext)
				break
			}
		}
	}
	if (wanted.length === 0) {
		return {
			check: 'VS Code extensions',
			status: 'ok',
			detail: 'no tool configs that map to an editor extension',
		}
	}

	let recommended: string[] = []
	const extPath = path.join(dir, '.vscode', 'extensions.json')
	if (await fs.pathExists(extPath)) {
		try {
			const json = (await fs.readJson(extPath)) as { recommendations?: unknown }
			if (Array.isArray(json.recommendations)) {
				recommended = json.recommendations.filter((r): r is string => typeof r === 'string')
			}
		} catch {
			recommended = []
		}
	}

	const missing = wanted.filter((ext) => !recommended.includes(ext))
	if (missing.length === 0) {
		return {
			check: 'VS Code extensions',
			status: 'ok',
			detail: '.vscode/extensions.json recommends the matching extensions',
		}
	}
	return {
		check: 'VS Code extensions',
		status: 'optional-missing',
		detail: `enabled tools without a recommended extension: ${missing.join(', ')}`,
		hint: 'Run `npx @rtorcato/repo-tooling fix vscode-extensions` to recommend matching editor extensions',
	}
}

export async function checkNodeVersionPin(dir: string): Promise<CheckResult> {
	for (const candidate of ['.nvmrc', '.node-version']) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			return {
				check: 'Node version pin',
				status: 'ok',
				detail: `${candidate} found`,
			}
		}
	}
	return {
		check: 'Node version pin',
		status: 'optional-missing',
		detail: 'no .nvmrc / .node-version',
		hint: 'Add .nvmrc to pin Node version per repo (e.g. `echo 22 > .nvmrc`)',
	}
}

interface NodeSignal {
	source: string
	major: number
}

/** First integer in an `engines.node` range (the floor major), or null. */
function enginesFloorMajor(pkg: Pkg | null): number | null {
	const engines = (pkg?.engines as Record<string, string> | undefined) ?? {}
	const raw = engines.node
	if (!raw) return null
	const m = raw.match(/\d+/)
	return m ? Number.parseInt(m[0], 10) : null
}

async function nvmrcMajor(dir: string): Promise<{ file: string; major: number } | null> {
	for (const candidate of ['.nvmrc', '.node-version']) {
		const p = path.join(dir, candidate)
		if (await fs.pathExists(p)) {
			const m = (await fs.readFile(p, 'utf-8')).trim().match(/\d+/)
			if (m) return { file: candidate, major: Number.parseInt(m[0], 10) }
		}
	}
	return null
}

// Matches a hardcoded scalar `node-version: <major>` — a leading digit (after
// an optional quote) is required. This skips matrix arrays (`[22, 24]`),
// `${{ matrix.node-version }}` expressions, bare `node-version:` input keys, and
// `node-version-file:` (a different key entirely) — those aren't drift signals.
const HARDCODED_NODE_VERSION = /node-version:\s*['"]?(\d+)/g

async function workflowNodeMajors(dir: string): Promise<NodeSignal[]> {
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (!(await fs.pathExists(workflowsDir))) return []
	let files: string[]
	try {
		files = (await fs.readdir(workflowsDir)).filter(
			(f) => f.endsWith('.yml') || f.endsWith('.yaml')
		)
	} catch {
		return []
	}
	const signals: NodeSignal[] = []
	for (const file of files) {
		const contents = await fs.readFile(path.join(workflowsDir, file), 'utf-8')
		const seen = new Set<number>()
		for (const match of contents.matchAll(HARDCODED_NODE_VERSION)) {
			const major = Number.parseInt(match[1] ?? '', 10)
			if (!Number.isNaN(major) && !seen.has(major)) {
				seen.add(major)
				signals.push({ source: `.github/workflows/${file}`, major })
			}
		}
	}
	return signals
}

// Root-cause check for the #94 class: a workflow hardcoding a Node major that
// disagrees with .nvmrc / engines.node (e.g. ci.yml pinned Node 20 while
// .nvmrc said 22 → node:sqlite crash under pnpm). Only flags genuine
// disagreement; a matrix that tests several majors uses arrays/expressions and
// is not counted.
export async function checkNodeVersionConsistency(
	dir: string,
	pkg: Pkg | null
): Promise<CheckResult> {
	const signals: NodeSignal[] = []
	const nvmrc = await nvmrcMajor(dir)
	if (nvmrc) signals.push({ source: nvmrc.file, major: nvmrc.major })
	const eng = enginesFloorMajor(pkg)
	if (eng !== null) signals.push({ source: 'engines.node', major: eng })
	signals.push(...(await workflowNodeMajors(dir)))

	if (signals.length < 2) {
		return {
			check: 'Node version consistency',
			status: 'ok',
			detail:
				signals.length === 0
					? 'no Node version pins to cross-check'
					: `single Node version source (${signals[0]?.source} → ${signals[0]?.major})`,
		}
	}

	const distinct = [...new Set(signals.map((s) => s.major))]
	if (distinct.length === 1) {
		return {
			check: 'Node version consistency',
			status: 'ok',
			detail: `Node ${distinct[0]} agrees across ${signals.length} sources`,
		}
	}

	const summary = signals.map((s) => `${s.source}→${s.major}`).join(', ')
	return {
		check: 'Node version consistency',
		status: 'drift',
		detail: `Node major disagreement: ${summary}`,
		hint: 'Run `npx @rtorcato/repo-tooling fix node-version` to point workflows at `node-version-file: .nvmrc` (one source of truth)',
	}
}

/**
 * The JS shape of the base `Git hooks` / `Pre-push hook` checks (#309): husky,
 * installed by the `prepare` script so a fresh clone wires the hooks on
 * `pnpm install`.
 */
export function jsGitHooksProfile(pkg: Pkg | null): GitHooksProfile {
	const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {}
	return {
		dir: '.husky',
		install: {
			present: /\bhusky\b/.test(scripts.prepare ?? ''),
			label: '`prepare: husky` script',
		},
		verifyCommand: 'pnpm verify',
		fixTarget: 'husky',
	}
}

export async function checkVerifyScript(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	if (!pkg) {
		return {
			check: 'verify script',
			status: 'missing',
			detail: 'no package.json',
		}
	}
	const scripts = (pkg.scripts as Record<string, string> | undefined) ?? {}
	const body = scripts.verify
	if (!body) {
		return {
			check: 'verify script',
			status: 'optional-missing',
			detail: 'no `verify` script in package.json',
			hint: 'Run `npx @rtorcato/repo-tooling fix verify` to add a unified `pnpm verify` script',
		}
	}

	// Lenient: only flag drift when an enabled tool is clearly absent from the script body.
	const deps = {
		...((pkg.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	const missing: string[] = []
	if (scripts.typecheck && !/\btypecheck\b/.test(body)) missing.push('typecheck')
	if ((scripts.check || deps['@biomejs/biome']) && !/\b(check|biome|lint)\b/.test(body)) {
		missing.push('lint/check')
	}
	if ((deps.vitest || scripts.test) && !/(vitest|jest|test:e2e|pnpm\s+test)/.test(body)) {
		missing.push('tests')
	}
	const hasTreeshakeApp = await fs.pathExists(
		path.join(dir, 'apps', 'treeshake-check', 'check.mjs')
	)
	if (hasTreeshakeApp && !/\btreeshake\b/.test(body)) missing.push('treeshake')

	if (missing.length > 0) {
		return {
			check: 'verify script',
			status: 'drift',
			detail: `\`verify\` script is missing: ${missing.join(', ')}`,
			hint: 'Run `npx @rtorcato/repo-tooling fix verify` to regenerate the verify chain',
		}
	}
	return {
		check: 'verify script',
		status: 'ok',
		detail: `\`verify\` = ${body}`,
	}
}

const LINT_STAGED_FILES = [
	'.lintstagedrc',
	'.lintstagedrc.json',
	'.lintstagedrc.yaml',
	'.lintstagedrc.yml',
	'.lintstagedrc.js',
	'.lintstagedrc.cjs',
	'.lintstagedrc.mjs',
	'lint-staged.config.js',
	'lint-staged.config.cjs',
	'lint-staged.config.mjs',
]

/**
 * True when any .husky hook has an uncommented line that invokes lint-staged.
 * A commented-out `# npx lint-staged` line (react-common's repro) does not
 * count — lint-staged never actually runs.
 */
async function huskyHookCallsLintStaged(dir: string): Promise<boolean> {
	const huskyDir = path.join(dir, '.husky')
	if (!(await fs.pathExists(huskyDir))) return false
	for (const name of await fs.readdir(huskyDir)) {
		const hookPath = path.join(huskyDir, name)
		if (!(await fs.stat(hookPath)).isFile()) continue
		const contents = await fs.readFile(hookPath, 'utf-8')
		if (hookHasUncommented(contents, /\blint-staged\b/)) return true
	}
	return false
}

export async function checkLintStaged(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const inPkg = pkg ? 'lint-staged' in pkg : false
	let inFile: string | null = null
	for (const candidate of LINT_STAGED_FILES) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			inFile = candidate
			break
		}
	}

	if (inPkg || inFile) {
		const where = inPkg ? '`lint-staged` field in package.json' : `${inFile} found`
		// Config presence isn't enough — verify a husky hook actually runs it.
		// Only assert wiring when husky is in use; a non-husky setup may invoke
		// lint-staged another way and shouldn't be flagged.
		const huskyInUse = await fs.pathExists(path.join(dir, '.husky'))
		if (huskyInUse && !(await huskyHookCallsLintStaged(dir))) {
			return {
				check: 'lint-staged',
				status: 'drift',
				detail: `${where} but no husky hook runs it`,
				hint: 'Run `npx @rtorcato/repo-tooling fix husky` to wire lint-staged into the pre-commit hook',
			}
		}
		return {
			check: 'lint-staged',
			status: 'ok',
			detail: where,
		}
	}
	return {
		check: 'lint-staged',
		status: 'optional-missing',
		detail: 'lint-staged not configured',
		hint: 'Add a `lint-staged` field to package.json and wire it into the husky pre-commit hook',
	}
}

const KNIP_FILES = [
	'knip.json',
	'knip.jsonc',
	'knip.ts',
	'knip.config.ts',
	'knip.config.js',
	'knip.config.mjs',
]

export async function checkKnip(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const inPkg = pkg ? 'knip' in pkg : false
	let inFile: string | null = null
	for (const candidate of KNIP_FILES) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			inFile = candidate
			break
		}
	}

	if (inPkg || inFile) {
		return {
			check: 'knip',
			status: 'ok',
			detail: inPkg ? '`knip` field in package.json' : `${inFile} found`,
		}
	}
	return {
		check: 'knip',
		status: 'optional-missing',
		detail: 'knip not configured',
		hint: 'Add `knip` to detect unused files, deps, and exports',
	}
}

const SIZE_LIMIT_FILES = [
	'.size-limit.json',
	'.size-limit.js',
	'.size-limit.cjs',
	'.size-limit.mjs',
	'.size-limit.ts',
]

export async function checkSizeLimit(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const inPkg = pkg ? 'size-limit' in pkg : false
	let inFile: string | null = null
	for (const candidate of SIZE_LIMIT_FILES) {
		if (await fs.pathExists(path.join(dir, candidate))) {
			inFile = candidate
			break
		}
	}

	if (inPkg || inFile) {
		return {
			check: 'size-limit',
			status: 'ok',
			detail: inPkg ? '`size-limit` field in package.json' : `${inFile} found`,
		}
	}
	return {
		check: 'size-limit',
		status: 'optional-missing',
		detail: 'size-limit not configured',
		hint: 'Add `size-limit` to enforce bundle-size budgets in CI for library projects',
	}
}

const SEMANTIC_RELEASE_FILES = [
	'.releaserc',
	'.releaserc.json',
	'.releaserc.yaml',
	'.releaserc.yml',
	'.releaserc.js',
	'.releaserc.cjs',
	'release.config.js',
	'release.config.cjs',
	'release.config.mjs',
]

export async function checkSemanticRelease(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const isPrivate = pkg?.private === true
	const inPkg = pkg ? 'release' in pkg : false

	let configFile: string | null = null
	let configContent: string | null = null
	for (const candidate of SEMANTIC_RELEASE_FILES) {
		const filepath = path.join(dir, candidate)
		if (await fs.pathExists(filepath)) {
			configFile = candidate
			try {
				configContent = await fs.readFile(filepath, 'utf-8')
			} catch {
				configContent = ''
			}
			break
		}
	}

	const hasChangesets = await fs.pathExists(path.join(dir, '.changeset', 'config.json'))
	const hasReleasePlease = await fs.pathExists(path.join(dir, 'release-please-config.json'))
	const hasSemanticRelease = inPkg || !!configFile

	// Conflict: more than one of {semantic-release, Changesets, Release Please}.
	const configured = [
		hasSemanticRelease && 'semantic-release',
		hasChangesets && 'Changesets',
		hasReleasePlease && 'Release Please',
	].filter((v): v is string => Boolean(v))
	if (configured.length >= 2) {
		return {
			check: 'semantic-release',
			status: 'drift',
			detail: `multiple release tools configured (${configured.join(', ')})`,
			hint: 'Pick one release tool — remove the extra config(s)',
		}
	}

	if (!hasSemanticRelease) {
		// Another release tool is present — treat semantic-release as intentionally unused.
		if (hasChangesets || hasReleasePlease) {
			return {
				check: 'semantic-release',
				status: 'ok',
				detail: `using ${hasChangesets ? 'Changesets' : 'Release Please'} instead`,
			}
		}
		return {
			check: 'semantic-release',
			status: isPrivate ? 'optional-missing' : 'drift',
			detail: isPrivate
				? 'semantic-release not configured (package is private)'
				: 'semantic-release not configured',
			hint: isPrivate
				? undefined
				: `Extend "${PACKAGE}/semantic-release" or "${PACKAGE}/semantic-release/github" in a release config`,
		}
	}

	const presetRegex = /@rtorcato\/(?:js|repo)-tooling\/semantic-release/
	const pkgReleaseStr = inPkg ? JSON.stringify(pkg?.release ?? '') : ''
	const usesPreset =
		(configContent && presetRegex.test(configContent)) || presetRegex.test(pkgReleaseStr)

	if (usesPreset) {
		return {
			check: 'semantic-release',
			status: 'ok',
			detail: configFile
				? `${configFile} extends ${PACKAGE}/semantic-release`
				: `release field extends ${PACKAGE}/semantic-release`,
		}
	}

	return {
		check: 'semantic-release',
		status: 'drift',
		detail: configFile
			? `${configFile} does not extend ${PACKAGE}/semantic-release`
			: '`release` field does not extend our preset',
		hint: `Extend "${PACKAGE}/semantic-release" or "${PACKAGE}/semantic-release/github"`,
	}
}

const TYPEDOC_CONFIGS = [
	'typedoc.json',
	'typedoc.config.js',
	'typedoc.config.mjs',
	'typedoc.config.cjs',
	'typedoc.config.ts',
]

export async function checkTypedoc(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	if (pkg?.private === true) {
		return {
			check: 'TypeDoc',
			status: 'ok',
			detail: 'not applicable (package is private)',
		}
	}

	let configFile: string | null = null
	let configContent: string | null = null
	for (const candidate of TYPEDOC_CONFIGS) {
		const fp = path.join(dir, candidate)
		if (await fs.pathExists(fp)) {
			configFile = candidate
			try {
				configContent = await fs.readFile(fp, 'utf-8')
			} catch {
				configContent = ''
			}
			break
		}
	}

	const deps = {
		...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	const hasDep = !!deps['typedoc']
	const usesPreset = configContent
		? /@rtorcato\/(?:js|repo)-tooling\/typedoc/.test(configContent)
		: false

	if (configFile && usesPreset) {
		return {
			check: 'TypeDoc',
			status: 'ok',
			detail: `${configFile} extends the preset`,
		}
	}
	if (configFile && !usesPreset) {
		return {
			check: 'TypeDoc',
			status: 'drift',
			detail: `${configFile} found but does not extend @rtorcato/repo-tooling/typedoc`,
			hint: 'Add `"extends": ["@rtorcato/repo-tooling/typedoc"]` to typedoc.json',
		}
	}
	if (hasDep && !configFile) {
		return {
			check: 'TypeDoc',
			status: 'drift',
			detail: 'typedoc installed but no typedoc.json found',
			hint: 'Run `npx @rtorcato/repo-tooling fix typedoc` to scaffold typedoc.json',
		}
	}
	return {
		check: 'TypeDoc',
		status: 'optional-missing',
		detail: 'TypeDoc not configured',
		hint: 'Run `npx @rtorcato/repo-tooling fix typedoc` to scaffold API docs generation',
	}
}

function isPublishableLibrary(pkg: Pkg | null): boolean {
	if (!pkg || pkg.private === true) return false
	return !!(pkg.exports || pkg.main || pkg.module || pkg.files)
}

export async function checkAreTheTypesWrong(_dir: string, pkg: Pkg | null): Promise<CheckResult> {
	if (!isPublishableLibrary(pkg)) {
		return {
			check: 'are-the-types-wrong',
			status: 'ok',
			detail: 'not applicable (private or no published exports)',
		}
	}

	const deps = {
		...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {}

	const hasDep = !!deps['@arethetypeswrong/cli']
	const hasScript = Object.values(scripts).some((s) => /\battw\b/.test(s))

	if (hasDep && hasScript) {
		return {
			check: 'are-the-types-wrong',
			status: 'ok',
			detail: '@arethetypeswrong/cli installed and wired into a script',
		}
	}

	if (hasDep) {
		return {
			check: 'are-the-types-wrong',
			status: 'drift',
			detail: '@arethetypeswrong/cli installed but no script runs it',
			hint: 'Run `npx @rtorcato/repo-tooling fix attw` to add an `attw` script and wire it into verify',
		}
	}

	return {
		check: 'are-the-types-wrong',
		status: 'optional-missing',
		detail: '@arethetypeswrong/cli not configured',
		hint: 'Run `npx @rtorcato/repo-tooling fix attw` to validate TypeScript exports before publishing',
	}
}

export async function checkPublint(_dir: string, pkg: Pkg | null): Promise<CheckResult> {
	if (!isPublishableLibrary(pkg)) {
		return {
			check: 'publint',
			status: 'ok',
			detail: 'not applicable (private or no published exports)',
		}
	}

	const deps = {
		...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
	}
	const scripts = (pkg?.scripts as Record<string, string> | undefined) ?? {}

	const hasDep = !!deps['publint']
	const hasScript = Object.values(scripts).some((s) => /\bpublint\b/.test(s))

	if (hasDep && hasScript) {
		return {
			check: 'publint',
			status: 'ok',
			detail: 'publint installed and wired into a script',
		}
	}

	if (hasDep) {
		return {
			check: 'publint',
			status: 'drift',
			detail: 'publint installed but no script runs it',
			hint: 'Run `npx @rtorcato/repo-tooling fix publint` to add a `publint` script and wire it into verify',
		}
	}

	return {
		check: 'publint',
		status: 'optional-missing',
		detail: 'publint not configured',
		hint: 'Run `npx @rtorcato/repo-tooling fix publint` to lint your package before publishing',
	}
}

/** Who this package's README badges are for — feeds the base badge check (#309). */
export function jsBadgeAudience(pkg: Pkg | null): BadgeAudience {
	if (!pkg || pkg.private === true) return 'private'
	return isPublishableLibrary(pkg) ? 'public' : 'not-applicable'
}

export async function checkTreeshakeSetup(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const appCheckPath = path.join(dir, 'apps', 'treeshake-check', 'check.mjs')
	if (await fs.pathExists(appCheckPath)) {
		return {
			check: 'Tree-shake check',
			status: 'ok',
			detail: 'apps/treeshake-check/check.mjs found',
		}
	}
	// Only nudge libraries that actually claim tree-shaking via multi-subpath exports + sideEffects: false.
	const exports = (pkg?.exports as Record<string, unknown> | undefined) ?? {}
	const subpaths = Object.keys(exports).filter(
		(k) => k !== '.' && k.startsWith('./') && !k.includes('*')
	)
	const sideEffectsFree = pkg?.sideEffects === false
	if (subpaths.length < 2 || !sideEffectsFree) {
		return {
			check: 'Tree-shake check',
			status: 'ok',
			detail: 'not applicable (single-export or has side effects)',
		}
	}
	return {
		check: 'Tree-shake check',
		status: 'optional-missing',
		detail: `package exports ${subpaths.length} subpaths with sideEffects: false but no apps/treeshake-check/`,
		hint: 'Run `npx @rtorcato/repo-tooling fix treeshake-check` to scaffold an esbuild metafile assertion',
	}
}

/**
 * A Claude Code worktree starts with no node_modules, so every agent working
 * one pays a full install before it can typecheck, lint or test — unless
 * `.claude/settings.json` tells Claude to symlink the directory from the main
 * checkout (#396). JS-only: the other language modules have nothing to symlink.
 */
export async function checkClaudeWorktreeSettings(dir: string): Promise<CheckResult> {
	const check = 'Claude worktree settings'
	const hint = `Run \`npx ${PACKAGE} fix ai\` to merge worktree.symlinkDirectories into ${CLAUDE_SETTINGS_FILE}`
	if (!(await fs.pathExists(path.join(dir, CLAUDE_SETTINGS_FILE)))) {
		return {
			check,
			status: 'optional-missing',
			detail: `no ${CLAUDE_SETTINGS_FILE} — agent worktrees reinstall node_modules from scratch`,
			hint,
		}
	}
	const settings = await readClaudeSettings(dir)
	if (!settings) {
		return {
			check,
			status: 'drift',
			detail: `${CLAUDE_SETTINGS_FILE} is not a readable JSON object`,
			// `fix ai` deliberately skips an unparseable file rather than clobbering
			// hand-written hooks/permissions, so this one is on the human.
			hint: `Repair the JSON in ${CLAUDE_SETTINGS_FILE} by hand — \`fix ai\` refuses to overwrite it`,
		}
	}
	if (worktreeSymlinkDirs(settings).includes('node_modules')) {
		return { check, status: 'ok', detail: 'worktree.symlinkDirectories carries node_modules' }
	}
	return {
		check,
		status: 'optional-missing',
		detail: `${CLAUDE_SETTINGS_FILE} has no worktree.symlinkDirectories entry for node_modules`,
		hint,
	}
}

export async function checkTurborepo(dir: string): Promise<CheckResult> {
	const hasTurbo = await fs.pathExists(path.join(dir, 'turbo.json'))
	const hasNx = await fs.pathExists(path.join(dir, 'nx.json'))
	if (hasTurbo && hasNx) {
		return {
			check: 'Turborepo',
			status: 'drift',
			detail: 'both turbo.json and nx.json present',
			hint: 'Pick one monorepo orchestrator — remove either turbo.json or nx.json',
		}
	}
	if (hasTurbo) return { check: 'Turborepo', status: 'ok', detail: 'turbo.json found' }
	if (hasNx) return { check: 'Turborepo', status: 'ok', detail: 'nx.json found (using Nx)' }
	return {
		check: 'Turborepo',
		status: 'optional-missing',
		detail: 'pnpm workspace without a task orchestrator',
		hint: 'Run `npx @rtorcato/repo-tooling fix turborepo` (or `fix nx`) to scaffold a task pipeline',
	}
}

/**
 * pnpm settings that would otherwise be hand-copied across the family (#314).
 * Only reported for pnpm repos — an npm or yarn repo has no use for the file,
 * and inventing one there would be noise.
 */
export async function checkPnpmWorkspace(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const check = 'pnpm settings'
	const hint = `Run \`npx ${PACKAGE} fix pnpm-workspace\` to merge them in`
	const file = path.join(dir, WORKSPACE_FILE)
	const exists = await fs.pathExists(file)
	if (!(await usesPnpm(dir, pkg))) {
		return { check, status: 'ok', detail: 'not a pnpm repo' }
	}

	const yaml = exists ? await fs.readFile(file, 'utf-8') : ''
	const missing = missingPnpmSettings(yaml, dependsOnEsbuild(allDeps(pkg)), familyGlob(pkg?.name))
	if (missing.length === 0) {
		return { check, status: 'ok', detail: `${WORKSPACE_FILE} carries the managed settings` }
	}
	return {
		check,
		// A repo with no workspace file at all hasn't drifted — it never opted in.
		status: exists ? 'drift' : 'optional-missing',
		detail: `missing ${missing.join(', ')}`,
		hint,
	}
}

/** The lifecycle scripts pnpm refuses to run until the package is approved. */
const BUILD_LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall'] as const

/**
 * Package names that already have a build decision recorded — approved or
 * declined, both count. `allowBuilds` is a map (pnpm 11); the older
 * `onlyBuiltDependencies` / `ignoredBuiltDependencies` lists are still read so
 * a repo that hasn't migrated isn't nagged about choices it already made.
 */
export function decidedBuilds(yaml: string): Set<string> {
	const decided = new Set<string>()
	const lines = yaml.split('\n')
	let inBlock = false
	for (const line of lines) {
		if (/^(allowBuilds|onlyBuiltDependencies|ignoredBuiltDependencies):/.test(line)) {
			inBlock = true
			continue
		}
		if (/^\S/.test(line)) {
			inBlock = false
			continue
		}
		if (!inBlock) continue
		// `  esbuild: true` (map) or `  - esbuild` (list).
		const name = /^\s*-?\s*['"]?(@?[\w./-]+?)['"]?\s*:?\s*(?:true|false)?\s*$/.exec(line)?.[1]
		if (name) decided.add(name)
	}
	return decided
}

/**
 * Package name encoded in a `node_modules/.pnpm` directory name (#373).
 *
 * Entries read `<name>@<version>` with `/` written as `+`, and the version may
 * carry a peer suffix that contains further `@`s
 * (`@babel+core@7.0.0_supports-color@8.0.0`), so the separator is the *first*
 * `@` after index 0 — never the last.
 */
export function pnpmStoreDirToName(entry: string): string | null {
	const at = entry.indexOf('@', 1)
	if (at < 1) return null
	return entry.slice(0, at).replace('+', '/')
}

/**
 * Transitive packages that ship a build script and have no decision (#373).
 *
 * One `package.json` read per unique name — never a recursive walk — and the
 * whole pass is skipped when `.pnpm` is absent (npm/yarn repos, or nothing
 * installed). `skip` drops the names the direct pass already owns.
 */
async function undecidedTransitiveBuilds(
	modulesDir: string,
	skip: (name: string) => boolean
): Promise<string[]> {
	const store = path.join(modulesDir, '.pnpm')
	if (!(await fs.pathExists(store))) return []

	const seen = new Set<string>()
	const undecided = new Set<string>()
	for (const entry of await fs.readdir(store)) {
		const name = pnpmStoreDirToName(entry)
		// A package present at two versions has two store dirs; report it once.
		if (!name || seen.has(name) || skip(name)) continue
		seen.add(name)
		// Store directory names come from registry metadata, and only the *first*
		// `+` is decoded — the rest of the entry passes through literally, so a
		// hostile name (`..+..@1.0.0` → `../..`) would climb out of the package
		// directory and have `fs.readJson` read an unrelated file, whose `name`
		// then lands in the report. Confirm the resolved path stays under this
		// entry's `node_modules` before reading it.
		const root = path.resolve(store, entry, 'node_modules')
		const target = path.join(root, name, 'package.json')
		if (!target.startsWith(root + path.sep)) continue
		let depPkg: { name?: string; scripts?: Record<string, string> }
		try {
			depPkg = await fs.readJson(target)
		} catch {
			continue
		}
		const scripts = depPkg.scripts ?? {}
		// `name` from the manifest is exact; the decoded dir name is the fallback.
		if (BUILD_LIFECYCLE_SCRIPTS.some((s) => scripts[s])) undecided.add(depPkg.name ?? name)
	}
	return [...undecided].filter((n) => !skip(n)).sort()
}

/**
 * Dependencies whose install would run a build script (#364, #373).
 *
 * pnpm 11 turned undecided build scripts into a hard error, so
 * `pnpm install --frozen-lockfile` exits non-zero with ERR_PNPM_IGNORED_BUILDS
 * — a guaranteed CI failure. Locally the same message reads as advisory, which
 * is exactly why it gets missed until the pipeline goes red.
 *
 * Direct and transitive offenders are graded apart. A direct one is `drift`:
 * the repo asked for the package by name and can answer for it. A transitive
 * one is `optional-missing` — still worth recording, but common enough that
 * grading it as drift would drown the report in noise.
 */
export async function checkBuildApprovals(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const check = 'pnpm build approvals'
	const deps = allDeps(pkg)
	const modulesDir = path.join(dir, 'node_modules')
	if (Object.keys(deps).length === 0 || !(await fs.pathExists(modulesDir))) {
		// Nothing installed to inspect — the manifest alone can't say which
		// packages ship an install script.
		return { check, status: 'ok', detail: 'no installed dependencies to inspect' }
	}

	const yamlPath = path.join(dir, WORKSPACE_FILE)
	const decided = decidedBuilds(
		(await fs.pathExists(yamlPath)) ? await fs.readFile(yamlPath, 'utf-8') : ''
	)

	const undecided: string[] = []
	for (const name of Object.keys(deps)) {
		if (decided.has(name)) continue
		const depPkgPath = path.join(modulesDir, name, 'package.json')
		if (!(await fs.pathExists(depPkgPath))) continue
		let scripts: Record<string, string> = {}
		try {
			const depPkg = (await fs.readJson(depPkgPath)) as Record<string, unknown>
			scripts = (depPkg.scripts as Record<string, string> | undefined) ?? {}
		} catch {
			continue
		}
		if (BUILD_LIFECYCLE_SCRIPTS.some((s) => scripts[s])) undecided.push(name)
	}

	const transitive = await undecidedTransitiveBuilds(
		modulesDir,
		(name) => decided.has(name) || name in deps
	)

	if (undecided.length === 0 && transitive.length === 0) {
		return { check, status: 'ok', detail: 'every dependency with a build script has a decision' }
	}

	const parts: string[] = []
	if (undecided.length)
		parts.push(
			`${undecided.length} dependenc${undecided.length === 1 ? 'y' : 'ies'} with undecided build scripts: ${undecided.join(', ')}`
		)
	if (transitive.length)
		parts.push(
			`${transitive.length} transitive dependenc${transitive.length === 1 ? 'y' : 'ies'} with undecided build scripts: ${transitive.join(', ')}`
		)

	return {
		check,
		status: undecided.length ? 'drift' : 'optional-missing',
		detail: parts.join('; '),
		hint: `Record a decision per package under \`allowBuilds:\` in ${WORKSPACE_FILE} (\`name: true\` to run it, \`false\` to skip). pnpm 11 fails \`pnpm install --frozen-lockfile\` outright while any is undecided, so CI cannot pass until each is answered.`,
	}
}

/** The docs app dir (apps/docs or apps/doc) if a Docusaurus config lives there. */
export async function findDocsAppDir(dir: string): Promise<string | null> {
	for (const app of ['apps/docs', 'apps/doc']) {
		if (await fs.pathExists(path.join(dir, app, 'docusaurus.config.ts'))) return app
	}
	return null
}

// Only surfaced when a Docusaurus site exists (see runDoctor). Verifies the
// shared-asset wiring #54 standardizes: sync-changelog present + chained into
// the docs app's build/start, and the deploy artifact path is `build` (not
// `dist`). Opt-in, so a repo without a docs site never sees this.
export async function checkDocsSite(dir: string, docsAppDir: string): Promise<CheckResult> {
	const check = 'Docs site'
	const deltas: string[] = []

	const syncPath = path.join(dir, 'scripts', 'sync-changelog.mjs')
	if (!(await fs.pathExists(syncPath))) {
		deltas.push('scripts/sync-changelog.mjs missing')
	} else {
		const pkgPath = path.join(dir, docsAppDir, 'package.json')
		if (await fs.pathExists(pkgPath)) {
			try {
				const docsPkg = (await fs.readJson(pkgPath)) as { scripts?: Record<string, string> }
				const scripts = docsPkg.scripts ?? {}
				const chained = ['build', 'start'].some(
					(s) => typeof scripts[s] === 'string' && /sync-changelog/.test(scripts[s])
				)
				// pnpm 8 doesn't run pre* hooks reliably, so build/start must chain it explicitly.
				if (!chained) deltas.push(`${docsAppDir} build/start does not chain sync-changelog`)
			} catch {
				// Unparseable package.json — a separate check owns that; skip here.
			}
		}
	}

	// The GitHub Pages deploy must upload `apps/doc*/build` (Docusaurus emits
	// `build/`, not `dist/`).
	const workflowsDir = path.join(dir, '.github', 'workflows')
	if (await fs.pathExists(workflowsDir)) {
		for (const file of await fs.readdir(workflowsDir)) {
			if (!/\.ya?ml$/.test(file)) continue
			const body = await fs.readFile(path.join(workflowsDir, file), 'utf-8').catch(() => '')
			if (new RegExp(`${docsAppDir}/dist`).test(body)) {
				deltas.push(`${file} deploys ${docsAppDir}/dist (should be ${docsAppDir}/build)`)
			}
		}
	}

	if (deltas.length)
		return {
			check,
			status: 'drift',
			detail: deltas.join('; '),
			hint: 'Align the docs site with the shared standard (sync-changelog wiring, build/ artifact path)',
		}
	return { check, status: 'ok', detail: `${docsAppDir} wired per standard` }
}

// Only called when `tailwindcss` is a dependency (see runDoctor) — Tailwind is
// opt-in per project, so nudging repos that don't use it would be noise. v4 is
// CSS-first: the wiring is a PostCSS plugin (or the Vite plugin), not a config
// file, so that's what we look for.
export async function checkTailwind(dir: string, pkg: Pkg | null): Promise<CheckResult> {
	const hasVitePlugin = '@tailwindcss/vite' in allDeps(pkg)
	let postcssWired = false
	for (const candidate of ['postcss.config.mjs', 'postcss.config.js', 'postcss.config.cjs']) {
		const p = path.join(dir, candidate)
		if (
			(await fs.pathExists(p)) &&
			(await fs.readFile(p, 'utf8')).includes('@tailwindcss/postcss')
		) {
			postcssWired = true
			break
		}
	}

	if (hasVitePlugin || postcssWired) {
		return {
			check: 'Tailwind',
			status: 'ok',
			detail: hasVitePlugin ? '@tailwindcss/vite configured' : '@tailwindcss/postcss configured',
		}
	}
	return {
		check: 'Tailwind',
		status: 'optional-missing',
		detail: 'tailwindcss installed without a PostCSS (or Vite) plugin',
		hint: 'Run `npx @rtorcato/repo-tooling fix tailwind` to scaffold the v4 PostCSS wiring',
	}
}

/**
 * Both checks below read `package.json` alone — no network, no lockfile. They
 * report `optional-missing` rather than `drift`: each is a policy call a repo
 * can legitimately decide against, so they surface in doctor's output and can
 * be declined in `.repo-tooling.json`, but neither fails a build.
 */

/** `[major, minor, patch]` floor of a range, or null when it hasn't got one. */
export function rangeFloor(range: string): [number, number, number] | null {
	const m = /^[\s^~>=<v]*(\d+)\.(\d+)\.(\d+)/.exec(range)
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/**
 * Major.minor only — patch is deliberately ignored. New config keys and new
 * behaviour arrive in minors; a dev floor five patches above the peer floor
 * (`^2.5.0` vs `^2.5.5`) is just a routine bump and flagging it would make
 * this check fire on almost every package.
 */
function compareFloor(a: [number, number, number], b: [number, number, number]): number {
	return a[0] - b[0] || a[1] - b[1]
}

/**
 * Config files whose `$schema` URL carries the tool version the config is
 * written for, and the package that reads them. One entry per tool; adding
 * another is a line here.
 */
const SCHEMA_CONFIGS: { files: string[]; host: string; pkg: string }[] = [
	{ files: ['biome.json', 'biome.jsonc'], host: 'biomejs.dev', pkg: '@biomejs/biome' },
]

/** The version out of `https://biomejs.dev/schemas/2.5.0/schema.json`. */
export function schemaUrlVersion(url: string): [number, number, number] | null {
	const m = /\/(\d+\.\d+\.\d+)\//.exec(url)
	return m?.[1] ? rangeFloor(m[1]) : null
}

/**
 * `"$schema": "..."` without parsing the file. Biome configs may be JSONC, and
 * a comment is enough to break `JSON.parse` — the one field this needs is
 * cheaper and safer to read directly.
 */
function readSchemaUrl(contents: string): string | null {
	return /"\$schema"\s*:\s*"([^"]+)"/.exec(contents)?.[1] ?? null
}

/**
 * A shipped config written for a newer tool version than the package claims to
 * support (#330). The `$schema` URL is an explicit, machine-readable statement
 * of which version the config targets, so comparing it against the declared
 * dependency floor is exact — no heuristics, no false positives.
 *
 * This is the #330 defect precisely: `tooling/biome/biome.json` carries
 * `$schema` 2.5.0 and uses `linter.rules.preset`, a 2.5 key, while
 * `peerDependencies` advertised `@biomejs/biome: ^2.0.0`. Consumers on 2.0–2.4
 * got `Found an unknown key \`preset\`` with nothing pointing at the range.
 *
 * It reads the same way in a consuming repo: a `biome.json` targeting 2.5.0
 * with `@biomejs/biome: ^2.3.0` in devDependencies is the identical failure,
 * one level down.
 *
 * The floor is what matters, not the ceiling — `^2.0.0` resolves to the newest
 * 2.x today, so the repo's own install works and only consumers pinned lower
 * break. That is exactly why this goes unnoticed.
 */
export async function checkConfigSchemaVersions(
	dir: string,
	pkg: Pkg | null
): Promise<CheckResult> {
	const check = 'Config schema versions'
	// peerDependencies is the contract a publisher offers; devDependencies is
	// what a leaf repo actually installs. Prefer the former when present.
	const declared = {
		...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.peerDependencies as Record<string, string> | undefined) ?? {}),
	}

	const mismatches: string[] = []
	let checked = 0
	for (const spec of SCHEMA_CONFIGS) {
		for (const file of spec.files) {
			const filepath = path.join(dir, file)
			if (!(await fs.pathExists(filepath))) continue
			const url = readSchemaUrl(await fs.readFile(filepath, 'utf8'))
			if (!url?.includes(spec.host)) continue
			const schemaVersion = schemaUrlVersion(url)
			const range = declared[spec.pkg]
			if (!schemaVersion || !range) continue
			const floor = rangeFloor(range)
			if (!floor) continue
			checked++
			if (compareFloor(schemaVersion, floor) > 0) {
				const v = schemaVersion.join('.')
				mismatches.push(`${file} targets ${spec.pkg} ${v} but the range is ${range}`)
			}
		}
	}

	if (checked === 0) {
		return { check, status: 'ok', detail: 'no versioned config schemas to compare' }
	}
	if (mismatches.length === 0) {
		return {
			check,
			status: 'ok',
			detail: `${checked} config schema${checked === 1 ? '' : 's'} within the declared version range`,
		}
	}
	return {
		check,
		status: 'optional-missing',
		detail: `${mismatches.length} config${mismatches.length === 1 ? '' : 's'} written for a newer tool than declared: ${mismatches.join('; ')}`,
		hint: 'Raise the dependency floor to the version the config targets, or rewrite the config for the oldest version supported. Anyone resolving below the schema version gets a config-parse error that never mentions the version range.',
	}
}

/** npm git specifiers, including the bare `owner/repo` GitHub shorthand. */
const GIT_PROTOCOL = /^(?:github|gitlab|bitbucket|gist):|^git\+|^git:\/\//
const GITHUB_SHORTHAND = /^[A-Za-z0-9][\w.-]*\/[A-Za-z0-9][\w.-]*(?:#.*)?$/

export function isGitSpecifier(spec: string): boolean {
	return GIT_PROTOCOL.test(spec) || GITHUB_SHORTHAND.test(spec)
}

/**
 * A git dependency with no `#ref` (#332). The package manager resolves it once
 * and pins the commit in the lockfile, so it never moves again until somebody
 * re-resolves by hand — with no version mismatch, no Dependabot PR, and no
 * signal of any kind that it has gone stale.
 *
 * This is how the docs homepage kept advertising `@rtorcato/js-tooling` for
 * days after the rename: `github:rtorcato/shared-docs` had been pinned to a
 * pre-rename commit and nothing could tell.
 */
export function checkGitDependencies(pkg: Pkg | null): CheckResult {
	const check = 'Git dependencies'
	const fields = ['dependencies', 'devDependencies', 'optionalDependencies'] as const
	const refless: string[] = []
	let total = 0

	for (const field of fields) {
		const deps = (pkg?.[field] as Record<string, string> | undefined) ?? {}
		for (const [name, spec] of Object.entries(deps)) {
			if (typeof spec !== 'string' || !isGitSpecifier(spec)) continue
			total++
			if (!spec.includes('#')) refless.push(`${name} (${spec})`)
		}
	}

	if (total === 0) {
		return { check, status: 'ok', detail: 'no git dependencies' }
	}
	if (refless.length === 0) {
		return {
			check,
			status: 'ok',
			detail: `${total} git dependenc${total === 1 ? 'y' : 'ies'}, all with an explicit ref`,
		}
	}
	return {
		check,
		status: 'optional-missing',
		detail: `${refless.length} git dependenc${refless.length === 1 ? 'y' : 'ies'} with no ref — pinned to whatever commit was current at install time: ${refless.join('; ')}`,
		hint: 'Prefer publishing to a registry and depending on a semver range. Failing that, add an explicit ref — `#semver:^1.2.0` is strongest, `#main` at least makes the intent legible and `pnpm update` meaningful.',
	}
}
