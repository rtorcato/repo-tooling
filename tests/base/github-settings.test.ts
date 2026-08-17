import { join } from 'node:path'
import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	applyGithubSettings,
	buildGhApplyCommands,
	checkGitHubSettings,
	type GhExec,
	type GhResult,
} from '../../src/base/github-settings.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** A git repo (doctor's cheap .git gate must pass before gh runs). */
function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

const ok = (stdout: string): GhResult => ({ ok: true, stdout, stderr: '', code: 0 })
const fail = (stderr: string, code: number | null = 1): GhResult => ({
	ok: false,
	stdout: '',
	stderr,
	code,
})

// The probe reads the REST repo endpoint (gh api repos/{owner}/{repo}), whose
// field names are snake_case and include allow_auto_merge — unlike gh repo view.
const COMPLIANT_REPO = JSON.stringify({
	full_name: 'owner/repo',
	default_branch: 'main',
	allow_auto_merge: true,
	allow_squash_merge: true,
	delete_branch_on_merge: true,
	// Squash-only: the other two methods are off, not merely unused (#410).
	allow_merge_commit: false,
	allow_rebase_merge: false,
})
const COMPLIANT_PROTECTION = JSON.stringify({
	required_status_checks: { strict: false, contexts: ['lint', 'typecheck', 'build', 'test'] },
	enforce_admins: { enabled: false },
	allow_force_pushes: { enabled: false },
	allow_deletions: { enabled: false },
	required_pull_request_reviews: null,
})
const COMPLIANT_WORKFLOW = JSON.stringify({
	default_workflow_permissions: 'read',
	can_approve_pull_request_reviews: false,
})

/** default-setup reads `not-configured` unless overridden → CodeQL gate no-ops. */
const CODEQL_OFF = JSON.stringify({ state: 'not-configured' })
const CODEQL_ON = JSON.stringify({ state: 'configured' })

interface GhOverrides {
	repo?: GhResult
	protection?: GhResult
	workflow?: GhResult
	defaultSetup?: GhResult
	rulesets?: GhResult
	rulesetDetail?: GhResult
}

/** Route canned responses by which gh api path is invoked. */
function fakeGh(overrides: GhOverrides = {}): GhExec {
	return vi.fn(async (args: string[]) => {
		const p = args[1]
		if (p === 'repos/{owner}/{repo}') return overrides.repo ?? ok(COMPLIANT_REPO)
		if (p?.includes('/protection')) return overrides.protection ?? ok(COMPLIANT_PROTECTION)
		if (p?.includes('/actions/permissions/workflow'))
			return overrides.workflow ?? ok(COMPLIANT_WORKFLOW)
		if (p?.includes('/code-scanning/default-setup')) return overrides.defaultSetup ?? ok(CODEQL_OFF)
		if (p?.includes('/rulesets/')) return overrides.rulesetDetail ?? ok('{}')
		if (p?.endsWith('/rulesets')) return overrides.rulesets ?? ok('[]')
		return fail('unexpected call')
	})
}

const byName = (results: { check: string }[], name: string) => results.find((r) => r.check === name)

describe('checkGitHubSettings — skip paths', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh()
		const results = await checkGitHubSettings(newTmpDir(), exec)
		expect(exec).not.toHaveBeenCalled()
		expect(results).toHaveLength(4)
		expect(results.every((r) => r.status === 'ok' && r.detail.includes('skipped'))).toBe(true)
	})

	it('skips all three when gh is not installed', async () => {
		const exec = fakeGh({ repo: fail('spawn gh ENOENT', null) })
		const results = await checkGitHubSettings(gitRepo(), exec)
		expect(results.every((r) => r.status === 'ok')).toBe(true)
		expect(byName(results, 'Branch protection')?.detail).toContain('gh not installed')
	})

	it('skips when the probe fails (no GitHub remote / not authed)', async () => {
		const exec = fakeGh({ repo: fail('gh auth login required') })
		const results = await checkGitHubSettings(gitRepo(), exec)
		expect(results.every((r) => r.status === 'ok' && r.detail.includes('skipped'))).toBe(true)
	})
})

