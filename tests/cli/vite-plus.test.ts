import fs from 'fs-extra'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runDoctor } from '../../src/cli/commands/doctor.js'
import { declinedInLock } from '../../src/cli/commands/fix-targets.js'
import { setupProject } from '../../src/cli/commands/setup.js'
import {
	CONFIG_SCHEMA,
	PRESET_NAMES,
	buildPresetConfig,
	computeFileList,
	validateProjectConfig,
} from '../../src/cli/commands/setup-presets.js'
import { generateCommitlintConfig } from '../../src/cli/generators/git.js'
import { generateConfigs } from '../../src/cli/generators/index.js'
import { composeVerifyScriptFromPkg } from '../../src/cli/generators/package-json.js'
import { readLockfile } from '../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

// #897: the opt-in Vite+ preset. `vp check` replaces Biome/ESLint/Prettier, so
// setup refuses the mixes and doctor stands those checks down.

const newTmpDir = useTmpDir()

/** Scaffold a preset without installing, the way `setup --skip-install` does. */
async function scaffold(preset: string): Promise<string> {
	const dir = newTmpDir()
	const log = vi.spyOn(console, 'log').mockImplementation(() => {})
	try {
		await setupProject({ directory: dir, preset, skipInstall: true, yes: true })
	} finally {
		log.mockRestore()
	}
	return dir
}

describe('vite-plus presets', () => {
	it('are listed, and are the only presets that set vitePlus', () => {
		expect(PRESET_NAMES).toEqual(expect.arrayContaining(['vite-plus', 'vite-plus-app']))
		for (const name of PRESET_NAMES) {
			expect(buildPresetConfig(name, 'demo').vitePlus === true).toBe(name.startsWith('vite-plus'))
		}
	})

	it('records no Biome, ESLint, Prettier or Oxlint: Vite+ owns lint and format', () => {
		for (const name of ['vite-plus', 'vite-plus-app'] as const) {
			const config = buildPresetConfig(name, 'demo')
			expect(config.linting.tool).toBe('none')
			expect(config.formatting.tool).toBe('none')
			expect(config.oxlint).toBeUndefined()
			expect(config.bundler).toBe('vite')
			expect(validateProjectConfig(config)).toEqual({ valid: true, errors: [] })
		}
	})

	it('the library publishes through semantic-release, the app does not', () => {
		const library = buildPresetConfig('vite-plus', 'demo')
		expect(library.projectType).toBe('library')
		expect(library.semanticRelease).toBe(true)
		const app = buildPresetConfig('vite-plus-app', 'demo')
		expect(app.projectType).toBe('web-app')
		expect(app.semanticRelease).toBe(false)
	})

	it('puts vitePlus in the published config schema', () => {
		expect(CONFIG_SCHEMA.properties.vitePlus).toEqual({ type: 'boolean' })
	})
})

describe('vitePlus config validation', () => {
	const config = () => ({ ...buildPresetConfig('vite-plus', 'demo') })

	it.each([
		['biome linting', { linting: { tool: 'biome' } }, /linting\.tool must be 'none'/],
		['eslint linting', { linting: { tool: 'eslint' } }, /linting\.tool must be 'none'/],
		['both linters', { linting: { tool: 'both' } }, /linting\.tool must be 'none'/],
		['biome formatting', { formatting: { tool: 'biome' } }, /formatting\.tool must be 'none'/],
		['prettier', { formatting: { tool: 'prettier' } }, /formatting\.tool must be 'none'/],
		['the Oxlint add-on', { oxlint: true }, /oxlint add-on/],
		['jest', { testing: { framework: 'jest' } }, /testing\.framework must be 'vitest'/],
		['tsup', { bundler: 'tsup' }, /bundler must be 'vite'/],
		['a Next.js app', { projectType: 'nextjs-app' }, /'library' and 'web-app'/],
	])('rejects vitePlus with %s', (_name, override, message) => {
		const result = validateProjectConfig({ ...config(), ...override })
		expect(result.valid).toBe(false)
		expect(result.errors.join('\n')).toMatch(message)
	})

	it('leaves Biome, ESLint and the Oxlint add-on valid when vitePlus is off', () => {
		for (const override of [{ linting: { tool: 'biome' } }, { oxlint: true }]) {
			const { vitePlus: _, ...rest } = config()
			expect(validateProjectConfig({ ...rest, ...override }).valid).toBe(true)
		}
	})
})

describe('vite-plus file list', () => {
	it('swaps husky, biome and the vitest/tsup configs for vite.config.ts and .vite-hooks', () => {
		const files = computeFileList(buildPresetConfig('vite-plus', 'demo'))
		expect(files).toEqual(
			expect.arrayContaining([
				'vite.config.ts',
				'.vite-hooks/pre-commit',
				'.vite-hooks/commit-msg',
				'.size-limit.json',
			])
		)
		for (const gone of ['.husky/pre-commit', 'biome.json', 'vitest.config.ts', 'tsup.config.ts']) {
			expect(files).not.toContain(gone)
		}
	})
})

