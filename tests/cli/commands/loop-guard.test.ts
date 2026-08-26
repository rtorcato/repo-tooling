import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import {
	classifyRoot,
	decideRebuild,
	defaultWorktreeRoot,
	type InstallExec,
	REBUILD_ARGS,
	runLoopGuard,
} from '../../../src/cli/commands/loop-guard.js'
import type { GitExec } from '../../../src/base/git-identity.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

/**
 * The spec is the invariant table in skills/ai-issue-loop/SKILL.md (#519). It
 * is asserted twice on purpose: once against `classifyRoot` (fast, exhaustive)
 * and once against repositories git actually created, because the table is a
 * claim about git's behaviour and a pure test can only re-state it.
 */

const newTmpDir = useTmpDir()

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim()

/** A checkout with one commit, so `worktree add` has something to branch from. */
function healthyCheckout(parent: string, name = 'repo'): string {
	const dir = join(parent, name)
	fs.ensureDirSync(dir)
	git(dir, 'init', '-q', '-b', 'main')
	git(dir, 'config', 'user.email', 'test@example.com')
	git(dir, 'config', 'user.name', 'Test')
	fs.writeFileSync(join(dir, 'README.md'), '# test\n')
	git(dir, 'add', '-A')
	git(dir, 'commit', '-qm', 'init')
	return dir
}

const neverInstalls: InstallExec = async () => {
	throw new Error('install must not run')
}

describe('classifyRoot — the SKILL.md invariant table', () => {
	it('reads a healthy checkout as a work tree', () => {
		expect(classifyRoot('true', 'directory')).toBe('work-tree')
	})

	it('reads false + a .git directory as wrongly bare', () => {
		expect(classifyRoot('false', 'directory')).toBe('wrongly-bare')
	})

	it('reads false + no .git as a genuinely bare repo', () => {
		expect(classifyRoot('false', 'absent')).toBe('genuinely-bare')
	})

	it('reads a linked worktree as a work tree, and never repairs one', () => {
		expect(classifyRoot('true', 'file')).toBe('work-tree')
		// The discriminator that matters: `.git` is a file, so even a false probe
		// is not ours to repair.
		expect(classifyRoot('false', 'file')).toBe('linked-worktree')
	})

	it('treats a git that could not answer as no repo at all', () => {
		expect(classifyRoot(null, 'directory')).toBe('not-a-repo')
	})

	it('trims, because the probe answer arrives with a newline', () => {
		expect(classifyRoot('true\n', 'directory')).toBe('work-tree')
	})
})

describe('runLoopGuard — bare detection and repair', () => {
	it('leaves a healthy checkout alone and exits 0', async () => {
		const root = healthyCheckout(newTmpDir())
		const result = await runLoopGuard({ root })
		expect(result.state).toBe('work-tree')
		expect(result.bare).toBe('healthy')
		expect(result.exitCode).toBe(0)
	})

	it('repairs a wrongly-bare checkout and exits 0', async () => {
		const root = healthyCheckout(newTmpDir())
		git(root, 'config', 'core.bare', 'true')
		const result = await runLoopGuard({ root })
		expect(result.state).toBe('wrongly-bare')
		expect(result.bare).toBe('repaired')
		expect(result.exitCode).toBe(0)
		expect(git(root, 'config', 'core.bare')).toBe('false')
		expect(git(root, 'rev-parse', '--is-inside-work-tree')).toBe('true')
	})

	it('detects the flip from stdout, not the exit code', async () => {
		const root = healthyCheckout(newTmpDir())
		git(root, 'config', 'core.bare', 'true')
		// The probe git actually runs: `false` on stdout, exit 0. An exit-code
		// probe would call this healthy and hand a bare root to the tick.
		expect(
			execFileSync('git', ['-C', root, 'rev-parse', '--is-inside-work-tree']).toString().trim()
		).toBe('false')
		expect((await runLoopGuard({ root })).bare).toBe('repaired')
	})

	it('refuses to touch a genuinely bare repository and exits 2', async () => {
		const root = join(newTmpDir(), 'bare.git')
		fs.ensureDirSync(root)
		git(root, 'init', '-q', '--bare')
		const result = await runLoopGuard({ root })
		expect(result.state).toBe('genuinely-bare')
		expect(result.bare).toBe('unrepairable')
		expect(result.exitCode).toBe(2)
		// The damage this guard must never do: flipping a real bare clone.
		expect(git(root, 'config', 'core.bare')).toBe('true')
	})

	it('treats a linked worktree as healthy — its .git is a file', async () => {
		const parent = newTmpDir()
		const root = healthyCheckout(parent)
		const wt = join(parent, 'repo-worktrees', 'ai-1-thing')
		git(root, 'worktree', 'add', '-q', wt, '-b', 'ai-1-thing')
		expect(fs.lstatSync(join(wt, '.git')).isFile()).toBe(true)
		const result = await runLoopGuard({ root: wt })
		expect(result.state).toBe('work-tree')
		expect(result.exitCode).toBe(0)
	})

	it('exits 2 when --root is not a repository at all', async () => {
		const result = await runLoopGuard({ root: newTmpDir() })
		expect(result.state).toBe('not-a-repo')
		expect(result.exitCode).toBe(2)
	})

	it('exits 1 when the repair fails, so the tick halts', async () => {
		// The observed failure: a sandbox refusing to lock .git/config. Injected
		// rather than staged, because the real one needs a sandbox to reproduce.
		const failingConfig: GitExec = async (args) => (args[0] === 'config' ? null : 'false')
		const root = healthyCheckout(newTmpDir())
		const result = await runLoopGuard({ root, git: failingConfig })
		expect(result.bare).toBe('repair-failed')
		expect(result.exitCode).toBe(1)
		expect(result.messages.join('\n')).toContain('repair FAILED')
	})
})

