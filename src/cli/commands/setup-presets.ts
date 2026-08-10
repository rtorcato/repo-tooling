import { swiftFileList } from '../../languages/swift/scaffold.js'
import { BIOME_CONFIG } from '../generators/linting.js'
import type { ProjectConfig } from './setup.js'

export type PresetName =
	| 'library'
	| 'web-app'
	| 'node-api'
	| 'nextjs-app'
	| 'react-app'
	| 'swift-library'

export const PRESET_NAMES: readonly PresetName[] = [
	'library',
	'web-app',
	'node-api',
	'nextjs-app',
	'react-app',
	'swift-library',
] as const

const BASE: Omit<ProjectConfig, 'projectName' | 'projectType' | 'typescript' | 'bundler'> = {
	language: 'js',
	linting: { tool: 'biome' },
	formatting: { tool: 'biome' },
	testing: { framework: 'vitest', environment: 'node' },
	gitHooks: true,
	commitLint: true,
	semanticRelease: false,
	securityAutomation: true,
	badges: true,
	aiSetup: true,
}

export function buildPresetConfig(name: PresetName, projectName: string): ProjectConfig {
	switch (name) {
		case 'library':
			return {
				...BASE,
				projectName,
				projectType: 'library',
				typescript: { enabled: true, config: 'base' },
				semanticRelease: true,
				bundler: 'tsup',
				publint: true,
			}
		case 'web-app':
			return {
				...BASE,
				projectName,
				projectType: 'web-app',
				typescript: { enabled: true, config: 'base' },
				testing: { framework: 'vitest', environment: 'browser' },
				bundler: 'vite',
			}
		case 'node-api':
			return {
				...BASE,
				projectName,
				projectType: 'node-api',
				typescript: { enabled: true, config: 'node' },
				bundler: 'esbuild',
			}
		case 'nextjs-app':
			return {
				...BASE,
				projectName,
				projectType: 'nextjs-app',
				typescript: { enabled: true, config: 'next' },
				linting: { tool: 'eslint', eslintConfig: 'nextjs' },
				formatting: { tool: 'prettier' },
				bundler: 'none',
			}
		case 'react-app':
			return {
				...BASE,
				projectName,
				projectType: 'react-app',
				typescript: { enabled: true, config: 'react' },
				testing: { framework: 'vitest', environment: 'browser' },
				bundler: 'vite',
			}
		// A SwiftPM library (#288). Deliberately not spread from BASE: every one
		// of its tool choices names a JS tool. The JS-shaped fields below are all
		// "no JS tool", which is not the same as "no tooling" — SwiftLint,
		// Periphery and `swift test` are wired unconditionally by the Swift
		// scaffolder, because unlike the JS path there's nothing to choose
		// between. They're set explicitly because ProjectConfig requires them and
		// the lockfile records them.
		case 'swift-library':
			return {
				projectName,
				language: 'swift',
				projectType: 'library',
				typescript: { enabled: false, config: 'base' },
				linting: { tool: 'none' },
				formatting: { tool: 'none' },
				testing: { framework: 'none' },
				// Husky is an npm package, but git hooks aren't (#309): the Swift path
				// commits `.githooks/` and points git at it with `core.hooksPath`.
				gitHooks: true,
				// commitlint *is* an npm package and needs node on PATH to run, so
				// the Swift hooks deliberately wire no commit-msg hook.
				commitLint: false,
				// The release-automation flag, not the npm tool: semantic-release
				// publishes to npm, and SwiftPM consumes git tags, so on this path it
				// means a tag-triggered release workflow instead (#310).
				semanticRelease: true,
				securityAutomation: true,
				bundler: 'none',
				// Every badge URL is derived from package.json (name + repository),
				// so on a Swift repo the block would always render empty.
				badges: false,
				aiSetup: true,
			}
	}
}

export const CONFIG_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://rtorcato.github.io/repo-tooling/schemas/project-config.json',
	title: 'ProjectConfig',
	description: '@rtorcato/repo-tooling setup configuration',
	type: 'object',
	additionalProperties: false,
	required: [
		'projectName',
		'projectType',
		'typescript',
		'linting',
		'formatting',
		'testing',
		'gitHooks',
		'commitLint',
		'semanticRelease',
		'securityAutomation',
		'bundler',
	],
	properties: {
		projectName: { type: 'string', minLength: 1 },
		language: { type: 'string', enum: ['js', 'swift', 'perl', 'python'] },
		projectType: {
			type: 'string',
			enum: ['library', 'web-app', 'node-api', 'nextjs-app', 'react-app'],
		},
		typescript: {
			type: 'object',
			additionalProperties: false,
			required: ['enabled', 'config'],
			properties: {
				enabled: { type: 'boolean' },
				config: { type: 'string', enum: ['base', 'react', 'next', 'node', 'express'] },
			},
		},
		linting: {
			type: 'object',
			additionalProperties: false,
			required: ['tool'],
			properties: {
				tool: { type: 'string', enum: ['biome', 'eslint', 'both', 'none'] },
				eslintConfig: { type: 'string', enum: ['base', 'nextjs'] },
			},
		},
		formatting: {
			type: 'object',
			additionalProperties: false,
			required: ['tool'],
			properties: { tool: { type: 'string', enum: ['biome', 'prettier', 'none'] } },
		},
		testing: {
			type: 'object',
			additionalProperties: false,
			required: ['framework'],
			properties: {
				framework: { type: 'string', enum: ['vitest', 'jest', 'playwright', 'cypress', 'none'] },
				environment: { type: 'string', enum: ['node', 'browser', 'both'] },
			},
		},
		gitHooks: { type: 'boolean' },
		commitLint: { type: 'boolean' },
		semanticRelease: { type: 'boolean' },
		changesets: { type: 'boolean' },
		releasePlease: { type: 'boolean' },
		oxlint: { type: 'boolean' },
		securityAutomation: { type: 'boolean' },
		bundler: { type: 'string', enum: ['tsup', 'esbuild', 'rollup', 'rolldown', 'vite', 'none'] },
		treeshakeCheck: { type: 'boolean' },
		publint: { type: 'boolean' },
		badges: { type: 'boolean' },
		aiSetup: { type: 'boolean' },
		turborepo: { type: 'boolean' },
		nx: { type: 'boolean' },
		tailwind: { type: 'boolean' },
		bun: { type: 'boolean' },
	},
} as const

