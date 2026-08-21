#!/usr/bin/env node

import path from 'node:path'
import chalk from 'chalk'
import { Command } from 'commander'
import fs from 'fs-extra'
import packageJson from '../../package.json' with { type: 'json' }
import { doctorCommand } from './commands/doctor.js'
import { fixCommand } from './commands/fix.js'
import { setupProject } from './commands/setup.js'
import { copyPreset, PRESETS, type PresetName } from './utils/copy-preset.js'

async function isSelfRepo(dir: string): Promise<boolean> {
	try {
		const pkg = await fs.readJson(path.join(dir, 'package.json'))
		return pkg.name === '@rtorcato/repo-tooling'
	} catch {
		return false
	}
}

const program = new Command()

program
	.name('@rtorcato/repo-tooling')
	.description('🛠️  JavaScript and TypeScript tooling setup for modern projects')
	.version(packageJson.version)

program
	.command('setup')
	.alias('init')
	.description('🚀 Setup tooling for a new or existing project')
	.option('-d, --directory <path>', 'Target directory for setup', process.cwd())
	.option('--skip-install', 'Skip installing dependencies')
	.option('--preset <name>', 'Skip prompts; use defaults for a project type')
	.option(
		'-y, --yes',
		'With --preset in a terminal, skip the file-list review and write everything'
	)
	.option(
		'--config <path>',
		'Skip prompts; read a ProjectConfig or .repo-tooling.json lockfile from <path>'
	)
	.option('--dry-run', 'Print the resolved config and file list, write nothing')
	.option('--config-schema', 'Print the JSON Schema for ProjectConfig and exit')
	.action(setupProject)

program
	.command('copy <config>')
	.description('📋 Copy a specific configuration file to current directory')
	.action(async (config: string) => {
		if (!(config in PRESETS)) {
			console.error(chalk.red(`\n❌ Unknown configuration: ${config}`))
			console.log(chalk.gray('Available configurations:'))
			for (const [key, { desc }] of Object.entries(PRESETS)) {
				console.log(`  ${chalk.green('●')} ${chalk.bold(key)}: ${chalk.gray(desc)}`)
			}
			console.log()
			process.exit(1)
		}

		try {
			const result = await copyPreset(config as PresetName)
			console.log(chalk.green(`\n✅ Copied ${result.desc}`))
			console.log(chalk.gray(`   From: ${result.source}`))
			console.log(chalk.gray(`   To:   ${result.target}\n`))
		} catch (error) {
			console.error(chalk.red(`\n❌ Error copying configuration: ${error}\n`))
		}
	})

interface ToolCatalogEntry {
	name: string
	description: string
	exports: string[]
	fixTarget: string | null
}

