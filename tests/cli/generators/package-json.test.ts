import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { declaredEntryPoints } from '../../../src/languages/js/checks.js'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import {
	SIZE_LIMIT_VERSION,
	composeVerifyScript,
	composeVerifyScriptFromPkg,
	generatePackageJson,
} from '../../../src/cli/generators/package-json.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function baseConfig(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'my-app',
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

describe('generatePackageJson', () => {
	it('creates a new package.json with the project name', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectName: 'cool-lib' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.name).toBe('cool-lib')
		expect(pkg.version).toBe('0.1.0')
		expect(pkg.type).toBe('module')
		expect(pkg.devDependencies['@rtorcato/repo-tooling']).toBe('latest')
		// packageManager is the single source of truth for pnpm/action-setup
		expect(pkg.packageManager).toMatch(/^pnpm@\d+\.\d+\.\d+$/)
	})

	it('merges into an existing package.json, preserving existing name and version', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'existing-pkg',
			version: '1.2.3',
			description: 'keep me',
			packageManager: 'pnpm@10.0.0',
		})

		await generatePackageJson(baseConfig(), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		// existing fields win over config defaults via spread
		expect(pkg.name).toBe('existing-pkg')
		expect(pkg.version).toBe('1.2.3')
		expect(pkg.description).toBe('keep me')
		expect(pkg.packageManager).toBe('pnpm@10.0.0')
		// new devDependencies are still injected
		expect(pkg.devDependencies['@rtorcato/repo-tooling']).toBe('latest')
	})

	it('wires commitizen alongside commitlint when commitLint is on', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ commitLint: true }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.commit).toBe('cz')
		expect(pkg.config.commitizen.path).toBe('./node_modules/cz-conventional-changelog')
		expect(pkg.devDependencies.commitizen).toBeDefined()
		expect(pkg.devDependencies['cz-conventional-changelog']).toBeDefined()
	})

	it('omits commitizen wiring when commitLint is off', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ commitLint: false }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.commit).toBeUndefined()
		expect(pkg.config?.commitizen).toBeUndefined()
		expect(pkg.devDependencies.commitizen).toBeUndefined()
	})

	it('wires are-the-types-wrong (attw) for library projects', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'library' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.attw).toBe('attw --pack')
		expect(pkg.devDependencies['@arethetypeswrong/cli']).toBeDefined()
	})

	it('omits attw for non-library projects', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'react-app' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.attw).toBeUndefined()
		expect(pkg.devDependencies['@arethetypeswrong/cli']).toBeUndefined()
	})

	// #382: the budget the library scaffold writes needs a way to run it.
	it('wires the size-limit script + dependency for library projects only', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'library' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts['size-limit']).toBe('size-limit')
		expect(pkg.devDependencies['size-limit']).toBe(SIZE_LIMIT_VERSION)

		const appDir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'react-app' }), appDir)

		const appPkg = await fs.readJson(join(appDir, 'package.json'))
		expect(appPkg.scripts['size-limit']).toBeUndefined()
		expect(appPkg.devDependencies['size-limit']).toBeUndefined()
	})

	it('adds library fields for library project type', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'library' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		// Mapping must match tsup output (type:module, format cjs+esm):
		// ESM → index.js, CJS → index.cjs, types → index.d.ts / index.d.cts.
		expect(pkg.main).toBe('./dist/index.cjs')
		expect(pkg.module).toBe('./dist/index.js')
		expect(pkg.types).toBe('./dist/index.d.ts')
		expect(pkg.exports['.'].import).toBe('./dist/index.js')
		expect(pkg.exports['.'].require).toBe('./dist/index.cjs')
		expect(pkg.files).toContain('dist')
		expect(pkg.publishConfig.access).toBe('public')
	})

	it('installs release deps and does NOT write build approvals to package.json', async () => {
		const dir = newTmpDir()
		await generatePackageJson(
			baseConfig({ projectType: 'library', bundler: 'tsup', semanticRelease: true }),
			dir
		)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		// Build approvals live in pnpm-workspace.yaml (allowBuilds) — pnpm 11
		// ignores the package.json `pnpm` field — so it must not be written here.
		expect(pkg.pnpm).toBeUndefined()
		expect(pkg.devDependencies['semantic-release']).toBeDefined()
		expect(pkg.devDependencies['@semantic-release/github']).toBeDefined()
		// The changelog + git plugins are NOT installed: the github preset drops
		// them, because the git plugin's push to main is rejected by the
		// code-scanning ruleset `fix github-settings` installs (#417).
		expect(pkg.devDependencies['@semantic-release/changelog']).toBeUndefined()
		expect(pkg.devDependencies['@semantic-release/git']).toBeUndefined()
	})

	it('omits library fields for web-app project type', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ projectType: 'web-app' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.main).toBeUndefined()
		expect(pkg.exports).toBeUndefined()
	})

	it('adds biome scripts when linting tool is biome', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ linting: { tool: 'biome' } }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.lint).toBe('biome lint .')
		expect(pkg.scripts.format).toBe('biome format .')
		expect(pkg.scripts.check).toBe('biome check .')
		expect(pkg.scripts['check:fix']).toBe('biome check --fix .')
		expect(pkg.scripts['lint:fix']).toBeUndefined()
	})

	it('adds eslint + prettier scripts when linting tool is eslint', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ linting: { tool: 'eslint' } }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.lint).toBe('eslint .')
		expect(pkg.scripts['lint:fix']).toBe('eslint . --fix')
		expect(pkg.scripts.format).toBe('prettier --write .')
	})

	it('adds vitest scripts and devDependencies when testing is vitest', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ testing: { framework: 'vitest' } }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.test).toBe('vitest')
		expect(pkg.scripts['test:watch']).toBe('vitest --watch')
		expect(pkg.scripts.coverage).toBe('vitest run --coverage')
		expect(pkg.devDependencies.vitest).toBeDefined()
	})

	it('adds tsup scripts and devDependencies when bundler is tsup', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ bundler: 'tsup' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.build).toBe('tsup')
		expect(pkg.scripts['build:watch']).toBe('tsup --watch')
		expect(pkg.devDependencies.tsup).toBeDefined()
	})

	it('adds husky prepare script and devDependency when gitHooks is true', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ gitHooks: true }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.prepare).toBe('husky')
		expect(pkg.devDependencies.husky).toBeDefined()
		expect(pkg.devDependencies['lint-staged']).toBeDefined()
	})

	it('adds semantic-release script and devDependencies when semanticRelease is true', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ semanticRelease: true }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.release).toBe('semantic-release')
		expect(pkg.devDependencies['semantic-release']).toBeDefined()
	})

	it('adds typecheck script when TypeScript is enabled', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ typescript: { enabled: true, config: 'base' } }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.typecheck).toBe('tsc --noEmit')
		expect(pkg.devDependencies.typescript).toBeDefined()
	})

	it('adds a verify script chaining typecheck + check + vitest for a TS/biome/vitest library', async () => {
		const dir = newTmpDir()
		await generatePackageJson(
			baseConfig({
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'biome' },
				testing: { framework: 'vitest' },
			}),
			dir
		)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.verify).toBe(
			'pnpm typecheck && pnpm check && pnpm exec vitest run && pnpm attw'
		)
	})

	it('omits the verify script when only one tool is enabled', async () => {
		const dir = newTmpDir()
		await generatePackageJson(
			baseConfig({
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'none' },
				testing: { framework: 'none' },
			}),
			dir
		)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.verify).toBeUndefined()
	})

	it('adds publint dep, script, and verify step when publint is enabled', async () => {
		const dir = newTmpDir()
		await generatePackageJson(
			baseConfig({
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'biome' },
				publint: true,
			}),
			dir
		)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.devDependencies.publint).toBe('^0.3.0')
		expect(pkg.scripts.publint).toBe('publint --strict')
		expect(pkg.scripts.verify).toBe('pnpm typecheck && pnpm check && pnpm publint && pnpm attw')
	})

	it('omits publint when not enabled', async () => {
		const dir = newTmpDir()
		await generatePackageJson(baseConfig({ publint: false }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.publint).toBeUndefined()
		expect(pkg.devDependencies.publint).toBeUndefined()
	})
})

