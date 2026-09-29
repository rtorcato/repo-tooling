import fs from 'fs-extra'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GhResult } from '../../../src/base/github-settings.js'
import type { ProjectConfig } from '../../../src/cli/commands/setup.js'
import { npmPublishFor } from '../../../src/cli/commands/setup.js'
import {
	applyNpmTrustedPublisher,
	checkNpmTrustedPublisher,
	checkPublishJob,
	findNpmPublishJob,
	type NpmExec,
	versionAtLeast,
} from '../../../src/languages/js/npm-trust.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const PKG = { name: '@acme/lib', version: '1.0.0', repository: 'github:acme/lib' }

const JOB = (extra = '') =>
	`jobs:\n  release:\n${extra}    permissions:\n      id-token: write\n    steps:\n      - run: npm install -g npm@^11.5.1\n      - run: npx semantic-release\n`

async function seed(workflow: string) {
	const dir = newTmpDir()
	await fs.outputFile(join(dir, '.github', 'workflows', 'ci.yml'), workflow)
	return dir
}

const res = (ok: boolean, stdout = '', stderr = ''): GhResult => ({
	ok,
	stdout,
	stderr,
	code: ok ? 0 : 1,
})

/** Fake npm: a published package, npm 11.16.0, logged in, and the given trust list. */
function fakeNpm(
	over: Partial<Record<'view' | 'version' | 'whoami' | 'trust', GhResult>> = {}
): NpmExec {
	return vi.fn(async (args: string[]) => {
		if (args[0] === 'view') return over.view ?? res(true, '1.0.0\n')
		if (args[0] === '--version') return over.version ?? res(true, '11.16.0\n')
		if (args[0] === 'whoami') return over.whoami ?? res(true, 'acme\n')
		if (args[0] === 'trust' && args[1] === 'list') return over.trust ?? res(true, '[]')
		return res(true, 'ok')
	})
}

const entry = (file: string, environment?: string, repository = 'acme/lib') =>
	JSON.stringify([
		{ id: 'x1', type: 'github', claims: { repository, workflow_ref: { file }, environment } },
	])

beforeEach(() => {
	vi.stubEnv('CI', '')
})

describe('checkPublishJob', () => {
	it('drifts without id-token: write', async () => {
		const dir = await seed(
			'jobs:\n  release:\n    steps:\n      - run: npm i -g npm@11\n      - run: npx semantic-release\n'
		)
		const job = await findNpmPublishJob(dir)
		expect(job && checkPublishJob(job).status).toBe('drift')
		expect(job && checkPublishJob(job).detail).toMatch(/id-token/)
	})

	it('drifts without an npm upgrade, hinting the pinned install', async () => {
		const dir = await seed(
			'jobs:\n  release:\n    permissions:\n      id-token: write\n    steps:\n      - run: npx semantic-release\n'
		)
		const job = await findNpmPublishJob(dir)
		const r = job && checkPublishJob(job)
		expect(r?.status).toBe('drift')
		expect(r?.hint).toContain('npm install -g npm@^11.5.1')
	})

	it('accepts id-token: write granted at the workflow level', async () => {
		const dir = await seed(
			'permissions:\n  id-token: write\njobs:\n  release:\n    steps:\n      - run: npm install -g npm@^11.5.1\n      - run: npx semantic-release\n'
		)
		const job = await findNpmPublishJob(dir)
		expect(job && checkPublishJob(job).status).toBe('ok')
	})

	it('is ok with both', async () => {
		const job = await findNpmPublishJob(await seed(JOB()))
		expect(job && checkPublishJob(job).status).toBe('ok')
	})
})

