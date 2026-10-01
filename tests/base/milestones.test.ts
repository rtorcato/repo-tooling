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

/** Serves the milestone and issue lists; PATCHes and POSTs succeed unless overridden. */
function fakeGh(milestones: unknown[], patch?: GhResult, issues: unknown[] = []): GhExec {
	return vi.fn(async (args: string[]) => {
		const method = ghMethod(args)
		if (method === 'GET')
			return ok(JSON.stringify(args.some((a) => a.endsWith('/issues')) ? issues : milestones))
		if (method === 'PATCH') return patch ?? ok('{}')
		if (method === 'POST' && args.includes('title=next')) return ok('{}')
		return { ok: false, stdout: '', stderr: `unexpected ${method}`, code: 422 }
	})
}

describe('checkMilestones', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh([])
		expect((await checkMilestones(newTmpDir(), exec)).detail).toContain('not a git repository')
		expect(exec).not.toHaveBeenCalled()
	})

	it('reports a repo that uses no milestones as optional, not drift', async () => {
		const r = await checkMilestones(gitRepo(), fakeGh([]))
		expect(r.status).toBe('optional-missing')
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
			fakeGh([milestone(), milestone({ number: 2, title: 'v2', open_issues: 0, closed_issues: 0 })])
		)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('permanent 0%')
	})

	it('exempts the sole open milestone from the empty check — it is the rolling one', async () => {
		const r = await checkMilestones(
			gitRepo(),
			fakeGh([milestone({ title: 'next', open_issues: 0, closed_issues: 0 })])
		)
		expect(r.status).toBe('ok')
	})

	it('does not drift on a done-and-closed milestone', async () => {
		const closed = milestone({ number: 2, state: 'closed', open_issues: 0, closed_issues: 6 })
		const r = await checkMilestones(gitRepo(), fakeGh([milestone(), closed]))
		expect(r.status).toBe('ok')
		expect(r.detail).not.toContain('warning')
	})

	it('reports no open milestone as optional-missing', async () => {
		const closed = milestone({ state: 'closed', open_issues: 0, closed_issues: 6 })
		const r = await checkMilestones(gitRepo(), fakeGh([closed]))
		expect(r.status).toBe('optional-missing')
		expect(r.hint).toContain('fix milestones')
	})

	it('warns about open feat/fix issues with no milestone, ignoring chores and PRs', async () => {
		const issues = [
			{ number: 7, title: 'feat(cli): add a thing' },
			{ number: 8, title: 'fix: broken thing' },
			{ number: 9, title: 'chore(deps): bump' },
			{ number: 10, title: 'feat: a PR', pull_request: {} },
		]
		const r = await checkMilestones(gitRepo(), fakeGh([milestone()], undefined, issues))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('2 open feat/fix issue(s) with no milestone: #7, #8')
	})

	it('warns about past-due, closed-with-open-issues and undated milestones', async () => {
		const r = await checkMilestones(
			gitRepo(),
			fakeGh([
				milestone({ title: 'late', due_on: '2000-01-01T00:00:00Z' }),
				milestone({ number: 2, title: 'a' }),
				milestone({ number: 3, title: 'b' }),
				milestone({ number: 4, title: 'left', state: 'closed', open_issues: 1 }),
			])
		)
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('past due: "late"')
		expect(r.detail).toContain('closed with open issues: "left"')
		expect(r.detail).toContain('2 open milestones have no due date')
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

	it('opens a rolling "next" milestone when closing leaves none open', async () => {
		const exec = fakeGh([milestone({ title: 'v1', open_issues: 0, closed_issues: 6 })])
		expect(await closeCompletedMilestones(gitRepo(), exec)).toEqual([
			'closed milestone "v1"',
			'opened milestone "next"',
		])
		expect(exec).toHaveBeenCalledWith([
			'api',
			'-X',
			'POST',
			'repos/{owner}/{repo}/milestones',
			'-f',
			'title=next',
		])
	})

	it('opens "next" in a repo with no milestones when targeted', async () => {
		expect(await closeCompletedMilestones(gitRepo(), fakeGh([]))).toEqual([
			'opened milestone "next"',
		])
	})

	it('will not reuse a closed "next" title', async () => {
		const exec = fakeGh([milestone({ title: 'next', state: 'closed', open_issues: 0 })])
		expect(await closeCompletedMilestones(gitRepo(), exec)).toEqual([])
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
