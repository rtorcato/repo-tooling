import fs from 'fs-extra'
import { spawnSync } from 'node:child_process'
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
		const preset = await fs.readJson(
			join(import.meta.dirname, '../../../tooling/biome/preset.json')
		)
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
		const preset = await fs.readJson(
			join(import.meta.dirname, '../../../tooling/biome/preset.json')
		)
		expect(preset.$schema).toBe('https://biomejs.dev/schemas/latest/schema.json')
	})

	it('skips .oxlintrc.json when oxlint flag is unset', async () => {
		const dir = newTmpDir()
		await generateLintingConfigs(baseConfig({ linting: { tool: 'biome' } }), dir)

		expect(await fs.pathExists(join(dir, '.oxlintrc.json'))).toBe(false)
	})
})

/**
 * #486 — does the shipped preset actually win where it lands? Every assertion
 * here is a real `biome` run, because the failure mode is a config that resolves
 * to nothing while the build stays green; no amount of reading JSON keys catches
 * that.
 *
 * The probe is `any`, not `debugger`: `noExplicitAny` is on under Biome's
 * built-in defaults and explicitly **off** in our preset, so its absence proves
 * the preset was applied. A `debugger` is reported either way and would pass
 * against a config that had silently evaporated.
 *
 * #486 renamed the shipped file to `preset.json` and dropped `"root": false`
 * (#469). One file cannot be both a root and a non-root, so that traded one
 * failure for another — and the trade is the point:
 *
 * - **Fixed:** a `copy biome` into a standalone repo used to be discarded in
 *   silence, leaving the consumer on stock Biome with exit 0. It now applies.
 * - **Traded:** that same verbatim copy, landed in a package under someone
 *   else's monorepo root, is now a second root config and Biome aborts loudly.
 *
 * The trade is worth taking because it *converges* the residual: the copied
 * config and the scaffolded `extends` pointer now fail the same way, for the
 * same reason, and one fix — teaching the scaffold when it is nested — closes
 * both. #486 left that open, so the last test stays `it.fails`.
 */
describe.skipIf(!fs.existsSync(join(process.cwd(), 'node_modules', '.bin', 'biome')))(
	'shipped biome preset: which config actually wins (#486)',
	() => {
		const newTmpDir = useTmpDir()
		const biomeBin = join(process.cwd(), 'node_modules', '.bin', 'biome')
		const PRESET = join(import.meta.dirname, '../../../tooling/biome/preset.json')
		const PROBE = 'export const v: any = "x"\n'
		/** A monorepo root that already owns a root config, on Biome's own defaults. */
		const PARENT = {
			$schema: 'https://biomejs.dev/schemas/latest/schema.json',
			linter: { enabled: true, rules: { preset: 'recommended' } },
		}

		/** A tmp project with the preset installed the way a consumer would have it. */
		async function project(): Promise<string> {
			const dir = newTmpDir()
			await fs.writeFile(join(dir, '.gitignore'), 'node_modules\n')
			// The preset sets vcs.useIgnoreFile, which wants a real repo above it.
			spawnSync('git', ['init', '--quiet'], { cwd: dir })

			const pkg = join(dir, 'node_modules', '@rtorcato', 'repo-tooling')
			await fs.ensureDir(join(pkg, 'tooling', 'biome'))
			await fs.copy(PRESET, join(pkg, 'tooling', 'biome', 'preset.json'))
			await fs.writeJson(join(pkg, 'package.json'), {
				name: '@rtorcato/repo-tooling',
				version: '0.0.0',
				exports: { './biome': './tooling/biome/preset.json' },
			})
			return dir
		}

		function check(cwd: string, target = '.'): string {
			const run = spawnSync(biomeBin, ['check', '--colors=off', target], {
				cwd,
				encoding: 'utf8',
				timeout: 30_000,
			})
			return `${run.stdout}${run.stderr}`
		}

		// The case #469's `root: false` bought, and what #486 gave back for it: a
		// verbatim copy under a monorepo root is a second root, so the run aborts
		// before any file is read. Loud — and it is the same defect the scaffolded
		// pointer hits below, which is why one `--nested` fix would close both.
		it('is a second root config when copied into a package under a monorepo root', async () => {
			const root = await project()
			await fs.writeJson(join(root, 'biome.json'), PARENT)
			// `copy biome` drops the preset verbatim; the sibling has no config at all.
			await fs.copy(PRESET, join(root, 'packages', 'nested', 'biome.json'))
			await fs.outputFile(join(root, 'packages', 'nested', 'src', 'probe.ts'), PROBE)
			await fs.outputFile(join(root, 'packages', 'sibling', 'src', 'probe.ts'), PROBE)

			// It fails, but it says so — no silent fallback to stock Biome.
			expect(check(root)).toContain('nested root configuration')
			// ...and the parent really is in force, so that abort is the only thing
			// standing between the monorepo root and a working check.
			expect(check(root, 'packages/sibling')).toContain('noExplicitAny')
		})

		// The whole point of the rename: `copy biome` lands the preset as the
		// consumer's own root config. With `root: false` still on it, Biome found no
		// root above, silently fell back to built-in defaults and exited 0 — the
		// preset simply gone. Dropping the key is what makes this hold.
		it('applies when copied in as the consumer’s own root config', async () => {
			const dir = await project()
			await fs.copy(PRESET, join(dir, 'biome.json'))
			await fs.outputFile(join(dir, 'src', 'probe.ts'), PROBE)

			expect(check(dir)).not.toContain('noExplicitAny')
		})

		// The shape consumers actually use, and the one the rename could silently
		// break: `extends` goes through the `./biome` exports entry, so if that entry
		// and the file on disk drift apart the preset stops arriving. This repo's own
		// `biome check .` proves nothing here — its node_modules symlinks back to the
		// working tree, so it resolves whatever is checked out rather than what ships.
		it('applies through the extends pointer, resolved via the exports map', async () => {
			const dir = await project()
			await generateBiomeConfig(dir)
			await fs.outputFile(join(dir, 'src', 'probe.ts'), PROBE)

			const out = check(dir)
			// `Checked N files` only prints once config resolution succeeded — an
			// exports entry pointing at nothing aborts the run instead, which would
			// otherwise make the assertion below pass by printing nothing at all.
			expect(out).toContain('Checked')
			expect(out).not.toContain('noExplicitAny')
		})

		// `root` is not inherited through `extends`, so the thin pointer
		// `generateBiomeConfig` writes is still read as a root of its own. Loud
		// rather than silent, but a scaffolded package inside someone else's
		// monorepo cannot be checked from that monorepo's root at all.
		it.fails('lets the scaffolded extends pointer sit inside a monorepo', async () => {
			const root = await project()
			await fs.writeJson(join(root, 'biome.json'), PARENT)
			const scaffolded = join(root, 'packages', 'scaffolded')
			await fs.ensureDir(scaffolded)
			await generateBiomeConfig(scaffolded)
			await fs.outputFile(join(scaffolded, 'src', 'probe.ts'), PROBE)

			expect(check(root)).not.toContain('nested root configuration')
		})
	}
)