describe('vite-plus library scaffold', () => {
	let dir: string
	beforeEach(async () => {
		dir = await scaffold('vite-plus')
	})

	it('drives lint, test, build and hooks through vp', async () => {
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts).toMatchObject({
			check: 'vp check',
			test: 'vp test',
			build: 'vp pack',
			prepare: 'vp config',
		})
		// `vp check` type-checks, and `vp build` is the app builder that fails on a library.
		expect(pkg.scripts.typecheck).toBeUndefined()
		expect(pkg.scripts.build).not.toContain('vp build')
		expect(pkg.scripts.verify).toBe(
			'pnpm check && pnpm exec vp test run && pnpm build && pnpm publint && pnpm attw'
		)
	})

	it('depends on vite-plus from the catalog and on none of the tools it replaces', async () => {
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.devDependencies['vite-plus']).toBe('catalog:')
		for (const gone of ['@biomejs/biome', 'vitest', 'tsup', 'husky', 'lint-staged', 'eslint']) {
			expect(pkg.devDependencies[gone]).toBeUndefined()
		}
		expect(pkg.engines.node).toBe('^22.18.0 || ^24.11.0 || >=26.0.0')
		expect(pkg.packageManager).toMatch(/^pnpm@/)
	})

	it('keeps the dual CJS/ESM publish contract the other library presets have', async () => {
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.exports['.']).toEqual({
			types: { import: './dist/index.d.ts', require: './dist/index.d.cts' },
			import: './dist/index.js',
			require: './dist/index.cjs',
		})
		const config = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(config).toContain("format: ['esm', 'cjs']")
		// Without this tsdown names the files .mjs/.d.mts and the exports above 404.
		expect(config).toContain('fixedExtension: false')
		// `exports: true` would have `vp pack` rewrite package.json on every build.
		expect(config).not.toContain('exports: true')
	})

	it('writes vite.config.ts and no tool configs for what Vite+ replaces', async () => {
		const config = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(config).toContain("from 'vite-plus'")
		expect(config).toContain("'*': 'vp check --fix'")
		expect(config).toContain('typeCheck: true')
		for (const gone of [
			'biome.json',
			'vitest.config.ts',
			'vitest.setup.ts',
			'tsup.config.ts',
			'.oxlintrc.json',
			'.husky',
		]) {
			expect(await fs.pathExists(join(dir, gone))).toBe(false)
		}
	})

	it('adds the vite-plus catalog to pnpm-workspace.yaml without losing the managed settings', async () => {
		const yaml = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(yaml).toContain('catalog:')
		expect(yaml).toContain('vite-plus: 1.2.0')
		expect(yaml).toContain('vite: npm:@voidzero-dev/vite-plus-core@1.2.0')
		expect(yaml).toContain('verifyDepsBeforeRun: false')
	})

	it('writes the hooks `vp config` wires up, including commitlint', async () => {
		expect(await fs.readFile(join(dir, '.vite-hooks', 'pre-commit'), 'utf-8')).toBe('vp staged\n')
		expect(await fs.readFile(join(dir, '.vite-hooks', 'commit-msg'), 'utf-8')).toContain(
			'commitlint --edit $1'
		)
		expect(await fs.readFile(join(dir, '.vite-hooks', 'pre-push'), 'utf-8')).toContain(
			'pnpm verify'
		)
	})

	it('extends our tsconfig without the vitest types it does not install', async () => {
		const tsconfig = await fs.readJson(join(dir, 'tsconfig.json'))
		expect(tsconfig.extends).toBe('@rtorcato/repo-tooling/typescript/base')
		expect(tsconfig.compilerOptions.types).toEqual(['node'])
	})

	it('starts with a test that imports the runner from vite-plus/test', async () => {
		const test = await fs.readFile(join(dir, 'src', 'index.test.ts'), 'utf-8')
		expect(test).toContain("from 'vite-plus/test'")
		expect(test).not.toContain("from 'vitest'")
	})

	it('runs `pnpm check` and `pnpm test` in CI, with no typecheck job', async () => {
		const ci = await fs.readFile(join(dir, '.github', 'workflows', 'ci.yml'), 'utf-8')
		expect(ci).toContain('run: pnpm check')
		expect(ci).toContain('run: pnpm test')
		expect(ci).not.toContain('pnpm typecheck')
		expect(ci).not.toContain('pnpm coverage')
		// Plain pnpm, so the vite-plus version comes from the lockfile: no remote install script.
		expect(ci).not.toContain('setup-vp')
		expect(ci).toContain('pnpm install --frozen-lockfile')
	})

	it('records vitePlus in the lockfile', async () => {
		const lock = await readLockfile(dir)
		expect(lock?.record.config.vitePlus).toBe(true)
	})

	it('recommends the Oxc extension', async () => {
		const { recommendations } = await fs.readJson(join(dir, '.vscode', 'extensions.json'))
		expect(recommendations).toContain('oxc.oxc-vscode')
	})
})

