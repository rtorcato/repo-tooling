import os from 'node:os'
import path from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec, GhResult } from '../../src/base/github-settings.js'
import { checkRepositorySecrets } from '../../src/base/secrets.js'

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
      - run: echo \${{ secrets.CODECOV_TOKEN }}
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
		expect(r.detail).toContain('CODECOV_TOKEN (ci.yml)')
		expect(r.detail).toContain('RELEASE_TOKEN (ci.yml) [falls back to GITHUB_TOKEN]')
		expect(r.hint).toContain('gh secret set CODECOV_TOKEN')
	})

	it('reports only fallback-masked secrets as drift', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['CODECOV_TOKEN']), env: ok(['ENV_ONLY']) })
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('RELEASE_TOKEN')
		expect(r.detail).not.toContain('CODECOV_TOKEN')
	})

	it('counts org-scoped and environment-scoped secrets as set', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ org: ok(['CODECOV_TOKEN', 'RELEASE_TOKEN']), env: ok(['ENV_ONLY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('is ok when everything is set at repo scope', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['CODECOV_TOKEN', 'RELEASE_TOKEN', 'ENV_ONLY']) })
		)
		expect(r.status).toBe('ok')
	})

	it('self-skips as ok when the list is unreadable', async () => {
		const r = await checkRepositorySecrets(await repo(), gh({ repo: fail }))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('not checked')
	})

	it('does not flag an environment secret when the environment is unreadable', async () => {
		const r = await checkRepositorySecrets(
			await repo(),
			gh({ repo: ok(['CODECOV_TOKEN', 'RELEASE_TOKEN']), env: fail })
		)
		expect(r.status).toBe('ok')
	})
})
