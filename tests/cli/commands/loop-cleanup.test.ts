import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec } from '../../../src/base/github-settings.js'
import { runLoopCleanup } from '../../../src/cli/commands/loop-cleanup.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim()

/** A main checkout cloned from a bare origin, so `origin/main` is real. */
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

/** Lands a squash subject on origin/main, the way GitHub would. */
function squash(root: string, subject: string) {
	git(root, 'commit', '-q', '--allow-empty', '-m', subject)
	git(root, 'push', '-q', 'origin', 'main')
}

function fakeGh(prs: Record<string, { number: number; state: string }>): GhExec {
	return async (args) => {
		const head = args[args.indexOf('--head') + 1] as string
		const pr = prs[head]
		return { ok: true, stdout: JSON.stringify(pr ? [pr] : []), stderr: '' }
	}
}

describe('runLoopCleanup', () => {
	it('removes landed and closed worktrees, keeps open and unlanded ones', async () => {
		const tmp = newTmpDir()
		const root = checkout(tmp)
		const wt = `${root}-worktrees`
		for (const slug of ['ai-1-landed', 'ai-2-unlanded', 'ai-3-closed', 'ai-4-open', 'ai-5-nopr']) {
			git(root, 'worktree', 'add', '-q', join(wt, slug), '-b', slug)
		}
		// Legacy root and legacy `worktree-` branch prefix.
		git(
			root,
			'worktree',
			'add',
			'-q',
			join(root, '.claude/worktrees/ai-6-legacy'),
			'-b',
			'worktree-ai-6-legacy'
		)
		squash(root, 'feat: landed (#11)')
		squash(root, 'feat: legacy (#16)')

		const result = await runLoopCleanup({
			root,
			gh: fakeGh({
				'ai-1-landed': { number: 11, state: 'MERGED' },
				'ai-2-unlanded': { number: 12, state: 'MERGED' },
				'ai-3-closed': { number: 13, state: 'CLOSED' },
				'ai-4-open': { number: 14, state: 'OPEN' },
				'worktree-ai-6-legacy': { number: 16, state: 'MERGED' },
			}),
		})

		const actions = Object.fromEntries(
			result.worktrees.map((w) => [w.path.split('/').pop(), w.action])
		)
		expect(actions).toEqual({
			'ai-1-landed': 'removed',
			'ai-2-unlanded': 'kept',
			'ai-3-closed': 'removed',
			'ai-4-open': 'kept',
			'ai-5-nopr': 'kept',
			'ai-6-legacy': 'removed',
		})
		expect(result.removed).toBe(true)
		expect(result.exitCode).toBe(0)
		expect(result.worktrees.find((w) => w.pr === 16)).toMatchObject({
			issue: 6,
			branch: 'worktree-ai-6-legacy',
		})
		expect(fs.existsSync(join(wt, 'ai-1-landed'))).toBe(false)
		expect(fs.existsSync(join(wt, 'ai-2-unlanded'))).toBe(true)
		expect(git(root, 'branch', '--list', 'ai-1-landed', 'worktree-ai-6-legacy')).toBe('')
		expect(git(root, 'branch', '--list', 'ai-2-unlanded')).not.toBe('')
	})

	it('reports removed: false when nothing is on disk', async () => {
		const root = checkout(newTmpDir())
		const result = await runLoopCleanup({ root, gh: fakeGh({}) })
		expect(result).toMatchObject({ removed: false, worktrees: [], exitCode: 0 })
	})
})
