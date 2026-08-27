import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GitExec } from '../../../src/base/git-identity.js'
import { checkExportsBuildable, declaredEntryPoints } from '../../../src/languages/js/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** The cheap .git gate must pass before git is consulted. */
function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

/** Stands in for `git ls-files -z`: the repo's tracked paths, NUL-separated. */
const tracks =
	(...paths: string[]): GitExec =>
	async () =>
		paths.join('\0')

/** The contract #570 shipped: dual-format, so half of it only tsup can produce. */
const DUAL_CONTRACT = {
	name: 'demo',
	main: './dist/index.cjs',
	module: './dist/index.js',
	types: './dist/index.d.ts',
	exports: {
		'.': {
			import: { types: './dist/index.d.ts', default: './dist/index.js' },
			require: { types: './dist/index.d.cts', default: './dist/index.cjs' },
		},
	},
}

describe('declaredEntryPoints', () => {
	it('collects main/module/types and every nested exports condition', () => {
		expect(declaredEntryPoints(DUAL_CONTRACT).sort()).toEqual([
			'./dist/index.cjs',
			'./dist/index.d.cts',
			'./dist/index.d.ts',
			'./dist/index.js',
		])
	})

	it('is empty for a package that declares no contract', () => {
		expect(declaredEntryPoints({ name: 'demo' })).toEqual([])
	})
})

describe('checkExportsBuildable', () => {
	it('flags the #570 case: a dual contract with `build: tsc`', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{ ...DUAL_CONTRACT, scripts: { build: 'tsc' } },
			tracks()
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('./dist/index.cjs')
		expect(r.detail).toContain('./dist/index.d.cts')
		// The halves tsc does emit are not reported.
		expect(r.detail).not.toContain('./dist/index.js,')
	})

	it('passes the same contract when tsup builds it', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{ ...DUAL_CONTRACT, scripts: { build: 'tsup' } },
			tracks()
		)
		expect(r.status).toBe('ok')
	})

	it('passes a single-format contract under tsc', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{
				name: 'demo',
				main: './dist/index.js',
				types: './dist/index.d.ts',
				scripts: { build: 'tsc' },
			},
			tracks()
		)
		expect(r.status).toBe('ok')
	})

	it('leaves committed assets alone — they need no build', async () => {
		// repo-tooling's own shape: exports point at .mjs/.d.mts files that are
		// checked in, which no build script emits and none needs to.
		const r = await checkExportsBuildable(
			gitRepo(),
			{
				name: 'demo',
				exports: { './preset': { types: './tooling/x.d.mts', default: './tooling/x.mjs' } },
				scripts: { build: 'tsc' },
			},
			tracks('tooling/x.mjs', 'tooling/x.d.mts')
		)
		expect(r.status).toBe('ok')
	})

	it('resolves a cleaner chain and a script indirection', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{
				...DUAL_CONTRACT,
				scripts: { build: 'pnpm build-cli', 'build-cli': 'rimraf ./dist && tsc -p tsconfig.json' },
			},
			tracks()
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('./dist/index.cjs')
	})

	it('stands down on a build command it does not recognise', async () => {
		for (const build of ['vite build', 'tsc | tee log', 'node ./scripts/build.mjs']) {
			const r = await checkExportsBuildable(
				gitRepo(),
				{ ...DUAL_CONTRACT, scripts: { build } },
				tracks()
			)
			expect(r.status, build).toBe('ok')
			expect(r.detail, build).toContain('not checked')
		}
	})

	it('stands down when .cts sources make tsc a dual-format emitter after all', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{ ...DUAL_CONTRACT, scripts: { build: 'tsc' } },
			tracks('src/index.cts')
		)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('.cts/.mts sources')
	})

	it('does not judge a package that publishes its TypeScript source', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{ name: 'demo', main: './src/index.ts', scripts: { build: 'tsc' } },
			tracks()
		)
		expect(r.status).toBe('ok')
	})

	it('stands down outside a git repository', async () => {
		const r = await checkExportsBuildable(newTmpDir(), {
			...DUAL_CONTRACT,
			scripts: { build: 'tsc' },
		})
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('not a git repository')
	})

	it('stands down when git is unavailable', async () => {
		const r = await checkExportsBuildable(
			gitRepo(),
			{ ...DUAL_CONTRACT, scripts: { build: 'tsc' } },
			async () => null
		)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('git ls-files')
	})

	it('is not applicable to a private package or one with no build', async () => {
		const priv = await checkExportsBuildable(
			gitRepo(),
			{ ...DUAL_CONTRACT, private: true, scripts: { build: 'tsc' } },
			tracks()
		)
		expect(priv.status).toBe('ok')
		expect(priv.detail).toContain('not applicable')

		const noBuild = await checkExportsBuildable(gitRepo(), DUAL_CONTRACT, tracks())
		expect(noBuild.status).toBe('ok')
		expect(noBuild.detail).toContain('no build script')
	})
})
