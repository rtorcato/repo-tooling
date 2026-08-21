import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	generateTreeshakeCheck,
	inferSubpathsFromExports,
} from '../../../src/cli/generators/treeshake.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

describe('inferSubpathsFromExports', () => {
	it('returns empty when pkg has no exports', () => {
		expect(inferSubpathsFromExports({})).toEqual({
			allCandidates: [],
			defaultAllowed: null,
		})
	})

	it('returns empty when pkg is null', () => {
		expect(inferSubpathsFromExports(null)).toEqual({
			allCandidates: [],
			defaultAllowed: null,
		})
	})

	it('extracts subpaths and ignores the root + wildcard entries', () => {
		const result = inferSubpathsFromExports({
			exports: {
				'.': './dist/index.js',
				'./clipboard': './dist/clipboard/index.js',
				'./geolocation': './dist/geolocation/index.js',
				'./*': './dist/*.js',
			},
		})
		expect(result.allCandidates).toEqual(['clipboard', 'geolocation'])
		expect(result.defaultAllowed).toBe('clipboard')
	})
})

describe('generateTreeshakeCheck', () => {
	it('writes package.json, check.mjs, and src/entry.ts under apps/treeshake-check', async () => {
		const dir = newTmpDir()
		const written = await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: ['geolocation', 'storage'],
		})

		expect(written).toEqual([
			'apps/treeshake-check/package.json',
			'apps/treeshake-check/check.mjs',
			'apps/treeshake-check/src/entry.ts',
			'pnpm-workspace.yaml',
		])
		expect(await fs.pathExists(join(dir, 'apps', 'treeshake-check', 'package.json'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'apps', 'treeshake-check', 'check.mjs'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'apps', 'treeshake-check', 'src', 'entry.ts'))).toBe(true)
	})

	it('writes a pnpm-workspace.yaml globbing apps/* so workspace:* resolves', async () => {
		const dir = newTmpDir()
		await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: [],
		})
		const ws = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(ws).toContain("- 'apps/*'")
		// Build approvals use the allowBuilds map (pnpm 11 ignores the older
		// onlyBuiltDependencies list → ERR_PNPM_IGNORED_BUILDS).
		expect(ws).toContain('allowBuilds')
		expect(ws).toContain('esbuild: true')
		// docs-path (apps/docs) build approvals are seeded ahead of need
		expect(ws).toContain('sharp: true')
		expect(ws).toContain('core-js: false')
	})

	it('does not clobber an existing pnpm-workspace.yaml', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
		const written = await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: [],
		})
		expect(written).not.toContain('pnpm-workspace.yaml')
		const ws = await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
		expect(ws).toContain("- 'packages/*'")
	})

	it('bakes the workspace name + allowed subpath into entry.ts', async () => {
		const dir = newTmpDir()
		await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: ['geolocation'],
		})
		const entry = await fs.readFile(
			join(dir, 'apps', 'treeshake-check', 'src', 'entry.ts'),
			'utf-8'
		)
		expect(entry).toContain("export * from '@my-org/my-lib/clipboard'")
	})

	it('emits ALLOWED_MODULES + FORBIDDEN_MODULES in check.mjs', async () => {
		const dir = newTmpDir()
		await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: ['geolocation', 'storage'],
		})
		const check = await fs.readFile(join(dir, 'apps', 'treeshake-check', 'check.mjs'), 'utf-8')
		expect(check).toContain('ALLOWED_MODULES = ["clipboard"]')
		expect(check).toContain('FORBIDDEN_MODULES')
		expect(check).toContain('geolocation')
		expect(check).toContain('storage')
		expect(check).toContain("import { build } from 'esbuild'")
	})

	it('uses workspace:* for the dependency on the target library', async () => {
		const dir = newTmpDir()
		await generateTreeshakeCheck(dir, {
			workspaceName: '@my-org/my-lib',
			allowedSubpath: 'clipboard',
			forbiddenSubpaths: [],
		})
		const pkg = await fs.readJson(join(dir, 'apps', 'treeshake-check', 'package.json'))
		expect(pkg.dependencies['@my-org/my-lib']).toBe('workspace:*')
		expect(pkg.devDependencies.esbuild).toBeDefined()
		expect(pkg.private).toBe(true)
	})
})