describe('composeVerifyScript', () => {
	it('uses pnpm lint for eslint projects', () => {
		const result = composeVerifyScript(
			baseConfig({
				linting: { tool: 'eslint' },
				testing: { framework: 'vitest' },
			})
		)
		expect(result).toBe('pnpm typecheck && pnpm lint && pnpm exec vitest run && pnpm attw')
	})

	it('uses pnpm test --ci for jest projects', () => {
		const result = composeVerifyScript(
			baseConfig({
				linting: { tool: 'biome' },
				testing: { framework: 'jest' },
			})
		)
		expect(result).toBe('pnpm typecheck && pnpm check && pnpm test --ci && pnpm attw')
	})

	it('returns null when fewer than two tools are enabled', () => {
		const result = composeVerifyScript(
			baseConfig({
				typescript: { enabled: false, config: 'base' },
				linting: { tool: 'none' },
				testing: { framework: 'vitest' },
			})
		)
		expect(result).toBeNull()
	})
})

// #364: `fix verify` skipped on a repo with both typecheck and test scripts,
// because the test half only counted when a runner it recognised was in deps.
describe('composeVerifyScriptFromPkg test fallback', () => {
	it('counts a test script from a runner it does not recognise', () => {
		const verify = composeVerifyScriptFromPkg({
			scripts: { typecheck: 'tsc --noEmit', test: 'node --test' },
			devDependencies: { typescript: '^5.9.3' },
		})
		expect(verify).toBe('pnpm typecheck && pnpm test')
	})

	it('still prefers the recognised runner when one is installed', () => {
		const verify = composeVerifyScriptFromPkg({
			scripts: { typecheck: 'tsc --noEmit', test: 'vitest' },
			devDependencies: { typescript: '^5.9.3', vitest: '^4.0.0' },
		})
		expect(verify).toBe('pnpm typecheck && pnpm exec vitest run')
	})
})