describe('checkGitHubSettings — compliant repo', () => {
	it('reports all three ok when settings match the standard', async () => {
		const results = await checkGitHubSettings(gitRepo(), fakeGh())
		expect(results).toHaveLength(4)
		expect(results.every((r) => r.status === 'ok')).toBe(true)
		expect(byName(results, 'Branch protection')?.detail).toContain('protected per standard')
	})
})

describe('checkGitHubSettings — code-scanning gate (#269)', () => {
	const gate = (r: GhResult[] | { check: string }[]) =>
		byName(r as { check: string }[], 'Code-scanning gate')

	it('no-ops as ok when CodeQL is not enabled', async () => {
		const g = gate(await checkGitHubSettings(gitRepo(), fakeGh()))
		expect(g?.status).toBe('ok')
		expect(g?.detail).toContain('CodeQL not enabled')
	})

	it('drifts when CodeQL is on but no active ruleset requires code-scanning', async () => {
		const exec = fakeGh({ defaultSetup: ok(CODEQL_ON), rulesets: ok('[]') })
		const g = gate(await checkGitHubSettings(gitRepo(), exec))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('High alerts stay advisory')
	})

	it('is ok when an active ruleset enforces code-scanning on the default branch', async () => {
		const exec = fakeGh({
			defaultSetup: ok(CODEQL_ON),
			rulesets: ok(JSON.stringify([{ id: 7, target: 'branch', enforcement: 'active' }])),
			rulesetDetail: ok(
				JSON.stringify({
					rules: [{ type: 'code_scanning' }],
					conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
				})
			),
		})
		const g = gate(await checkGitHubSettings(gitRepo(), exec))
		expect(g?.status).toBe('ok')
		expect(g?.detail).toContain('requires code-scanning on main')
	})

	it('ignores an inactive or non-default-branch ruleset (still drift)', async () => {
		const exec = fakeGh({
			defaultSetup: ok(CODEQL_ON),
			// A code_scanning ruleset that targets a different branch → does not count.
			rulesets: ok(JSON.stringify([{ id: 9, target: 'branch', enforcement: 'active' }])),
			rulesetDetail: ok(
				JSON.stringify({
					rules: [{ type: 'code_scanning' }],
					conditions: { ref_name: { include: ['refs/heads/release'] } },
				})
			),
		})
		expect(gate(await checkGitHubSettings(gitRepo(), exec))?.status).toBe('drift')
	})

	it('skips (ok) when rulesets cannot be read', async () => {
		const exec = fakeGh({ defaultSetup: ok(CODEQL_ON), rulesets: fail('gh: (HTTP 403)') })
		const g = gate(await checkGitHubSettings(gitRepo(), exec))
		expect(g?.status).toBe('ok')
		expect(g?.detail).toContain('skipped')
	})
})

