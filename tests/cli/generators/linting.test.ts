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
		expect(biome.$schema).toBe('https://biomejs.dev/schemas/latest/schema.json')
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
		await generateLintingConfigs(baseConfig({ linting: { tool: 'biome' }, oxlint: true }), dir)

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

	// #363: `useIgnoreFile` does nothing while `vcs.enabled` is false, so the
	// preset linted build output — 1477 errors from .next/ on a Next.js app.
	it('ships a preset whose .gitignore setting is actually switched on', async () => {
		const preset = await fs.readJson(join(import.meta.dirname, '../../../tooling/biome/biome.json'))
		expect(preset.vcs).toMatchObject({ enabled: true, clientKind: 'git', useIgnoreFile: true })
	})

	// #363/#468: any version in the URL — hardcoded, or derived from whatever is
	// installed at scaffold time — makes Biome print a schema-version warning on
	// every run the moment the consumer's CLI moves past it. `latest` never does.
	it('writes an unpinned $schema, whatever Biome happens to be installed', async () => {
		const dir = newTmpDir()
		const biomePkg = join(dir, 'node_modules', '@biomejs', 'biome')
		await fs.ensureDir(biomePkg)
		await fs.writeJson(join(biomePkg, 'package.json'), { name: '@biomejs/biome', version: '2.9.3' })
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			devDependencies: { '@biomejs/biome': '^2.5.0' },
		})

		await generateBiomeConfig(dir)

		const biome = await fs.readJson(join(dir, BIOME_CONFIG))
		expect(biome.$schema).toBe('https://biomejs.dev/schemas/latest/schema.json')
	})

	// The shipped preset is parsed by whichever Biome the consumer installed, so
	// it must not pin either — it carried its own separate stale 2.5.0 (#468).
	it('ships a preset whose $schema is unpinned too', async () => {
		const preset = await fs.readJson(join(import.meta.dirname, '../../../tooling/biome/biome.json'))
		expect(preset.$schema).toBe('https://biomejs.dev/schemas/latest/schema.json')
	})

	it('skips .oxlintrc.json when oxlint flag is unset', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(baseConfig({ linting: { tool: 'biome' } }), dir)

		expect(await fs.pathExists(join(dir, '.oxlintrc.json'))).toBe(false)
	})
})
