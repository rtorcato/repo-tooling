import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec } from '../../../src/base/github-settings.js'
import { runLoopTick } from '../../../src/cli/commands/loop-tick.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim()

function checkout(parent: string): string {
	const origin = join(parent, 'origin.git')
	git(parent, 'init', '-q', '--bare', '-b', 'main', origin)
	const dir = join(parent, 'repo')
	git(parent, 'clone', '-q', origin, dir)
	git(dir, 'config', 'user.email', 'test@example.com')
	git(dir, 'config', 'user.name', 'Test')
	git(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
	git(dir, 'push', '-q', 'origin', 'main')
	return fs.realpathSync(dir)
}

const NOW = new Date('2026-06-01T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString()

const pr = (
	number: number,
	head: string,
	labels: string[],
	extra: Partial<{ autoMergeRequest: unknown; author: string; body: string }> = {}
) => ({
	number,
	headRefName: head,
	labels: labels.map((name) => ({ name })),
	autoMergeRequest: extra.autoMergeRequest ?? null,
	author: { login: extra.author ?? 'me-bot' },
	body: extra.body ?? '',
	statusCheckRollup: [],
})

interface World {
	prs?: ReturnType<typeof pr>[]
	wip?: number[]
	suggested?: { number: number; updatedAt: string; labels: { name: string }[] }[]
	queue?: unknown[]
	merge?: Record<number, string>
	failing?: number[]
	/** PR → [arm, verdict] markers posted on the current head. */
	reviews?: Record<number, [string, string][]>
	changes?: Record<number, number>
}

function fakeGh(w: World): GhExec {
	return async (args) => {
		const ok = (v: unknown) => ({
			ok: true,
			stdout: typeof v === 'string' ? v : JSON.stringify(v),
			stderr: '',
		})
		const [a, b] = args
		if (a === 'repo') return ok('acme/widget\n')
		if (a === 'api') {
			if (b === 'user') return ok('me-bot\n')
			if (b === 'repos/acme/widget') return ok('acme\n')
			if (b === 'repos/acme/widget/environments') return ok({ environments: [] })
			if (b?.startsWith('repos/acme/widget/issues?')) return ok(w.queue ?? [])
			const timeline = b?.match(/issues\/(\d+)\/timeline/)
			if (timeline) {
				const n = Number(timeline[1])
				return ok(
					Array.from({ length: w.changes?.[n] ?? 0 }, () => `ai-changes\t${daysAgo(1)}`).join('\n')
				)
			}
			const reviews = b?.match(/pulls\/(\d+)\/reviews/)
			if (reviews) {
				const markers = w.reviews?.[Number(reviews[1])] ?? []
				return ok([
					markers.map(([arm, v]) => ({
						id: 1,
						user: { login: 'me-bot' },
						commit_id: 'head',
						body: `<!-- ai-issue-loop:verdict:${arm}:${v} -->`,
					})),
				])
			}
		}
		if (a === 'issue' && args.includes('ai-wip'))
			return ok((w.wip ?? []).map((number) => ({ number })))
		if (a === 'issue' && args.includes('ai-suggested')) return ok(w.suggested ?? [])
		if (a === 'pr' && b === 'list') return ok(args.includes('--head') ? [] : (w.prs ?? []))
		if (a === 'pr' && b === 'checks') {
			const failing = w.failing?.includes(Number(args[2]))
			return {
				ok: !failing,
				stdout: JSON.stringify(failing ? [{ name: 'test', state: 'FAILURE', link: 'l' }] : []),
				stderr: '',
			}
		}
		if (a === 'pr' && b === 'view') {
			if (args.includes('headRefOid')) return ok('head\n')
			return ok({ mergeStateStatus: w.merge?.[Number(args[2])] ?? 'UNKNOWN' })
		}
		return { ok: false, stdout: '', stderr: `unexpected gh ${args.join(' ')}` }
	}
}

describe('runLoopTick', () => {
	it('halts when the checkout cannot be resolved', async () => {
		const gh: GhExec = async () => ({ ok: false, stdout: '', stderr: 'no' })
		const r = await runLoopTick({ root: newTmpDir(), gh, env: {} })
		expect(r.exitCode).toBe(1)
		expect(r.halt).toBeTruthy()
	})

	it('is idle on a quiet repo', async () => {
		const root = checkout(newTmpDir())
		const r = await runLoopTick({ root, gh: fakeGh({}), env: {}, now: NOW })
		expect(r).toMatchObject({ idle: true, summary: 'idle', exitCode: 0, errors: [] })
	})

	it('turns label state into one work list', async () => {
		const root = checkout(newTmpDir())
		await fs.ensureDir(`${root}-worktrees/ai-6-fix`)
		const r = await runLoopTick({
			root,
			env: {},
			now: NOW,
			gh: fakeGh({
				wip: [1, 2, 6],
				prs: [
					pr(10, 'ai-1-ready', ['ai-review', 'ai-ok-code', 'ai-ok-sec', 'ai-notes']),
					pr(11, 'ai-2-behind', ['merge-ready']),
					pr(12, 'ai-3-red', ['ai-review']),
					pr(13, 'ai-4-review', ['ai-review', 'ai-ok-sec'], { autoMergeRequest: {} }),
					pr(14, 'ai-5-adopt-code', ['ai-review']),
					pr(15, 'ai-6-fix', ['ai-changes']),
					pr(16, 'ai-7-capped', ['ai-changes']),
					pr(17, 'fix/by-agent', [], { body: '🤖 *Opened by an agent.*' }),
					pr(18, 'fix/by-hand', [], { body: 'hand-written' }),
					pr(19, 'dependabot/npm/x', ['ai-changes']),
				],
				merge: { 10: 'CLEAN', 11: 'BEHIND' },
				failing: [12],
				reviews: { 14: [['code', 'PASS']] },
				changes: { 15: 1, 16: 3 },
				suggested: [
					{ number: 30, updatedAt: daysAgo(31), labels: [{ name: 'ai-suggested' }] },
					{ number: 31, updatedAt: daysAgo(1), labels: [{ name: 'ai-suggested' }] },
					{
						number: 32,
						updatedAt: daysAgo(40),
						labels: [{ name: 'ai-suggested' }, { name: 'ai-ready' }],
					},
				],
				queue: [
					{ number: 40, title: 'ok', body: 'b', labels: [], author_association: 'OWNER' },
					{ number: 41, title: 'stranger', body: '', labels: [], author_association: 'NONE' },
					{
						number: 42,
						title: 'held',
						body: '',
						labels: [{ name: 'holding' }],
						author_association: 'OWNER',
					},
					{
						number: 43,
						title: 'pr',
						body: '',
						labels: [],
						author_association: 'OWNER',
						pull_request: {},
					},
				],
			}),
		})

		expect(r.exitCode).toBe(0)
		expect(r.errors).toEqual([])
		expect(r.handoffs).toEqual([{ pr: 10, issue: 1, notes: true, autoMerge: false }])
		expect(r.sendBacks).toEqual([
			{ pr: 11, issue: 2, reason: 'BEHIND', failing: [] },
			{ pr: 12, issue: 3, reason: 'ci-red', failing: [{ name: 'test', link: 'l' }] },
		])
		expect(r.disarm).toEqual([13])
		expect(r.verdicts).toEqual([{ pr: 14, arm: 'code', verdict: 'PASS' }])
		expect(r.reviewsToSpawn).toEqual([
			{ pr: 13, issue: 4, arm: 'code' },
			{ pr: 14, issue: 5, arm: 'sec' },
		])
		expect(r.fixRounds.map((f) => [f.pr, f.action])).toEqual([
			[15, 'spawn'],
			[16, 'block'],
		])
		expect(r.fixRounds[0]?.worktree).toBe(`${root}-worktrees/ai-6-fix`)
		expect(r.adopt).toEqual([17])
		expect(r.dependabotChanges).toEqual([19])
		expect(r.decay).toEqual([30])
		expect(r.pickups.map((p) => p.number)).toEqual([40])
		expect(r.slots).toBe(3)
		expect(r.idle).toBe(false)
		expect(r.summary).toBe('⚠1blocked·⚠1ci-red·4wip·6rev·1ready')
	})
})