describe('checkGitHubSettings — drift', () => {
	it('flags an unprotected default branch as optional-missing on 404', async () => {
		const exec = fakeGh({ protection: fail('gh: Not Found (HTTP 404)') })
		const results = await checkGitHubSettings(gitRepo(), exec)
		const bp = byName(results, 'Branch protection')
		expect(bp?.status).toBe('optional-missing')
		expect(bp?.detail).toContain('unprotected')
	})

	it('skips branch protection (not drift) when the token lacks admin (403)', async () => {
		const exec = fakeGh({ protection: fail('gh: Must have admin rights (HTTP 403)') })
		const bp = byName(await checkGitHubSettings(gitRepo(), exec), 'Branch protection')
		expect(bp?.status).toBe('ok')
		expect(bp?.detail).toContain('skipped')
	})

	it('drifts when a required status check is missing', async () => {
		const protection = ok(
			JSON.stringify({
				required_status_checks: { strict: false, contexts: ['lint', 'build', 'test'] },
				enforce_admins: { enabled: false },
				allow_force_pushes: { enabled: false },
				allow_deletions: { enabled: false },
			})
		)
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ protection })),
			'Branch protection'
		)
		expect(bp?.status).toBe('drift')
		expect(bp?.detail).toContain('typecheck')
	})

	it('accepts matrix status checks (`test (node 22)`) as satisfying `test`', async () => {
		const protection = ok(
			JSON.stringify({
				required_status_checks: {
					strict: false,
					contexts: ['lint', 'typecheck', 'build', 'test (node 22)', 'test (node 24)'],
				},
				enforce_admins: { enabled: false },
				allow_force_pushes: { enabled: false },
				allow_deletions: { enabled: false },
			})
		)
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ protection })),
			'Branch protection'
		)
		expect(bp?.status).toBe('ok')
	})

	it('drifts when merge settings are off (from the repo probe)', async () => {
		const repo = ok(
			JSON.stringify({
				full_name: 'owner/repo',
				default_branch: 'main',
				allow_auto_merge: false,
				allow_squash_merge: true,
				delete_branch_on_merge: true,
				allow_merge_commit: false,
				allow_rebase_merge: false,
			})
		)
		const ms = byName(await checkGitHubSettings(gitRepo(), fakeGh({ repo })), 'Merge settings')
		expect(ms?.status).toBe('drift')
		expect(ms?.detail).toContain('auto-merge disabled')
	})

	it('drifts when merge commits or rebase merging are still allowed (#410)', async () => {
		// Everything the old standard asked for is on — squash just isn't exclusive,
		// so the merge button still offers all three and one mis-click puts every
		// branch commit on main.
		const repo = ok(
			JSON.stringify({
				full_name: 'owner/repo',
				default_branch: 'main',
				allow_auto_merge: true,
				allow_squash_merge: true,
				delete_branch_on_merge: true,
				allow_merge_commit: true,
				allow_rebase_merge: true,
			})
		)
		const ms = byName(await checkGitHubSettings(gitRepo(), fakeGh({ repo })), 'Merge settings')
		expect(ms?.status).toBe('drift')
		expect(ms?.detail).toContain('merge commits allowed')
		expect(ms?.detail).toContain('rebase merging allowed')
	})

	it('skips (not drifts) when the token cannot see merge fields (no admin:read)', async () => {
		// A read/write token (CI's default GITHUB_TOKEN) omits the merge booleans
		// entirely — they must not be read as "disabled".
		const repo = ok(JSON.stringify({ full_name: 'owner/repo', default_branch: 'main' }))
		const ms = byName(await checkGitHubSettings(gitRepo(), fakeGh({ repo })), 'Merge settings')
		expect(ms?.status).toBe('ok')
		expect(ms?.detail).toContain('skipped')
	})

	it('drifts when default workflow permissions are write', async () => {
		const workflow = ok(
			JSON.stringify({
				default_workflow_permissions: 'write',
				can_approve_pull_request_reviews: false,
			})
		)
		const wp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ workflow })),
			'Workflow permissions'
		)
		expect(wp?.status).toBe('drift')
		expect(wp?.detail).toContain('write')
	})
})

describe('buildGhApplyCommands', () => {
	const state = { nwo: 'owner/repo', branch: 'main' }

	it('returns the exact PATCH/PUT/PUT invocations for a fully-drifted repo', () => {
		const cmds = buildGhApplyCommands({ ...state, merge: true, protection: true, workflow: true })
		expect(cmds.map((c) => c.args)).toEqual([
			[
				'api',
				'-X',
				'PATCH',
				'repos/owner/repo',
				'-F',
				'allow_auto_merge=true',
				'-F',
				'allow_squash_merge=true',
				'-F',
				'delete_branch_on_merge=true',
				'-F',
				'allow_merge_commit=false',
				'-F',
				'allow_rebase_merge=false',
			],
			['api', '-X', 'PUT', 'repos/owner/repo/branches/main/protection', '--input', '-'],
			[
				'api',
				'-X',
				'PUT',
				'repos/owner/repo/actions/permissions/workflow',
				'-f',
				'default_workflow_permissions=read',
				'-F',
				'can_approve_pull_request_reviews=false',
			],
		])
		// The protection PUT carries the standard body on stdin.
		const body = JSON.parse(cmds[1]?.stdin ?? '{}')
		expect(body.required_status_checks).toEqual({
			strict: false,
			contexts: ['lint', 'typecheck', 'build', 'test'],
		})
		expect(body.enforce_admins).toBe(false)
		expect(body.required_pull_request_reviews).toBeNull()
	})

	it('returns [] when nothing deviates', () => {
		expect(
			buildGhApplyCommands({ ...state, merge: false, protection: false, workflow: false })
		).toEqual([])
	})
})

