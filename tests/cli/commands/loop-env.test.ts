import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import type { GhExec } from '../../../src/base/github-settings.js'
import { resolveLoopEnv, toShell } from '../../../src/cli/commands/loop-env.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim()

function checkout(parent: string): string {
	const dir = join(parent, 'repo')
	fs.ensureDirSync(dir)
	git(dir, 'init', '-q', '-b', 'main')
	git(dir, 'config', 'user.email', 'test@example.com')
	git(dir, 'config', 'user.name', 'Test')
	fs.writeFileSync(join(dir, 'README.md'), '# test\n')
	git(dir, 'add', '-A')
	git(dir, 'commit', '-qm', 'init')
	return fs.realpathSync(dir)
}

/** Answers by the first arg that names a route; records every call. */
function fakeGh(opts: { owner?: 'User' | 'Organization'; assignable?: string[] } = {}) {
	const calls: string[][] = []
	const gh: GhExec = async (args) => {
		calls.push(args)
		const ok = (stdout: string) => ({ ok: true, stdout, stderr: '' })
		if (args[0] === 'repo') return ok('acme/widget\n')
		const route = args[1]
		if (route === 'user') return ok('me-bot\n')
		if (route === 'repos/acme/widget') return ok(opts.owner === 'Organization' ? '\n' : 'acme\n')
		const m = route?.match(/^repos\/acme\/widget\/assignees\/(.+)$/)
		if (m && opts.assignable?.includes(m[1] as string)) return ok('')
		return { ok: false, stdout: '', stderr: 'HTTP 404' }
	}
	return { gh, calls }
}

describe('resolveLoopEnv', () => {
	it('resolves ROOT to the main checkout from inside a linked worktree', async () => {
		const tmp = newTmpDir()
		const root = checkout(tmp)
		const wt = join(tmp, 'repo-worktrees', 'ai-1')
		git(root, 'worktree', 'add', '-q', wt, '-b', 'ai-1')
		const env = await resolveLoopEnv({ dir: wt, gh: fakeGh().gh, env: {} })
		expect(env.root).toBe(root)
		expect(env.worktreeRoot).toBe(`${root}-worktrees`)
		expect(env).toMatchObject({ ownerRepo: 'acme/widget', humanUser: 'acme', me: 'me-bot' })
	})

	it('reads rules.aiLoop.agentUser and keeps it when assignable', async () => {
		const root = checkout(newTmpDir())
		fs.writeJsonSync(join(root, '.repo-tooling.json'), { rules: { aiLoop: { agentUser: 'bot' } } })
		const env = await resolveLoopEnv({ dir: root, gh: fakeGh({ assignable: ['bot'] }).gh, env: {} })
		expect(env.agentUser).toBe('bot')
		expect(env.warnings).toEqual([])
	})

	it('lets AI_LOOP_AGENT override the lockfile', async () => {
		const root = checkout(newTmpDir())
		fs.writeJsonSync(join(root, '.repo-tooling.json'), { aiLoop: { agentUser: 'bot' } })
		const { gh } = fakeGh({ assignable: ['bot', 'other'] })
		const env = await resolveLoopEnv({ dir: root, gh, env: { AI_LOOP_AGENT: 'other' } })
		expect(env.agentUser).toBe('other')
	})

	it('drops an unassignable agentUser to empty, with a warning', async () => {
		const root = checkout(newTmpDir())
		const env = await resolveLoopEnv({ dir: root, gh: fakeGh().gh, env: { AI_LOOP_AGENT: 'typo' } })
		expect(env.agentUser).toBe('')
		expect(env.warnings.join()).toMatch(/not an assignable collaborator/)
	})

	it('never puts an invalid login into an API path', async () => {
		const root = checkout(newTmpDir())
		const { gh, calls } = fakeGh()
		const env = await resolveLoopEnv({ dir: root, gh, env: { AI_LOOP_AGENT: '../../x' } })
		expect(env.agentUser).toBe('')
		expect(calls.some((c) => c.join(' ').includes('assignees'))).toBe(false)
	})

	it('leaves HUMAN_USER empty for an organisation repo', async () => {
		const root = checkout(newTmpDir())
		const env = await resolveLoopEnv({
			dir: root,
			gh: fakeGh({ owner: 'Organization' }).gh,
			env: {},
		})
		expect(env.humanUser).toBe('')
	})

	it('reports an unresolvable checkout and repo as empty', async () => {
		const dir = newTmpDir()
		const gh: GhExec = async () => ({ ok: false, stdout: '', stderr: 'no repo' })
		const env = await resolveLoopEnv({ dir, gh, git: async () => null, env: {} })
		expect(env).toMatchObject({ root: '', worktreeRoot: '', ownerRepo: '', me: '' })
		expect(env.warnings).toHaveLength(2)
	})
})

describe('toShell', () => {
	it('single-quotes values so eval cannot be injected', () => {
		const out = toShell({
			root: "/a'b",
			worktreeRoot: '/w',
			ownerRepo: 'o/r',
			agentUser: '',
			humanUser: 'h',
			me: '$(id)',
			warnings: [],
		})
		expect(out).toContain(`ROOT='/a'\\''b'`)
		expect(out).toContain(`ME='$(id)'`)
		expect(out).toContain(`AGENT_USER=''`)
	})
})
