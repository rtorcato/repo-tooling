import { createRequire } from 'node:module'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	ensureEnginesNode,
	ensurePackageManager,
	generateEditorConfig,
	generateKnipConfig,
	generateMiscBaseline,
	generateNvmrc,
	generateSizeLimitConfig,
	generateVscodeExtensions,
	recommendedExtensions,
} from '../../../src/cli/generators/misc.js'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const require = createRequire(import.meta.url)
const newTmpDir = useTmpDir()

function cfg(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
	return {
		projectName: 'demo',
		projectType: 'library',
		typescript: { enabled: true, config: 'base' },
		linting: { tool: 'biome' },
		formatting: { tool: 'biome' },
		testing: { framework: 'vitest' },
		gitHooks: false,
		commitLint: false,
		semanticRelease: false,
		bundler: 'none',
		...overrides,
	}
}

describe('generateEditorConfig', () => {
	it('writes .editorconfig with utf-8 and lf', async () => {
		const dir = newTmpDir()
		await generateEditorConfig(dir)
		const content = await fs.readFile(join(dir, '.editorconfig'), 'utf-8')
		expect(content).toMatch(/charset = utf-8/)
		expect(content).toMatch(/end_of_line = lf/)
		expect(content).toMatch(/root = true/)
	})
})

describe('generateNvmrc', () => {
	it('writes .nvmrc pinned to 22', async () => {
		const dir = newTmpDir()
		await generateNvmrc(dir)
		const content = await fs.readFile(join(dir, '.nvmrc'), 'utf-8')
		expect(content.trim()).toBe('22')
	})
})

describe('generateSizeLimitConfig', () => {
	it('emits an exports-driven .size-limit.cjs for multi-subpath libraries', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			exports: {
				'.': { import: './dist/index.js' },
				'./hooks': { import: './dist/hooks/index.js' },
				'./providers': { import: { types: './x.d.ts', default: './dist/providers/index.js' } },
				'./package.json': './package.json',
			},
		})

		const written = await generateSizeLimitConfig(dir)
		expect(written).toBe('.size-limit.cjs')

		// The generated config computes one budget per subpath from package.json
		// at run time — the root '.' barrel and ./package.json are skipped.
		const config = require(join(dir, '.size-limit.cjs')) as Array<{
			name: string
			path: string
			limit: string
		}>
		expect(config).toHaveLength(2)
		expect(config).toContainEqual({ name: 'demo/hooks', path: 'dist/hooks/index.js', limit: '10 kB' })
		expect(config).toContainEqual({
			name: 'demo/providers',
			path: 'dist/providers/index.js',
			limit: '10 kB',
		})
	})

	it('falls back to a static .size-limit.json for a single-export package', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			exports: { '.': { import: './dist/index.js' } },
		})

		const written = await generateSizeLimitConfig(dir)
		expect(written).toBe('.size-limit.json')
		const config = await fs.readJson(join(dir, '.size-limit.json'))
		expect(config[0].path).toBe('dist/index.js')
	})

	it('falls back to the static form when there is no package.json', async () => {
		const dir = newTmpDir()
		const written = await generateSizeLimitConfig(dir)
		expect(written).toBe('.size-limit.json')
		expect(await fs.pathExists(join(dir, '.size-limit.json'))).toBe(true)
	})
})

describe('recommendedExtensions', () => {
	it('always recommends EditorConfig and derives the rest from enabled tools', () => {
		const ids = recommendedExtensions(
			cfg({
				linting: { tool: 'eslint' },
				formatting: { tool: 'prettier' },
				testing: { framework: 'vitest' },
				oxlint: true,
			})
		)
		expect(ids).toContain('EditorConfig.EditorConfig')
		expect(ids).toContain('dbaeumer.vscode-eslint')
		expect(ids).toContain('esbenp.prettier-vscode')
		expect(ids).toContain('vitest.explorer')
		expect(ids).toContain('oxc.oxc-vscode')
		expect(ids).not.toContain('biomejs.biome')
	})

	it('recommends Biome when it is the linter or formatter', () => {
		expect(recommendedExtensions(cfg({ linting: { tool: 'biome' } }))).toContain('biomejs.biome')
	})
})

describe('generateVscodeExtensions', () => {
	it('writes .vscode/extensions.json with the matching recommendations', async () => {
		const dir = newTmpDir()
		const written = await generateVscodeExtensions(cfg(), dir)
		expect(written).toBe('.vscode/extensions.json')
		const json = await fs.readJson(join(dir, '.vscode', 'extensions.json'))
		expect(json.recommendations).toContain('biomejs.biome')
		expect(json.recommendations).toContain('vitest.explorer')
		expect(json.recommendations).toContain('EditorConfig.EditorConfig')
	})

	it('preserves existing recommendations and dedupes', async () => {
		const dir = newTmpDir()
		await fs.ensureDir(join(dir, '.vscode'))
		await fs.writeJson(join(dir, '.vscode', 'extensions.json'), {
			recommendations: ['some.user-extension', 'biomejs.biome'],
		})
		await generateVscodeExtensions(cfg(), dir)
		const json = await fs.readJson(join(dir, '.vscode', 'extensions.json'))
		expect(json.recommendations).toContain('some.user-extension')
		expect(json.recommendations.filter((r: string) => r === 'biomejs.biome')).toHaveLength(1)
	})

	it('does not clobber an unparseable (commented) extensions.json', async () => {
		const dir = newTmpDir()
		await fs.ensureDir(join(dir, '.vscode'))
		const original = '{\n  // keep my comments\n  "recommendations": ["a.b"]\n}\n'
		await fs.writeFile(join(dir, '.vscode', 'extensions.json'), original)
		const written = await generateVscodeExtensions(cfg(), dir)
		expect(written).toBeNull()
		expect(await fs.readFile(join(dir, '.vscode', 'extensions.json'), 'utf-8')).toBe(original)
	})
})