describe('checkNpmTrustedPublisher', () => {
	it('ok when the listed publisher matches repo + workflow', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ trust: res(true, entry('ci.yml')) })
		)
		expect(r.status).toBe('ok')
	})

	it('drift on a different workflow file', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ trust: res(true, entry('release.yml')) })
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toMatch(/different workflow/)
		expect(r.hint).toContain('fix npm-trusted-publisher')
	})

	it('drift when the job declares environment: release and the publisher has none', async () => {
		const dir = await seed(JOB('    environment: release\n'))
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ trust: res(true, entry('ci.yml')) })
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toMatch(/release/)
		const ok = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ trust: res(true, entry('ci.yml', 'release')) })
		)
		expect(ok.status).toBe('ok')
	})

	it('drift on an empty list', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(dir, PKG, fakeNpm())
		expect(r.status).toBe('drift')
		expect(r.detail).toMatch(/no trusted publisher/)
	})

	it('optional-missing with the manual values when local npm is too old', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(dir, PKG, fakeNpm({ version: res(true, '10.9.2\n') }))
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toMatch(/11\.15\.0/)
		expect(r.hint).toContain('Workflow filename: ci.yml')
		expect(r.hint).not.toMatch(/NPM_TOKEN/)
	})

	it('optional-missing when not logged in', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ whoami: res(false, '', 'ENEEDAUTH') })
		)
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toMatch(/not logged in/)
	})

	it('optional-missing with the bootstrap recipe when the package is not on npm', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ view: res(false, '', 'npm error code E404') })
		)
		expect(r.status).toBe('optional-missing')
		expect(r.hint).toMatch(/--provenance=false/)
	})

	it('never touches npm without a GitHub repository to compare against', async () => {
		const dir = await seed(JOB())
		const npm = fakeNpm()
		const r = await checkNpmTrustedPublisher(dir, { name: 'demo' }, npm)
		expect(r.status).toBe('optional-missing')
		expect(npm).not.toHaveBeenCalled()
	})

	it('a network failure skips, never fails', async () => {
		const dir = await seed(JOB())
		const r = await checkNpmTrustedPublisher(
			dir,
			PKG,
			fakeNpm({ view: res(false, '', 'ETIMEDOUT') })
		)
		expect(r.status).toBe('optional-missing')
	})
})

describe('applyNpmTrustedPublisher', () => {
	it('dry-runs, then registers with flags derived from the job', async () => {
		const dir = await seed(JOB('    environment: release\n'))
		const npm = fakeNpm()
		const out = await applyNpmTrustedPublisher(dir, PKG, true, npm)
		expect(out).toHaveLength(1)
		const calls = vi.mocked(npm).mock.calls.map((c) => c[0].join(' '))
		const want = 'trust github --file ci.yml --repo acme/lib --env release --allow-publish'
		expect(calls).toContain(`${want} --dry-run -- @acme/lib`)
		expect(calls).toContain(`${want} --yes -- @acme/lib`)
	})

	it('refuses a flag-shaped package name without calling npm', async () => {
		const dir = await seed(JOB(''))
		const npm = fakeNpm()
		await expect(
			applyNpmTrustedPublisher(dir, { ...PKG, name: '--registry=https://evil' }, true, npm)
		).rejects.toThrow()
		expect(npm).not.toHaveBeenCalled()
	})

	it('refuses when the package is not on npm yet', async () => {
		const dir = await seed(JOB())
		await expect(
			applyNpmTrustedPublisher(dir, PKG, true, fakeNpm({ view: res(false, '', 'E404') }))
		).rejects.toThrow(/not on npm yet/)
	})

	it('refuses when not logged in', async () => {
		const dir = await seed(JOB())
		await expect(
			applyNpmTrustedPublisher(dir, PKG, true, fakeNpm({ whoami: res(false) }))
		).rejects.toThrow(/not logged in/)
	})
})

describe('setup npm publish guidance', () => {
	it('names the trusted-publisher values and never an NPM_TOKEN secret', () => {
		const g = npmPublishFor({
			projectName: 'my-lib',
			projectType: 'library',
			semanticRelease: true,
		} as ProjectConfig)
		expect(g?.workflowFilename).toBe('ci.yml')
		expect(g?.command).toContain('npm trust github my-lib --file ci.yml')
		expect(JSON.stringify(g)).not.toMatch(/NPM_TOKEN/)
		expect(
			npmPublishFor({ projectType: 'web-app', semanticRelease: true } as ProjectConfig)
		).toBeNull()
	})
})

it('versionAtLeast', () => {
	expect(versionAtLeast('11.15.0', '11.15.0')).toBe(true)
	expect(versionAtLeast('11.16.1\n', '11.15.0')).toBe(true)
	expect(versionAtLeast('10.9.2', '11.5.1')).toBe(false)
	expect(versionAtLeast('11.5.0', '11.5.1')).toBe(false)
})
