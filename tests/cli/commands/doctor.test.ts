import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	evaluateNodeVersion,
	nextStepSuggestions,
	runDoctor,
	summarize,
} from '../../../src/cli/commands/doctor.js'
import { checkBuildApprovals, pnpmStoreDirToName } from '../../../src/languages/js/checks.js'
import { generateDependabotConfig } from '../../../src/cli/generators/security.js'
import { copyPreset } from '../../../src/cli/utils/copy-preset.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

async function seedPackageJson(dir: string, withDep = true) {
	await fs.writeJson(join(dir, 'package.json'), {
		name: 'demo',
		version: '0.0.0',
		devDependencies: withDep ? { '@rtorcato/repo-tooling': '^2.0.0' } : {},
	})
}

// The language-agnostic suite, declared once in doctor's runBaseChecks. Before
// #309 the JS path re-listed it inline, so anything added to base silently
// skipped JS repos — and the hook/commit/badge checks lived in the JS module, so
// a Swift repo never saw them at all.
const BASE_CHECKS = [
	'lockfile',
	'EditorConfig',
	'Commitlint',
	'Git hooks',
	'Pre-push hook',
	'GitHub Actions',
	'Dependabot',
	'CodeQL',
	'GitLab CI',
	'CODEOWNERS',
	'Community health',
	'AI setup',
	'README badges',
	'Coverage upload',
]

describe('doctor base suite', () => {
	it('runs every base check for a JS repo and a Swift repo alike', async () => {
		const jsDir = newTmpDir()
		await seedPackageJson(jsDir)
		const swiftDir = newTmpDir()
		await fs.writeFile(join(swiftDir, 'Package.swift'), '// swift-tools-version: 5.9\n')

		const jsChecks = new Set((await runDoctor(jsDir)).map((r) => r.check))
		const swiftChecks = new Set((await runDoctor(swiftDir)).map((r) => r.check))

		for (const check of BASE_CHECKS) {
			expect(jsChecks, `JS: ${check}`).toContain(check)
			expect(swiftChecks, `Swift: ${check}`).toContain(check)
		}
	})

	it('emits each base check exactly once', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const names = (await runDoctor(dir)).map((r) => r.check)
		const duplicated = names.filter((n, i) => names.indexOf(n) !== i)
		expect(duplicated).toEqual([])
	})

	it('suggests the Swift fixer, not the husky one, for a Swift repo', () => {
		const results = [{ check: 'Git hooks', status: 'optional-missing' as const, detail: '' }]
		expect(nextStepSuggestions(results, 'swift')[0]).toMatch(/fix swift-git-hooks/)
		expect(nextStepSuggestions(results, 'js')[0]).toMatch(/fix husky/)
	})
})

