import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'
import { generateVitePlusConfig } from './vite-plus.js'

// tsup, esbuild, and vite all pull in esbuild, whose install-time build script
// pnpm 11 refuses to run until it's approved — otherwise `pnpm install` fails
// with ERR_PNPM_IGNORED_BUILDS.
export function bundlerNeedsEsbuild(config: ProjectConfig): boolean {
	return config.bundler === 'tsup' || config.bundler === 'esbuild' || config.bundler === 'vite'
}

// pnpm 11 reads build-script approvals from the `allowBuilds` map (package →
// boolean), NOT the older `onlyBuiltDependencies` list — verified against the
// pinned pnpm@11.1.3, which ignores the list form and errors with
// ERR_PNPM_IGNORED_BUILDS.
const SINGLE_PACKAGE_BUILD_APPROVALS = `allowBuilds:
  esbuild: true
`

/**
 * pnpm 11 no longer reads build-script approvals from package.json's `pnpm`
 * field — they live in pnpm-workspace.yaml. For a single-package esbuild-backed
 * build, write a minimal pnpm-workspace.yaml approving esbuild. Never clobbers
 * an existing file (the treeshake-check path writes a richer one that already
 * lists esbuild). Must run after that path so its file wins. Returns the
 * relative path if written, else null.
 */
export async function ensureBuildApprovals(
	config: ProjectConfig,
	targetDir: string
): Promise<string | null> {
	if (!bundlerNeedsEsbuild(config)) return null
	const wsPath = path.join(targetDir, 'pnpm-workspace.yaml')
	if (await fs.pathExists(wsPath)) return null
	await fs.writeFile(wsPath, SINGLE_PACKAGE_BUILD_APPROVALS)
	return 'pnpm-workspace.yaml'
}

export async function generateBuildConfigs(config: ProjectConfig, targetDir: string) {
	if (config.bundler === 'tsup') {
		await generateTsupConfig(targetDir)
	} else if (config.bundler === 'esbuild') {
		await generateEsbuildConfig(targetDir)
	} else if (config.bundler === 'rollup') {
		await generateRollupConfig(targetDir)
	} else if (config.bundler === 'rolldown') {
		await generateRolldownConfig(targetDir)
	} else if (config.bundler === 'vite') {
		if (config.vitePlus) await generateVitePlusConfig(config, targetDir)
		else await generateViteConfig(config, targetDir)
	}

	// Generate semantic-release config for GitHub
	if (config.semanticRelease) {
		await generateSemanticReleaseConfig(targetDir)
	}

	// Generate Changesets config (alternative to semantic-release)
	if (config.changesets) {
		await generateChangesetsConfig(targetDir)
	}

	// Generate Release Please config (alternative to semantic-release)
	if (config.releasePlease) {
		await generateReleasePleaseConfig(targetDir)
	}
}

async function generateTsupConfig(targetDir: string) {
	const tsupConfigPath = path.join(targetDir, 'tsup.config.ts')

	const tsupConfig = `import { getConfig } from '@rtorcato/repo-tooling/tsup'

export default getConfig({
  entry: ['src/index.ts'],
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  sourcemap: true,
}, process.env.NODE_ENV || 'development')
`

	await fs.writeFile(tsupConfigPath, tsupConfig)
}

async function generateEsbuildConfig(targetDir: string) {
	const esbuildConfigPath = path.join(targetDir, 'build.mjs')

	const esbuildConfig = `import { build } from 'esbuild'
import { nodeExternalsPlugin } from 'esbuild-node-externals'

const isProduction = process.env.NODE_ENV === 'production'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  outdir: 'dist',
  format: 'esm',
  target: 'node18',
  platform: 'node',
  minify: isProduction,
  sourcemap: !isProduction,
  plugins: [nodeExternalsPlugin()],
})

console.log('Build completed!')
`

	await fs.writeFile(esbuildConfigPath, esbuildConfig)
}

export async function generateRollupConfig(targetDir: string) {
	const rollupConfigPath = path.join(targetDir, 'rollup.config.mjs')

	const rollupConfig = `export { default } from '@rtorcato/repo-tooling/rollup'
`

	await fs.writeFile(rollupConfigPath, rollupConfig)
}

export async function generateRolldownConfig(targetDir: string) {
	const rolldownConfigPath = path.join(targetDir, 'rolldown.config.mjs')

	const rolldownConfig = `export { default } from '@rtorcato/repo-tooling/rolldown'
`

	await fs.writeFile(rolldownConfigPath, rolldownConfig)
}

export async function generateViteConfig(config: ProjectConfig, targetDir: string) {
	const viteConfigPath = path.join(targetDir, 'vite.config.ts')

	// React apps need the plugin; we layer it on top of the shipped preset.
	const viteConfig =
		config.projectType === 'react-app'
			? `import preset from '@rtorcato/repo-tooling/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, mergeConfig } from 'vite'

export default mergeConfig(preset, defineConfig({ plugins: [react()] }))
`
			: `export { default } from '@rtorcato/repo-tooling/vite'
`

	await fs.writeFile(viteConfigPath, viteConfig)
}

