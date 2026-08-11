import { join } from 'node:path'
import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GhExec, GhResult } from '../../src/base/github-settings.js'
import { checkMilestones, closeCompletedMilestones } from '../../src/base/milestones.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '', code: 0 })

const milestone = (over: Partial<Record<string, unknown>> = {}) => ({
	number: 1,
	title: 'v1.0 — Stable API',
	state: 'open',
	open_issues: 2,
	closed_issues: 3,
	...over,
})

/**
 * Mirrors `gh api`'s flag-to-method inference: `-f`/`-F` without an explicit
 * `-X` switches the request to POST. So only a real `GET` serves the list — a
 * read that forgets `-X GET` reads as "create milestone" and fails here, the
 * way it does against GitHub.
 */
function ghMethod(args: string[]): string {
	const i = args.indexOf('-X')
	if (i !== -1) return args[i + 1] ?? ''
	return args.includes('-f') || args.includes('-F') ? 'POST' : 'GET'
}

/** Serves the milestone list; PATCHes succeed unless `patch` says otherwise. */
function fakeGh(milestones: unknown[], patch?: GhResult): GhExec {
	return vi.fn(async (args: string[]) => {
		const method = ghMethod(args)
		if (method === 'GET') return ok(JSON.stringify(milestones))
		if (method === 'PATCH') return patch ?? ok('{}')
		return { ok: false, stdout: '', stderr: `unexpected ${method}`, code: 422 }
	})
}

describe('checkMilestones', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh([])
		expect((await checkMilestones(newTmpDir(), exec)).detail).toContain('not a git repository')
		expect(exec).not.toHaveBeenCalled()
	})

	it('skips a repo that uses no milestones — that is a choice, not drift', async () => {
		const r = await checkMilestones(gitRepo(), fakeGh([]))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('no milestones')
	})

	it('is ok when every open milestone still has work in it', async () => {
		expect((await checkMilestones(gitRepo(), fakeGh([milestone()]))).status).toBe('ok')
	})

	it('lists milestones with an explicit GET, not gh’s inferred POST', async () => {
		const exec = fakeGh([milestone()])
		await checkMilestones(gitRepo(), exec)
		expect(exec).toHaveBeenCalledWith([
			'api',
			'-X',
			'GET',
			'repos/{owner}/{repo}/milestones',
			'-f',
			'state=all',
			'-F',
			'per_page=100',
		])
	})

	it('flags a 100%-complete milestone left open', async () => {
		const exec = fakeGh([milestone({ open_issues: 0, closed_issues: 6 })])
		const r = await checkMilestones(gitRepo(), exec)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('100% complete but still open')
	})

	it('flags an empty milestone as a permanent 0%', async () => {
		const r = await checkMilestones(
			gitRepo(),
			fakeGh([milestone({ open_issues: 0, closed_issues: 0 })])
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('permanent 0%')
	})

	it('ignores closed milestones entirely', async () => {
		const closed = milestone({ state: 'closed', open_issues: 0, closed_issues: 6 })
		expect((await checkMilestones(gitRepo(), fakeGh([closed]))).status).toBe('ok')
	})

	it('warns about a catch-all title without making it a fixable drift', async () => {
		const r = await checkMilestones(gitRepo(), fakeGh([milestone({ title: 'Backlog' })]))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('can never close')
	})

	it('matches post-N and someday titles too', async () => {
		const r = await checkMilestones(gitRepo(), fakeGh([milestone({ title: 'Post-1 cleanup' })]))
		expect(r.detail).toContain('can never close')
	})

	it('self-skips when the milestone read fails', async () => {
		const exec: GhExec = async () => ({ ok: false, stdout: '', stderr: 'gh error', code: 1 })
		const r = await checkMilestones(gitRepo(), exec)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('could not read milestones')
	})
})

describe('closeCompletedMilestones', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	it('closes only the 100%-complete ones', async () => {
		const exec = fakeGh([
			milestone({ number: 1, title: 'Done', open_issues: 0, closed_issues: 6 }),
			milestone({ number: 2, title: 'In flight' }),
		])
		expect(await closeCompletedMilestones(gitRepo(), exec)).toEqual(['closed milestone "Done"'])
		expect(exec).toHaveBeenCalledWith([
			'api',
			'-X',
			'PATCH',
			'repos/{owner}/{repo}/milestones/1',
			'-f',
			'state=closed',
		])
	})

	it('never deletes an empty milestone', async () => {
		const exec = fakeGh([milestone({ open_issues: 0, closed_issues: 0 })])
		expect(await closeCompletedMilestones(gitRepo(), exec)).toEqual([])
		expect(vi.mocked(exec).mock.calls.every((c) => !c[0].includes('DELETE'))).toBe(true)
	})

	it('is a no-op outside a git repo', async () => {
		const exec = fakeGh([])
		expect(await closeCompletedMilestones(newTmpDir(), exec)).toEqual([])
		expect(exec).not.toHaveBeenCalled()
	})
})
