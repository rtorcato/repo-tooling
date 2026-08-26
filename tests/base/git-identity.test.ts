import { join } from 'node:path'
import fs from 'fs-extra'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
	checkGitIdentity,
	checkGitIdentityHistory,
	classifyGitEmail,
	type GitExec,
	HISTORY_SCAN_LIMIT,
} from '../../src/base/git-identity.js'
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

describe('checkGitIdentityHistory', () => {
	/** Fake git: answers the shallow probe and the bounded log, nothing else. */
	const history = (opts: { shallow?: boolean; log?: string | null }): GitExec => {
		return async (args) => {
			if (args[0] === 'rev-parse') return opts.shallow ? 'true' : 'false'
			if (args[0] === 'log') {
				expect(args).toContain(`-${HISTORY_SCAN_LIMIT}`)
				return opts.log ?? null
			}
			return null
		}
	}

	it('passes a history of real addresses, naming what was scanned', async () => {
		const r = await checkGitIdentityHistory(
			gitRepo(),
			history({ log: 'abc1234 rtorcato@me.com\ndef5678 1234+user@users.noreply.github.com' })
		)
		expect(r.status).toBe('ok')
		// "0 found" must say how far it looked, or it reads as "all history clean".
		expect(r.detail).toContain('last 2 commits')
	})

	it('reports a placeholder-authored commit in range without failing the run', async () => {
		const r = await checkGitIdentityHistory(
			gitRepo(),
			history({
				log: 'abc1234 rtorcato@me.com\ndef5678 test@example.com\n0123abc a@host.local',
			})
		)
		// Never drift/missing: history is not fixable by editing the repo.
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toContain('2 of the last 3 commits')
		expect(r.detail).toContain('def5678 (test@example.com)')
		// The hint must be honest that only a history rewrite could fix these.
		expect(r.hint).toContain('history rewrite')
	})

	it('says so on a shallow clone rather than reporting a false all-clear', async () => {
		const r = await checkGitIdentityHistory(gitRepo(), history({ shallow: true }))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('shallow clone')
	})

	it('handles a repo with no commits yet', async () => {
		const r = await checkGitIdentityHistory(gitRepo(), history({ log: null }))
		expect(r.status).toBe('ok')
		expect(r.detail).toContain('no commits')
	})

	it('skips on CI without consulting git', async () => {
		process.env.CI = 'true'
		let called = false
		const spy: GitExec = async () => {
			called = true
			return null
		}
		const r = await checkGitIdentityHistory(gitRepo(), spy)
		expect(r.status).toBe('ok')
		expect(called).toBe(false)
	})
})
