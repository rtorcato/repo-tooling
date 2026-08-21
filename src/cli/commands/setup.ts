import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import inquirer from 'inquirer'
import { LANGUAGES, type LanguageModule } from '../../languages/registry.js'
import { generateConfigs } from '../generators/index.js'
import { detectLanguage } from '../utils/detect-language.js'
import { formatGeneratedFiles } from '../utils/format.js'
import { installDependencies } from '../utils/install.js'
import { LOCKFILE_NAME, writeLockfile } from '../utils/lockfile.js'
import {
	buildPresetConfig,
	computeFileList,
	CONFIG_SCHEMA,
	PRESET_NAMES,
	type PresetName,
	validateProjectConfig,
} from './setup-presets.js'

export interface ProjectConfig {
	projectName: string
	/**
	 * Primary language of the repo. Optional for backward compat — lockfiles
	 * written before v2 lack it and are migrated to 'js' on read. New setups
	 * always record it. Part of the multi-language seam (#139/#140).
	 */
	language?: 'js' | 'swift' | 'perl' | 'python'
	projectType: 'library' | 'web-app' | 'node-api' | 'nextjs-app' | 'react-app'
	typescript: {
		enabled: boolean
		config: 'base' | 'react' | 'next' | 'node' | 'express'
	}
	linting: {
		tool: 'biome' | 'eslint' | 'both' | 'none'
		eslintConfig?: 'base' | 'nextjs'
	}
	formatting: {
		tool: 'biome' | 'prettier' | 'none'
	}
	testing: {
		framework: 'vitest' | 'jest' | 'playwright' | 'cypress' | 'none'
		environment?: 'node' | 'browser' | 'both'
	}
	gitHooks: boolean
	commitLint: boolean
	semanticRelease: boolean
	changesets?: boolean
	releasePlease?: boolean
	oxlint?: boolean
	securityAutomation: boolean
	bundler: 'tsup' | 'esbuild' | 'rollup' | 'rolldown' | 'vite' | 'none'
	treeshakeCheck?: boolean
	/** Add publint (validates package.json + dist for publishing mistakes). */
	publint?: boolean
	/** Add a status-badge block to the generated README. */
	badges?: boolean
	/** Scaffold AI agent files (AGENTS.md, CLAUDE.md, Cursor/Copilot, Claude skill, MCP example). */
	aiSetup?: boolean
	/** Scaffold a turbo.json task pipeline (pnpm-workspace monorepos). */
	turborepo?: boolean
	/** Scaffold an nx.json task orchestrator (Turborepo alternative). */
	nx?: boolean
	/** Scaffold Tailwind CSS v4 (PostCSS plugin + CSS entry) for frontend projects. */
	tailwind?: boolean
	/** Scaffold a Docusaurus docs site under apps/docs (deployed to GitHub Pages). */
	docsSite?: boolean
	/**
	 * Target the Bun runtime (#225): a runtime flag on the existing project types,
	 * not a distinct projectType — most Bun consumers still ship Node-compatible
	 * libraries. When set, setup emits a bunfig.toml and the Bun-typed tsconfig.
	 */
	bun?: boolean
}

export interface SetupOptions {
	directory: string
	skipInstall?: boolean
	config?: string
	preset?: string
	dryRun?: boolean
	configSchema?: boolean
	/** Accept a `--preset` as-is instead of reviewing it in an interactive terminal. */
	yes?: boolean
}

/**
 * The opinionated extras a preset turns on, in the order they're offered for
 * review. Each one writes files (or a README block) the user never asked for by
 * name, which is the complaint in #461.
 */
const REVIEWABLE_FEATURES = [
	{ key: 'gitHooks', label: 'Git hooks (Husky + lint-staged)' },
	{ key: 'commitLint', label: 'Conventional commit linting (commitlint)' },
	{ key: 'semanticRelease', label: 'Automated releases (semantic-release)' },
	{ key: 'securityAutomation', label: 'Security automation (Dependabot + CodeQL)' },
	{ key: 'badges', label: 'README status badges' },
	{ key: 'aiSetup', label: 'AI agent rules (AGENTS.md, CLAUDE.md, Cursor, Copilot)' },
] as const satisfies ReadonlyArray<{ key: keyof ProjectConfig; label: string }>

/**
 * A preset run may only ask questions when a human is on both ends of the pipe.
 * Redirect either direction and this is CI — the case `--preset` exists for —
 * where the one-shot behaviour has to stay exactly as it was.
 */
