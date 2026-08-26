import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { AMBIENT_REPO_VARS } from '../../src/base/git-identity.js'
// @ts-expect-error — plain .mjs helper, loaded directly by scripts that run before any build
import { AMBIENT_GIT_REPO_VARS, stripAmbientGitEnv } from '../../scripts/lib/git-env.mjs'

/**
 * git's own answer to "which variables bind a process to one repository".
 * githooks(1) points at this list for exactly the case that corrupted this repo.
 */
const gitLocalEnvVars = (): string[] =>
	execFileSync('git', ['rev-parse', '--local-env-vars'], { encoding: 'utf8' })
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean)

describe('ambient git env stripping', () => {
	it('covers every variable the installed git calls repository-local', () => {
		// The guard against hand-curation: the first version of this list was
		// assembled by eye and missed the GIT_CONFIG* family, which redirects
		// where `git config` writes — the operation that flipped core.bare.
		// A future git that adds a variable fails here rather than silently
		// reopening the hole.
		expect(AMBIENT_GIT_REPO_VARS).toEqual(expect.arrayContaining(gitLocalEnvVars()))
	})

	it('keeps the .mjs and TypeScript copies in step', () => {
		// Two copies exist by necessity — one compiles into dist/ for consumers,
		// the other is loaded raw by .mjs scripts that run before any build.
		// Divergence is the failure this asserts against.
		expect([...AMBIENT_REPO_VARS].sort()).toEqual([...AMBIENT_GIT_REPO_VARS].sort())
	})

	it('removes every listed variable', () => {
		const env: Record<string, string> = { PATH: '/usr/bin', HOME: '/home/x' }
		for (const key of AMBIENT_GIT_REPO_VARS) env[key] = '/somewhere/else'

		stripAmbientGitEnv(env)

		for (const key of AMBIENT_GIT_REPO_VARS) expect(env, `${key} still set`).not.toHaveProperty(key)
	})

	it('leaves identity and unrelated vars alone', () => {
		const env = { PATH: '/usr/bin', GIT_AUTHOR_NAME: 'x', GIT_DIR: '/d', GIT_CONFIG_COUNT: '2' }
		expect(stripAmbientGitEnv(env)).toEqual({
			PATH: '/usr/bin',
			// Identity vars do not redirect which repository git operates on, so
			// stripping them would change commit authorship for no benefit.
			GIT_AUTHOR_NAME: 'x',
		})
	})
})