describe('ensureEnginesNode', () => {
	it('returns no-package-json when package.json is absent', async () => {
		const dir = newTmpDir()
		const result = await ensureEnginesNode(dir)
		expect(result).toBe('no-package-json')
	})

	it('adds engines.node when missing', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		const result = await ensureEnginesNode(dir)
		expect(result).toBe('added')
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines).toEqual({ node: '>=22' })
	})

	it('does not overwrite an existing engines.node value', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { node: '>=24' },
		})
		const result = await ensureEnginesNode(dir)
		expect(result).toBe('already-set')
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines.node).toBe('>=24')
	})

	it('preserves other engines fields when adding node', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			version: '0.0.0',
			engines: { pnpm: '>=8' },
		})
		await ensureEnginesNode(dir)
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines).toEqual({ pnpm: '>=8', node: '>=22' })
	})
})

describe('generateKnipConfig', () => {
	it('writes a narrow src/index entry when no package.json exists', async () => {
		const dir = newTmpDir()
		await generateKnipConfig(dir)
		const knip = await fs.readJson(join(dir, 'knip.json'))
		expect(knip.entry).toEqual(['src/index.{ts,tsx}'])
		expect(knip.project).toEqual(['src/**/*.{ts,tsx}'])
		expect(knip.$schema).toBe('https://unpkg.com/knip@6/schema.json')
	})

	it('keeps the narrow entry for a single-barrel library', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			exports: { '.': './dist/index.js' },
		})
		await generateKnipConfig(dir)
		const knip = await fs.readJson(join(dir, 'knip.json'))
		expect(knip.entry).toEqual(['src/index.{ts,tsx}'])
	})

	it('uses an all-of-src entry for per-file-entry libraries (>1 subpath export)', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			exports: {
				'.': './dist/index.js',
				'./hooks': './dist/hooks/index.js',
				'./providers': './dist/providers/index.js',
			},
		})
		await generateKnipConfig(dir)
		const knip = await fs.readJson(join(dir, 'knip.json'))
		expect(knip.entry).toEqual(['src/**/*.{ts,tsx}'])
		expect(knip.project).toEqual(['src/**/*.{ts,tsx}'])
	})

	it('emits the workspaces form when a pnpm-workspace.yaml is present', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), {
			name: 'demo',
			exports: { '.': './dist/index.js' },
		})
		await fs.writeFile(
			join(dir, 'pnpm-workspace.yaml'),
			"packages:\n  - 'apps/*'\n  - 'packages/*'\n\nonlyBuiltDependencies:\n  - esbuild\n"
		)
		await generateKnipConfig(dir)
		const knip = await fs.readJson(join(dir, 'knip.json'))
		// flat entry/project are dropped in favour of per-workspace config
		expect(knip.entry).toBeUndefined()
		expect(knip.project).toBeUndefined()
		expect(knip.workspaces['.']).toEqual({
			entry: ['src/index.{ts,tsx}'],
			project: ['src/**/*.{ts,tsx}'],
		})
		// package globs from `packages:` become workspace keys, not the
		// unrelated onlyBuiltDependencies list below it
		expect(knip.workspaces['apps/*']).toEqual({})
		expect(knip.workspaces['packages/*']).toEqual({})
		expect(knip.workspaces.esbuild).toBeUndefined()
	})
})

describe('generateMiscBaseline', () => {
	it('writes all four baseline files', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })
		await generateMiscBaseline(dir)
		expect(await fs.pathExists(join(dir, '.editorconfig'))).toBe(true)
		expect(await fs.pathExists(join(dir, '.nvmrc'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'knip.json'))).toBe(true)
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.engines?.node).toBe('>=22')
	})
})

// #364: `pnpm/action-setup` is emitted with no `version:` input, so without
// `packageManager` every generated job died at setup with "No pnpm version is
// specified" before a single check ran.
describe('ensurePackageManager', () => {
	it('pins packageManager when absent', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', version: '0.0.0' })

		expect(await ensurePackageManager(dir, '11.20.0')).toBe('added')
		expect((await fs.readJson(join(dir, 'package.json'))).packageManager).toBe('pnpm@11.20.0')
	})

	it('leaves an existing pin alone', async () => {
		const dir = newTmpDir()
		await fs.writeJson(join(dir, 'package.json'), { name: 'demo', packageManager: 'yarn@4.9.1' })

		expect(await ensurePackageManager(dir, '11.20.0')).toBe('already-set')
		expect((await fs.readJson(join(dir, 'package.json'))).packageManager).toBe('yarn@4.9.1')
	})

	it('reports no-package-json rather than creating one', async () => {
		expect(await ensurePackageManager(newTmpDir(), '11.20.0')).toBe('no-package-json')
	})
})