describe('doctor', () => {
	it('reports drift when nothing is configured', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir, false)

		const results = await runDoctor(dir)
		const byCheck = new Map(results.map((r) => [r.check, r]))

		expect(byCheck.get('package.json')?.status).toBe('drift')
		expect(byCheck.get('TypeScript')?.status).toBe('missing')
		expect(byCheck.get('Biome')?.status).toBe('optional-missing')
	})

	it('reports ok when tsconfig extends our preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'tsconfig.json'), {
			extends: '@rtorcato/repo-tooling/typescript/base',
		})

		const results = await runDoctor(dir)
		const ts = results.find((r) => r.check === 'TypeScript')
		expect(ts?.status).toBe('ok')
	})

	it('reports drift when tsconfig exists but does not extend our preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'tsconfig.json'), {
			compilerOptions: { strict: true },
		})

		const results = await runDoctor(dir)
		const ts = results.find((r) => r.check === 'TypeScript')
		expect(ts?.status).toBe('drift')
		expect(ts?.hint).toMatch(/tsconfig/)
	})

	// #385: `copy tsconfig` writes the preset inline — the preset names itself
	// nowhere, so the old text matcher could never match what copy produced and
	// the repo stayed drifted however many times it re-ran.
	it('reports ok for the tsconfig.json `copy tsconfig` writes', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await copyPreset('tsconfig', dir)

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'TypeScript')?.status).toBe('ok')
	})

	it('still reports drift for a tsconfig that is neither a pointer nor the preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'tsconfig.json'), { compilerOptions: { strict: false } })

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'TypeScript')?.status).toBe('drift')
	})

	// Keeping the preset's shape while turning strictness off is exactly the
	// drift this check exists to catch — the bypass the #379 security review
	// caught on the Biome side, one preset over.
	it('reports drift for a preset-shaped tsconfig with strict disabled', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		// The real preset, one option flipped: every other marker still present.
		await copyPreset('tsconfig', dir)
		const tsconfigPath = join(dir, 'tsconfig.json')
		const inlined = await fs.readFile(tsconfigPath, 'utf-8')
		const disabled = inlined.replace('"strict": true', '"strict": false')
		expect(disabled).not.toBe(inlined)
		await fs.writeFile(tsconfigPath, disabled)

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'TypeScript')?.status).toBe('drift')
	})

	it('reports drift when the preset it extends has strict switched back off', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'tsconfig.json'), {
			extends: '@rtorcato/repo-tooling/typescript/base',
			compilerOptions: { strict: false },
		})

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'TypeScript')?.status).toBe('drift')
	})

	// `strict: true` can stay literally present while any one flag it implies is
	// overridden to false — the override wins, so both shapes above would keep
	// every marker and still ship with type safety off.
	it('reports drift when a strict-implied flag is switched off on either shape', async () => {
		const pointer = newTmpDir()
		await seedPackageJson(pointer)
		await fs.writeJson(join(pointer, 'tsconfig.json'), {
			extends: '@rtorcato/repo-tooling/typescript/base',
			compilerOptions: { noImplicitAny: false },
		})

		const inlined = newTmpDir()
		await seedPackageJson(inlined)
		await copyPreset('tsconfig', inlined)
		const tsconfigPath = join(inlined, 'tsconfig.json')
		const preset = await fs.readFile(tsconfigPath, 'utf-8')
		// `strict` itself stays true, as do all four TS_PRESET_STRICTNESS keys.
		const weakened = preset.replace('"strict": true', '"strict": true, "strictNullChecks": false')
		expect(weakened).not.toBe(preset)
		await fs.writeFile(tsconfigPath, weakened)

		expect((await runDoctor(pointer)).find((r) => r.check === 'TypeScript')?.status).toBe('drift')
		expect((await runDoctor(inlined)).find((r) => r.check === 'TypeScript')?.status).toBe('drift')
	})

	it('accepts a commented tsconfig.json and does not crash on a corrupt one', async () => {
		const commented = newTmpDir()
		await seedPackageJson(commented)
		await fs.writeFile(
			join(commented, 'tsconfig.json'),
			'// shared preset\n{ "extends": "@rtorcato/repo-tooling/typescript/base" /* base */ }\n'
		)
		const corrupt = newTmpDir()
		await seedPackageJson(corrupt)
		await fs.writeFile(join(corrupt, 'tsconfig.json'), '{ "extends": "…/typescript/base"')

		expect((await runDoctor(commented)).find((r) => r.check === 'TypeScript')?.status).toBe('ok')
		expect((await runDoctor(corrupt)).find((r) => r.check === 'TypeScript')?.status).toBe('drift')
	})

	it('detects biome.jsonc and eslint configs that import our presets', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		// The comment is the point: biome.jsonc is a candidate, so the matcher has
		// to tolerate what the format allows rather than assume strict JSON.
		await fs.writeFile(
			join(dir, 'biome.jsonc'),
			'// shared preset\n{ "extends": ["@rtorcato/repo-tooling/biome"] }\n'
		)
		await fs.writeFile(
			join(dir, 'eslint.config.mjs'),
			"export { default } from '@rtorcato/repo-tooling/eslint/base'\n"
		)

		const results = await runDoctor(dir)
		const biome = results.find((r) => r.check === 'Biome')
		const eslint = results.find((r) => r.check === 'ESLint')
		expect(biome?.status).toBe('ok')
		expect(eslint?.status).toBe('ok')
	})

	// #378: `copy biome` writes the preset inline, with no `extends` to match,
	// so the repo was reported as drifted forever — re-running `copy` wrote the
	// same file again.
	it('reports ok for the biome.json `copy biome` writes', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await copyPreset('biome', dir)

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Biome')?.status).toBe('ok')
	})

	it('still reports drift for a biome.json that is neither a pointer nor the preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'biome.json'), { linter: { enabled: false } })

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Biome')?.status).toBe('drift')
	})

	// Keeping the preset's markers while switching the linter off is exactly the
	// drift this check exists to catch, so the shape has to be parsed rather than
	// scanned for `$schema` / `preset` as text.
	it('reports drift for a preset-shaped biome.json with the linter disabled', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'biome.json'), {
			$schema: 'https://biomejs.dev/schemas/2.5.0/schema.json',
			linter: { enabled: false, rules: { preset: 'recommended' } },
		})

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Biome')?.status).toBe('drift')
	})

	it('reports drift for a biome.json that is too corrupt to parse', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'biome.json'), '{ "extends": ["@rtorcato/repo-tooling/biome"')

		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Biome')?.status).toBe('drift')
	})

	it('summarize tallies statuses correctly', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'tsconfig.json'), {
			extends: '@rtorcato/repo-tooling/typescript/base',
		})

		const results = await runDoctor(dir)
		const summary = summarize(results)
		expect(summary.ok).toBeGreaterThanOrEqual(2) // package.json + tsconfig
		expect(summary.missing).toBe(0)
	})

	it('exits with non-zero when drift or missing present', async () => {
		const dir = newTmpDir()
		// no package.json at all
		const results = await runDoctor(dir)
		const summary = summarize(results)
		expect(summary.missing + summary.drift).toBeGreaterThan(0)
	})
})

describe('evaluateNodeVersion', () => {
	it('reports missing when Node major is below the minimum', () => {
		const result = evaluateNodeVersion('v20.10.0')
		expect(result.status).toBe('missing')
		expect(result.hint).toMatch(/nodejs\.org/)
	})

	it('reports drift on Node 22 below the LTS patch', () => {
		const result = evaluateNodeVersion('v22.10.0')
		expect(result.status).toBe('drift')
		expect(result.hint).toMatch(/22\.22\.2/)
	})

	it('reports drift on Node 24 below the LTS patch', () => {
		const result = evaluateNodeVersion('v24.14.1')
		expect(result.status).toBe('drift')
		expect(result.hint).toMatch(/24\.15\.0/)
	})

	it('reports ok on Node 22.22.2 and 24.15.0+', () => {
		expect(evaluateNodeVersion('v22.22.2').status).toBe('ok')
		expect(evaluateNodeVersion('v24.15.0').status).toBe('ok')
		expect(evaluateNodeVersion('v24.20.0').status).toBe('ok')
	})

	it('reports ok on Node 26+ without LTS patch requirements', () => {
		expect(evaluateNodeVersion('v26.0.0').status).toBe('ok')
		expect(evaluateNodeVersion('v28.5.1').status).toBe('ok')
	})

	it('tolerates pre-release suffixes', () => {
		const result = evaluateNodeVersion('v22.22.2-rc.1')
		expect(result.status).toBe('ok')
	})
})

