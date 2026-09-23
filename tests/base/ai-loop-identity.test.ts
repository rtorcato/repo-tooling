import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it, vi } from 'vitest'
import { type GhEnvExec, setupAgentIdentity } from '../../src/base/ai-loop-identity.js'
import { FixerAbort } from '../../src/base/fixers.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

function repo(agentUser?: string): string {
	const dir = newTmpDir()
	if (agentUser)
		fs.writeJsonSync(join(dir, '.repo-tooling.json'), { rules: { aiLoop: { agentUser } } })
	return dir
}

const ghAs = (login: string): GhEnvExec =>
	vi.fn(async () => ({ ok: true, stdout: `${login}\n`, stderr: '', code: 0 }))

describe('setupAgentIdentity', () => {
	it('does nothing without a configured agentUser', async () => {
		const gh = ghAs('x')
		expect(await setupAgentIdentity(repo(), { home: newTmpDir(), gh })).toEqual([])
		expect(gh).not.toHaveBeenCalled()
	})

	it('writes nothing and names the login command when the profile is missing', async () => {
		const dir = repo('some-bot')
		const home = newTmpDir()
		const err = await setupAgentIdentity(dir, { home, gh: ghAs('some-bot') }).catch((e) => e)
		expect(err).toBeInstanceOf(FixerAbort)
		expect(err.hint).toContain(`GH_CONFIG_DIR=${join(home, '.config/gh-some-bot')} gh auth login`)
		expect(fs.existsSync(join(dir, '.claude'))).toBe(false)
	})

	it('refuses a profile signed in as someone else', async () => {
		const dir = repo('some-bot')
		const profile = newTmpDir()
		const err = await setupAgentIdentity(dir, {
			home: newTmpDir(),
			ghConfigDir: profile,
			gh: ghAs('the-owner'),
		}).catch((e) => e)
		expect(err.message).toContain('signed in as the-owner')
		expect(fs.existsSync(join(dir, '.claude'))).toBe(false)
	})

	it('merges GH_CONFIG_DIR into settings.local.json and gitignores it', async () => {
		const dir = repo('some-bot')
		const profile = newTmpDir()
		fs.outputJsonSync(join(dir, '.claude/settings.local.json'), {
			permissions: { allow: ['Bash(ls)'] },
			env: { FOO: '1' },
		})
		fs.writeFileSync(join(dir, '.gitignore'), 'node_modules')
		const gh = ghAs('Some-Bot')
		const written = await setupAgentIdentity(dir, { home: newTmpDir(), ghConfigDir: profile, gh })
		expect(gh).toHaveBeenCalledWith(['api', 'user', '--jq', '.login'], { GH_CONFIG_DIR: profile })
		expect(written).toEqual(['.claude/settings.local.json', '.gitignore'])
		expect(fs.readJsonSync(join(dir, '.claude/settings.local.json'))).toEqual({
			permissions: { allow: ['Bash(ls)'] },
			env: { FOO: '1', GH_CONFIG_DIR: profile },
		})
		expect(fs.readFileSync(join(dir, '.gitignore'), 'utf-8')).toBe(
			'node_modules\n.claude/settings.local.json\n'
		)
		// Idempotent.
		expect(await setupAgentIdentity(dir, { home: newTmpDir(), ghConfigDir: profile, gh })).toEqual(
			[]
		)
	})
})