function isInteractiveTerminal(): boolean {
	return process.stdin.isTTY === true && process.stdout.isTTY === true
}

/**
 * Show what the preset resolved to and let the user drop parts of it before a
 * single file is written (#461).
 */
async function reviewPresetConfig(config: ProjectConfig): Promise<ProjectConfig> {
	const files = computeFileList(config)
	console.log(chalk.cyan(`\n📄 This preset writes ${files.length} files:\n`))
	for (const file of files) console.log(chalk.gray(`   ${file}`))
	console.log()

	const enabled = REVIEWABLE_FEATURES.filter((feature) => config[feature.key] === true)
	if (enabled.length === 0) return config

	const { features } = await inquirer.prompt([
		{
			type: 'checkbox',
			name: 'features',
			message: '🧹 Uncheck anything you do not want:',
			choices: enabled.map((feature) => ({
				name: feature.label,
				value: feature.key,
				checked: true,
			})),
		},
	])

	const kept = new Set(features as string[])
	const reviewed = { ...config }
	for (const feature of enabled) {
		if (!kept.has(feature.key)) reviewed[feature.key] = false
	}
	return reviewed
}

/** `null` means the run was declined, not that it failed — see promptForConfig. */
async function resolveConfig(options: SetupOptions): Promise<ProjectConfig | null> {
	if (options.config && options.preset) {
		console.warn(chalk.yellow('⚠️  Both --config and --preset given; --config wins.\n'))
	}
	if (options.config) {
		const configPath = path.resolve(options.config)
		if (!(await fs.pathExists(configPath))) {
			throw new Error(`Config file not found: ${configPath}`)
		}
		const raw = await fs.readJson(configPath)
		// Accept the `.repo-tooling.json` lockfile itself as the config source, so a
		// repo needs only one file: the lockfile already embeds the full
		// ProjectConfig under `config`. Unwrap it here rather than requiring a
		// separate hand-authored config file (#271).
		const candidate =
			typeof raw === 'object' && raw !== null && 'config' in raw && 'version' in raw
				? (raw as { config: unknown }).config
				: raw
		const { valid, errors } = validateProjectConfig(candidate)
		if (!valid) {
			throw new Error(`Invalid config:\n  - ${errors.join('\n  - ')}`)
		}
		return candidate as ProjectConfig
	}
	if (options.preset) {
		if (!(PRESET_NAMES as readonly string[]).includes(options.preset)) {
			throw new Error(`Unknown preset: ${options.preset}. Available: ${PRESET_NAMES.join(', ')}`)
		}
		const projectName = path.basename(path.resolve(options.directory))
		const config = buildPresetConfig(options.preset as PresetName, projectName)
		if (options.dryRun || options.yes || !isInteractiveTerminal()) return config
		return reviewPresetConfig(config)
	}
	return promptForConfig(path.resolve(options.directory))
}

export async function setupProject(options: SetupOptions) {
	if (options.configSchema) {
		console.log(JSON.stringify(CONFIG_SCHEMA, null, 2))
		return
	}

	const targetDir = path.resolve(options.directory)
	const interactive = !options.config && !options.preset
	const dryRun = options.dryRun === true

	if (interactive && !dryRun) {
		console.log(chalk.cyan('\n🛠️  Welcome to JS Tooling Setup!\n'))
		console.log(chalk.gray(`Setting up tooling in: ${targetDir}\n`))
	}

	try {
		await fs.ensureDir(targetDir)
		const config = await resolveConfig(options)
		// The language picker bails out for a language whose module hasn't landed
		// yet. It has already explained why — scaffolding a JS project into a Swift
		// repo would be worse than doing nothing.
		if (config === null) return

		if (dryRun) {
			const files = computeFileList(config)
			console.log(JSON.stringify({ directory: targetDir, config, files }, null, 2))
			return
		}

		if (!interactive) {
			const shape = config.language === 'swift' ? `Swift ${config.projectType}` : config.projectType
			console.log(chalk.cyan(`\n🛠️  Scaffolding ${shape} in ${targetDir}\n`))
		}
		console.log(chalk.cyan('\n📝 Generating configuration files...\n'))

		await generateConfigs(config, targetDir)
		await writeLockfile(targetDir, config)

		// Both steps shell out to pnpm. A Swift package has no dependencies to
		// install and no Biome to format with — SwiftPM resolves on first build,
		// and `swiftlint --fix` is the formatter (it needs a Swift toolchain we
		// can't assume is present).
		if (!options.skipInstall && config.language !== 'swift') {
			console.log(chalk.cyan('\n📦 Installing dependencies...\n'))
			await installDependencies(config, targetDir)
			// Format now that the linter/formatter is installed, so the scaffold
			// passes its own `pnpm check` out of the box (templates are written by
			// hand and don't match biome/prettier whitespace).
			await formatGeneratedFiles(config, targetDir)
		}

		console.log(chalk.green('\n✅ Setup completed successfully!\n'))
		showNextSteps(config, targetDir)
	} catch (error) {
		console.error(chalk.red('\n❌ Setup failed:'), error)
		process.exit(1)
	}
}