describe('doctor extended checks', () => {
	it('reports drift when engines.node is missing', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const engines = results.find((r) => r.check === 'engines.node')
		expect(engines?.status).toBe('drift')
		expect(engines?.hint).toMatch(/engines/)
	})

	it('reports ok when engines.node is set', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { node: '>=22' },
		})
		const results = await runDoctor(dir)
		const engines = results.find((r) => r.check === 'engines.node')
		expect(engines?.status).toBe('ok')
	})

	it('reports drift when a pnpm repo has no packageManager', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		const results = await runDoctor(dir)
		const pm = results.find((r) => r.check === 'packageManager')
		expect(pm?.status).toBe('drift')
		expect(pm?.hint).toMatch(/fix engines/)
	})

	it('reports ok when packageManager is set', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			packageManager: 'pnpm@11.1.3',
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'packageManager')?.status).toBe('ok')
	})

	// Not applicable rather than drift: an npm or yarn repo has no pnpm version
	// to pin, and inventing one would be noise.
	it('reports ok when the repo does not use pnpm', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const pm = results.find((r) => r.check === 'packageManager')
		expect(pm?.status).toBe('ok')
		expect(pm?.detail).toBe('not a pnpm repo')
	})

	it('detects .editorconfig and .nvmrc presence', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, '.editorconfig'), 'root = true\n')
		await fs.writeFile(join(dir, '.nvmrc'), '22\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'EditorConfig')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'Node version pin')?.status).toBe('ok')
	})

	it('Node version consistency: ok when .nvmrc, engines, and workflow all agree', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { node: '>=22' },
		})
		await fs.writeFile(join(dir, '.nvmrc'), '22\n')
		await fs.outputFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: "22"\n'
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Node version consistency')?.status).toBe('ok')
	})

	it('Node version consistency: drift when a workflow hardcodes a different major', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { node: '>=22' },
		})
		await fs.writeFile(join(dir, '.nvmrc'), '22\n')
		await fs.outputFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  build:\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: 20\n'
		)
		const results = await runDoctor(dir)
		const c = results.find((r) => r.check === 'Node version consistency')
		expect(c?.status).toBe('drift')
		expect(c?.hint).toMatch(/fix node-version/)
	})

	it('Node version consistency: a matrix array is not flagged as drift', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { node: '>=22' },
		})
		await fs.writeFile(join(dir, '.nvmrc'), '22\n')
		await fs.outputFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  test:\n    strategy:\n      matrix:\n        node-version: ["22", "24"]\n    steps:\n      - uses: actions/setup-node@v7\n        with:\n          node-version: ${{ matrix.node-version }}\n'
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Node version consistency')?.status).toBe('ok')
	})

	it('reports git hooks drift when .husky/ exists without prepare script', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.husky'))
		const results = await runDoctor(dir)
		const gitHooks = results.find((r) => r.check === 'Git hooks')
		expect(gitHooks?.status).toBe('drift')
	})

	it('reports git hooks ok when both .husky/ and prepare script exist', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: { prepare: 'husky' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Git hooks')?.status).toBe('ok')
	})

	it('AI setup: optional-missing on a bare project, ok once AGENTS.md has the block', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		let results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'AI setup')?.status).toBe('optional-missing')

		await fs.writeFile(
			join(dir, 'AGENTS.md'),
			'<!-- js-tooling:start -->\nx\n<!-- js-tooling:end -->\n'
		)
		results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'AI setup')?.status).toBe('ok')
	})

	it('AI setup: ok when the Claude skill is present without AGENTS.md', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.outputFile(join(dir, '.claude', 'skills', 'js-tooling.md'), '# skill\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'AI setup')?.status).toBe('ok')
	})

	it('detects lint-staged in package.json', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			'lint-staged': { '*.ts': 'biome check' },
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'lint-staged')?.status).toBe('ok')
	})

	it('reports lint-staged ok when a husky hook actually calls it', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			'lint-staged': { '*.ts': 'biome check' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-commit'), 'npx lint-staged\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'lint-staged')?.status).toBe('ok')
	})

	it('reports lint-staged drift when configured but the husky hook only comments it out', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			'lint-staged': { '*.ts': 'biome check' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-commit'), '# npx lint-staged\npnpm check\n')
		const results = await runDoctor(dir)
		const ls = results.find((r) => r.check === 'lint-staged')
		expect(ls?.status).toBe('drift')
		expect(ls?.hint).toMatch(/fix husky/)
	})

	it('detects knip config field', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			knip: { entry: ['src/index.ts'] },
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'knip')?.status).toBe('ok')
	})

	it('skips semantic-release on private packages', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			private: true,
		})
		const results = await runDoctor(dir)
		const sr = results.find((r) => r.check === 'semantic-release')
		expect(sr?.status).toBe('optional-missing')
	})

	it('flags semantic-release drift on publishable packages without config', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const sr = results.find((r) => r.check === 'semantic-release')
		expect(sr?.status).toBe('drift')
		expect(sr?.hint).toMatch(/semantic-release/)
	})

	it('reports semantic-release ok when release config extends our preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(
			join(dir, 'release.config.mjs'),
			"export { default } from '@rtorcato/repo-tooling/semantic-release/github'\n"
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'semantic-release')?.status).toBe('ok')
	})

	it('reports semantic-release ok as "using Release Please instead" when only release-please is configured', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'release-please-config.json'), {
			packages: { '.': { 'release-type': 'node' } },
		})
		const results = await runDoctor(dir)
		const sr = results.find((r) => r.check === 'semantic-release')
		expect(sr?.status).toBe('ok')
		expect(sr?.detail).toMatch(/Release Please/)
	})

	it('flags drift when multiple release tools are configured', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(
			join(dir, 'release.config.mjs'),
			"export { default } from '@rtorcato/repo-tooling/semantic-release/github'\n"
		)
		await fs.writeJson(join(dir, 'release-please-config.json'), {
			packages: { '.': { 'release-type': 'node' } },
		})
		const sr = (await runDoctor(dir)).find((r) => r.check === 'semantic-release')
		expect(sr?.status).toBe('drift')
		expect(sr?.detail).toMatch(/multiple release tools/)
		expect(sr?.detail).toMatch(/Release Please/)
	})

	it('detects GitHub Actions workflows', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: ci\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'GitHub Actions')?.status).toBe('ok')
	})

	// #349/#340: "a workflow exists" reported ok on a ci.yml that had drifted
	// arbitrarily far from the preset, so nothing ever noticed the sync reverting a
	// consumer's action bump.
	it('flags ci.yml action pins that disagree with the preset', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'name: ci\njobs:\n  lint:\n    steps:\n      - uses: actions/setup-node@v3\n'
		)
		const gha = (await runDoctor(dir)).find((r) => r.check === 'GitHub Actions')
		expect(gha?.status).toBe('drift')
		expect(gha?.detail).toMatch(/actions\/setup-node@v3/)
	})

	it('ignores action pins the preset never emits', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'name: ci\njobs:\n  lint:\n    steps:\n      - uses: some-org/some-action@v1\n'
		)
		const gha = (await runDoctor(dir)).find((r) => r.check === 'GitHub Actions')
		expect(gha?.status).toBe('ok')
	})

	it('reports verify script optional-missing when not in package.json', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const verify = results.find((r) => r.check === 'verify script')
		expect(verify?.status).toBe('optional-missing')
		expect(verify?.hint).toMatch(/fix verify/)
	})

	it('reports verify script ok when a canonical chain is present', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: {
				typecheck: 'tsc --noEmit',
				check: 'biome check .',
				verify: 'pnpm typecheck && pnpm check && pnpm exec vitest run',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0', vitest: '^4.0.0' },
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'verify script')?.status).toBe('ok')
	})

	it('treats user-added steps in the verify chain as ok (lenient)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: {
				typecheck: 'tsc --noEmit',
				check: 'biome check .',
				verify: 'pnpm typecheck && pnpm check && pnpm exec vitest run && pnpm treeshake',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0', vitest: '^4.0.0' },
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'verify script')?.status).toBe('ok')
	})

	it('reports verify script drift when a tool is enabled but missing from the chain', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: {
				typecheck: 'tsc --noEmit',
				check: 'biome check .',
				verify: 'pnpm check',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		const results = await runDoctor(dir)
		const verify = results.find((r) => r.check === 'verify script')
		expect(verify?.status).toBe('drift')
		expect(verify?.detail).toMatch(/typecheck/)
	})

	it('reports pre-push hook ok when the hook calls pnpm verify', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-push'), 'pnpm verify\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('ok')
	})

	it('reports pre-push hook drift when the hook does not call pnpm verify', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
			scripts: { verify: 'pnpm typecheck && pnpm check' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-push'), 'pnpm test\n')
		const results = await runDoctor(dir)
		const prePush = results.find((r) => r.check === 'Pre-push hook')
		expect(prePush?.status).toBe('drift')
		expect(prePush?.hint).toMatch(/fix husky/)
	})

	it('reports pre-push hook drift when the verify call is commented out', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
			scripts: { verify: 'pnpm typecheck && pnpm check' },
		})
		await fs.ensureDir(join(dir, '.husky'))
		await fs.writeFile(join(dir, '.husky', 'pre-push'), '#!/usr/bin/env sh\n# pnpm verify\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('drift')
	})

	it('reports pre-push hook optional-missing when husky is present but the hook is absent', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.husky'))
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('optional-missing')
	})

	it('reports tree-shake check optional-missing on multi-subpath sideEffects-free libraries', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: '@my-org/my-lib',
			version: '0.0.0',
			sideEffects: false,
			exports: {
				'.': './dist/index.js',
				'./a': './dist/a.js',
				'./b': './dist/b.js',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		const results = await runDoctor(dir)
		const ts = results.find((r) => r.check === 'Tree-shake check')
		expect(ts?.status).toBe('optional-missing')
		expect(ts?.hint).toMatch(/fix treeshake-check/)
	})

	it('reports tree-shake check ok (not applicable) for single-export packages', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		const results = await runDoctor(dir)
		const ts = results.find((r) => r.check === 'Tree-shake check')
		expect(ts?.status).toBe('ok')
		expect(ts?.detail).toMatch(/not applicable/)
	})

	it('reports verify script drift when apps/treeshake-check exists but verify omits treeshake', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			scripts: {
				typecheck: 'tsc --noEmit',
				check: 'biome check .',
				verify: 'pnpm typecheck && pnpm check',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fs.ensureDir(join(dir, 'apps', 'treeshake-check'))
		await fs.writeFile(join(dir, 'apps', 'treeshake-check', 'check.mjs'), '// stub\n')
		const results = await runDoctor(dir)
		const verify = results.find((r) => r.check === 'verify script')
		expect(verify?.status).toBe('drift')
		expect(verify?.detail).toMatch(/treeshake/)
	})

	it('reports tree-shake check ok when apps/treeshake-check is present', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: '@my-org/my-lib',
			version: '0.0.0',
			sideEffects: false,
			exports: {
				'.': './dist/index.js',
				'./a': './dist/a.js',
				'./b': './dist/b.js',
			},
			devDependencies: { '@rtorcato/repo-tooling': '^2.0.0' },
		})
		await fs.ensureDir(join(dir, 'apps', 'treeshake-check'))
		await fs.writeFile(join(dir, 'apps', 'treeshake-check', 'check.mjs'), '// stub\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Tree-shake check')?.status).toBe('ok')
	})

	it('detects GitLab CI configuration', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, '.gitlab-ci.yml'), 'stages: []\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'GitLab CI')?.status).toBe('ok')
	})
})

