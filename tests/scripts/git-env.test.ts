import { describe, expect, it } from 'vitest'
// @ts-expect-error — plain .mjs helper, loaded directly by scripts that run before any build
import { AMBIENT_GIT_REPO_VARS, stripAmbientGitEnv } from '../../scripts/lib/git-env.mjs'

describe('stripAmbientGitEnv', () => {
	it('removes every var git uses to override cwd/-C', () => {
		const env: Record<string, string> = { PATH: '/usr/bin', HOME: '/home/x' }
		for (const key of AMBIENT_GIT_REPO_VARS) env[key] = '/somewhere/else/.git'

		stripAmbientGitEnv(env)

		for (const key of AMBIENT_GIT_REPO_VARS) expect(env, `${key} still set`).not.toHaveProperty(key)
	})

	it('leaves unrelated vars alone', () => {
		const env = { PATH: '/usr/bin', HOME: '/home/x', GIT_AUTHOR_NAME: 'x', GIT_DIR: '/d' }
		expect(stripAmbientGitEnv(env)).toEqual({
			PATH: '/usr/bin',
			HOME: '/home/x',
			// Identity vars do not redirect which repository git operates on, so
			// stripping them would change commit authorship for no benefit.
			GIT_AUTHOR_NAME: 'x',
		})
	})

	it('covers GIT_DIR and GIT_WORK_TREE — the two that caused #500 and #519', () => {
		// Guards against the list being trimmed: these are the pair that redirect
		// `git init` and `git commit` into a repository nobody named.
		expect(AMBIENT_GIT_REPO_VARS).toEqual(expect.arrayContaining(['GIT_DIR', 'GIT_WORK_TREE']))
	})
})