/**
 * Languages `setup` can scaffold. Deliberately separate from the registry's
 * `supported` flag, which means "has doctor/fix checks" — a language can be
 * auditable before it's scaffoldable (Swift was, between #286 and #288). Both
 * the picker label and the gate below read from here, so the two can't drift.
 */
const SCAFFOLDABLE: ReadonlyArray<LanguageModule['id']> = ['js', 'swift']

/**
 * Ask which language this repo is, defaulting to whatever the target dir looks
 * like. Languages setup can't scaffold yet are still offered — hiding them reads
 * as "repo-tooling is JS-only" when the honest answer is "not yet" (#139).
 */
async function promptForLanguage(targetDir: string): Promise<LanguageModule> {
	const detected = await detectLanguage(targetDir)
	const { language } = await inquirer.prompt([
		{
			type: 'select',
			name: 'language',
			message: '🗣️  What is the primary language of this repo?',
			choices: Object.values(LANGUAGES).map((module) => ({
				name: SCAFFOLDABLE.includes(module.id)
					? module.label
					: `${module.label} (${module.supported ? 'doctor/fix only — no setup preset yet' : 'setup lands with its module'})`,
				value: module.id,
			})),
			// 'unknown' is a bare dir mid-setup — JS is the historical default.
			default: detected === 'unknown' ? 'js' : detected,
		},
	])
	return LANGUAGES[language as LanguageModule['id']]
}

function explainNotScaffoldable(module: LanguageModule) {
	console.log(chalk.yellow(`\n⚠️  ${module.label} scaffolding isn't available yet.\n`))
	console.log(
		chalk.gray(
			module.supported
				? `   doctor and fix already audit ${module.label} repos — both the language-agnostic\n` +
						`   checks (CI, CodeQL, Dependabot, GitHub repo settings) and the ${module.label}-specific\n` +
						'   ones:\n'
				: `   doctor and fix already cover ${module.label} repos with the language-agnostic\n` +
						'   checks (CI, CodeQL, Dependabot, GitHub repo settings):\n'
		)
	)
	console.log(chalk.gray('     npx @rtorcato/repo-tooling doctor\n'))
	console.log(
		chalk.gray(
			`   ${module.label} setup presets are tracked at\n` +
				'   https://github.com/rtorcato/repo-tooling/issues/139\n'
		)
	)
}