describe('doctor security checks', () => {
	it('reports Dependabot optional-missing on empty repo', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const dep = results.find((r) => r.check === 'Dependabot')
		expect(dep?.status).toBe('optional-missing')
		expect(dep?.hint).toMatch(/fix dependabot/)
	})

	it('reports Dependabot drift when dependabot.yml exists but has no grouping', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github'))
		await fs.writeFile(join(dir, '.github', 'dependabot.yml'), 'version: 2\n')
		const results = await runDoctor(dir)
		const dep = results.find((r) => r.check === 'Dependabot')
		expect(dep?.status).toBe('drift')
		expect(dep?.hint).toMatch(/fix dependabot/)
	})

	it('reports Dependabot drift when the config lacks the canonical groups', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github'))
		await fs.writeFile(
			join(dir, '.github', 'dependabot.yml'),
			'version: 2\nupdates:\n  - package-ecosystem: "npm"\n    groups:\n      all:\n        patterns: ["*"]\n'
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Dependabot')?.status).toBe('drift')
	})

	it('reports Dependabot ok with the canonical config + auto-merge workflow', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await generateDependabotConfig(dir)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Dependabot')?.status).toBe('ok')
	})

	it('reports Dependabot ok when renovate.json exists (Renovate is an accepted alternative)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'renovate.json'), { extends: ['config:recommended'] })
		const results = await runDoctor(dir)
		const dep = results.find((r) => r.check === 'Dependabot')
		expect(dep?.status).toBe('ok')
		expect(dep?.detail).toMatch(/Renovate/)
	})

	it('reports CodeQL ok when .github/workflows/codeql.yml exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(join(dir, '.github', 'workflows', 'codeql.yml'), 'name: CodeQL\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'CodeQL')?.status).toBe('ok')
	})

	it('detects CodeQL via codeql-action reference in any workflow', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'security.yml'),
			'name: Security\nuses: github/codeql-action/init@v3\n'
		)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'CodeQL')?.status).toBe('ok')
	})

	it('reports CodeQL optional-missing when no workflows reference it', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
		const results = await runDoctor(dir)
		const codeql = results.find((r) => r.check === 'CodeQL')
		expect(codeql?.status).toBe('optional-missing')
		expect(codeql?.hint).toMatch(/fix codeql/)
	})
})

