#!/usr/bin/env node

import chalk from 'chalk'
import { Command } from 'commander'
import { doctorCommand } from './commands/doctor.js'
import { fixCommand, printFixTargets } from './commands/fix.js'
import { setupProject } from './commands/setup.js'
import { selfRepoRefusal } from './self-repo.js'
import { copyPreset, PRESETS, type PresetName } from './utils/copy-preset.js'
import { getToolVersion } from './utils/version.js'

const program = new Command()

program
	.name('@rtorcato/repo-tooling')
	.description(
		'🛠️  Scaffold and audit project tooling: JavaScript/TypeScript, Swift, Python and Perl'
	)
	.version(await getToolVersion())

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
	.option(
		'--no-ai-setup',
		'Skip the AI agent files (AGENTS.md, CLAUDE.md, .claude/, .cursor/, Copilot, .mcp.json.example)'
	)
	.option('--dry-run', 'Print the resolved config and file list, write nothing')
	.option('--config-schema', 'Print the JSON Schema for ProjectConfig and exit')
	// Seeds the wizard, never skips it (#563) — every answer is still yours.
	.option(
		'--from <owner/repo>',
		"Seed the wizard's defaults from that repo's .repo-tooling.json instead of the built-in ones (read via `gh`)"
	)
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

program
	.command('list')
	.alias('ls')
	.description('📋 List every fix target (the same registry as `fix --list`)')
	.option('--json', 'Emit machine-readable JSON output')
	.action((options: { json?: boolean }) =>
		printFixTargets(options.json === true, { legacyTools: true })
	)

program
	.command('doctor')
	.description('🩺 Diagnose project alignment with @rtorcato/repo-tooling presets')
	.option('-d, --directory <path>', 'Target directory to diagnose', process.cwd())
	.option('--json', 'Emit machine-readable JSON output')
	// CI gates (#755): live GitHub state depends on timing and on who runs it.
	.option('--offline', 'Skip checks that read live GitHub state via `gh` (for CI gates)')
	// Rules are per-repo (#563): this compares them against another repo's, and
	// only reports. Never drift, never a fixer, never part of the exit code.
	.option(
		'--rules-from <owner/repo>',
		"Report how this repo's config and rules differ from that repo's .repo-tooling.json (informational; read via `gh`)"
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
	.action((target: string | undefined, options) =>
		fixCommand(target, {
			directory: options.directory,
			yes: options.yes,
			dryRun: options.dryRun,
			json: options.json,
			list: options.list,
			resync: options.resync,
			diff: options.diff,
		})
	)

// The ai-issue-loop pipeline moved to @infrazero/repo-ai (#658). Kept as a
// pointer so a stale skill calling `repo-tooling loop …` fails loudly with the
// fix, instead of commander's generic "unknown command".
program
	.command('loop', { hidden: true })
	.argument('[args...]')
	.allowUnknownOption()
	.helpOption(false)
	.action(() => {
		console.error(
			chalk.red('`repo-tooling loop` moved to @infrazero/repo-ai.') +
				'\n  Run `npx @infrazero/repo-ai loop …`, and refresh the skills with' +
				'\n  `npx @infrazero/repo-ai fix claude-skills --force-skills`.'
		)
		process.exitCode = 1
	})

// The docs-site and brand scaffolds moved to @rtorcato/shared-docs (#718). The
// fix targets stay as hidden pointers so old instructions fail with the fix.
const MOVED_TARGETS: Record<string, string> = { 'docs-site': 'init', brand: 'brand' }

program.hook('preAction', async (_, actionCommand) => {
	const target = actionCommand.args[0]
	if (actionCommand.name() === 'fix' && target && Object.hasOwn(MOVED_TARGETS, target)) {
		console.error(
			chalk.red(`\`repo-tooling fix ${target}\` moved to @rtorcato/shared-docs.`) +
				`\n  Run \`npx @rtorcato/shared-docs ${MOVED_TARGETS[target]}\` instead.`
		)
		process.exit(1)
	}
	const refusal = await selfRepoRefusal(
		actionCommand.name(),
		actionCommand.args[0],
		actionCommand.opts()
	)
	if (refusal) {
		console.log(
			chalk.yellow(
				'\n⚠️  This command cannot be run inside the @rtorcato/repo-tooling repo itself.\n'
			)
		)
		console.log(chalk.gray(`   ${refusal}\n`))
		process.exit(0)
	}
})

// Handle unknown commands
program.on('command:*', () => {
	console.error(chalk.red(`\n❌ Unknown command: ${program.args.join(' ')}`))
	console.log(chalk.gray('See --help for a list of available commands.\n'))
	process.exit(1)
})

// Show help if no arguments. help() exits 0; outputHelp() fell through to
// parse(), which printed it a second time and exited 1 (#825).
if (!process.argv.slice(2).length) {
	program.help()
}

program.parse()
