import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

/**
 * Vite+ (#897): `vite-plus` ships the `vp` CLI, which runs Vite + Rolldown
 * (build), Oxlint + Oxfmt + tsgo (`vp check`), Vitest (`vp test`) and tsdown
 * (`vp pack`) from one `vite.config.ts`.
 */
const VITE_PLUS_VERSION = '1.2.0'

/** The `engines.node` Vite+ itself declares; `.nvmrc` pins a major inside it. */
export const VITE_PLUS_NODE = '^22.18.0 || ^24.11.0 || >=26.0.0'

/** Where `vp config` installs git hooks, in place of `.husky`. */
export const VITE_HOOKS_DIR = '.vite-hooks'

/**
 * `defineConfig` comes from `vite-plus`, which re-exports Vite's. `staged` is
 * what the pre-commit hook's `vp staged` runs; `lint.options` turns on the
 * type-aware rules and the type check that `tsc --noEmit` would otherwise do.
 * `prefer-vite-plus-imports` is the rule Vite+'s own templates enable.
 *
 * A library's `pack` block keeps the tsup-era output names (`index.js`,
 * `index.cjs`, `index.d.ts`, `index.d.cts`) with `fixedExtension: false`, so the
 * exports map, size-limit budget and attw run are the same as every other
 * library preset. It is not `exports: true`: that would have `vp pack` rewrite
 * package.json on every build.
 */
function viteConfigFor(config: ProjectConfig): string {
	const pack =
		config.projectType === 'library'
			? `	pack: {
		entry: ['src/index.ts'],
		format: ['esm', 'cjs'],
		dts: true,
		clean: true,
		sourcemap: true,
		fixedExtension: false,
	},
`
			: ''
	return `import { defineConfig } from 'vite-plus'

export default defineConfig({
	staged: {
		'*': 'vp check --fix',
	},
${pack}	lint: {
		jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
		rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
		options: { typeAware: true, typeCheck: true },
	},
	fmt: {
		useTabs: true,
		semi: false,
		singleQuote: true,
	},
})
`
}

export async function generateVitePlusConfig(config: ProjectConfig, targetDir: string) {
	await fs.writeFile(path.join(targetDir, 'vite.config.ts'), viteConfigFor(config))
}

/**
 * The catalog `vp create` writes: `vite` is aliased to Vite+'s own core build, so
 * every plugin that peers on `vite` resolves the same copy. Both versions come
 * from this one block, which is why package.json says `catalog:`.
 */
const VITE_PLUS_WORKSPACE = `catalog:
  vite: npm:@voidzero-dev/vite-plus-core@${VITE_PLUS_VERSION}
  vite-plus: ${VITE_PLUS_VERSION}
overrides:
  vite@*: 'catalog:'
peerDependencyRules:
  allowAny:
    - vite
  allowedVersions:
    vite: '*'
`

/** Add the catalog to pnpm-workspace.yaml unless the repo already has one. */
export async function ensureVitePlusWorkspace(targetDir: string): Promise<void> {
	const file = path.join(targetDir, 'pnpm-workspace.yaml')
	const current = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf-8') : ''
	if (/^catalog:/m.test(current)) return
	const lead = current.trim() === '' ? '' : `${current.replace(/\n*$/, '\n')}\n`
	await fs.writeFile(file, lead + VITE_PLUS_WORKSPACE)
}