describe('doctor CODEOWNERS', () => {
	it('reports optional-missing when no CODEOWNERS exists', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const co = results.find((r) => r.check === 'CODEOWNERS')
		expect(co?.status).toBe('optional-missing')
		expect(co?.hint).toMatch(/fix codeowners/)
	})

	it('reports ok when CODEOWNERS lives at .github/CODEOWNERS', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github'))
		await fs.writeFile(join(dir, '.github', 'CODEOWNERS'), '* @owner\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'CODEOWNERS')?.status).toBe('ok')
	})

	it('reports ok when CODEOWNERS lives at repo root', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'CODEOWNERS'), '* @owner\n')
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'CODEOWNERS')?.status).toBe('ok')
	})
})

describe('doctor + lockfile', () => {
	async function writeLock(dir: string, configPatch: Record<string, unknown> = {}): Promise<void> {
		const config = {
			projectName: 'demo',
			projectType: 'library',
			typescript: { enabled: true, config: 'base' },
			linting: { tool: 'biome' },
			formatting: { tool: 'biome' },
			testing: { framework: 'vitest', environment: 'node' },
			gitHooks: true,
			commitLint: true,
			semanticRelease: true,
			securityAutomation: true,
			bundler: 'tsup',
			...configPatch,
		}
		await fs.writeJson(join(dir, '.repo-tooling.json'), {
			version: 1,
			config,
			writtenBy: '@rtorcato/repo-tooling@test',
			writtenAt: new Date().toISOString(),
		})
	}

	it('reports the lockfile check ok when present', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir)
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'lockfile')?.status).toBe('ok')
	})

	it('reports the lockfile check optional-missing when absent', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const results = await runDoctor(dir)
		const lock = results.find((r) => r.check === 'lockfile')
		expect(lock?.status).toBe('optional-missing')
		expect(lock?.hint).toMatch(/fix lockfile/)
	})

	it('reports lockfile drift when version is from a newer CLI', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, '.repo-tooling.json'), {
			version: 99,
			config: {
				projectName: 'demo',
				projectType: 'library',
				typescript: { enabled: true, config: 'base' },
				linting: { tool: 'biome' },
				formatting: { tool: 'biome' },
				testing: { framework: 'vitest' },
				gitHooks: true,
				commitLint: true,
				semanticRelease: true,
				securityAutomation: true,
				bundler: 'tsup',
			},
			writtenBy: 'future',
			writtenAt: new Date().toISOString(),
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'lockfile')?.status).toBe('drift')
	})

	it('demotes Vitest to ok when the lock records testing.framework=jest', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { testing: { framework: 'jest', environment: 'node' } })
		const results = await runDoctor(dir)
		const vitest = results.find((r) => r.check === 'Vitest')
		expect(vitest?.status).toBe('ok')
		expect(vitest?.detail).toMatch(/intentionally declined/)
	})

	it('demotes Biome to ok when the lock records linting.tool=eslint', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, {
			linting: { tool: 'eslint', eslintConfig: 'base' },
			formatting: { tool: 'prettier' },
		})
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Biome')?.status).toBe('ok')
	})

	it('demotes git hooks, lint-staged, and pre-push hook when gitHooks=false in lock', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { gitHooks: false, commitLint: false })
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Git hooks')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'lint-staged')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'Pre-push hook')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'Commitlint')?.status).toBe('ok')
	})

	it('demotes Dependabot and CodeQL when securityAutomation=false in lock', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { securityAutomation: false })
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'Dependabot')?.status).toBe('ok')
		expect(results.find((r) => r.check === 'CodeQL')?.status).toBe('ok')
	})

	it('demotes AI setup to ok when the lock records aiSetup=false', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await writeLock(dir, { aiSetup: false })
		const results = await runDoctor(dir)
		expect(results.find((r) => r.check === 'AI setup')?.status).toBe('ok')
	})

	it('only ever demotes optional-missing to ok, never makes anything worse', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		const before = await runDoctor(dir)
		const beforeStatuses = new Map(before.map((r) => [r.check, r.status]))

		await writeLock(dir)
		const after = await runDoctor(dir)
		for (const r of after) {
			if (r.check === 'lockfile') continue
			const previous = beforeStatuses.get(r.check)
			if (previous === r.status) continue
			// The only allowed transition is optional-missing → ok (lockfile-driven demotion).
			expect(previous).toBe('optional-missing')
			expect(r.status).toBe('ok')
		}
	})
})

