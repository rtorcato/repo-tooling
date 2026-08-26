import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import { checkAgentUser } from '../../src/base/agent-user.js'
import type { GhExec, GhResult } from '../../src/base/github-settings.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

const gh = (r: Partial<GhResult>): GhExec =>
	vi.fn(async () => ({ ok: true, stdout: '', stderr: '', code: 0, ...r }))

describe('checkAgentUser', () => {
	it('is ok/not-applicable when the field is absent — the default, not drift', async () => {
		const exec = gh({})
		const r = await checkAgentUser(gitRepo(), undefined, exec)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('not applicable')
		expect(exec).not.toHaveBeenCalled()
	})

	it('rejects a malformed login before it reaches the API path', async () => {
		const exec = gh({})
		const r = await checkAgentUser(gitRepo(), 'evil/../../repos', exec)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('not a valid GitHub login')
		expect(exec).not.toHaveBeenCalled()
	})

	it('never spawns gh outside a git repo', async () => {
		const exec = gh({})
		const r = await checkAgentUser(newTmpDir(), 'some-bot', exec)
		expect(r.detail).toContain('not a git repository')
		expect(exec).not.toHaveBeenCalled()
	})

	it('is ok when the login is assignable (204)', async () => {
		const exec = gh({})
		const r = await checkAgentUser(gitRepo(), 'some-bot', exec)
		expect(r.status).toBe('ok')
		expect(exec).toHaveBeenCalledWith(['api', 'repos/{owner}/{repo}/assignees/some-bot'])
	})

	it('flags a 404 as drift — the skills fail silently, this is where it surfaces', async () => {
		const exec = gh({ ok: false, stderr: 'gh: Not Found (HTTP 404)', code: 1 })
		const r = await checkAgentUser(gitRepo(), 'gone-bot', exec)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('not an assignable collaborator')
	})

	it('self-skips on any other gh failure — offline is not drift', async () => {
		const exec = gh({ ok: false, stderr: 'connection refused', code: 1 })
		const r = await checkAgentUser(gitRepo(), 'some-bot', exec)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('could not verify')
	})
})
