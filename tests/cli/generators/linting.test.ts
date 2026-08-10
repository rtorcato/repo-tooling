import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { computeFileList } from '../../../src/cli/commands/setup-presets.js'
import {
	BIOME_CONFIG,
	generateBiomeConfig,
	generateLintingConfigs,
} from '../../../src/cli/generators/linting.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
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

describe('generateLintingConfigs', () => {
	it('writes biome.json when tool is biome', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(baseConfig({ linting: { tool: 'biome' } }), dir)

		const biome = await fs.readJson(join(dir, 'biome.json'))
		expect(biome.extends).toEqual(['@rtorcato/repo-tooling/biome'])
		// Biome 2.x schema + shape — no 1.x `files.include`/`ignore` that would
		// force consumers to run `biome migrate` before `biome check` runs.
		expect(biome.$schema).toContain('biomejs.dev/schemas/2.')
		expect(biome.files?.include).toBeUndefined()
		expect(await fs.pathExists(join(dir, 'eslint.config.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, 'prettier.config.mjs'))).toBe(false)
	})

	it('writes eslint + prettier configs when tool is eslint', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(
			baseConfig({ linting: { tool: 'eslint', eslintConfig: 'base' } }),
			dir
		)

		const eslint = await fs.readFile(join(dir, 'eslint.config.mjs'), 'utf-8')
		expect(eslint).toContain("from '@rtorcato/repo-tooling/eslint/base'")

		expect(await fs.pathExists(join(dir, 'prettier.config.mjs'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(false)
	})

	it("writes both configs when tool is 'both' and skips prettier", async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(
			baseConfig({ linting: { tool: 'both', eslintConfig: 'nextjs' } }),
			dir
		)

		const eslint = await fs.readFile(join(dir, 'eslint.config.mjs'), 'utf-8')
		expect(eslint).toContain("from '@rtorcato/repo-tooling/eslint/nextjs'")

		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(true)
		// prettier is only emitted when eslint is the sole linter
		expect(await fs.pathExists(join(dir, 'prettier.config.mjs'))).toBe(false)
	})

	it('defaults eslint config to base when not specified', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(baseConfig({ linting: { tool: 'eslint' } }), dir)

		const eslint = await fs.readFile(join(dir, 'eslint.config.mjs'), 'utf-8')
		expect(eslint).toContain("from '@rtorcato/repo-tooling/eslint/base'")
	})

	it('drops .oxlintrc.json when oxlint is enabled (additive to Biome)', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(
			baseConfig({ linting: { tool: 'biome' }, oxlint: true }),
			dir
		)

		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(true)
		const oxlint = await fs.readJson(join(dir, '.oxlintrc.json'))
		expect(oxlint.categories?.correctness).toBe('error')
	})

	// #365: `fix biome` wrote biome.json while `fix --resync` wrote biome.jsonc.
	// Biome resolves biome.json first and never mentions the other, so resync
	// looked like it worked while changing nothing.
	it('removes a stale biome.jsonc left by an older scaffold', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'biome.jsonc'), '{ "linter": { "enabled": false } }\n')

		await generateBiomeConfig(dir)

		expect(await fs.pathExists(join(dir, 'biome.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'biome.jsonc'))).toBe(false)
	})

	// The scaffolded config must carry the `extends` that doctor's Biome check
	// matches on — copying the preset inline (the old `fix biome`) did not.
	it('scaffolds the same file the resync file list promises', async () => {
		const dir = newTmpDir()
		const written = await generateBiomeConfig(dir)

		expect(written).toBe(BIOME_CONFIG)
		expect(computeFileList(baseConfig({ linting: { tool: 'biome' } }))).toContain(BIOME_CONFIG)
		const contents = await fs.readFile(join(dir, BIOME_CONFIG), 'utf-8')
		expect(contents).toMatch(/@rtorcato\/repo-tooling\/biome/)
	})

	it('skips .oxlintrc.json when oxlint flag is unset', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(baseConfig({ linting: { tool: 'biome' } }), dir)

		expect(await fs.pathExists(join(dir, '.oxlintrc.json'))).toBe(false)
	})
})