/** `null` when the chosen language has no scaffolding yet; nothing is written. */
async function promptForConfig(targetDir: string): Promise<ProjectConfig | null> {
	const language = await promptForLanguage(targetDir)

	// Gate on SCAFFOLDABLE, not `module.supported` — Swift is supported (#286)
	// but has no preset yet (#288), and falling through here would write a
	// package.json into a Swift repo.
	if (!SCAFFOLDABLE.includes(language.id)) {
		explainNotScaffoldable(language)
		return null
	}

	// Swift has exactly one shape to scaffold, so there is nothing to ask beyond
	// the name: SwiftLint, Periphery and `swift test` are the standard, not
	// options (see the `swift-library` preset). A wizard whose every question has
	// one answer is worse than no wizard.
	if (language.id === 'swift') {
		const { projectName } = await inquirer.prompt([
			{
				type: 'input',
				name: 'projectName',
				message: '📦 What is your package name?',
				default: path.basename(targetDir),
				validate: (input: string) => input.trim().length > 0 || 'Package name is required',
			},
		])
		return buildPresetConfig('swift-library', projectName)
	}

	// Narrowing for the question list below, which is JS-shaped throughout.
	if (language.id !== 'js') return null

	// Turborepo only makes sense in a pnpm-workspace monorepo, so the prompt is
	// only offered when one is already present in the target dir.
	const hasWorkspace = await fs.pathExists(path.join(targetDir, 'pnpm-workspace.yaml'))
	const answers = await inquirer.prompt([
		{
			type: 'input',
			name: 'projectName',
			message: '📦 What is your project name?',
			default: path.basename(process.cwd()),
			validate: (input: string) => input.trim().length > 0 || 'Project name is required',
		},
		{
			type: 'select',
			name: 'projectType',
			message: '🏗️  What type of project are you building?',
			choices: [
				{ name: '📚 Library/Package', value: 'library' },
				{ name: '🌐 Web Application', value: 'web-app' },
				{ name: '🚀 Node.js API', value: 'node-api' },
				{ name: '⚡ Next.js App', value: 'nextjs-app' },
				{ name: '⚛️  React App', value: 'react-app' },
			],
		},
		{
			type: 'confirm',
			name: 'useTypeScript',
			message: '📘 Do you want to use TypeScript?',
			default: true,
		},
		{
			type: 'select',
			name: 'tsConfig',
			message: '⚙️  Which TypeScript configuration?',
			choices: (answers: any) => {
				const baseChoices = [
					{ name: '🔧 Base (General purpose)', value: 'base' },
					{ name: '🖥️  Node.js', value: 'node' },
				]

				if (answers.projectType === 'nextjs-app') {
					return [{ name: '⚡ Next.js', value: 'next' }, ...baseChoices]
				}
				if (answers.projectType === 'react-app' || answers.projectType === 'web-app') {
					return [{ name: '⚛️  React', value: 'react' }, ...baseChoices]
				}
				if (answers.projectType === 'node-api') {
					return [
						{ name: '🚀 Express/API', value: 'express' },
						{ name: '🖥️  Node.js', value: 'node' },
					]
				}

				return baseChoices
			},
			when: (answers: any) => answers.useTypeScript,
		},
		{
			type: 'select',
			name: 'lintingTool',
			message: '🔍 Which linting/formatting tool?',
			choices: [
				{ name: '⚡ Biome (Fast, all-in-one)', value: 'biome' },
				{ name: '🔧 ESLint (Configurable)', value: 'eslint' },
				{ name: '🔥 Both Biome + ESLint', value: 'both' },
				{ name: '❌ None', value: 'none' },
			],
			default: 'biome',
		},
		{
			type: 'select',
			name: 'eslintConfig',
			message: '🔧 Which ESLint configuration?',
			choices: (answers: any) => {
				const choices = [{ name: '🔧 Base configuration', value: 'base' }]
				if (answers.projectType === 'nextjs-app') {
					choices.unshift({ name: '⚡ Next.js configuration', value: 'nextjs' })
				}
				return choices
			},
			when: (answers: any) => answers.lintingTool === 'eslint' || answers.lintingTool === 'both',
		},
		{
			type: 'confirm',
			name: 'oxlint',
			message: '🦀 Also run Oxlint alongside (50–100× faster than ESLint)?',
			default: false,
			when: (answers: any) => answers.lintingTool !== 'none',
		},
		{
			type: 'select',
			name: 'testingFramework',
			message: '🧪 Which testing framework?',
			choices: [
				{ name: '⚡ Vitest (Fast, Vite-powered)', value: 'vitest' },
				{ name: '🃏 Jest (Traditional)', value: 'jest' },
				{ name: '🎭 Playwright (E2E)', value: 'playwright' },
				{ name: '🌲 Cypress (E2E)', value: 'cypress' },
				{ name: '❌ None', value: 'none' },
			],
			default: 'vitest',
		},
		{
			type: 'select',
			name: 'testEnvironment',
			message: '🌍 Test environment?',
			choices: [
				{ name: '🖥️  Node.js', value: 'node' },
				{ name: '🌐 Browser (DOM)', value: 'browser' },
				{ name: '🔄 Both', value: 'both' },
			],
			when: (answers: any) => answers.testingFramework === 'jest',
			default: 'node',
		},
		{
			type: 'confirm',
			name: 'gitHooks',
			message: '🪝 Set up Git hooks (Husky + lint-staged)?',
			default: true,
		},
		{
			type: 'confirm',
			name: 'commitLint',
			message: '📝 Set up conventional commit linting?',
			default: true,
			when: (answers: any) => answers.gitHooks,
		},
		{
			type: 'select',
			name: 'releaseTool',
			message: '🚀 Automated release tool?',
			choices: [
				{ name: '📦 semantic-release (commit-message-driven)', value: 'semantic-release' },
				{ name: '📝 Changesets (changeset-file-driven, monorepo-friendly)', value: 'changesets' },
				{ name: '🙏 Release Please (Google, release-PR-driven)', value: 'release-please' },
				{ name: '❌ None', value: 'none' },
			],
			default: 'semantic-release',
			when: (answers: any) => answers.projectType === 'library',
		},
		{
			type: 'confirm',
			name: 'treeshakeCheck',
			message: '🌳 Add a tree-shake verification check (apps/treeshake-check)?',
			default: false,
			when: (answers: any) => answers.projectType === 'library',
		},
		{
			type: 'confirm',
			name: 'publint',
			message: '📦 Add publint to lint your package before publishing?',
			default: true,
			when: (answers: any) => answers.projectType === 'library',
		},
		{
			type: 'confirm',
			name: 'badges',
			message: '🔖 Add status badges (CI, npm, coverage, license) to the README?',
			default: true,
		},
		{
			type: 'confirm',
			name: 'securityAutomation',
			message: '🛡️  Include security automation (Dependabot + CodeQL)?',
			default: true,
		},
		{
			type: 'confirm',
			name: 'aiSetup',
			message: '🤖 Add AI agent rules (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill)?',
			default: true,
		},
		{
			type: 'select',
			name: 'orchestrator',
			message: '🚀 Monorepo task orchestrator?',
			choices: [
				{ name: '⚡ Turborepo (turbo.json)', value: 'turbo' },
				{ name: '🔷 Nx (nx.json)', value: 'nx' },
				{ name: '❌ None', value: 'none' },
			],
			default: 'turbo',
			when: () => hasWorkspace,
		},
		{
			type: 'confirm',
			name: 'tailwind',
			message: '🎨 Add Tailwind CSS v4 (PostCSS plugin + globals.css)?',
			default: true,
			// Only meaningful for frontend project types.
			when: (answers: any) =>
				answers.projectType === 'web-app' ||
				answers.projectType === 'react-app' ||
				answers.projectType === 'nextjs-app',
		},
		{
			type: 'select',
			name: 'bundler',
			message: '📦 Which bundler/build tool?',
			choices: (answers: any) => {
				const choices = [
					{ name: '📦 tsup (TypeScript packages)', value: 'tsup' },
					{ name: '⚡ esbuild (Fast bundling)', value: 'esbuild' },
					{ name: '🍣 Rollup (library bundler)', value: 'rollup' },
					{ name: '🦀 Rolldown (Rust, Rollup-compatible)', value: 'rolldown' },
					{ name: '❌ None', value: 'none' },
				]

				if (answers.projectType === 'web-app' || answers.projectType === 'react-app') {
					choices.unshift({ name: '⚡ Vite (Modern web apps)', value: 'vite' })
				}

				return choices
			},
			when: (answers: any) => answers.projectType !== 'nextjs-app', // Next.js has its own bundler
		},
		{
			type: 'confirm',
			name: 'bun',
			message: '🥟 Target the Bun runtime (bunfig.toml + Bun-typed tsconfig)?',
			default: false,
			// A runtime flag, not a project type — offer it for Node-compatible
			// library/API targets, not the browser-framework types.
			when: (answers: any) =>
				answers.projectType === 'library' || answers.projectType === 'node-api',
		},
	])

	return {
		projectName: answers.projectName,
		// The real answer from the language question above, not a hardcoded 'js'
		// (#284) — the lockfile is what doctor/fix gate on later.
		language: language.id,
		projectType: answers.projectType,
		typescript: {
			enabled: answers.useTypeScript || false,
			config: answers.tsConfig || 'base',
		},
		linting: {
			tool: answers.lintingTool || 'none',
			eslintConfig: answers.eslintConfig,
		},
		formatting: {
			tool:
				answers.lintingTool === 'biome' || answers.lintingTool === 'both'
					? 'biome'
					: answers.lintingTool === 'eslint'
						? 'prettier'
						: 'none',
		},
		testing: {
			framework: answers.testingFramework || 'none',
			environment: answers.testEnvironment,
		},
		gitHooks: answers.gitHooks || false,
		commitLint: answers.commitLint || false,
		semanticRelease: answers.releaseTool === 'semantic-release',
		changesets: answers.releaseTool === 'changesets',
		releasePlease: answers.releaseTool === 'release-please',
		oxlint: answers.oxlint || false,
		securityAutomation: answers.securityAutomation ?? false,
		bundler: answers.bundler || 'none',
		treeshakeCheck: answers.treeshakeCheck || false,
		publint: answers.publint ?? false,
		badges: answers.badges ?? false,
		aiSetup: answers.aiSetup ?? false,
		turborepo: answers.orchestrator === 'turbo',
		nx: answers.orchestrator === 'nx',
		tailwind: answers.tailwind ?? false,
		bun: answers.bun ?? false,
	}
}

