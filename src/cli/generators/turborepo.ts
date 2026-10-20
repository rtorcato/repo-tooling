import path from 'node:path'
import fs from '../../base/safe-fs.js'

/**
 * Scaffold a starter turbo.json for a pnpm-workspace monorepo. Turborepo 2.x
 * (`tasks`, not the pre-2.0 `pipeline`). The defaults cover the common
 * build/lint/typecheck/test/dev pipeline; teams tune outputs per repo.
 */
export async function generateTurborepo(targetDir: string): Promise<string> {
	const filepath = path.join(targetDir, 'turbo.json')
	await fs.writeJson(filepath, TURBO_CONFIG, { spaces: 2 })
	return 'turbo.json'
}

const TURBO_CONFIG = {
	$schema: 'https://turborepo.com/schema.json',
	tasks: {
		build: {
			dependsOn: ['^build'],
			// Covers both plain bundlers (dist) and Next.js apps; cache is invalidated
			// on source changes. Drop what your packages don't emit.
			outputs: ['dist/**', '.next/**', '!.next/cache/**'],
		},
		lint: {},
		typecheck: {
			dependsOn: ['^build'],
		},
		test: {
			dependsOn: ['^build'],
			outputs: ['coverage/**'],
		},
		dev: {
			cache: false,
			persistent: true,
		},
	},
} as const
