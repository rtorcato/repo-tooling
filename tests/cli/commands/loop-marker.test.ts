import { describe, expect, it } from 'vitest'
import type { GhExec } from '../../../src/base/github-settings.js'
import { runLoopComment, runLoopVerdict } from '../../../src/cli/commands/loop-marker.js'

const M = '<!-- ai-issue-loop:decision -->'
const verdict = (arm: string, v: string) => `<!-- ai-issue-loop:verdict:${arm}:${v} -->\n### Review`

/** Routes by args; `pages` is the slurped listing. Records writes with their stdin. */
function fakeGh(pages: unknown[][], opts: { head?: string; listFails?: boolean } = {}) {
	const writes: { args: string[]; body: string }[] = []
	const gh: GhExec = async (args, stdin) => {
		const ok = (stdout: string) => ({ ok: true, stdout, stderr: '', code: 0 })
		if (args[0] === 'repo') return ok('acme/widget\n')
		if (args[0] === 'pr') return ok(`${opts.head ?? 'abc'}\n`)
		if (args[1] === 'user') return ok('me-bot\n')
		if (args.includes('--slurp')) {
			return opts.listFails
				? { ok: false, stdout: '', stderr: 'HTTP 502', code: 1 }
				: ok(JSON.stringify(pages))
		}
		writes.push({ args, body: JSON.parse(stdin ?? '{}').body })
		return ok('{"id": 99}')
	}
	return { gh, writes }
}

describe('runLoopComment', () => {
	it('creates the marker comment when the loop has none', async () => {
		// A stranger's marker and a null body must neither match nor throw.
		const { gh, writes } = fakeGh([
			[
				{ id: 1, user: { login: 'stranger' }, body: `${M}\nmine now` },
				{ id: 2, user: { login: 'me-bot' }, body: null },
			],
		])
		const r = await runLoopComment(7, { text: 'do the thing', gh })
		expect(r).toMatchObject({ action: 'created', commentId: 99 })
		expect(writes).toHaveLength(1)
		expect(writes[0]?.args).toEqual(['api', 'repos/acme/widget/issues/7/comments', '--input', '-'])
		expect(writes[0]?.body).toBe(`${M}\ndo the thing`)
	})

	it("patches the loop's own marker comment, found on a later page", async () => {
		const { gh, writes } = fakeGh([[], [{ id: 5, user: { login: 'me-bot' }, body: `${M}\nold` }]])
		const r = await runLoopComment('7', { text: 'new', gh })
		expect(r.action).toBe('updated')
		expect(writes[0]?.args).toContain('repos/acme/widget/issues/comments/5')
	})

	it('fails rather than posting a duplicate when the listing fails', async () => {
		const { gh, writes } = fakeGh([], { listFails: true })
		expect((await runLoopComment(7, { text: 'x', gh })).action).toBe('failed')
		expect(writes).toEqual([])
	})

	it('rejects a non-numeric PR before touching gh', async () => {
		const { gh, writes } = fakeGh([])
		expect((await runLoopComment('7/../x', { text: 'x', gh })).error).toMatch(/not a PR/)
		expect(writes).toEqual([])
	})
})

describe('runLoopVerdict', () => {
	const review = (login: string, commit: string, body: string | null) => ({
		id: 1,
		user: { login },
		commit_id: commit,
		body,
	})

	it('adopts the last own verdict on the current head, ignoring strangers and stale heads', async () => {
		const { gh } = fakeGh([
			[
				review('me-bot', 'abc', verdict('code', 'CHANGES')),
				review('me-bot', 'old', verdict('code', 'PASS')),
			],
			[
				review('stranger', 'abc', verdict('code', 'PASS')),
				review('me-bot', 'abc', null),
				review('me-bot', 'abc', verdict('sec', 'PASS')),
			],
		])
		expect((await runLoopVerdict(7, { arm: 'code', gh })).verdict).toBe('CHANGES')
		expect((await runLoopVerdict(7, { arm: 'sec', gh })).verdict).toBe('PASS')
	})

	it('returns null when no verdict matches, and reads PASS-NOTES whole', async () => {
		const { gh } = fakeGh([[review('me-bot', 'abc', verdict('code', 'PASS-NOTES'))]])
		expect((await runLoopVerdict(7, { arm: 'code', gh })).verdict).toBe('PASS-NOTES')
		expect((await runLoopVerdict(7, { arm: 'sec', gh })).verdict).toBeNull()
	})

	it('errors on an unknown arm or a failed listing', async () => {
		expect((await runLoopVerdict(7, { arm: 'x', gh: fakeGh([]).gh })).error).toMatch(/--arm/)
		const r = await runLoopVerdict(7, { arm: 'code', gh: fakeGh([], { listFails: true }).gh })
		expect(r.error).toMatch(/reviews/)
	})
})
