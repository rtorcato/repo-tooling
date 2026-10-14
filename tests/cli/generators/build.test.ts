import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { ensureBuildApprovals, generateBuildConfigs } from '../../../src/cli/generators/build.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'my-lib',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'biome' },
		formatting: { tool: 'biome' },
		testing: { framework: 'none' },
		gitHooks: false,
		commitLint: false,
		semanticRelease: false,
		bundler: 'none',
		...overrides,
	}
}

describe('generateBuildConfigs', () => {
	it('writes tsup.config.ts when bundler is tsup', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'tsup' }), dir)

		const content = await fs.readFile(join(dir, 'tsup.config.ts'), 'utf-8')
		expect(content).toContain("from '@rtorcato/repo-tooling/tsup'")
		expect(content).toContain("entry: ['src/index.ts']")
		expect(await fs.pathExists(join(dir, 'build.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'vite.config.ts'))).toBe(false)
	})

	it('writes build.mjs when bundler is esbuild', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'esbuild' }), dir)

		const content = await fs.readFile(join(dir, 'build.mjs'), 'utf-8')
		expect(content).toContain("from 'esbuild'")
		expect(content).toContain('nodeExternalsPlugin')
		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(false)
	})

	it('writes rollup.config.mjs re-exporting the preset', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'rollup' }), dir)

		const content = await fs.readFile(join(dir, 'rollup.config.mjs'), 'utf-8')
		expect(content).toContain("from '@rtorcato/repo-tooling/rollup'")
		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'build.mjs'))).toBe(false)
	})

	it('writes rolldown.config.mjs re-exporting the preset', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'rolldown' }), dir)

		const content = await fs.readFile(join(dir, 'rolldown.config.mjs'), 'utf-8')
		expect(content).toContain("from '@rtorcato/repo-tooling/rolldown'")
		expect(await fs.pathExists(join(dir, 'rollup.config.mjs'))).toBe(false)
	})

	it('the shipped rolldown preset uses rolldown defineConfig', async () => {
		const preset = await fs.readFile(
			join(process.cwd(), 'tooling/rolldown/rolldown.config.mjs'),
			'utf-8'
		)
		expect(preset).toMatch(/from 'rolldown'/)
		expect(preset).toMatch(/\bdefineConfig\b/)
	})

	it('writes vite.config.ts re-exporting the preset', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'vite' }), dir)

		const content = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(content).toContain("from '@rtorcato/repo-tooling/vite'")
		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(false)
	})

	it('layers react plugin on the vite preset for react-app project type', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'vite', projectType: 'react-app' }), dir)

		const content = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(content).toContain("from '@rtorcato/repo-tooling/vite'")
		expect(content).toContain("from '@vitejs/plugin-react'")
		expect(content).toContain('mergeConfig')
		expect(content).toContain('react()')
	})

	it('omits react plugin in vite config for non-react project types', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ bundler: 'vite', projectType: 'node-api' }), dir)

		const content = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(content).not.toContain('@vitejs/plugin-react')
	})

	it('the shipped vite preset uses defineConfig', async () => {
		const presetPath = join(process.cwd(), 'tooling/vite/vite.config.mjs')
		const preset = await fs.readFile(presetPath, 'utf-8')
		expect(preset).toMatch(/from 'vite'/)
		expect(preset).toMatch(/\bdefineConfig\b/)
	})

	it('writes release.config.mjs when semanticRelease is true', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ semanticRelease: true }), dir)

		const content = await fs.readFile(join(dir, 'release.config.mjs'), 'utf-8')
		expect(content).toContain('@rtorcato/repo-tooling/semantic-release/github')
	})

	it('leaves an existing release config alone on setup (#875)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, '.releaserc.json'), { branches: ['main'] })
		await fs.writeJson(join(dir, 'package.json'), { name: 'x', release: { branches: ['main'] } })
		await generateBuildConfigs(baseConfig({ semanticRelease: true }), dir)

		expect(await fs.pathExists(join(dir, '.releaserc.json'))).toBe(true)
		expect((await fs.readJson(join(dir, 'package.json'))).release).toEqual({ branches: ['main'] })
	})

	it('writes .changeset/config.json when changesets is true', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ changesets: true }), dir)

		const config = await fs.readJson(join(dir, '.changeset/config.json'))
		expect(config.access).toBe('public')
		expect(config.baseBranch).toBe('main')
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(false)
	})

	it('writes release-please config + manifest + workflow when releasePlease is true', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig({ releasePlease: true }), dir)

		const config = await fs.readJson(join(dir, 'release-please-config.json'))
		expect(config.packages['.']['release-type']).toBe('node')
		const manifest = await fs.readJson(join(dir, '.release-please-manifest.json'))
		expect(manifest['.']).toBe('0.0.0')
		const workflow = await fs.readFile(join(dir, '.github/workflows/release-please.yml'), 'utf-8')
		expect(workflow).toContain('googleapis/release-please-action')
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(false)
	})

	it('preserves an existing release-please manifest (holds live versions)', async () => {
		const dir = newTmpDir()
		await fs.outputJson(join(dir, '.release-please-manifest.json'), { '.': '3.2.1' })
		await generateBuildConfigs(baseConfig({ releasePlease: true }), dir)
		expect((await fs.readJson(join(dir, '.release-please-manifest.json')))['.']).toBe('3.2.1')
	})

	it('writes no files when bundler is none and no release tool is selected', async () => {
		const dir = newTmpDir()
		await generateBuildConfigs(baseConfig(), dir)

		expect(await fs.pathExists(join(dir, 'tsup.config.ts'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'build.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'rollup.config.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'vite.config.ts'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.changeset/config.json'))).toBe(false)
	})
})

describe('ensureBuildApprovals', () => {
	it('writes pnpm-workspace.yaml with an allowBuilds map for esbuild bundlers', async () => {
		for (const bundler of ['tsup', 'esbuild', 'vite'] as const) {
			const dir = newTmpDir()
			const written = await ensureBuildApprovals(baseConfig({ bundler }), dir)
			expect(written).toBe('pnpm-workspace.yaml')
			const ws = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
			// pnpm 11 reads the allowBuilds map, not the onlyBuiltDependencies list.
			expect(ws).toContain('allowBuilds:')
			expect(ws).toContain('esbuild: true')
			expect(ws).not.toContain('onlyBuiltDependencies')
		}
	})

	it('does nothing for bundlers without an esbuild build script', async () => {
		const dir = newTmpDir()
		expect(await ensureBuildApprovals(baseConfig({ bundler: 'rollup' }), dir)).toBeNull()
		expect(await ensureBuildApprovals(baseConfig({ bundler: 'none' }), dir)).toBeNull()
		expect(await fs.pathExists(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
	})

	it('never clobbers an existing pnpm-workspace.yaml (treeshake path owns it)', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
		const written = await ensureBuildApprovals(baseConfig({ bundler: 'tsup' }), dir)
		expect(written).toBeNull()
		const ws = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(ws).toBe("packages:\n  - 'apps/*'\n")
	})

	it('the shipped tsup preset applies customOptions (regression: dropped entry)', async () => {
		const preset = await fs.readFile(join(process.cwd(), 'tooling/tsup/index.mjs'), 'utf-8')
		// The old `defineConfig((options = customOptions) => ...)` default was
		// bypassed by tsup and silently dropped the consumer's config; the
		// callback must take tsup's options and spread customOptions in explicitly.
		expect(preset).not.toMatch(/defineConfig\(\(options = customOptions\)/)
		expect(preset).toContain('...customOptions')
	})
})