const TOOL_CATALOG: ToolCatalogEntry[] = [
	{
		name: 'TypeScript',
		description: 'Base, React, Next.js, Node.js, Express, Bun tsconfig presets',
		exports: [
			'@rtorcato/repo-tooling/typescript/base',
			'@rtorcato/repo-tooling/typescript/react',
			'@rtorcato/repo-tooling/typescript/next',
			'@rtorcato/repo-tooling/typescript/node',
			'@rtorcato/repo-tooling/typescript/express',
			'@rtorcato/repo-tooling/typescript/bun',
			'@rtorcato/repo-tooling/typescript/test',
			'@rtorcato/repo-tooling/typescript/reset',
		],
		fixTarget: 'tsconfig',
	},
	{
		name: 'Bun',
		description: 'Bun runtime/test-runner config (bunfig.toml + Bun-typed tsconfig)',
		exports: ['@rtorcato/repo-tooling/typescript/bun'],
		fixTarget: 'bun',
	},
	{
		name: 'ESLint',
		description: 'Base and Next.js ESLint configurations',
		exports: ['@rtorcato/repo-tooling/eslint/base', '@rtorcato/repo-tooling/eslint/nextjs'],
		fixTarget: 'eslint',
	},
	{
		name: 'Biome',
		description: 'Fast formatter and linter configuration',
		exports: ['@rtorcato/repo-tooling/biome'],
		fixTarget: 'biome',
	},
	{
		name: 'Prettier',
		description: 'Code formatter configuration',
		exports: ['@rtorcato/repo-tooling/prettier'],
		fixTarget: 'prettier',
	},
	{
		name: 'Vitest',
		description: 'Testing framework configuration',
		exports: [
			'@rtorcato/repo-tooling/vitest/config',
			'@rtorcato/repo-tooling/vitest/react',
			'@rtorcato/repo-tooling/vitest/setup',
		],
		fixTarget: 'vitest',
	},
	{
		name: 'Jest',
		description: 'Testing framework presets for browser and Node.js',
		exports: [
			'@rtorcato/repo-tooling/jest-presets/browser/jest-preset',
			'@rtorcato/repo-tooling/jest-presets/node/jest-preset',
		],
		fixTarget: null,
	},
	{
		name: 'Playwright',
		description: 'End-to-end testing configuration',
		exports: ['@rtorcato/repo-tooling/playwright'],
		fixTarget: null,
	},
	{
		name: 'Cypress',
		description: 'End-to-end testing configuration',
		exports: ['@rtorcato/repo-tooling/cypress'],
		fixTarget: 'cypress',
	},
	{
		name: 'Commitlint',
		description: 'Conventional commit linting',
		exports: ['@rtorcato/repo-tooling/commitlint/config'],
		fixTarget: 'commitlint',
	},
	{
		name: 'Husky',
		description: 'Git hooks for pre-commit validation',
		exports: [],
		fixTarget: 'husky',
	},
	{
		name: 'lint-staged',
		description: 'Run linters on staged files (pairs with Husky)',
		exports: [],
		fixTarget: 'husky',
	},
	{
		name: 'Semantic Release',
		description: 'Automated versioning and publishing',
		exports: [
			'@rtorcato/repo-tooling/semantic-release',
			'@rtorcato/repo-tooling/semantic-release/github',
			'@rtorcato/repo-tooling/semantic-release/docker',
		],
		fixTarget: 'semantic-release',
	},
	{
		name: 'Changesets',
		description: 'Monorepo-friendly release tool (alternative to semantic-release)',
		exports: ['@rtorcato/repo-tooling/changesets'],
		fixTarget: 'changesets',
	},
	{
		name: 'Release Please',
		description: 'Release-PR-driven release tool (alternative to semantic-release)',
		exports: ['@rtorcato/repo-tooling/release-please'],
		fixTarget: 'release-please',
	},
	{
		name: 'Oxlint',
		description: 'Rust-based linter (additive to Biome/ESLint)',
		exports: ['@rtorcato/repo-tooling/oxlint'],
		fixTarget: 'oxlint',
	},
	{
		name: 'tsup',
		description: 'TypeScript bundler configuration',
		exports: ['@rtorcato/repo-tooling/tsup'],
		fixTarget: null,
	},
	{
		name: 'TypeDoc',
		description: 'API documentation generation for TypeScript library projects',
		exports: ['@rtorcato/repo-tooling/typedoc'],
		fixTarget: 'typedoc',
	},
	{
		name: 'Docs site',
		description: 'Docusaurus docs site (apps/docs) with shared tokens + GitHub Pages deploy',
		exports: [],
		fixTarget: 'docs-site',
	},
	{
		name: 'esbuild',
		description: 'Fast JavaScript bundler configuration',
		exports: ['@rtorcato/repo-tooling/esbuild'],
		fixTarget: null,
	},
	{
		name: 'Vite',
		description: 'Modern web app build tool configuration',
		exports: ['@rtorcato/repo-tooling/vite'],
		fixTarget: null,
	},
	{
		name: 'EditorConfig',
		description: 'Cross-editor formatting consistency (.editorconfig)',
		exports: [],
		fixTarget: 'editorconfig',
	},
	{
		name: '.nvmrc',
		description: 'Pin Node version per repository',
		exports: [],
		fixTarget: 'nvmrc',
	},
	{
		name: 'knip',
		description: 'Find unused files, exports, and dependencies',
		exports: [],
		fixTarget: 'knip',
	},
	{
		name: 'Dependabot',
		description: 'Weekly automated dependency updates',
		exports: [],
		fixTarget: 'dependabot',
	},
	{
		name: 'Renovate',
		description: 'Weekly automated dependency updates (alternative to Dependabot)',
		exports: [],
		fixTarget: 'renovate',
	},
	{
		name: 'CodeQL',
		description: 'GitHub security scanning workflow',
		exports: [],
		fixTarget: 'codeql',
	},
	{
		name: 'SwiftLint',
		description: 'Swift linter configuration (lint + --fix; pairs with `swiftlint --strict` in CI)',
		exports: [],
		fixTarget: 'swiftlint',
	},
	{
		name: 'Periphery',
		description: 'Swift dead-code scanner configuration (retains public API for SwiftPM libraries)',
		exports: [],
		fixTarget: 'periphery',
	},
	{
		name: 'Ruff',
		description:
			'Python linter and formatter in one tool (replaces flake8, isort, pyupgrade, black)',
		exports: [],
		fixTarget: 'ruff',
	},
	{
		name: 'mypy',
		description:
			'Python static type checker configuration (strict on your code, lenient on untyped deps)',
		exports: [],
		fixTarget: 'mypy',
	},
	{
		name: 'pytest',
		description: 'Python test runner configuration (strict markers and config, warnings as errors)',
		exports: [],
		fixTarget: 'pytest',
	},
	{
		name: 'Perl::Critic',
		description: 'Perl linter configuration (severity 3, with the family rule exceptions)',
		exports: [],
		fixTarget: 'perlcritic',
	},
	{
		name: 'perltidy',
		description: 'Perl formatter configuration (Perl Best Practices layout at 100 columns)',
		exports: [],
		fixTarget: 'perltidy',
	},
	{
		name: 'AI Agent Setup',
		description: 'Scaffold AGENTS.md, CLAUDE.md, Cursor/Copilot rules, Claude skill, MCP example',
		exports: [],
		fixTarget: 'ai',
	},
	{
		name: 'Claude skills',
		description:
			'Install the ai-issue-loop skill into ~/.claude/skills (user-global, opt-in — see --skills-dir)',
		exports: [],
		fixTarget: 'claude-skills',
	},
]