function showNextSteps(config: ProjectConfig, _targetDir: string) {
	console.log(chalk.bold('\n📋 Next Steps:\n'))

	const steps = []

	// Every step in the else-branch names a pnpm script. Swift's equivalents are
	// SwiftPM and SwiftLint commands — and neither tool ships with the scaffold,
	// so the last line is how to get them.
	if (config.language === 'swift') {
		steps.push(
			'🏗️  Build with: swift build',
			'🧪 Run tests with: swift test',
			'🔍 Lint and format with: swiftlint --fix (CI runs swiftlint lint --strict)',
			'🧹 Find dead code with: periphery scan',
			'📦 Install both tools with: brew install swiftlint periphery'
		)
	} else {
		if (config.typescript.enabled) {
			steps.push('🔧 Customize your tsconfig.json as needed')
		}

		if (config.linting.tool !== 'none') {
			steps.push(
				`🔍 Run linting with: ${config.linting.tool === 'biome' ? 'pnpm biome check .' : 'pnpm eslint .'}`
			)
		}

		if (config.testing.framework !== 'none') {
			steps.push(`🧪 Run tests with: pnpm ${config.testing.framework}`)
		}

		if (config.gitHooks) {
			steps.push('🪝 Commit your changes to test the git hooks')
		}
	}

	steps.push(
		`🔒 ${LOCKFILE_NAME} records your setup choices — doctor uses it to suppress intentional opt-outs`
	)
	steps.push('📖 Check the generated README.md for more details')

	steps.forEach((step, index) => {
		console.log(`  ${index + 1}. ${step}`)
	})

	const skipped = collectSkippedFixSuggestions(config)
	if (skipped.length > 0) {
		console.log(chalk.bold('\n💡 Want to add something you skipped?\n'))
		for (const s of skipped) {
			console.log(`  ${chalk.gray('-')} ${s}`)
		}
	}

	console.log(
		chalk.dim('\n📁 All configuration files have been generated in your project directory.')
	)
	console.log(chalk.dim('   You can modify them to suit your specific needs.\n'))
}