describe('nextStepSuggestions', () => {
	it('returns empty when there is nothing to fix', () => {
		expect(nextStepSuggestions([{ check: 'Biome', status: 'ok', detail: '' }])).toEqual([])
	})

	it('emits fix commands for drift, missing, and optional-missing', () => {
		const suggestions = nextStepSuggestions([
			{ check: 'Biome', status: 'drift', detail: '' },
			{ check: 'ESLint', status: 'optional-missing', detail: '' },
			{ check: 'TypeScript', status: 'missing', detail: '' },
		])
		expect(suggestions).toContain('Run `npx @rtorcato/repo-tooling fix biome` to align Biome')
		expect(suggestions).toContain('Run `npx @rtorcato/repo-tooling fix eslint` to scaffold ESLint')
		expect(suggestions).toContain(
			'Run `npx @rtorcato/repo-tooling fix tsconfig` to scaffold TypeScript'
		)
	})

	it('appends a closing line that points at the no-target fix walk', () => {
		const suggestions = nextStepSuggestions([
			{ check: 'EditorConfig', status: 'optional-missing', detail: '' },
		])
		expect(suggestions.at(-1)).toMatch(/walk all findings/)
	})

	it('caps specific suggestions at 8 and emits an overflow line', () => {
		const checks = [
			'Biome',
			'ESLint',
			'Prettier',
			'Vitest',
			'Commitlint',
			'Git hooks',
			'knip',
			'EditorConfig',
			'Node version pin',
			'engines.node',
		]
		const suggestions = nextStepSuggestions(
			checks.map((c) => ({ check: c, status: 'optional-missing' as const, detail: '' }))
		)
		// 8 specific + 1 overflow
		expect(suggestions).toHaveLength(9)
		expect(suggestions.at(-1)).toMatch(/and \d+ more/)
	})

	it('skips checks with no registered fix target', () => {
		const suggestions = nextStepSuggestions([{ check: 'Node', status: 'drift', detail: '' }])
		expect(suggestions).toEqual([])
	})

	it('flags a release workflow that runs semantic-release with bare GITHUB_TOKEN', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  release:\n    steps:\n      - run: npx semantic-release\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n'
		)

		const results = await runDoctor(dir)
		const rt = results.find((r) => r.check === 'Release token')
		expect(rt?.status).toBe('drift')
		expect(rt?.hint).toMatch(/RELEASE_TOKEN/)
	})

	it('reports ok when the release workflow uses the RELEASE_TOKEN fallback', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  release:\n    steps:\n      - uses: actions/checkout@v7\n        with:\n          token: ${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}\n      - run: npx semantic-release\n        env:\n          GITHUB_TOKEN: ${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}\n'
		)

		const results = await runDoctor(dir)
		const rt = results.find((r) => r.check === 'Release token')
		expect(rt?.status).toBe('ok')
	})

	it('flags a release workflow still authenticating npm publish with NPM_TOKEN', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  release:\n    steps:\n      - run: npx semantic-release\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
		)

		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'npm OIDC publish')
		expect(r?.status).toBe('drift')
		expect(r?.hint).toMatch(/Trusted Publisher/)
	})

	it('reports ok when the release workflow publishes via OIDC (no NPM_TOKEN)', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  release:\n    permissions:\n      id-token: write\n    steps:\n      - run: npx semantic-release\n        env:\n          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}\n'
		)

		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'npm OIDC publish')
		expect(r?.status).toBe('ok')
	})

	it('skips the npm OIDC check for private packages', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0', private: true })
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'jobs:\n  release:\n    steps:\n      - run: npx semantic-release\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}\n'
		)

		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'npm OIDC publish')
		expect(r?.status).toBe('optional-missing')
	})
})

describe('doctor publint check', () => {
	it('flags a publishable library with no publint as not configured', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
		})
		const results = await runDoctor(dir)
		const p = results.find((r) => r.check === 'publint')
		expect(p?.status).toBe('optional-missing')
	})

	it('reports ok when publint is installed and wired into a script', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
			scripts: { publint: 'publint --strict' },
			devDependencies: { publint: '^0.3.0' },
		})
		const results = await runDoctor(dir)
		const p = results.find((r) => r.check === 'publint')
		expect(p?.status).toBe('ok')
	})

	it('flags drift when publint is installed but no script runs it', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
			devDependencies: { publint: '^0.3.0' },
		})
		const results = await runDoctor(dir)
		const p = results.find((r) => r.check === 'publint')
		expect(p?.status).toBe('drift')
	})

	it('is not applicable for a private package', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			private: true,
			exports: { '.': './dist/index.js' },
		})
		const results = await runDoctor(dir)
		const p = results.find((r) => r.check === 'publint')
		expect(p?.status).toBe('ok')
		expect(p?.detail).toMatch(/not applicable/)
	})
})