program
	.command('list')
	.alias('ls')
	.description('📋 List all available tooling configurations')
	.option('--json', 'Emit machine-readable JSON output')
	.action((options: { json?: boolean }) => {
		if (options.json) {
			console.log(JSON.stringify({ tools: TOOL_CATALOG }, null, 2))
			return
		}

		console.log(chalk.cyan('\n🛠️  Available tooling configurations:\n'))
		for (const { name, description } of TOOL_CATALOG) {
			console.log(`  ${chalk.green('●')} ${chalk.bold(name)}: ${chalk.gray(description)}`)
		}
		console.log(chalk.dim('\n💡 Run `repo-tooling setup` for a new project'))
		console.log(chalk.dim('   or `repo-tooling fix` to apply missing pieces to an existing one\n'))
	})

program
	.command('doctor')
	.description('🩺 Diagnose project alignment with @rtorcato/repo-tooling presets')
	.option('-d, --directory <path>', 'Target directory to diagnose', process.cwd())
	.option('--json', 'Emit machine-readable JSON output')
	// The read side of `fix --skills-dir` (#485). No --yes/--json requirement
	// here: doctor never writes, so an unresolved directory is just reported.
	.option(
		'--skills-dir <path>',
		'Where `fix claude-skills` installs user-global agent skills (default: ~/.claude/skills). Pass the same path `fix` was given, or the skill reports as not installed'
	)
	.action(doctorCommand)

program
	.command('fix [target]')
	.description('🔧 Apply scaffolders for items doctor flagged')
	.option('-d, --directory <path>', 'Target directory', process.cwd())
	.option('--yes', 'Assume yes to all prompts (including drift overwrites)')
	.option('--dry-run', 'Print what would change without writing files')
	.option('--json', 'Emit machine-readable JSON output (implies --yes)')
	.option('--list', 'List all registered fix targets and exit')
	.option('--resync', 'Re-scaffold every file recorded in .repo-tooling.json')
	.option('--diff', 'Show a unified diff of each change before confirming')
	.option(
		'--skills-dir <path>',
		'Where `fix claude-skills` installs user-global agent skills (default: ~/.claude/skills). Required with --yes/--json when that directory does not exist'
	)
	// Deliberately not folded into --yes: unattended runs pass --yes, and this is
	// the one overwrite that destroys work living outside the repo (#480).
	.option(
		'--force-skills',
		'Let `fix claude-skills` overwrite a locally modified skill instead of refusing'
	)
	.action((target: string | undefined, options) =>
		fixCommand(target, {
			directory: options.directory,
			yes: options.yes,
			dryRun: options.dryRun,
			json: options.json,
			list: options.list,
			resync: options.resync,
			diff: options.diff,
			skillsDir: options.skillsDir,
			forceSkills: options.forceSkills,
		})
	)

program.hook('preAction', async (_, actionCommand) => {
	const name = actionCommand.name()
	if (name === 'setup' || name === 'doctor' || name === 'fix') {
		// `fix --list` is read-only and safe to run anywhere, including this repo.
		if (name === 'fix' && actionCommand.opts().list) return
		// Dogfood escape hatch (#273): allow read-only `doctor` against this repo
		// so CI can audit our own config the same way it does consumers'. Scoped
		// to doctor — the mutating setup/fix stay blocked even with the flag set.
		if (name === 'doctor' && process.env.REPO_TOOLING_ALLOW_SELF === '1') return
		const dir = (actionCommand.opts().directory as string | undefined) ?? process.cwd()
		if (await isSelfRepo(dir)) {
			console.log(
				chalk.yellow(
					'\n⚠️  This command cannot be run inside the @rtorcato/repo-tooling repo itself.\n'
				)
			)
			console.log(
				chalk.gray('   setup and doctor are for consumer projects, not for the tooling repo.\n')
			)
			process.exit(0)
		}
	}
})

// Handle unknown commands
program.on('command:*', () => {
	console.error(chalk.red(`\n❌ Unknown command: ${program.args.join(' ')}`))
	console.log(chalk.gray('See --help for a list of available commands.\n'))
	process.exit(1)
})

// Show help if no arguments
if (!process.argv.slice(2).length) {
	program.outputHelp()
}

program.parse()
