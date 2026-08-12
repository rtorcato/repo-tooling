import type { Lockfile } from '../utils/lockfile.js'
import type { ProjectConfig } from './setup.js'

export const FIX_TARGETS: Record<string, string> = {
	'package.json': 'package-json',
	'engines.node': 'engines',
	packageManager: 'engines',
	EditorConfig: 'editorconfig',
	'VS Code extensions': 'vscode-extensions',
	'Node version pin': 'nvmrc',
	'Node version consistency': 'node-version',
	TypeScript: 'tsconfig',
	Biome: 'biome',
	ESLint: 'eslint',
	Prettier: 'prettier',
	Vitest: 'vitest',
	Commitlint: 'commitlint',
	'Git hooks': 'husky',
	'lint-staged': 'husky',
	'Pre-push hook': 'husky',
	'verify script': 'verify',
	'semantic-release': 'semantic-release',
	knip: 'knip',
	'size-limit': 'size-limit',
	'Tree-shake check': 'treeshake-check',
	'GitHub Actions': 'github-actions',
	'Coverage upload': 'github-actions',
	Dependabot: 'dependabot',
	CodeQL: 'codeql',
	'Branch protection': 'github-settings',
	'Merge settings': 'github-settings',
	'Workflow permissions': 'github-settings',
	'Code-scanning gate': 'github-settings',
	Milestones: 'milestones',
	CODEOWNERS: 'codeowners',
	'GitLab CI': 'gitlab-ci',
	Turborepo: 'turborepo',
	'pnpm settings': 'pnpm-workspace',
	Tailwind: 'tailwind',
	lockfile: 'lockfile',
	'.repo-tooling.json': 'lockfile',
	// Pre-rename lockfile name — still recognized as managed so doctor doesn't
	// flag an un-migrated repo's lockfile as unmanaged (#272).
	'.js-tooling.json': 'lockfile',
	'are-the-types-wrong': 'attw',
	publint: 'publint',
	'README badges': 'badges',
	'Brand assets': 'brand',
	TypeDoc: 'typedoc',
	'AI setup': 'ai',
	'Claude worktree settings': 'ai',
	'Claude skills': 'claude-skills',
}

/**
 * Where the Swift module's fixers shadow (or extend) the JS-named defaults
 * above. Without this, `doctor` on a Swift repo suggests `fix husky` and
 * `fix github-actions` — targets its fixer set doesn't contain.
 */
const SWIFT_FIX_TARGETS: Record<string, string> = {
	'Git hooks': 'swift-git-hooks',
	'Pre-push hook': 'swift-git-hooks',
	'GitHub Actions': 'swift-ci',
	'GitLab CI': 'swift-gitlab-ci',
	lockfile: 'swift-lockfile',
	SwiftLint: 'swiftlint',
	Periphery: 'periphery',
	'Swift .gitignore': 'swift-gitignore',
	'Release automation': 'swift-release',
	'swift-format': 'swift-format',
	DocC: 'docc',
	// `Swift tests` is deliberately absent: when it fails for the manifest half
	// (no `.testTarget(`) there's nothing to run, and rewriting Package.swift
	// isn't safe. The check's own hint covers both halves.
}

/** The same shadowing for the Python module (#290). */
const PYTHON_FIX_TARGETS: Record<string, string> = {
	'Git hooks': 'python-git-hooks',
	'Pre-push hook': 'python-git-hooks',
	'GitHub Actions': 'python-ci',
	'GitLab CI': 'python-gitlab-ci',
	Ruff: 'ruff',
	mypy: 'mypy',
	pytest: 'pytest',
	'Python .gitignore': 'python-gitignore',
	// `pyproject.toml` and `Python tests` are deliberately absent, for the same
	// reason `Swift tests` is: the fix is content only the project can write
	// (package metadata, actual tests). Their own hints say what to add.
	// `lockfile` too — see the note at the top of src/languages/python/fixers.ts.
}

/** The same shadowing for the Perl module (#289). */
const PERL_FIX_TARGETS: Record<string, string> = {
	'Git hooks': 'perl-git-hooks',
	'Pre-push hook': 'perl-git-hooks',
	'GitHub Actions': 'perl-ci',
	'GitLab CI': 'perl-gitlab-ci',
	'Perl::Critic': 'perlcritic',
	perltidy: 'perltidy',
	'Perl .gitignore': 'perl-gitignore',
	// `Perl distribution` and `Perl tests` are deliberately absent, for the same
	// reason `Swift tests` is: the fix is content only the project can write
	// (dependency metadata, actual tests). Their own hints say what to add.
	// `lockfile` too — see the note at the top of src/languages/perl/fixers.ts.
}

const FIX_TARGETS_BY_LANGUAGE: Record<string, Record<string, string>> = {
	swift: SWIFT_FIX_TARGETS,
	python: PYTHON_FIX_TARGETS,
	perl: PERL_FIX_TARGETS,
}