/** Every name semantic-release's config search accepts, in the order doctor reads them. */
export const SEMANTIC_RELEASE_FILES = [
	'.releaserc',
	'.releaserc.json',
	'.releaserc.yaml',
	'.releaserc.yml',
	'.releaserc.js',
	'.releaserc.cjs',
	'release.config.js',
	'release.config.cjs',
	'release.config.mjs',
]

/**
 * What the github preset needs installed to load at all. Core bundles the
 * commit-analyzer, notes generator and npm plugin (the changelog and git plugins
 * are gone, #417), but the analyzer's `preset: 'conventionalcommits'` resolves
 * a package core does not bring, so the first release failed to load it (#875).
 * Kept inside this package's own peer ranges, or doctor flags a fresh scaffold.
 */
export const SEMANTIC_RELEASE_DEPS: Record<string, string> = {
	'semantic-release': '^25.0.0',
	'@semantic-release/github': '^12.0.0',
	'conventional-changelog-conventionalcommits': '^10.0.0',
}

/**
 * Point semantic-release at the github preset, and make sure nothing shadows it.
 *
 * semantic-release reads a package.json `release` field or any `.releaserc*`
 * before `release.config.mjs`, so writing ours next to one of those changed
 * nothing and doctor kept the same drift (#875). With `replaceShadowing` they
 * are removed. Only the fixer passes it: it reaches here for drift under
 * `--yes`, the overwrite opt-in, and it prints what was replaced. `setup` never
 * deletes a repo's existing release config.
 *
 * @returns the files written, and the configs removed because they shadowed it.
 */
export async function generateSemanticReleaseConfig(
	targetDir: string,
	{ replaceShadowing = false }: { replaceShadowing?: boolean } = {}
): Promise<{ written: string[]; replaced: string[] }> {
	const replaced: string[] = []
	for (const name of SEMANTIC_RELEASE_FILES) {
		if (!replaceShadowing || name === 'release.config.mjs') continue
		const file = path.join(targetDir, name)
		if (await fs.pathExists(file)) {
			await fs.remove(file)
			replaced.push(name)
		}
	}
	await fs.writeFile(
		path.join(targetDir, 'release.config.mjs'),
		`export { default } from '@rtorcato/repo-tooling/semantic-release/github'\n`
	)
	const written = ['release.config.mjs']

	const pkgPath = path.join(targetDir, 'package.json')
	if (await fs.pathExists(pkgPath)) {
		const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
		let changed = false
		if (replaceShadowing && 'release' in pkg) {
			delete pkg.release
			replaced.push('package.json `release`')
			changed = true
		}
		const devDeps = { ...((pkg.devDependencies as Record<string, string> | undefined) ?? {}) }
		const deps = (pkg.dependencies as Record<string, string> | undefined) ?? {}
		for (const [name, range] of Object.entries(SEMANTIC_RELEASE_DEPS)) {
			if (!devDeps[name] && !deps[name]) {
				devDeps[name] = range
				changed = true
			}
		}
		if (changed) {
			pkg.devDependencies = devDeps
			await fs.writeJson(pkgPath, pkg, { spaces: 2 })
			written.push('package.json')
		}
	}
	return { written, replaced }
}

export async function generateChangesetsConfig(targetDir: string) {
	// Drop the canonical Changesets config into .changeset/config.json. The user
	// owns this file once it's in their repo; subsequent `pnpm changeset` runs
	// create per-change markdown files alongside it.
	const { copyPreset } = await import('../utils/copy-preset.js')
	await copyPreset('changesets', targetDir)
}

// The release-please workflow — googleapis/release-please-action opens/maintains
// a release PR on every push to main and tags + creates the GitHub release when
// it merges. RELEASE_TOKEN (falling back to GITHUB_TOKEN) lets the release PR's
// checks run, mirroring the semantic-release setup.
const RELEASE_PLEASE_WORKFLOW = `name: release-please

on:
  push:
    branches: [main]

permissions:
  contents: write
  pull-requests: write

jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@v4
        with:
          token: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
          config-file: release-please-config.json
          manifest-file: .release-please-manifest.json
`

/**
 * Scaffolds Release Please: the config (from the shipped preset), a starting
 * manifest, and the release workflow. The config is (re)written to realign with
 * the preset, but the manifest (holds live versions) and the workflow (may be
 * user-tuned) are only created when absent. Returns the relative paths touched.
 */
export async function generateReleasePleaseConfig(targetDir: string): Promise<string[]> {
	const { copyPreset, getPackageRoot } = await import('../utils/copy-preset.js')
	const written: string[] = []

	const cfg = await copyPreset('release-please', targetDir)
	written.push(cfg.target)

	const manifestDest = path.join(targetDir, '.release-please-manifest.json')
	if (!(await fs.pathExists(manifestDest))) {
		await fs.copy(
			path.join(getPackageRoot(), 'tooling/release-please/.release-please-manifest.json'),
			manifestDest
		)
	}
	written.push('.release-please-manifest.json')

	const workflowPath = path.join(targetDir, '.github', 'workflows', 'release-please.yml')
	if (!(await fs.pathExists(workflowPath))) {
		await fs.ensureDir(path.dirname(workflowPath))
		await fs.writeFile(workflowPath, RELEASE_PLEASE_WORKFLOW)
	}
	written.push('.github/workflows/release-please.yml')

	return written
}