describe('vite-plus app scaffold', () => {
	it('builds with vp build and ships an index.html for it', async () => {
		const dir = await scaffold('vite-plus-app')
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts).toMatchObject({
			build: 'vp build',
			dev: 'vp dev',
			preview: 'vp preview',
			check: 'vp check',
		})
		expect(pkg.private).toBe(true)
		expect(pkg.exports).toBeUndefined()
		expect(await fs.pathExists(join(dir, 'index.html'))).toBe(true)
		const config = await fs.readFile(join(dir, 'vite.config.ts'), 'utf-8')
		expect(config).not.toContain('pack:')
		const test = await fs.readFile(join(dir, 'src', 'index.test.ts'), 'utf-8')
		expect(test).toContain("from 'vite-plus/test'")
	})
})

describe('doctor on a Vite+ scaffold', () => {
	// What each of these reports on a Biome repo; a Vite+ repo leaves the files out on purpose.
	const STANDS_DOWN = [
		'Biome',
		'ESLint',
		'Prettier',
		'Vitest',
		'Oxlint',
		'Turborepo',
		'lint-staged',
		'Git hooks',
		'Pre-push hook',
		'verify script',
		'GitHub Actions',
		'VS Code extensions',
		'packageManager',
		'TypeScript',
	]

	it.each(['vite-plus', 'vite-plus-app'])(
		'reports no drift from the %s toolchain',
		async (preset) => {
			const dir = await scaffold(preset)
			const results = await runDoctor(dir, { offline: true })
			const flagged = results.filter(
				(r) => STANDS_DOWN.includes(r.check) && r.status !== 'ok' && r.status !== 'skipped'
			)
			expect(flagged).toEqual([])
			expect(results.filter((r) => r.status === 'drift' || r.status === 'missing')).toEqual([])
		}
	)

	it('flags a pre-commit hook that no longer runs vp staged', async () => {
		const dir = await scaffold('vite-plus')
		await fs.writeFile(join(dir, '.vite-hooks', 'pre-commit'), '# vp staged\n')
		const results = await runDoctor(dir, { offline: true })
		expect(results.find((r) => r.check === 'lint-staged')).toMatchObject({ status: 'drift' })
	})
})

describe('vitePlus in the lockfile', () => {
	it('declines the checks for files a Vite+ repo leaves out', async () => {
		const dir = await scaffold('vite-plus')
		const lock = await readLockfile(dir)
		for (const check of ['Biome', 'ESLint', 'Prettier', 'Vitest', 'Oxlint', 'Turborepo']) {
			expect(declinedInLock(lock, check), check).toBe(true)
		}
		// Hooks are wired, just differently: they are not declined.
		expect(declinedInLock(lock, 'Git hooks')).toBe(false)
	})

	it('does not decline the Oxlint add-on for a Biome repo', async () => {
		const dir = await scaffold('library')
		expect(declinedInLock(await readLockfile(dir), 'Oxlint')).toBe(false)
	})
})

describe('commit-msg hook location', () => {
	let log: ReturnType<typeof vi.spyOn>
	beforeEach(() => {
		log = vi.spyOn(console, 'log').mockImplementation(() => {})
	})
	afterEach(() => log.mockRestore())

	it('goes in .vite-hooks for a repo with vite-plus and no .husky', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { devDependencies: { 'vite-plus': '1.2.0' } })
		expect(await generateCommitlintConfig(dir)).toContain('.vite-hooks/commit-msg')
		expect(await fs.pathExists(join(dir, '.husky'))).toBe(false)
	})

	it('still goes in .husky for a husky repo', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { devDependencies: { husky: '^9.0.0' } })
		expect(await generateCommitlintConfig(dir)).toContain('.husky/commit-msg')
	})
})

describe('verify chain for an existing Vite+ repo', () => {
	it('composes check and a single-pass test, then build and publint when present', () => {
		const pkg = {
			scripts: { check: 'vp check', test: 'vp test', build: 'vp pack', publint: 'publint' },
			devDependencies: { 'vite-plus': 'catalog:' },
		}
		expect(composeVerifyScriptFromPkg(pkg)).toBe(
			'pnpm check && pnpm exec vp test run && pnpm build && pnpm publint'
		)
	})
})

// Generating into a directory that already has a catalog must not duplicate it.
describe('re-running the generators', () => {
	it('keeps one catalog block', async () => {
		const dir = newTmpDir()
		const config = buildPresetConfig('vite-plus', 'demo')
		const log = vi.spyOn(console, 'log').mockImplementation(() => {})
		try {
			await generateConfigs(config, dir)
			await generateConfigs(config, dir)
		} finally {
			log.mockRestore()
		}
		const yaml = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(yaml.match(/^catalog:/gm)).toHaveLength(1)
	})
})
