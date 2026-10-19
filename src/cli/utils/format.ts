import chalk from 'chalk'
import { spawn } from 'node:child_process'
import type { ProjectConfig } from '../commands/setup.js'

function run(cmd: string, args: string[], cwd: string): Promise<number> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: true })
		child.on('close', (code) => resolve(code ?? 1))
		child.on('error', () => resolve(1))
	})
}

/**
 * Generated config files come from hand-built templates whose whitespace doesn't
 * match the project's shipped formatter (biome collapses JSON arrays and uses
 * tabs + trailing commas). Run the formatter once, post-install, so a fresh
 * scaffold passes its own `pnpm check` / lint out of the box instead of failing
 * on the consumer's first verify. Best-effort: never fails setup.
 */
export async function formatGeneratedFiles(
	config: ProjectConfig,
	targetDir: string
): Promise<void> {
	const usesBiome = config.linting.tool === 'biome' || config.linting.tool === 'both'
	const usesEslint = config.linting.tool === 'eslint' || config.linting.tool === 'both'

	// Vite+ formats and fixes lint through its one command (#897).
	if (config.vitePlus) {
		await run('pnpm', ['exec', 'vp', 'check', '--fix'], targetDir)
		console.log(chalk.green('✨ Formatted generated files'))
		return
	}

	if (usesBiome) {
		await run('pnpm', ['exec', 'biome', 'check', '--write', '.'], targetDir)
	}
	if (config.formatting.tool === 'prettier') {
		await run('pnpm', ['exec', 'prettier', '--write', '.'], targetDir)
	}
	if (usesEslint) {
		await run('pnpm', ['exec', 'eslint', '.', '--fix'], targetDir)
	}

	if (usesBiome || usesEslint || config.formatting.tool === 'prettier') {
		console.log(chalk.green('✨ Formatted generated files'))
	}
}