// #570: the preset wrote a dual-format publish contract but preserved the repo's
// existing `build: tsc`, which emits neither ./dist/index.cjs nor
// ./dist/index.d.cts — so every CJS entry point in the published package 404'd.
// Nothing asserted setup's own output was internally coherent, which is why it
// shipped.
describe('library publish contract (#570)', () => {
	// What each build command actually drops in dist/ for a `src/index.ts` in a
	// "type": "module" package. tsup (format: ['cjs','esm'], dts: true) is the only
	// one producing the .cjs / .d.cts half of the dual contract.
	const EMITS: Record<string, string[]> = {
		tsup: ['./dist/index.js', './dist/index.cjs', './dist/index.d.ts', './dist/index.d.cts'],
		tsc: ['./dist/index.js', './dist/index.d.ts'],
	}

	// `declaredEntryPoints` is doctor's own walker (#578), so this test and the
	// `Exports buildable` check cannot drift on what the contract even is.
	async function readCoherentPkg(dir: string) {
		const pkg = await fs.readJson(join(dir, 'package.json'))
		const emitted = EMITS[pkg.scripts.build]
		expect(emitted, `no emitted-file list for build script: ${pkg.scripts.build}`).toBeDefined()
		expect(declaredEntryPoints(pkg).filter((p) => !emitted.includes(p))).toEqual([])
		return pkg
	}

	it('names only entry points the resolved build script emits (greenfield)', async () => {
		const dir = newTmpDir()
		await generatePackageJson(buildPresetConfig('library', 'my-lib'), dir)
		await readCoherentPkg(dir)
	})

	it('claims a stale `build` rather than shipping exports nothing emits', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'my-lib',
			main: 'dist/index.js',
			scripts: { build: 'tsc', 'my:script': 'echo hi', test: 'node --test' },
		})
		await generatePackageJson(buildPresetConfig('library', 'my-lib'), dir)

		const pkg = await readCoherentPkg(dir)
		expect(pkg.scripts.build).toBe('tsup')
		// `build` is the only script the contract claims — the rest still merge.
		expect(pkg.scripts['my:script']).toBe('echo hi')
		expect(pkg.scripts.test).toBe('node --test')
	})

	it('leaves a non-library `build` alone', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { scripts: { build: 'tsc' } })
		await generatePackageJson(baseConfig({ projectType: 'node-api', bundler: 'tsup' }), dir)

		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.scripts.build).toBe('tsc')
	})
})
