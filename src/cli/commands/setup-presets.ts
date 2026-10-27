import { swiftFileList } from '../../languages/swift/scaffold.js'
import { BIOME_CONFIG } from '../generators/linting.js'
import { starterFiles } from '../generators/starter.js'
import type { ProjectConfig } from './setup.js'

export type PresetName =
	| 'minimal'
	| 'library'
	| 'web-app'
	| 'node-api'
	| 'nextjs-app'
	| 'react-app'
	| 'swift-library'
	| 'vite-plus'
	| 'vite-plus-app'

export const PRESET_NAMES: readonly PresetName[] = [
	'minimal',
	'library',
	'web-app',
	'node-api',
	'nextjs-app',
	'react-app',
	'swift-library',
	'vite-plus',
	'vite-plus-app',
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

// Not spread from BASE: BASE names Biome and a tsup-era bundler.
const VITE_PLUS_BASE: Omit<ProjectConfig, 'projectName' | 'projectType'> = {
	language: 'js',
	typescript: { enabled: true, config: 'base' },
	linting: { tool: 'none' },
	formatting: { tool: 'none' },
	testing: { framework: 'vitest', environment: 'node' },
	gitHooks: true,
	commitLint: true,
	semanticRelease: false,
	securityAutomation: true,
	bundler: 'vite',
	vitePlus: true,
	badges: true,
	aiSetup: true,
}

export function buildPresetConfig(name: PresetName, projectName: string): ProjectConfig {
	switch (name) {
		// tsconfig + biome + vitest, nothing else (#461). Deliberately not spread
		// from BASE: BASE hardcodes git hooks, commitlint, security automation,
		// badges and the AI agent files, and every other case only ever adds to
		// it — so no preset built on BASE can produce a small repo.
		//
		// `node-api` is the only projectType that adds nothing of its own:
		// `library` would pull in publint, attw, a size-limit budget and a
		// dist/-rooted exports map that `bundler: 'none'` never builds, and the
		// three app types each seed a framework. It says "plain Node package",
		// which is what this preset scaffolds.
		case 'minimal':
			return {
				projectName,
				language: 'js',
				projectType: 'node-api',
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'biome' },
				formatting: { tool: 'biome' },
				testing: { framework: 'vitest', environment: 'node' },
				gitHooks: false,
				commitLint: false,
				semanticRelease: false,
				securityAutomation: false,
				bundler: 'none',
				badges: false,
				aiSetup: false,
			}
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
				// vite-app, not react: this preset ships a Vite bundler, so
				// `import.meta.env` has to typecheck, and typecheck is the app's CI
				// gate rather than a build, so its tests are checked too (#592).
				typescript: { enabled: true, config: 'vite-app' },
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
		// Opt-in Vite+ (#897). Linting and formatting are 'none' because `vp check`
		// does both: the toolchain is the `vitePlus` flag, which doctor reads.
		case 'vite-plus':
			return {
				...VITE_PLUS_BASE,
				projectName,
				projectType: 'library',
				semanticRelease: true,
				publint: true,
			}
		case 'vite-plus-app':
			return { ...VITE_PLUS_BASE, projectName, projectType: 'web-app' }
	}
}

export const CONFIG_SCHEMA = {
	$schema: 'https://json-schema.org/draft/2020-12/schema',
	$id: 'https://docs.torcato.dev/repo-tooling/schemas/project-config.json',
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
				config: { type: 'string', enum: ['base', 'react', 'vite-app', 'next', 'node', 'express'] },
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
		vitePlus: { type: 'boolean' },
		securityAutomation: { type: 'boolean' },
		bundler: { type: 'string', enum: ['tsup', 'esbuild', 'rollup', 'rolldown', 'vite', 'none'] },
		treeshakeCheck: { type: 'boolean' },
		publint: { type: 'boolean' },
		badges: { type: 'boolean' },
		aiSetup: { type: 'boolean' },
		turborepo: { type: 'boolean' },
		nx: { type: 'boolean' },
		tailwind: { type: 'boolean' },
		// Deprecated (#718): both scaffolds moved to @rtorcato/shared-docs. Accepted, inert.
		docsSite: { type: 'boolean', deprecated: true },
		brand: { type: 'boolean', deprecated: true },
		bun: { type: 'boolean' },
		docs: {
			type: 'object',
			additionalProperties: false,
			properties: {
				url: { type: 'string', format: 'uri', pattern: '^https?://' },
				deploy: { type: 'string', enum: ['github', 'cloudflare', 'none'] },
			},
		},
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
	if ('docs' in obj) errors.push(...validateDocs(obj.docs))
	if (obj.vitePlus === true) errors.push(...vitePlusConflicts(obj))
	return { valid: errors.length === 0, errors }
}