function collectSkippedFixSuggestions(config: ProjectConfig): string[] {
	const suggestions: string[] = []
	// Every suggestion below is a JS fix target (husky, biome, vitest…). On a
	// Swift repo they'd all be wrong — `fix` doesn't even offer them there — so
	// the Swift scaffold gets only the doctor line at the end.
	if (config.language === 'swift') {
		return ['Run `npx @rtorcato/repo-tooling doctor` any time to audit drift']
	}
	if (!config.gitHooks) {
		suggestions.push('Run `npx @rtorcato/repo-tooling fix husky` to add git hooks later')
	}
	if (!config.commitLint) {
		suggestions.push(
			'Run `npx @rtorcato/repo-tooling fix commitlint` to add conventional-commit linting'
		)
	}
	if (!config.semanticRelease && config.projectType === 'library') {
		suggestions.push(
			'Run `npx @rtorcato/repo-tooling fix semantic-release` to add automated releases'
		)
	}
	if (!config.securityAutomation) {
		suggestions.push(
			'Run `npx @rtorcato/repo-tooling fix dependabot` and `fix codeql` for security automation'
		)
	}
	if (config.linting.tool === 'none') {
		suggestions.push('Run `npx @rtorcato/repo-tooling fix biome` or `fix eslint` to add linting')
	}
	if (config.testing.framework === 'none') {
		suggestions.push('Run `npx @rtorcato/repo-tooling fix vitest` to add a test runner')
	}
	if (config.projectType === 'library' && !config.treeshakeCheck) {
		suggestions.push(
			'Run `npx @rtorcato/repo-tooling fix treeshake-check` to add an esbuild-based tree-shake assertion'
		)
	}
	suggestions.push('Run `npx @rtorcato/repo-tooling doctor` any time to audit drift')
	return suggestions
}
