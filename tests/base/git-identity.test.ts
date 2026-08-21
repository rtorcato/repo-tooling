import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkGitIdentity, classifyGitEmail, type GitExec } from '../../src/base/git-identity.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** The cheap .git gate must pass before git is consulted. */
function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

const emailIs =
	(email: string | null): GitExec =>
	async () =>
		email

// checkGitIdentity self-skips under CI, which is exactly where these run.
const realCi = process.env.CI
beforeEach(() => {
	process.env.CI = ''
})
afterEach(() => {
	if (realCi === undefined) delete process.env.CI
	else process.env.CI = realCi
})

describe('classifyGitEmail', () => {
	it('accepts a real address', () => {
		expect(classifyGitEmail('rtorcato@me.com')).toBe('ok')
		expect(classifyGitEmail('richard@sub.domain.co.uk')).toBe('ok')
		// The forge's own noreply address is legitimate and must not warn.
		expect(classifyGitEmail('1234+user@users.noreply.github.com')).toBe('ok')
	})

	it('treats unset and whitespace as unset', () => {
		expect(classifyGitEmail(null)).toBe('unset')
		expect(classifyGitEmail(undefined)).toBe('unset')
		expect(classifyGitEmail('')).toBe('unset')
		expect(classifyGitEmail('   ')).toBe('unset')
	})

	it('flags the reserved placeholder domains that caused #327', () => {
		expect(classifyGitEmail('richardtorcato@example.com')).toBe('placeholder')
		expect(classifyGitEmail('a@example.org')).toBe('placeholder')
		expect(classifyGitEmail('a@example.net')).toBe('placeholder')
		expect(classifyGitEmail('a@mail.example.com')).toBe('placeholder')
		expect(classifyGitEmail('a@anything.invalid')).toBe('placeholder')
	})

	it('flags hostname-derived addresses', () => {
		expect(classifyGitEmail('richardtorcato@Richards-Mini.matrix')).toBe('generated')
		expect(classifyGitEmail('richard@Richards-Mini.local')).toBe('generated')
		// No dot in the domain at all.
		expect(classifyGitEmail('richard@laptop')).toBe('generated')
	})

	it('flags anything that is not an address', () => {
		expect(classifyGitEmail('Richard Torcato')).toBe('generated')
		expect(classifyGitEmail('@example.com')).toBe('generated')
	})

	it('is case-insensitive', () => {
		expect(classifyGitEmail('A@EXAMPLE.COM')).toBe('placeholder')
		expect(classifyGitEmail('A@Richards-Mini.MATRIX')).toBe('generated')
	})
})

describe('checkGitIdentity', () => {
	it('passes a real identity', async () => {
		const r = await checkGitIdentity(gitRepo(), emailIs('rtorcato@me.com'))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('rtorcato@me.com')
	})

	// The whole point: a warning, never a gate. 'drift'/'missing' exit 1, and the
	// identity is the operator's, not the repo's.
	it('never returns a status that fails the doctor exit code', async () => {
		for (const email of [null, 'a@example.com', 'a@host.local']) {
			const r = await checkGitIdentity(gitRepo(), emailIs(email))
			expect(r.status).toBe('optional-missing')
			expect(r.hint).toBeTruthy()
		}
	})

	it('skips a non-git directory without consulting git', async () => {
		let called = false
		const spy: GitExec = async () => {
			called = true
			return 'a@example.com'
		}
		const r = await checkGitIdentity(newTmpDir(), spy)
		expect(r.status).toBe('ok')
		expect(called).toBe(false)
	})

	it('skips on CI, where the identity belongs to the runner', async () => {
		process.env.CI = 'true'
		const r = await checkGitIdentity(gitRepo(), emailIs('a@example.com'))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('CI')
	})
})
