import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { runLoopWorktreeAdd } from '../../../src/cli/commands/loop-worktree.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const git = (cwd: string, ...args: string[]) =>
	execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
		.toString()
		.trim()

function checkout(parent: string, symlinkDirectories?: unknown[]): string {
	const dir = join(parent, 'repo')
	fs.ensureDirSync(join(dir, 'node_modules'))
	fs.ensureDirSync(join(dir, 'apps', 'docs', 'node_modules'))
	git(dir, 'init', '-q', '-b', 'main')
	git(dir, 'config', 'user.email', 'test@example.com')
	git(dir, 'config', 'user.name', 'Test')
	fs.writeFileSync(join(dir, '.gitignore'), 'node_modules/\n')
	if (symlinkDirectories) {
		fs.outputJsonSync(join(dir, '.claude', 'settings.json'), { worktree: { symlinkDirectories } })
	}
	git(dir, 'add', '-A')
	git(dir, 'commit', '-qm', 'init')
	return fs.realpathSync(dir)
}

describe('runLoopWorktreeAdd', () => {
	it('creates the worktree, links every entry, and excludes the links from git', async () => {
		const root = checkout(newTmpDir(), [
			'node_modules',
			'apps/docs/node_modules',
			'packages/gone/node_modules',
			'../escape',
		])
		const r = await runLoopWorktreeAdd('ai-7-add-thing', { root, base: 'main' })
		expect(r.exitCode).toBe(0)
		expect(r.worktree).toBe(join(`${root}-worktrees`, 'ai-7-add-thing'))
		// an entry with nothing behind it, and one escaping the tree, are neither
		expect(r).toMatchObject({ linked: ['node_modules', 'apps/docs/node_modules'], missing: [] })
		expect(fs.lstatSync(join(r.worktree, 'apps/docs/node_modules')).isSymbolicLink()).toBe(true)
		expect(git(r.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe('ai-7-add-thing')
		expect(git(r.worktree, 'status', '--porcelain')).toBe('')
		// idempotent: a second worktree does not append the line again
		await runLoopWorktreeAdd('ai-8-other', { root, base: 'main' })
		const exclude = fs.readFileSync(join(root, '.git/info/exclude'), 'utf8')
		expect(exclude.split('\n').filter((l) => l === 'node_modules')).toHaveLength(1)
	})

	it('reports needsInstall when the repo declares no symlink list', async () => {
		const root = checkout(newTmpDir())
		const r = await runLoopWorktreeAdd('ai-7-add-thing', { root, base: 'main' })
		expect(r).toMatchObject({ exitCode: 0, needsInstall: true, linked: [] })
	})

	it('fails when an entry cannot be linked', async () => {
		const root = checkout(newTmpDir(), ['node_modules'])
		// something already sits where the link must go
		const r = await runLoopWorktreeAdd('ai-7-add-thing', {
			root,
			base: 'main',
			git: async (args) => {
				const out = git(root, ...args)
				fs.ensureDirSync(join(args[2] as string, 'node_modules'))
				return out
			},
		})
		expect(r).toMatchObject({ exitCode: 1, missing: ['node_modules'] })
	})

	it('fails when the branch already exists', async () => {
		const root = checkout(newTmpDir())
		git(root, 'branch', 'ai-7-add-thing')
		const r = await runLoopWorktreeAdd('ai-7-add-thing', { root, base: 'main' })
		expect(r.exitCode).toBe(1)
		expect(fs.existsSync(r.worktree)).toBe(false)
	})

	it.each(['../ai-7-x', 'ai-7', 'ai-x-thing', '--force'])('rejects slug %s', async (slug) => {
		const root = checkout(newTmpDir())
		const r = await runLoopWorktreeAdd(slug, { root, base: 'main', git: async () => '' })
		expect(r.exitCode).toBe(1)
	})

	it('rejects a base that git would read as an option', async () => {
		const root = checkout(newTmpDir())
		const r = await runLoopWorktreeAdd('ai-7-x', { root, base: '--detach', git: async () => '' })
		expect(r.exitCode).toBe(1)
		expect(r.messages[0]).toMatch(/not a ref/)
	})
})