describe('applyGithubSettings', () => {
	beforeEach(() => {
		vi.spyOn(console, 'log').mockImplementation(() => {})
	})

	/** Records every gh call; canned responses drive which deltas fire. */
	function recordingGh(overrides: GhOverrides = {}) {
		const calls: { args: string[]; stdin?: string }[] = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			calls.push({ args, stdin })
			if (args[1] === 'repos/{owner}/{repo}') return overrides.repo ?? ok(COMPLIANT_REPO)
			if (args.includes('--input')) return ok('') // protection PUT or ruleset POST
			if (args[1]?.includes('/protection')) return overrides.protection ?? ok(COMPLIANT_PROTECTION)
			if (args[1]?.includes('/actions/permissions/workflow'))
				return overrides.workflow ?? ok(COMPLIANT_WORKFLOW)
			if (args[1]?.includes('/code-scanning/default-setup'))
				return overrides.defaultSetup ?? ok(CODEQL_OFF)
			if (args[1]?.includes('/rulesets/')) return overrides.rulesetDetail ?? ok('{}')
			if (args[1]?.endsWith('/rulesets')) return overrides.rulesets ?? ok('[]')
			if (args.includes('PATCH')) return ok('') // merge PATCH
			return ok('')
		})
		return { exec, calls }
	}

	it('never spawns gh outside a git repo', async () => {
		const { exec } = recordingGh()
		expect(await applyGithubSettings(newTmpDir(), exec)).toEqual([])
		expect(exec).not.toHaveBeenCalled()
	})

	it('applies all three deltas and returns their labels, in order', async () => {
		const driftedRepo = ok(
			JSON.stringify({
				full_name: 'owner/repo',
				default_branch: 'main',
				allow_auto_merge: false,
				allow_squash_merge: false,
				delete_branch_on_merge: false,
				allow_merge_commit: true,
				allow_rebase_merge: true,
			})
		)
		const { exec, calls } = recordingGh({
			repo: driftedRepo,
			protection: fail('gh: Not Found (HTTP 404)'),
			workflow: ok(
				JSON.stringify({
					default_workflow_permissions: 'write',
					can_approve_pull_request_reviews: false,
				})
			),
		})
		const labels = await applyGithubSettings(gitRepo(), exec)
		expect(labels).toEqual([
			'merge settings (squash-only, auto-merge, delete-on-merge)',
			'branch protection on main',
			'workflow permissions (read-only)',
		])
		// The three mutating calls fire after the read probes, PATCH before the PUTs.
		const mutations = calls.filter((c) => c.args.includes('PATCH') || c.args.includes('PUT'))
		expect(mutations.map((c) => c.args[2])).toEqual(['PATCH', 'PUT', 'PUT'])
		const protectionPut = mutations.find((c) => c.args.includes('--input'))
		expect(protectionPut?.stdin).toContain('required_status_checks')
	})

	it('is a no-op on a compliant repo', async () => {
		const { exec } = recordingGh()
		expect(await applyGithubSettings(gitRepo(), exec)).toEqual([])
	})

	it('skips (no mutation) when the probe fails', async () => {
		const { exec, calls } = recordingGh({ repo: fail('gh auth login required') })
		expect(await applyGithubSettings(gitRepo(), exec)).toEqual([])
		expect(calls.every((c) => !c.args.includes('PUT') && !c.args.includes('PATCH'))).toBe(true)
	})

	it('POSTs a code-scanning ruleset when CodeQL is on and none exists (#269)', async () => {
		const { exec, calls } = recordingGh({ defaultSetup: ok(CODEQL_ON), rulesets: ok('[]') })
		const labels = await applyGithubSettings(gitRepo(), exec)
		expect(labels).toContain('code-scanning ruleset on main')
		const post = calls.find(
			(c) => c.args.includes('POST') && c.args.some((a) => a.endsWith('/rulesets'))
		)
		expect(post?.stdin).toContain('code_scanning')
	})

	it('does not POST a ruleset on a compliant CodeQL-off repo', async () => {
		const { exec, calls } = recordingGh()
		await applyGithubSettings(gitRepo(), exec)
		expect(calls.some((c) => c.args.includes('POST'))).toBe(false)
	})
})