export function getFixTargetForCheck(checkName: string, language?: string): string | null {
	const overrides = language ? FIX_TARGETS_BY_LANGUAGE[language] : undefined
	return overrides?.[checkName] ?? FIX_TARGETS[checkName] ?? null
}

/**
 * For a given doctor check name, returns true when the lockfile records that
 * the user intentionally opted out of the tool that check covers. Used by
 * doctor to demote `optional-missing` to `ok` and by fix to print a conflict
 * warning before overriding the recorded choice.
 */
export function declinedInLock(lock: Lockfile | null, checkName: string): boolean {
	if (!lock) return false
	const c = lock.config
	switch (checkName) {
		case 'TypeScript':
			return c.typescript?.enabled === false
		case 'Biome':
			return c.linting?.tool !== 'biome' && c.linting?.tool !== 'both'
		case 'ESLint':
			return c.linting?.tool !== 'eslint' && c.linting?.tool !== 'both'
		case 'Prettier':
			return c.formatting?.tool !== 'prettier'
		case 'Vitest':
			return c.testing?.framework !== 'vitest'
		case 'Commitlint':
			return c.commitLint === false
		case 'Git hooks':
		case 'lint-staged':
		case 'Pre-push hook':
			return c.gitHooks === false
		case 'verify script':
			// Verify is derived from other tools; only "declined" if none of typecheck/lint/test are enabled.
			return (
				c.typescript?.enabled === false &&
				c.linting?.tool === 'none' &&
				c.testing?.framework === 'none'
			)
		case 'semantic-release':
		// The Swift shape of the same recorded choice (#310): `semanticRelease`
		// is the config's release-automation flag, and on a SwiftPM repo that
		// means a tag-triggered workflow rather than an npm publish.
		case 'Release automation':
			return c.semanticRelease === false
		case 'Dependabot':
		case 'CodeQL':
		// GitHub repo-settings checks (#137) share the securityAutomation opt-out.
		case 'Branch protection':
		case 'Merge settings':
		case 'Workflow permissions':
		case 'Code-scanning gate':
			return c.securityAutomation === false
		case 'publint':
			return c.publint === false
		case 'README badges':
			return c.badges === false
		case 'AI setup':
		// The same recorded choice: the worktree settings are part of what
		// `fix ai` writes, so a repo that declined AI setup declined them too.
		case 'Claude worktree settings':
			return c.aiSetup === false
		case 'Turborepo':
			return c.turborepo === false
		case 'Tailwind':
			return c.tailwind === false
		default:
			return false
	}
}

/**
 * When a fixer is about to scaffold a tool, return the patch to apply to the
 * lockfile's recorded choices so intent stays in sync with reality. Returns
 * null when the target either doesn't change any recorded choice (e.g. the
 * `verify` fixer is derived, or `engines` writes a universal field) or when
 * the lockfile already reflects the change.
 */
export function lockfilePatchForTarget(
	target: string,
	lock: Lockfile
): Partial<ProjectConfig> | null {
	const c = lock.config
	switch (target) {
		case 'biome':
			if (c.linting.tool === 'biome' || c.linting.tool === 'both') return null
			return {
				linting: { tool: 'biome' },
				formatting: { tool: 'biome' },
			}
		case 'eslint':
			if (c.linting.tool === 'eslint' || c.linting.tool === 'both') return null
			return {
				linting: { tool: 'eslint', eslintConfig: c.linting.eslintConfig ?? 'base' },
				formatting: { tool: 'prettier' },
			}
		case 'prettier':
			if (c.formatting.tool === 'prettier') return null
			return { formatting: { tool: 'prettier' } }
		case 'vitest':
			if (c.testing.framework === 'vitest') return null
			return {
				testing: { framework: 'vitest', environment: c.testing.environment ?? 'node' },
			}
		case 'commitlint':
			return c.commitLint ? null : { commitLint: true }
		case 'husky':
		case 'swift-git-hooks':
		case 'python-git-hooks':
		case 'perl-git-hooks':
			return c.gitHooks ? null : { gitHooks: true }
		case 'semantic-release':
		case 'swift-release':
			return c.semanticRelease ? null : { semanticRelease: true }
		case 'dependabot':
		case 'renovate':
		case 'codeql':
		case 'github-settings':
			return c.securityAutomation ? null : { securityAutomation: true }
		case 'tsconfig':
			return c.typescript.enabled ? null : { typescript: { enabled: true, config: 'base' } }
		case 'treeshake-check':
			return c.treeshakeCheck ? null : { treeshakeCheck: true }
		case 'publint':
			return c.publint ? null : { publint: true }
		case 'badges':
			return c.badges ? null : { badges: true }
		case 'ai':
			return c.aiSetup ? null : { aiSetup: true }
		case 'turborepo':
			return c.turborepo ? null : { turborepo: true }
		case 'nx':
			return c.nx ? null : { nx: true }
		case 'tailwind':
			return c.tailwind ? null : { tailwind: true }
		case 'docs-site':
			return c.docsSite ? null : { docsSite: true }
		case 'bun':
			return c.bun ? null : { bun: true }
		default:
			return null
	}
}
