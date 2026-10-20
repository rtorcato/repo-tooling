import chalk from 'chalk'
import fs from '../../base/safe-fs.js'
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

const indentOf = (line: string): number => line.length - line.trimStart().length

const isContent = (line: string): boolean => line.trim() !== '' && !line.trimStart().startsWith('#')

/**
 * The block under `key:` at exactly `indent`, searched in `[from, to)`, as
 * `[header, end)`; null when the key is absent. A line indented deeper than the
 * header, a blank line, or a compact `- item` at the header's own indent stays
 * inside the block.
 */
function blockRange(lines: string[], key: string, indent: number, from: number, to: number) {
	const header = lines.findIndex(
		(line, i) =>
			i >= from && i < to && indentOf(line) === indent && line.trimStart().startsWith(`${key}:`)
	)
	if (header === -1) return null
	let end = header + 1
	while (end < to) {
		const line = lines[end] ?? ''
		const inside =
			line.trim() === '' ||
			indentOf(line) > indent ||
			(indentOf(line) === indent && line.trimStart().startsWith('- '))
		if (!inside) break
		end++
	}
	return { header, end }
}

/**
 * Add `item` under the block at `keys` (a top-level key, then optionally one
 * child key), creating whichever headers are missing, unless a line in that
 * block already matches `has`. New lines copy the indent of the lines already
 * there. A key written in flow style (`overrides: {}`) is left alone with a
 * warning, since this is a text edit, not a YAML parser.
 */
function mergeUnder(yaml: string, keys: string[], item: string, has: RegExp): string {
	const lines = yaml.replace(/\n*$/, '').split('\n')
	let from = 0
	let to = lines.length
	let indent = 0
	for (const [depth, key] of keys.entries()) {
		const range = blockRange(lines, key, indent, from, to)
		if (!range) {
			const add = [
				...keys.slice(depth).map((k, i) => `${' '.repeat(indent + 2 * i)}${k}:`),
				`${' '.repeat(indent + 2 * (keys.length - depth))}${item}`,
			]
			if (depth === 0) return `${yaml.replace(/\n*$/, '\n')}\n${add.join('\n')}\n`
			lines.splice(from, 0, ...add)
			return `${lines.join('\n')}\n`
		}
		if (!/:\s*(#.*)?$/.test(lines[range.header] ?? '')) {
			console.warn(
				chalk.yellow(
					`⚠️  pnpm-workspace.yaml: \`${keys.join('.')}\` is not a block, so Vite+ did not add \`${item}\`; add it by hand.`
				)
			)
			return yaml
		}
		from = range.header + 1
		to = range.end
		const child = lines.slice(from, to).find(isContent)
		indent = child ? indentOf(child) : indent + 2
	}
	if (lines.slice(from, to).some((line) => has.test(line))) return yaml
	lines.splice(from, 0, ' '.repeat(indent) + item)
	return `${lines.join('\n')}\n`
}

/**
 * Merge the Vite+ catalog, override and peer rules into `yaml` (#903). Each
 * entry goes under the repo's own `overrides:` / `peerDependencyRules:` when it
 * has them, so they are extended rather than duplicated as a second top-level
 * key, and an entry the repo already sets is kept as it is.
 */
export function mergeVitePlusWorkspace(yaml: string): string {
	if (/^catalog:/m.test(yaml)) return yaml
	if (yaml.trim() === '') return VITE_PLUS_WORKSPACE
	const [catalog] = VITE_PLUS_WORKSPACE.split(/^overrides:/m)
	let next = `${yaml.replace(/\n*$/, '\n')}\n${catalog}`
	next = mergeUnder(next, ['overrides'], "vite@*: 'catalog:'", /^\s*['"]?vite@\*['"]?\s*:/)
	next = mergeUnder(
		next,
		['peerDependencyRules', 'allowAny'],
		'- vite',
		/^\s*-\s*['"]?vite['"]?\s*$/
	)
	next = mergeUnder(
		next,
		['peerDependencyRules', 'allowedVersions'],
		"vite: '*'",
		/^\s*['"]?vite['"]?\s*:/
	)
	return next
}

/** Add the catalog to pnpm-workspace.yaml unless the repo already has one. */
export async function ensureVitePlusWorkspace(targetDir: string): Promise<void> {
	const file = path.join(targetDir, 'pnpm-workspace.yaml')
	const current = (await fs.pathExists(file)) ? await fs.readFile(file, 'utf-8') : ''
	const next = mergeVitePlusWorkspace(current)
	if (next !== current) await fs.writeFile(file, next)
}