describe('runLoopGuard — node_modules rebuild gating', () => {
	const pnpmRepo = (): string => {
		const root = healthyCheckout(newTmpDir())
		fs.writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		return root
	}

	it('does nothing when no worktree was removed', async () => {
		const result = await runLoopGuard({ root: pnpmRepo(), install: neverInstalls })
		expect(result.rebuild).toBe('not-requested')
	})

	it('rebuilds when a worktree was removed and none are left', async () => {
		const root = pnpmRepo()
		let ranIn: string | null = null
		const result = await runLoopGuard({
			root,
			removed: true,
			install: async (cwd) => {
				ranIn = cwd
				return true
			},
		})
		expect(result.rebuild).toBe('rebuilt')
		expect(ranIn).toBe(root)
	})

	it('defers while an ai-* worktree is still live', async () => {
		const parent = newTmpDir()
		const root = healthyCheckout(parent)
		fs.writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		fs.ensureDirSync(join(parent, 'repo-worktrees', 'ai-42-live'))
		const result = await runLoopGuard({ root, removed: true, install: neverInstalls })
		expect(result.rebuild).toBe('deferred')
		expect(result.live).toEqual([join(parent, 'repo-worktrees', 'ai-42-live')])
		expect(result.messages.join('\n')).toContain('rebuild deferred — 1 worktree(s) still live')
	})

	it('also scans the in-repo .claude/worktrees location', async () => {
		const root = pnpmRepo()
		fs.ensureDirSync(join(root, '.claude', 'worktrees', 'ai-7-legacy'))
		const result = await runLoopGuard({ root, removed: true, install: neverInstalls })
		expect(result.rebuild).toBe('deferred')
	})

	it('ignores directories that are not ai-*', async () => {
		const parent = newTmpDir()
		const root = healthyCheckout(parent)
		fs.writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		fs.ensureDirSync(join(parent, 'repo-worktrees', 'scratch'))
		const result = await runLoopGuard({ root, removed: true, install: async () => true })
		expect(result.live).toEqual([])
		expect(result.rebuild).toBe('rebuilt')
	})

	it('skips a non-pnpm repo entirely', async () => {
		const root = healthyCheckout(newTmpDir())
		const result = await runLoopGuard({ root, removed: true, install: neverInstalls })
		expect(result.rebuild).toBe('skipped-no-lockfile')
	})

	it('reports a failed rebuild loudly without changing the exit code', async () => {
		const result = await runLoopGuard({
			root: pnpmRepo(),
			removed: true,
			install: async () => false,
		})
		expect(result.rebuild).toBe('rebuild-failed')
		expect(result.exitCode).toBe(0)
		expect(result.messages.join('\n')).toContain('rebuild FAILED')
	})

	it('never installs into a root the tick is about to halt over', async () => {
		const root = join(newTmpDir(), 'bare.git')
		fs.ensureDirSync(root)
		git(root, 'init', '-q', '--bare')
		fs.writeFileSync(join(root, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n")
		const result = await runLoopGuard({ root, removed: true, install: neverInstalls })
		expect(result.rebuild).toBe('skipped-root-unusable')
		expect(result.exitCode).toBe(2)
	})

	it('keeps both pnpm flags — neither is optional', () => {
		expect([...REBUILD_ARGS]).toEqual([
			'install',
			'--frozen-lockfile',
			'--config.confirmModulesPurge=false',
		])
	})

	it('decides purely, so the conditions can be read without a pnpm install', async () => {
		const root = pnpmRepo()
		expect(await decideRebuild({ root, removed: false, exitCode: 0, live: [] })).toBe(
			'not-requested'
		)
		expect(await decideRebuild({ root, removed: true, exitCode: 1, live: [] })).toBe(
			'skipped-root-unusable'
		)
		expect(await decideRebuild({ root, removed: true, exitCode: 0, live: ['/x/ai-1'] })).toBe(
			'deferred'
		)
	})
})

describe('defaultWorktreeRoot', () => {
	it('is a sibling of the repo, never inside it', () => {
		expect(defaultWorktreeRoot('/Volumes/W/repo-tooling')).toBe('/Volumes/W/repo-tooling-worktrees')
	})
})