/**
 * `vitePlus` owns lint, format, type-check, test and build, so a config that
 * also picks one of those tools would run two formatters over the same files or
 * keep a second source of truth for lint rules (#897). Refused outright rather
 * than given a silent precedence.
 */
function vitePlusConflicts(obj: Record<string, unknown>): string[] {
	const tool = (key: string, field: string) =>
		(obj[key] as Record<string, unknown> | undefined)?.[field]
	const errors: string[] = []
	const linting = tool('linting', 'tool')
	if (linting !== undefined && linting !== 'none') {
		errors.push(`vitePlus replaces linting; linting.tool must be 'none', not '${String(linting)}'`)
	}
	const formatting = tool('formatting', 'tool')
	if (formatting !== undefined && formatting !== 'none') {
		errors.push(
			`vitePlus replaces formatting; formatting.tool must be 'none', not '${String(formatting)}'`
		)
	}
	if (obj.oxlint === true) {
		errors.push('vitePlus pins its own Oxlint; the oxlint add-on would be a second config')
	}
	const framework = tool('testing', 'framework')
	if (framework !== undefined && framework !== 'vitest' && framework !== 'none') {
		errors.push(`vitePlus runs Vitest; testing.framework must be 'vitest' or 'none'`)
	}
	if (obj.bundler !== undefined && obj.bundler !== 'vite') {
		errors.push(`vitePlus builds with its own bundler; bundler must be 'vite'`)
	}
	if (
		obj.projectType !== undefined &&
		obj.projectType !== 'library' &&
		obj.projectType !== 'web-app'
	) {
		errors.push(`vitePlus supports projectType 'library' and 'web-app'`)
	}
	return errors
}

function validateDocs(docs: unknown): string[] {
	if (typeof docs !== 'object' || docs === null || Array.isArray(docs)) {
		return ['docs must be an object']
	}
	const errors: string[] = []
	const { url, deploy, ...rest } = docs as Record<string, unknown>
	for (const key of Object.keys(rest)) errors.push(`Unknown field: docs.${key}`)
	if (url !== undefined && (typeof url !== 'string' || !/^https?:\/\/\S+$/.test(url))) {
		errors.push('docs.url must be an http(s) URL')
	}
	const deploys: readonly unknown[] = CONFIG_SCHEMA.properties.docs.properties.deploy.enum
	if (deploy !== undefined && !deploys.includes(deploy)) {
		errors.push(`docs.deploy must be one of: ${deploys.join(', ')}`)
	}
	return errors
}

export function computeFileList(config: ProjectConfig): string[] {
	// Swift shares the language-agnostic files but none of the package.json-rooted
	// ones, so its list is built by the Swift scaffolder rather than filtered out
	// of this one condition by condition.
	if (config.language === 'swift') return swiftFileList(config)

	const files: string[] = ['package.json', '.repo-tooling.json']
	files.push('.editorconfig', '.nvmrc', '.gitignore', 'knip.json', '.vscode/extensions.json')
	if (config.typescript.enabled) {
		files.push('tsconfig.json', 'reset.d.ts')
	}
	// Libraries get a bundle-size budget plus the `size-limit` script that runs it
	// (#382). The scaffold's exports are root-only, so it's always the static form.
	if (config.projectType === 'library') files.push('.size-limit.json')
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		files.push(BIOME_CONFIG)
	}
	if (config.linting.tool === 'eslint' || config.linting.tool === 'both') {
		files.push('eslint.config.mjs')
	}
	if (config.linting.tool === 'eslint') {
		files.push('prettier.config.mjs')
	}
	// Under Vite+ the test config is the `test` key of vite.config.ts.
	if (config.testing.framework === 'vitest' && !config.vitePlus) {
		files.push('vitest.config.ts', 'vitest.setup.ts')
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
	// Vite+ installs its hooks with `vp config`, into .vite-hooks rather than .husky.
	const hooksDir = config.vitePlus ? '.vite-hooks' : '.husky'
	if (config.gitHooks) {
		files.push(`${hooksDir}/pre-commit`)
	}
	if (config.commitLint) {
		files.push(`${hooksDir}/commit-msg`, 'commitlint.config.mjs')
	}
	files.push('.github/workflows/ci.yml')
	if ((config.projectType === 'library' && config.semanticRelease) || config.changesets) {
		files.push('.github/workflows/release.yml')
	}
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
			'.claude/skills/repo-tooling/SKILL.md',
			'.mcp.json.example',
			'.claude/settings.json'
		)
	}
	if (config.turborepo) files.push('turbo.json')
	if (config.nx) files.push('nx.json')
	if (config.tailwind) files.push('postcss.config.mjs', 'src/styles/globals.css')
	if (config.bun) files.push('bunfig.toml')
	// Only written into a directory with no src/ or app/ yet (#821).
	for (const rel of Object.keys(starterFiles(config))) {
		if (!files.includes(rel)) files.push(rel)
	}
	files.push('README.md')
	return files
}
