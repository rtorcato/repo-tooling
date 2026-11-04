import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FixerAbort } from '../../../src/base/fixers.js'
import { jobEnvironment, workflowJobs } from '../../../src/base/github-settings.js'
import { lockfilePatchForTarget } from '../../../src/cli/commands/fix-targets.js'
import type { Lockfile } from '../../../src/cli/utils/lockfile.js'
import { checkReleaseTool } from '../../../src/languages/js/checks.js'
import { migrateToChangesets } from '../../../src/languages/js/changesets-migrate.js'
import type { NpmExec } from '../../../src/languages/js/npm-trust.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const RELEASE = `name: Release
on:
  workflow_dispatch:
  milestone:
    types: [closed]
jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - run: npx semantic-release
`

const PKG = {
	name: '@x/lib',
	version: '0.0.0-development',
	main: 'index.js',
	scripts: { release: 'semantic-release', test: 'vitest' },
	devDependencies: {
		'semantic-release': '^25.0.0',
		'@semantic-release/github': '^12.0.0',
		vitest: '^4.0.0',
	},
}

async function fixture(pkg: Record<string, unknown> = PKG) {
	const dir = newTmpDir()
	await fs.outputJson(join(dir, 'package.json'), pkg)
	await fs.outputFile(join(dir, 'release.config.mjs'), 'export default {}\n')
	await fs.outputFile(join(dir, '.github/workflows/release.yml'), RELEASE)
	await fs.outputFile(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'apps/*'\n")
	return dir
}

const npm = (stdout: string, stderr = '', ok = true): NpmExec =>
	vi.fn(async () => ({ ok, stdout, stderr, code: ok ? 0 : 1 }))

afterEach(() => vi.restoreAllMocks())

describe('checkReleaseTool (#967)', () => {
	it('flags a public package on semantic-release, without failing doctor', async () => {
		const dir = await fixture()
		const r = await checkReleaseTool(dir, PKG)
		expect(r).toMatchObject({ check: 'Release tool', status: 'optional-missing' })
		expect(r?.hint).toContain('fix changesets-migrate')
	})

	it('flags a package.json `release` field too', async () => {
		const dir = newTmpDir()
		expect(
			await checkReleaseTool(dir, { name: 'x', release: { branches: ['main'] } })
		).not.toBeNull()
	})

	it('says nothing for a private package, a Changesets repo, or no release tool', async () => {
		const dir = await fixture()
		expect(await checkReleaseTool(dir, { ...PKG, private: true })).toBeNull()
		await fs.outputJson(join(dir, '.changeset/config.json'), {})
		expect(await checkReleaseTool(dir, PKG)).toBeNull()
		expect(await checkReleaseTool(newTmpDir(), { name: 'x' })).toBeNull()
	})
})

describe('migrateToChangesets (#967)', () => {
	it('swaps the release tool and sets the version to the one on npm', async () => {
		const dir = await fixture()
		const written = await migrateToChangesets(dir, PKG, npm('6.1.0\n'))
		expect(written).toEqual(
			expect.arrayContaining([
				'release.config.mjs',
				'package.json',
				'.changeset/config.json',
				'pnpm-workspace.yaml',
				'.github/workflows/release.yml',
			])
		)
		const pkg = await fs.readJson(join(dir, 'package.json'))
		expect(pkg.version).toBe('6.1.0')
		expect(pkg.scripts).toEqual({ test: 'vitest', changeset: 'changeset' })
		expect(pkg.devDependencies).toEqual({ vitest: '^4.0.0', '@changesets/cli': '^3.0.3' })
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.changeset/config.json'))).toBe(true)
		expect(await fs.readFile(join(dir, 'pnpm-workspace.yaml'), 'utf-8')).toBe(
			"packages:\n  - '.'\n  - 'apps/*'\n"
		)
	})

	it('keeps release.yml and its environment, and drops the milestone trigger', async () => {
		const dir = await fixture()
		await migrateToChangesets(dir, PKG, npm('1.0.0'))
		const yml = await fs.readFile(join(dir, '.github/workflows/release.yml'), 'utf-8')
		expect(yml).not.toContain('milestone')
		expect(yml).not.toContain('semantic-release')
		expect([...workflowJobs(yml).keys()]).toEqual(['version', 'publish'])
		expect(jobEnvironment(workflowJobs(yml).get('publish') ?? '')).toBe('release')
	})

	it('keeps a custom environment name', async () => {
		const dir = await fixture()
		await fs.writeFile(
			join(dir, '.github/workflows/release.yml'),
			RELEASE.replace('environment: release', 'environment: publish-prod')
		)
		await migrateToChangesets(dir, PKG, npm('1.0.0'))
		const yml = await fs.readFile(join(dir, '.github/workflows/release.yml'), 'utf-8')
		expect(jobEnvironment(workflowJobs(yml).get('publish') ?? '')).toBe('publish-prod')
	})

	it('leaves the version alone for a package that is not on npm yet', async () => {
		const dir = await fixture()
		await migrateToChangesets(dir, PKG, npm('', 'npm error code E404', false))
		expect((await fs.readJson(join(dir, 'package.json'))).version).toBe('0.0.0-development')
	})

	it('writes nothing when npm cannot be read', async () => {
		const dir = await fixture()
		const err = await migrateToChangesets(dir, PKG, npm('', 'getaddrinfo ENOTFOUND', false)).catch(
			(e) => e
		)
		expect(err).toBeInstanceOf(FixerAbort)
		expect(err.code).toBe('npm-view-failed')
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(true)
		expect((await fs.readJson(join(dir, 'package.json'))).scripts.release).toBe('semantic-release')
	})

	it('guards the npm view call and checks the name and version', async () => {
		const dir = await fixture()
		const exec = npm('6.1.0')
		await migrateToChangesets(dir, PKG, exec)
		expect(exec).toHaveBeenCalledWith(['view', '--', '@x/lib', 'version'])

		for (const [name, out] of [
			['--registry=http://evil', '1.0.0'],
			['@x/lib', 'not-a-version'],
		] as const) {
			const bad = await fixture({ ...PKG, name })
			const err = await migrateToChangesets(bad, { ...PKG, name }, npm(out)).catch((e) => e)
			expect(err).toBeInstanceOf(FixerAbort)
			expect(await fs.pathExists(join(bad, 'release.config.mjs'))).toBe(true)
		}
	})

	it('drops `npx semantic-release` style release scripts too', async () => {
		for (const release of ['npx semantic-release', 'pnpm exec semantic-release --dry-run']) {
			const pkg = { ...PKG, scripts: { release, test: 'vitest' } }
			const dir = await fixture(pkg)
			await migrateToChangesets(dir, pkg, npm('1.0.0'))
			expect((await fs.readJson(join(dir, 'package.json'))).scripts.release).toBeUndefined()
		}
		const keep = { ...PKG, scripts: { release: 'node scripts/release.js' } }
		const dir = await fixture(keep)
		await migrateToChangesets(dir, keep, npm('1.0.0'))
		expect((await fs.readJson(join(dir, 'package.json'))).scripts.release).toBe(
			'node scripts/release.js'
		)
	})

	it('keeps a tab-indented package.json', async () => {
		const dir = await fixture()
		await fs.writeFile(join(dir, 'package.json'), JSON.stringify(PKG, null, '\t'))
		await migrateToChangesets(dir, PKG, npm('1.0.0'))
		expect(await fs.readFile(join(dir, 'package.json'), 'utf-8')).toMatch(/^\{\n\t"name"/)
	})

	it('suggests `fix release-environment` when the old workflow had no environment', async () => {
		const dir = await fixture()
		await fs.writeFile(
			join(dir, '.github/workflows/release.yml'),
			RELEASE.replace('    environment: release\n', '')
		)
		const err = vi.spyOn(console, 'error').mockImplementation(() => {})
		await migrateToChangesets(dir, PKG, npm('1.0.0'))
		expect(err.mock.calls.flat().join('\n')).toContain('fix release-environment')
	})

	it('refuses while ci.yml still runs semantic-release', async () => {
		const dir = await fixture()
		await fs.outputFile(
			join(dir, '.github/workflows/ci.yml'),
			'jobs:\n  release:\n    steps:\n      - run: npx semantic-release\n'
		)
		const err = await migrateToChangesets(dir, PKG, npm('1.0.0')).catch((e) => e)
		expect(err).toBeInstanceOf(FixerAbort)
		expect(err.code).toBe('release-job-in-ci')
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(true)
	})

	it('changes nothing for a repo that is not on semantic-release', async () => {
		const dir = newTmpDir()
		const pkg = { name: '@x/lib', version: '1.0.0', scripts: { test: 'vitest' } }
		await fs.outputJson(join(dir, 'package.json'), pkg)
		const exec = npm('9.9.9')
		expect(await migrateToChangesets(dir, pkg, exec)).toEqual([])
		expect(exec).not.toHaveBeenCalled()
		expect(await fs.readJson(join(dir, 'package.json'))).toEqual(pkg)
	})

	it('changes nothing for a private package', async () => {
		const dir = await fixture({ ...PKG, private: true })
		expect(await migrateToChangesets(dir, { ...PKG, private: true }, npm('1.0.0'))).toEqual([])
		expect(await fs.pathExists(join(dir, 'release.config.mjs'))).toBe(true)
	})
})

describe('lockfile record (#967)', () => {
	it('flips semanticRelease off and changesets on', () => {
		const lock = (c: object) => ({ version: 4, record: { config: c } }) as unknown as Lockfile
		expect(lockfilePatchForTarget('changesets-migrate', lock({ semanticRelease: true }))).toEqual({
			semanticRelease: false,
			changesets: true,
		})
		expect(
			lockfilePatchForTarget(
				'changesets-migrate',
				lock({ semanticRelease: false, changesets: true })
			)
		).toBeNull()
	})
})
