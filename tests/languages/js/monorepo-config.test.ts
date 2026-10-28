import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	checkChangesets,
	checkFileFromRoot,
	checkLintStaged,
	checkSemanticRelease,
	FILE_CHECKS,
	readPackageJson,
} from '../../../src/languages/js/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

// A monorepo: the git/workspace root holds the config, the package dir is nested in it (#861).
async function monorepo(): Promise<{ root: string; pkg: string }> {
	const root = newTmpDir()
	const pkg = join(root, 'packages', 'app')
	await fs.ensureDir(pkg)
	await fs.writeJson(join(pkg, 'package.json'), { name: 'app' })
	return { root, pkg }
}

describe('monorepo config lookup (#861)', () => {
	it('reads lint-staged from the workspace root package.json when the package has none', async () => {
		const { root, pkg } = await monorepo()
		await fs.writeJson(join(root, 'package.json'), { 'lint-staged': { '*.ts': 'biome' } })
		const result = await checkLintStaged(pkg, await readPackageJson(pkg), root)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('workspace root')
	})

	it('prefers a package-dir lint-staged config over the root one', async () => {
		const { root, pkg } = await monorepo()
		await fs.writeJson(join(root, 'package.json'), { 'lint-staged': {} })
		await fs.writeFile(join(pkg, '.lintstagedrc.json'), '{}')
		const result = await checkLintStaged(pkg, await readPackageJson(pkg), root)
		expect(result.status).toBe('ok')
		expect(result.detail).not.toContain('workspace root')
	})

	it('stays not configured when neither the package nor the root has lint-staged', async () => {
		const { root, pkg } = await monorepo()
		const result = await checkLintStaged(pkg, await readPackageJson(pkg), root)
		expect(result.status).toBe('optional-missing')
		expect(result.detail).toBe('lint-staged not configured')
	})

	it('reads a root Changesets config and says so', async () => {
		const { root, pkg } = await monorepo()
		await fs.outputJson(join(root, '.changeset', 'config.json'), { baseBranch: 'main' })
		const spec = FILE_CHECKS.find((c) => c.check === 'Changesets')
		if (!spec) throw new Error('Changesets spec missing')
		const result = await checkFileFromRoot(pkg, root, spec)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('workspace root')
	})

	// #952: a config with no CLI fails the release workflow's `pnpm changeset version`.
	it.each([
		['the package', 'pkg', 'ok'],
		['the workspace root', 'root', 'ok'],
		['neither', null, 'drift'],
	] as const)('checks @changesets/cli in %s', async (_label, where, status) => {
		const { root, pkg } = await monorepo()
		await fs.outputJson(join(root, '.changeset', 'config.json'), { baseBranch: 'main' })
		const withCli = { devDependencies: { '@changesets/cli': '^3.0.3' } }
		if (where === 'pkg') await fs.writeJson(join(pkg, 'package.json'), { name: 'app', ...withCli })
		await fs.writeJson(join(root, 'package.json'), where === 'root' ? withCli : {})
		const spec = FILE_CHECKS.find((c) => c.check === 'Changesets')
		if (!spec) throw new Error('Changesets spec missing')
		const result = await checkChangesets(pkg, root, await readPackageJson(pkg), spec)
		expect(result.status).toBe(status)
		if (status === 'drift') expect(result.hint).toContain('@changesets/cli')
	})

	it('accepts a root semantic-release preset when the package has no release config', async () => {
		const { root, pkg } = await monorepo()
		await fs.writeJson(join(root, 'package.json'), {
			release: { extends: '@rtorcato/repo-tooling/semantic-release' },
		})
		const result = await checkSemanticRelease(pkg, await readPackageJson(pkg), root)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('workspace root')
	})

	it('counts a root Changesets config as a second release tool', async () => {
		const { root, pkg } = await monorepo()
		await fs.outputJson(join(root, '.changeset', 'config.json'), { baseBranch: 'main' })
		await fs.writeFile(
			join(pkg, '.releaserc.json'),
			'{"extends":"@rtorcato/repo-tooling/semantic-release"}'
		)
		const result = await checkSemanticRelease(pkg, await readPackageJson(pkg), root)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('multiple release tools')
	})
})
