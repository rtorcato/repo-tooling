import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec } from '../../../src/base/github-settings.js'
import { runLoopReap } from '../../../src/cli/commands/loop-reap.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const NOW = new Date('2026-01-01T12:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString()

const pr = (number: number, head: string, labels: string[], state = 'OPEN') => ({
	number,
	state,
	headRefName: head,
	labels: labels.map((name) => ({ name })),
})

function fakeGh(state: {
	wip: number[]
	prs: ReturnType<typeof pr>[]
	/** issue/PR number → [label, minutes ago][] */
	timeline: Record<number, [string, number][]>
}): GhExec {
	return async (args) => {
		const ok = (v: unknown) => ({
			ok: true,
			stdout: typeof v === 'string' ? v : JSON.stringify(v),
			stderr: '',
			code: 0,
		})
		if (args[0] === 'issue') return ok(state.wip.map((number) => ({ number })))
		if (args[0] === 'pr') return ok(state.prs)
		const n = Number(args[1]?.match(/issues\/(\d+)\//)?.[1])
		return ok((state.timeline[n] ?? []).map(([l, m]) => `${l}\t${ago(m)}`).join('\n'))
	}
}

describe('runLoopReap', () => {
	it('applies the stalled-agent table', async () => {
		const root = join(newTmpDir(), 'repo')
		for (const slug of ['ai-1-dead', 'ai-9-orphan', 'ai-4-open']) {
			await fs.ensureDir(join(`${root}-worktrees`, slug))
		}

		const result = await runLoopReap({
			root,
			now: NOW,
			gh: fakeGh({
				wip: [1, 2, 3],
				prs: [
					pr(13, 'ai-3-has-pr', []),
					pr(14, 'ai-4-open', ['ai-reviewing-code', 'ai-reviewing-sec', 'ai-ok-sec']),
					pr(15, 'ai-5-review-done', ['ai-reviewing-code', 'ai-changes']),
					pr(16, 'ai-6-fix', ['ai-fixing', 'ai-changes']),
					pr(17, 'ai-7-fix-again', ['ai-fixing', 'ai-changes']),
				],
				timeline: {
					1: [['ai-wip', 60]],
					2: [['ai-wip', 10]], // fresh — still working
					3: [['ai-wip', 90]], // has a PR — handed off
					14: [
						['ai-reviewing-code', 50],
						['ai-reviewing-sec', 50],
					],
					15: [['ai-reviewing-code', 90]],
					16: [['ai-fixing', 46]],
					17: [
						['ai-fixing', 300],
						['ai-fixing', 200],
						['ai-fixing', 45],
					],
				},
			}),
		})

		expect(result.exitCode).toBe(0)
		expect(
			result.stalled.map(({ kind, issue, pr, label, applications, action }) => ({
				kind,
				issue,
				pr,
				label,
				applications,
				action,
			}))
		).toEqual([
			{
				kind: 'implementer',
				issue: 1,
				pr: null,
				label: 'ai-wip',
				applications: 1,
				action: 'block',
			},
			{
				kind: 'reviewer',
				issue: 4,
				pr: 14,
				label: 'ai-reviewing-code',
				applications: 1,
				action: 'drop-label',
			},
			{
				kind: 'fixer',
				issue: 6,
				pr: 16,
				label: 'ai-fixing',
				applications: 1,
				action: 'drop-label',
			},
			{ kind: 'fixer', issue: 7, pr: 17, label: 'ai-fixing', applications: 3, action: 'block' },
			{
				kind: 'orphan',
				issue: 9,
				pr: null,
				label: null,
				applications: null,
				action: 'remove-worktree',
			},
		])
		expect(result.stalled[0]?.worktree).toBe(join(`${root}-worktrees`, 'ai-1-dead'))
		expect(result.stalled[0]?.minutes).toBe(60)
	})

	it('reaps nothing and exits 1 when a list query fails', async () => {
		const result = await runLoopReap({
			root: newTmpDir(),
			now: NOW,
			gh: async () => ({ ok: false, stdout: '', stderr: 'boom', code: 1 }),
		})
		expect(result.stalled).toEqual([])
		expect(result.exitCode).toBe(1)
	})
})