describe('doctor README badges check', () => {
	it('flags a public library with no badges as not configured', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
		})
		await fs.writeFile(join(dir, 'README.md'), '# demo\n\nNo badges here.\n')
		const results = await runDoctor(dir)
		const b = results.find((r) => r.check === 'README badges')
		expect(b?.status).toBe('optional-missing')
	})

	it('reports ok when the README already carries badges', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			exports: { '.': './dist/index.js' },
		})
		await fs.writeFile(
			join(dir, 'README.md'),
			'# demo\n\n![npm](https://img.shields.io/npm/v/demo)\n'
		)
		const results = await runDoctor(dir)
		const b = results.find((r) => r.check === 'README badges')
		expect(b?.status).toBe('ok')
	})

	it('flags drift when a private package carries npm/coverage badges', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			private: true,
		})
		await fs.writeFile(
			join(dir, 'README.md'),
			'# demo\n\n![npm](https://img.shields.io/npm/v/demo)\n'
		)
		const results = await runDoctor(dir)
		const b = results.find((r) => r.check === 'README badges')
		expect(b?.status).toBe('drift')
	})

	it('flags a Codecov badge with no CI coverage upload', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(
			join(dir, 'README.md'),
			'# demo\n\n![Coverage](https://codecov.io/gh/o/r/branch/main/graph/badge.svg)\n'
		)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(join(dir, '.github', 'workflows', 'ci.yml'), 'name: CI\n')
		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'Coverage upload')
		expect(r?.status).toBe('drift')
	})

	it('passes coverage upload when ci.yml uses codecov-action', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(
			join(dir, 'README.md'),
			'# demo\n\n![Coverage](https://codecov.io/gh/o/r/branch/main/graph/badge.svg)\n'
		)
		await fs.ensureDir(join(dir, '.github', 'workflows'))
		await fs.writeFile(
			join(dir, '.github', 'workflows', 'ci.yml'),
			'name: CI\njobs:\n  test:\n    steps:\n      - uses: codecov/codecov-action@v7\n'
		)
		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'Coverage upload')
		expect(r?.status).toBe('ok')
	})

	it('coverage upload not applicable without a Codecov badge', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeFile(join(dir, 'README.md'), '# demo\n')
		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'Coverage upload')
		expect(r?.status).toBe('ok')
	})

	it('nudges when a tool config lacks its recommended VS Code extension', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'biome.json'), { $schema: 'x' })
		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'VS Code extensions')
		expect(r?.status).toBe('optional-missing')
		expect(r?.detail).toMatch(/biomejs\.biome/)
	})

	it('passes when .vscode/extensions.json recommends the matching extension', async () => {
		const dir = newTmpDir()
		await seedPackageJson(dir)
		await fs.writeJson(join(dir, 'biome.json'), { $schema: 'x' })
		await fs.ensureDir(join(dir, '.vscode'))
		await fs.writeJson(join(dir, '.vscode', 'extensions.json'), {
			recommendations: ['biomejs.biome'],
		})
		const results = await runDoctor(dir)
		const r = results.find((c) => c.check === 'VS Code extensions')
		expect(r?.status).toBe('ok')
	})

	// Per-module dispatch (#285): a non-JS repo runs the language-agnostic base
	// checks instead of the old single "skipped" note, and none of the JS suite.
	it('runs base checks (not the JS suite) for a non-JS language', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), '// swift-tools-version:5.9\n')
		await fs.writeFile(join(dir, '.editorconfig'), 'root = true\n')

		const results = await runDoctor(dir)
		const checks = new Set(results.map((r) => r.check))

		// friendly language note, not a wholesale skip
		expect(results.length).toBeGreaterThan(1)
		const lang = results.find((r) => r.check === 'language')
		expect(lang?.status).toBe('ok')
		expect(lang?.detail).toContain('Swift')

		// base checks run
		expect(results.find((r) => r.check === 'EditorConfig')?.status).toBe('ok')
		expect(checks.has('GitLab CI')).toBe(true)
		expect(checks.has('CODEOWNERS')).toBe(true)

		// JS-specific checks are absent
		expect(checks.has('package.json')).toBe(false)
		expect(checks.has('TypeScript')).toBe(false)
		expect(checks.has('Node')).toBe(false)
	})
})

