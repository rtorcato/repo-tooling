import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec, GhResult } from '../../src/base/github-settings.js'
import { checkRepositorySecrets } from '../../src/base/secrets.js'
import { buildPresetConfig } from '../../src/cli/commands/setup-presets.js'
import { renderReleaseWorkflow } from '../../src/languages/js/ci.js'

const ok = (names: string[]): GhResult => ({
	ok: true,
	stdout: JSON.stringify({ secrets: names.map((name) => ({ name })) }),
	stderr: '',
	code: 0,
})
const fail: GhResult = { ok: false, stdout: '', stderr: 'HTTP 403', code: 1 }

const WORKFLOW = `name: CI
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: echo \${{ secrets.API_KEY }}
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - run: echo \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
      - run: echo \${{ secrets.ENV_ONLY }}
`

async function repo(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-'))
	await fs.ensureDir(path.join(dir, '.git'))
	await fs.outputFile(path.join(dir, '.github/workflows/ci.yml'), WORKFLOW)
	return dir
}

function gh(o: { repo?: GhResult; org?: GhResult; env?: GhResult }): GhExec {
	return async (args) => {
		const url = args[1] ?? ''
		if (url.includes('environments')) return o.env ?? ok([])
		if (url.includes('organization-secrets')) return o.org ?? ok([])
		return o.repo ?? ok([])
	}
}

describe('checkRepositorySecrets', () => {
	it('reports a missing secret with no fallback as missing, with a hint', async () => {
		const r = await checkRepositorySecrets(await repo(), gh({}))
		expect(r.status).toBe('missing')
		expect(r.detail).toContain('API_KEY (ci.yml)')
		expect(r.detail).toContain('RELEASE_TOKEN (ci.yml) [falls back to GITHUB_TOKEN]')
		expect(r.hint).toContain('gh secret set API_KEY')
	})

	it('reports only fallback-masked secrets as drift', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['API_KEY']), env: ok(['ENV_ONLY']) })
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('RELEASE_TOKEN')
		expect(r.detail).not.toContain('API_KEY')
	})

	it('counts org-scoped and environment-scoped secrets as set', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ org: ok(['API_KEY', 'RELEASE_TOKEN']), env: ok(['ENV_ONLY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('is ok when everything is set at repo scope', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['API_KEY', 'RELEASE_TOKEN', 'ENV_ONLY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('self-skips (not ok) when the list is unreadable', async () => {
		const r = await checkRepositorySecrets(await repo(), gh({ repo: fail }))
		expect(r.status).toBe('skipped')
		expect(r.detail).toContain('not checked')
	})

	it('does not flag an environment secret when the environment is unreadable', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['API_KEY', 'RELEASE_TOKEN']), env: fail })
		)
		expect(r.status).toBe('ok')
	})
})

// The generated Changesets release.yml: an App token, then RELEASE_TOKEN, then
// GITHUB_TOKEN (#1030).
describe('checkRepositorySecrets on a Changesets release workflow (#1030)', () => {
	async function changesetsRepo(): Promise<string> {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'secrets-cs-'))
		await fs.ensureDir(path.join(dir, '.git'))
		const yml = renderReleaseWorkflow({ ...buildPresetConfig('library', 'x'), changesets: true })
		await fs.outputFile(path.join(dir, '.github/workflows/release.yml'), yml ?? '')
		return dir
	}

	it('flags a repo with no release credentials, naming the held-workflows symptom', async () => {
		const r = await checkRepositorySecrets(await changesetsRepo(), gh({}))
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('RELEASE_APP_ID')
		expect(r.detail).toContain('RELEASE_TOKEN')
		expect(r.hint).toContain('Approve and run workflows')
		expect(r.hint).toContain('gh secret set RELEASE_APP_PRIVATE_KEY')
	})

	it('passes a repo with the App secrets and no RELEASE_TOKEN', async () => {
		const r = await checkRepositorySecrets(
			await changesetsRepo(),
			gh({ repo: ok(['RELEASE_APP_ID', 'RELEASE_APP_PRIVATE_KEY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('counts org-scoped App secrets', async () => {
		const r = await checkRepositorySecrets(
			await changesetsRepo(),
			gh({ org: ok(['RELEASE_APP_ID', 'RELEASE_APP_PRIVATE_KEY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('passes a repo with RELEASE_TOKEN and no App', async () => {
		const r = await checkRepositorySecrets(
			await changesetsRepo(),
			gh({ repo: ok(['RELEASE_TOKEN']) })
		)
		expect(r.status).toBe('ok')
	})

	it('needs both App secrets: an App ID alone is still no credential', async () => {
		const r = await checkRepositorySecrets(
			await changesetsRepo(),
			gh({ repo: ok(['RELEASE_APP_ID']) })
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('RELEASE_APP_PRIVATE_KEY')
		expect(r.detail).not.toContain('RELEASE_APP_ID (')
	})
})