const ALLOWED_KEYS: Set<string> = new Set([
	...CONFIG_SCHEMA.required,
	...Object.keys(CONFIG_SCHEMA.properties),
])

export interface ConfigValidationResult {
	valid: boolean
	errors: string[]
}

export function validateProjectConfig(input: unknown): ConfigValidationResult {
	const errors: string[] = []
	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return { valid: false, errors: ['Config must be a JSON object'] }
	}
	const obj = input as Record<string, unknown>
	for (const key of Object.keys(obj)) {
		if (!ALLOWED_KEYS.has(key)) errors.push(`Unknown field: ${key}`)
	}
	for (const required of CONFIG_SCHEMA.required) {
		if (!(required in obj)) errors.push(`Missing required field: ${required}`)
	}
	return { valid: errors.length === 0, errors }
}

export function computeFileList(config: ProjectConfig): string[] {
	// Swift shares the language-agnostic files but none of the package.json-rooted
	// ones, so its list is built by the Swift scaffolder rather than filtered out
	// of this one condition by condition.
	if (config.language === 'swift') return swiftFileList(config)

	const files: string[] = ['package.json', '.repo-tooling.json']
	files.push('.editorconfig', '.nvmrc', 'knip.json', '.vscode/extensions.json')
	if (config.typescript.enabled) {
		files.push('tsconfig.json', 'reset.d.ts')
	}
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		files.push(BIOME_CONFIG)
	}
	if (config.linting.tool === 'eslint' || config.linting.tool === 'both') {
		files.push('eslint.config.mjs')
	}
	if (config.linting.tool === 'eslint') {
		files.push('prettier.config.mjs')
	}
	if (config.testing.framework === 'vitest') {
		files.push('vitest.config.ts', 'vitest.setup.ts', 'codecov.yml')
	}
	if (config.testing.framework === 'jest') {
		files.push('jest.config.mjs')
	}
	if (config.testing.framework === 'playwright') {
		files.push('playwright.config.ts')
	}
	if (config.testing.framework === 'cypress') {
		files.push(
			'cypress.config.ts',
			'cypress/support/e2e.ts',
			'cypress/support/commands.ts',
			'tests/e2e/example.cy.ts'
		)
	}
	if (config.gitHooks) {
		files.push('.husky/pre-commit', '.gitignore')
	}
	if (config.commitLint) {
		files.push('.husky/commit-msg', 'commitlint.config.mjs')
	}
	files.push('.github/workflows/ci.yml')
	if (config.securityAutomation) {
		files.push(
			'.github/dependabot.yml',
			'.github/workflows/dependabot-automerge.yml',
			'.github/workflows/codeql.yml'
		)
	}
	if (config.bundler === 'tsup') files.push('tsup.config.ts')
	else if (config.bundler === 'esbuild') files.push('build.mjs')
	else if (config.bundler === 'rollup') files.push('rollup.config.mjs')
	else if (config.bundler === 'rolldown') files.push('rolldown.config.mjs')
	else if (config.bundler === 'vite') files.push('vite.config.ts')
	if (config.semanticRelease) files.push('release.config.mjs')
	if (config.changesets) files.push('.changeset/config.json')
	if (config.releasePlease)
		files.push(
			'release-please-config.json',
			'.release-please-manifest.json',
			'.github/workflows/release-please.yml'
		)
	if (config.oxlint) files.push('.oxlintrc.json')
	if (config.treeshakeCheck && config.projectType === 'library') {
		files.push(
			'apps/treeshake-check/package.json',
			'apps/treeshake-check/check.mjs',
			'apps/treeshake-check/src/entry.ts'
		)
	}
	// pnpm-workspace.yaml carries the family-wide pnpm settings (#314) plus, where
	// they apply, build-script approvals and the treeshake path's apps/* glob —
	// so it's written for every JS scaffold.
	files.push('pnpm-workspace.yaml')
	if (config.aiSetup) {
		files.push(
			'AGENTS.md',
			'CLAUDE.md',
			'.cursor/rules/repo-tooling.mdc',
			'.github/copilot-instructions.md',
			'.claude/skills/repo-tooling.md',
			'.mcp.json.example'
		)
	}
	if (config.turborepo) files.push('turbo.json')
	if (config.nx) files.push('nx.json')
	if (config.tailwind) files.push('postcss.config.mjs', 'src/styles/globals.css')
	if (config.bun) files.push('bunfig.toml')
	files.push('README.md')
	return files
}
