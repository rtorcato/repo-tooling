import fs from '../../base/safe-fs.js'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

export async function generateTSConfig(config: ProjectConfig, targetDir: string) {
	const tsconfigPath = path.join(targetDir, 'tsconfig.json')

	// Base configuration extends our tooling. The shared presets anchor `paths`
	// with ${configDir}, so no local baseUrl/paths is needed (baseUrl is
	// deprecated in TS 5.9, removed in TS 7.0). Refs: https://aka.ms/ts6
	// Targeting Bun (#225) means the Bun-typed preset (adds `types: ['bun']`),
	// regardless of the chosen project config — Bun is a runtime flag, not a type.
	const preset = config.bun ? 'bun' : config.typescript.config
	const tsconfig: any = {
		extends: `@rtorcato/repo-tooling/typescript/${preset}`,
		compilerOptions: {},
		include: ['src/**/*', 'reset.d.ts'],
		exclude: ['node_modules', 'dist', 'build'],
	}

	// Adjust for project type
	if (config.projectType === 'library') {
		tsconfig.compilerOptions.outDir = './dist'
		tsconfig.compilerOptions.rootDir = './src'
	}

	// web-app is the only browser target that lands on the `base` preset, whose
	// lib is ES2022 — so `document`/`window` don't typecheck. The react and next
	// presets already add the DOM libs themselves.
	if (config.projectType === 'web-app' && preset === 'base') {
		tsconfig.compilerOptions.lib = ['ES2022', 'DOM', 'DOM.Iterable']
	}

	// The base preset lists `vitest` in `types`, which a Vite+ repo doesn't install:
	// its tests import the runner from `vite-plus/test` instead (#897).
	if (config.vitePlus) tsconfig.compilerOptions.types = ['node']

	// The next preset clears `paths` (Turbopack doesn't expand ${configDir}, #922),
	// so the aliases the other presets inherit are declared here, relative to
	// this tsconfig.
	if (preset === 'next') {
		tsconfig.compilerOptions.paths = { '~/*': ['./src/*'], '@/*': ['./src/*'] }
	}

	if (config.projectType === 'nextjs-app') {
		tsconfig.include = ['next-env.d.ts', 'src', 'app', 'pages', 'components', 'reset.d.ts']
		tsconfig.exclude.push('.next')
	}

	await fs.writeJson(tsconfigPath, tsconfig, { spaces: 2 })
}
