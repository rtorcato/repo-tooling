import path from 'node:path'
import fs from '../../base/safe-fs.js'

/**
 * Scaffold Bun toolchain files: a bunfig.toml and — only when no tsconfig.json
 * exists yet — a tsconfig.json that extends the Bun-typed preset
 * (`@rtorcato/repo-tooling/typescript/bun`, which adds `types: ['bun']`). Both are
 * safe-add: an existing bunfig.toml or tsconfig.json is never clobbered (an
 * existing project points its tsconfig at the bun preset by hand — see the docs).
 * Returns the relative paths written.
 */
export async function generateBun(targetDir: string): Promise<string[]> {
	const written: string[] = []

	const bunfigPath = path.join(targetDir, 'bunfig.toml')
	if (!(await fs.pathExists(bunfigPath))) {
		const { copyPreset } = await import('../utils/copy-preset.js')
		const result = await copyPreset('bun', targetDir)
		written.push(result.target)
	}

	const tsconfigPath = path.join(targetDir, 'tsconfig.json')
	if (!(await fs.pathExists(tsconfigPath))) {
		await fs.writeJson(
			tsconfigPath,
			{ extends: '@rtorcato/repo-tooling/typescript/bun' },
			{ spaces: 2 }
		)
		written.push('tsconfig.json')
	}

	return written
}