// #364: pnpm 11 turned undecided build scripts into a hard error, so
// `pnpm install --frozen-lockfile` exits non-zero with ERR_PNPM_IGNORED_BUILDS.
// Locally the same message reads as advisory, which is why it goes unnoticed
// until the pipeline is red.
describe('checkBuildApprovals', () => {
	async function seedDep(dir: string, name: string, scripts: Record<string, string>) {
		await fs.outputJson(join(dir, 'node_modules', name, 'package.json'), { name, scripts })
	}

	it('flags a dependency with an install script and no recorded decision', async () => {
		const dir = newTmpDir()
		const pkg = { name: 'demo', devDependencies: { 'better-sqlite3': '^12.0.0' } }
		await seedDep(dir, 'better-sqlite3', { install: 'prebuild-install || node-gyp rebuild' })

		const result = await checkBuildApprovals(dir, pkg)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('better-sqlite3')
		expect(result.hint).toContain('allowBuilds')
	})

	it('accepts a decision either way — declining a build is still deciding', async () => {
		const dir = newTmpDir()
		const pkg = { name: 'demo', devDependencies: { esbuild: '^0.25.0', '@prisma/client': '^5.0.0' } }
		await seedDep(dir, 'esbuild', { postinstall: 'node install.js' })
		await seedDep(dir, '@prisma/client', { postinstall: 'prisma generate' })
		await fs.writeFile(
			join(dir, 'pnpm-workspace.yaml'),
			'allowBuilds:\n  esbuild: true\n  "@prisma/client": false\n'
		)

		expect((await checkBuildApprovals(dir, pkg)).status).toBe('ok')
	})

	it('says nothing about dependencies that ship no build script', async () => {
		const dir = newTmpDir()
		const pkg = { name: 'demo', devDependencies: { chalk: '^5.0.0' } }
		await seedDep(dir, 'chalk', { test: 'vitest' })

		expect((await checkBuildApprovals(dir, pkg)).status).toBe('ok')
	})

	it('stays quiet when nothing is installed to inspect', async () => {
		const result = await checkBuildApprovals(newTmpDir(), { name: 'demo', devDependencies: { x: '1' } })
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('no installed dependencies')
	})

	// #373: pnpm names transitive packages in ERR_PNPM_IGNORED_BUILDS too, so a
	// direct-only scan reports clean while CI goes red.
	describe('transitive dependencies', () => {
		async function seedStoreDep(
			dir: string,
			storeEntry: string,
			name: string,
			scripts: Record<string, string>
		) {
			await fs.outputJson(
				join(dir, 'node_modules', '.pnpm', storeEntry, 'node_modules', name, 'package.json'),
				{ name, scripts }
			)
		}

		it('flags a transitive package with an install script and no decision', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { vite: '^7.0.0' } }
			await seedDep(dir, 'vite', { test: 'vitest' })
			await seedStoreDep(dir, 'esbuild@0.25.0', 'esbuild', { postinstall: 'node install.js' })

			const result = await checkBuildApprovals(dir, pkg)
			expect(result.status).toBe('optional-missing')
			expect(result.detail).toContain('esbuild')
			expect(result.detail).toContain('transitive')
		})

		it('decodes a scoped store directory back to its package name', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { vite: '^7.0.0' } }
			await seedDep(dir, 'vite', { test: 'vitest' })
			await seedStoreDep(dir, '@prisma+client@5.22.0', '@prisma/client', {
				postinstall: 'prisma generate',
			})

			expect((await checkBuildApprovals(dir, pkg)).detail).toContain('@prisma/client')
		})

		it('says nothing about a transitive package already under allowBuilds', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { vite: '^7.0.0' } }
			await seedDep(dir, 'vite', { test: 'vitest' })
			await seedStoreDep(dir, 'esbuild@0.25.0', 'esbuild', { postinstall: 'node install.js' })
			await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), 'allowBuilds:\n  esbuild: true\n')

			expect((await checkBuildApprovals(dir, pkg)).status).toBe('ok')
		})

		it('reports a package present at two versions once', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { vite: '^7.0.0' } }
			await seedDep(dir, 'vite', { test: 'vitest' })
			await seedStoreDep(dir, 'esbuild@0.24.0', 'esbuild', { postinstall: 'node install.js' })
			await seedStoreDep(dir, 'esbuild@0.25.0', 'esbuild', { postinstall: 'node install.js' })

			const detail = (await checkBuildApprovals(dir, pkg)).detail ?? ''
			expect(detail.match(/esbuild/g)).toHaveLength(1)
			expect(detail).toContain('1 transitive dependency')
		})

		it('grades a direct offender as drift even when transitive ones exist', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { 'better-sqlite3': '^12.0.0' } }
			await seedDep(dir, 'better-sqlite3', { install: 'node-gyp rebuild' })
			await seedStoreDep(dir, 'esbuild@0.25.0', 'esbuild', { postinstall: 'node install.js' })

			const result = await checkBuildApprovals(dir, pkg)
			expect(result.status).toBe('drift')
			expect(result.detail).toContain('better-sqlite3')
			expect(result.detail).toContain('esbuild')
		})

		// Only the first `+` is decoded, so a hostile entry name can leave `..`
		// segments in the decoded package name and point the read outside the
		// package directory.
		it('refuses a store entry whose decoded name escapes its package directory', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { vite: '^7.0.0' } }
			await seedDep(dir, 'vite', { test: 'vitest' })
			// `..+..@1.0.0` decodes to `../..`, so the unguarded read climbs out of
			// the entry's `node_modules` and resolves to this file in the store root.
			await fs.ensureDir(join(dir, 'node_modules', '.pnpm', '..+..@1.0.0'))
			await fs.outputJson(join(dir, 'node_modules', '.pnpm', 'package.json'), {
				name: 'pwned',
				scripts: { postinstall: 'node steal.js' },
			})

			const result = await checkBuildApprovals(dir, pkg)
			expect(result.status).toBe('ok')
			expect(result.detail ?? '').not.toContain('pwned')
		})

		it('does not double-report a direct dependency that also sits in the store', async () => {
			const dir = newTmpDir()
			const pkg = { name: 'demo', devDependencies: { esbuild: '^0.25.0' } }
			await seedDep(dir, 'esbuild', { postinstall: 'node install.js' })
			await seedStoreDep(dir, 'esbuild@0.25.0', 'esbuild', { postinstall: 'node install.js' })

			const detail = (await checkBuildApprovals(dir, pkg)).detail ?? ''
			expect(detail.match(/esbuild/g)).toHaveLength(1)
			expect(detail).not.toContain('transitive')
		})
	})
})

describe('pnpmStoreDirToName', () => {
	it('decodes plain, scoped, and peer-suffixed store directories', () => {
		expect(pnpmStoreDirToName('esbuild@0.25.0')).toBe('esbuild')
		expect(pnpmStoreDirToName('@prisma+client@5.22.0')).toBe('@prisma/client')
		// The peer suffix carries its own `@` — the first one still wins.
		expect(pnpmStoreDirToName('@babel+core@7.0.0_supports-color@8.0.0')).toBe('@babel/core')
		expect(pnpmStoreDirToName('node_modules')).toBeNull()
	})
})
