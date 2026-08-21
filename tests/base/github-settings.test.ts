import { join } from 'node:path'
import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
	addJobEnvironment,
	applyGithubSettings,
	applyReleaseEnvironment,
	buildGhApplyCommands,
	checkGitHubSettings,
	type GhExec,
	type GhResult,
	jobEnvironment,
	releaseUsesGitPlugin,
	workflowJobs,
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

/** A repo carrying a release.config.mjs, for the #419 collision checks. */
function repoWithRelease(source: string): string {
	const dir = gitRepo()
	fs.writeFileSync(join(dir, 'release.config.mjs'), source)
	return dir
}

const WITH_GIT_PLUGIN = `export default {
	plugins: ['@semantic-release/npm', ['@semantic-release/git', { assets: ['package.json'] }]],
}
`

/** The remedy's own shape: the plugin name appears, filtered out of the array. */
const FILTERS_GIT_PLUGIN = `const DROPPED = new Set(['@semantic-release/git', '@semantic-release/changelog'])
const preset = { plugins: ['@semantic-release/npm', '@semantic-release/git'] }
export default {
	...preset,
	plugins: preset.plugins.filter((p) => !DROPPED.has(Array.isArray(p) ? p[0] : p)),
}
`

/** default-setup reads `not-configured` unless overridden → CodeQL gate no-ops. */
const CODEQL_OFF = JSON.stringify({ state: 'not-configured' })
const CODEQL_ON = JSON.stringify({ state: 'configured' })

/** CodeQL on, with an active code_scanning ruleset covering the default branch. */
const ACTIVE_GATE = {
	defaultSetup: ok(CODEQL_ON),
	rulesets: ok(JSON.stringify([{ id: 7, target: 'branch', enforcement: 'active' }])),
	rulesetDetail: ok(
		JSON.stringify({
			rules: [{ type: 'code_scanning' }],
			conditions: { ref_name: { include: ['~DEFAULT_BRANCH'] } },
		})
	),
}

interface GhOverrides {
	repo?: GhResult
	protection?: GhResult
	workflow?: GhResult
	defaultSetup?: GhResult
	rulesets?: GhResult
	rulesetDetail?: GhResult
	environments?: GhResult
}

/** No environments configured — the shape the REST endpoint returns. */
const NO_ENVIRONMENTS = JSON.stringify({ total_count: 0, environments: [] })

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
		if (p?.endsWith('/environments')) return overrides.environments ?? ok(NO_ENVIRONMENTS)
		return fail('unexpected call')
	})
}

const byName = (results: { check: string }[], name: string) => results.find((r) => r.check === name)

describe('checkGitHubSettings — skip paths', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh()
		const results = await checkGitHubSettings(newTmpDir(), exec)
		expect(exec).not.toHaveBeenCalled()
		expect(results).toHaveLength(6)
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
		expect(results).toHaveLength(6)
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
		const exec = fakeGh(ACTIVE_GATE)
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

	it('drifts when the gate is in place but the release config still pushes to it (#419)', async () => {
		const dir = repoWithRelease(WITH_GIT_PLUGIN)
		const g = gate(await checkGitHubSettings(dir, fakeGh(ACTIVE_GATE)))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('GH013')
		expect(g?.hint).toContain('@semantic-release/changelog')
	})

	it('names the collision in the hint when the gate is still missing (#419)', async () => {
		const dir = repoWithRelease(WITH_GIT_PLUGIN)
		const exec = fakeGh({ defaultSetup: ok(CODEQL_ON), rulesets: ok('[]') })
		const g = gate(await checkGitHubSettings(dir, exec))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('High alerts stay advisory')
		expect(g?.hint).toContain('GH013')
	})
})

describe('checkGitHubSettings — release environment gate (#429)', () => {
	/** A workflow whose `release` job publishes; `env` adds an `environment:`. */
	function workflow(env?: string): string {
		return `name: CI

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    # A pages deploy carries its own environment — a whole-file grep would read
    # this as the release gate.
    environment:
      name: github-pages
      url: https://example.invalid
    steps:
      - name: Build
        run: pnpm build

  release:
    runs-on: ubuntu-latest
    needs: build
${env ? `    environment: ${env}\n` : ''}    steps:
      - name: Publish
        run: npx semantic-release
`
	}

	/** A git repo with the given workflow (and, by default, a public package). */
	function repoWithWorkflow(yaml: string, pkg: Record<string, unknown> = {}): string {
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows/ci.yml'), yaml)
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing', ...pkg })
		return dir
	}

	const environments = (...names: Array<[string, boolean]>) =>
		ok(
			JSON.stringify({
				total_count: names.length,
				environments: names.map(([name, reviewers]) => ({
					name,
					protection_rules: reviewers ? [{ type: 'required_reviewers' }] : [],
				})),
			})
		)

	const gate = (r: { check: string }[]) => byName(r, 'Release gate')
	const env = (r: { check: string }[]) => byName(r, 'Release environment')

	it('is not applicable when nothing publishes', async () => {
		const results = await checkGitHubSettings(gitRepo(), fakeGh())
		expect(gate(results)?.status).toBe('ok')
		expect(gate(results)?.detail).toContain('no workflow job publishes')
		expect(env(results)?.status).toBe('ok')
	})

	it('is not applicable for a private package that runs semantic-release', async () => {
		const dir = repoWithWorkflow(workflow(), { private: true })
		expect(gate(await checkGitHubSettings(dir, fakeGh()))?.detail).toContain('not applicable')
	})

	it('drifts when the publish job has no environment and none exists', async () => {
		const dir = repoWithWorkflow(workflow())
		const g = gate(await checkGitHubSettings(dir, fakeGh()))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('no `environment:`')
		expect(g?.hint).toContain('required reviewers')
	})

	it('flags a `release` environment that no job references (#429, the decorative gate)', async () => {
		const dir = repoWithWorkflow(workflow())
		const exec = fakeGh({ environments: environments(['release', true]) })
		const results = await checkGitHubSettings(dir, exec)
		expect(env(results)?.status).toBe('drift')
		expect(env(results)?.detail).toContain('gates nothing')
		// Exactly one finding for one root cause: the gate check defers.
		expect(gate(results)?.status).toBe('ok')
	})

	it('ignores a job that only mentions publishing in a comment', async () => {
		// Caught dogfooding this check on repo-tooling's own ci.yml: a `varcheck`
		// job whose shell block ends `# npm publish uses OIDC trusted publishing`
		// was reported as the publishing job.
		const dir = repoWithWorkflow(`name: CI

on: [push]

jobs:
  varcheck:
    runs-on: ubuntu-latest
    steps:
      - name: Check env
        run: |
          echo "checking"
          # npm publish uses OIDC trusted publishing (no NPM_TOKEN needed).

  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - run: npx semantic-release
`)
		const exec = fakeGh({ environments: environments(['release', true]) })
		const g = gate(await checkGitHubSettings(dir, exec))
		expect(g?.status).toBe('ok')
		expect(g?.detail).toContain('`release`')
	})

	it('does not read another job’s environment as the release gate', async () => {
		// `build` declares `github-pages`; `release` declares nothing.
		const dir = repoWithWorkflow(workflow())
		const exec = fakeGh({ environments: environments(['github-pages', true]) })
		expect(gate(await checkGitHubSettings(dir, exec))?.status).toBe('drift')
	})

	it('is ok when the publish job runs behind an environment with required reviewers', async () => {
		const dir = repoWithWorkflow(workflow('release'))
		const exec = fakeGh({ environments: environments(['release', true]) })
		const results = await checkGitHubSettings(dir, exec)
		expect(gate(results)?.status).toBe('ok')
		expect(gate(results)?.detail).toContain('required reviewers')
		expect(env(results)?.status).toBe('ok')
	})

	it('drifts when the referenced environment has no required_reviewers', async () => {
		const dir = repoWithWorkflow(workflow('release'))
		const exec = fakeGh({ environments: environments(['release', false]) })
		const g = gate(await checkGitHubSettings(dir, exec))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('no required_reviewers')
	})

	it('drifts when the job names an environment the repo does not have', async () => {
		// Actions creates it unprotected on first run, so it holds nothing.
		const dir = repoWithWorkflow(workflow('release'))
		const g = gate(await checkGitHubSettings(dir, fakeGh()))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('does not have')
	})

	it('skips (ok) when the environments endpoint cannot be read', async () => {
		const dir = repoWithWorkflow(workflow())
		const exec = fakeGh({ environments: fail('gh: (HTTP 403)') })
		const results = await checkGitHubSettings(dir, exec)
		expect(gate(results)?.status).toBe('ok')
		expect(gate(results)?.detail).toContain('skipped')
		expect(env(results)?.status).toBe('ok')
	})

	it('reads a 404 from the environments endpoint as "none", not unreadable', async () => {
		const dir = repoWithWorkflow(workflow())
		const exec = fakeGh({ environments: fail('gh: Not Found (HTTP 404)') })
		expect(gate(await checkGitHubSettings(dir, exec))?.status).toBe('drift')
	})

	it('skips, not "nothing publishes", when the workflows directory is unreadable', async () => {
		// The fail-open this check exists to avoid: an unreadable input must never
		// report as `ok`/not-applicable, which reads as "you have a gate" on a repo
		// whose workflows were never inspected. A file where the directory belongs
		// makes readdir fail with ENOTDIR without needing chmod (root would ignore).
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows'), 'not a directory\n')
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		const results = await checkGitHubSettings(dir, fakeGh())
		for (const r of [gate(results), env(results)]) {
			expect(r?.detail).toContain('skipped')
			expect(r?.detail).toContain('could not read .github/workflows')
			expect(r?.detail).not.toContain('not applicable')
		}
	})
})

describe('workflowJobs / jobEnvironment', () => {
	const YAML = `name: CI

on: [push]

jobs:
  build:
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - name: Build
        run: pnpm build

  release:
    runs-on: ubuntu-latest
    environment:
      name: 'release'
      url: https://npmjs.com
    steps:
      - name: Publish
        run: npm publish

permissions:
  contents: read
`

	it('splits jobs and stops at the next top-level key', () => {
		expect([...workflowJobs(YAML).keys()]).toEqual(['build', 'release'])
		expect(workflowJobs(YAML).get('release')).not.toContain('contents: read')
	})

	it('reads both the scalar and the block form of environment', () => {
		const jobs = workflowJobs(YAML)
		expect(jobEnvironment(jobs.get('build') ?? '')).toBe('staging')
		// Quoted, in block form, with step `- name:` entries below it.
		expect(jobEnvironment(jobs.get('release') ?? '')).toBe('release')
	})

	it('is not truncated by a column-0 comment inside the jobs block', () => {
		// A comment ends no block, so it must not stand in for the next top-level key.
		const jobs = workflowJobs(`jobs:
# unusual, but valid YAML
  release:
    environment: release
    steps:
      - run: npm publish
`)
		expect([...jobs.keys()]).toEqual(['release'])
		expect(jobEnvironment(jobs.get('release') ?? '')).toBe('release')
	})

	it('is null for a job with no environment, and empty for a workflow with no jobs', () => {
		expect(jobEnvironment('    runs-on: ubuntu-latest\n    steps:\n      - run: true')).toBeNull()
		expect(workflowJobs('name: nothing\n').size).toBe(0)
	})
})

describe('releaseUsesGitPlugin (#419)', () => {
	it('is true when the resolved plugins include the git plugin', async () => {
		expect(await releaseUsesGitPlugin(repoWithRelease(WITH_GIT_PLUGIN))).toBe(true)
	})

	it('is false when a config lists the plugin only to filter it out', async () => {
		// The documented way to drop it names the plugin in a Set, so any
		// text-level grep reports this backwards. Only the resolved array is right.
		expect(await releaseUsesGitPlugin(repoWithRelease(FILTERS_GIT_PLUGIN))).toBe(false)
	})

	it('is false when there is no release config at all', async () => {
		expect(await releaseUsesGitPlugin(gitRepo())).toBe(false)
	})

	it('is false (never a wrong warning) when the config throws on import', async () => {
		expect(await releaseUsesGitPlugin(repoWithRelease('throw new Error("boom")\n'))).toBe(false)
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

	it('does not POST a duplicate when the gate exists and the config collides (#419)', async () => {
		// That combination is drift on the check side now, so the POST must not
		// key off the check's status.
		const { exec, calls } = recordingGh(ACTIVE_GATE)
		const labels = await applyGithubSettings(repoWithRelease(WITH_GIT_PLUGIN), exec)
		expect(labels).not.toContain('code-scanning ruleset on main')
		expect(
			calls.some((c) => c.args.some((a) => a.endsWith('/rulesets')) && c.args.includes('POST'))
		).toBe(false)
	})

	it('warns about the git plugin while still installing the ruleset (#419)', async () => {
		const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			const { exec } = recordingGh({ defaultSetup: ok(CODEQL_ON), rulesets: ok('[]') })
			const labels = await applyGithubSettings(repoWithRelease(WITH_GIT_PLUGIN), exec)
			expect(labels).toContain('code-scanning ruleset on main')
			const said = warn.mock.calls.flat().join('\n')
			expect(said).toContain('GH013')
			expect(said).toContain('@semantic-release/git')
		} finally {
			warn.mockRestore()
		}
	})

	it('stays quiet when the release config has no git plugin (#419)', async () => {
		const warn = vi.spyOn(console, 'error').mockImplementation(() => {})
		try {
			const { exec } = recordingGh(ACTIVE_GATE)
			await applyGithubSettings(repoWithRelease(FILTERS_GIT_PLUGIN), exec)
			expect(warn.mock.calls.flat().join('\n')).not.toContain('GH013')
		} finally {
			warn.mockRestore()
		}
	})
})

describe('addJobEnvironment (#429)', () => {
	const YAML = `name: CI

on:
  push:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: pnpm build

  release:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - run: npx semantic-release
`

	it('inserts environment as the first key of the named job, matching its indent', () => {
		const out = addJobEnvironment(YAML, 'release', 'release')
		expect(out).toContain('  release:\n    environment: release\n    runs-on: ubuntu-latest')
		// The other job is untouched.
		expect(out).toContain('  build:\n    runs-on: ubuntu-latest')
	})

	it('returns null for a job that does not exist', () => {
		expect(addJobEnvironment(YAML, 'publish', 'release')).toBeNull()
	})

	it('returns null when there is no jobs block', () => {
		expect(addJobEnvironment('name: CI\n', 'release', 'release')).toBeNull()
	})

	it('never matches a nested key with the job name', () => {
		const nested = `jobs:
  build:
    steps:
      - run: echo hi
    release:
      inner: true
`
		// `release:` exists only nested inside `build` — not a job header.
		expect(addJobEnvironment(nested, 'release', 'release')).toBeNull()
	})
})

describe('applyReleaseEnvironment (#429)', () => {
	function releaseWorkflow(env?: string): string {
		return `name: CI

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
${env ? `    environment: ${env}\n` : ''}    steps:
      - run: npx semantic-release
`
	}

	function publishRepo(env?: string): string {
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows/release.yml'), releaseWorkflow(env))
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		return dir
	}

	/** Routes by inspecting the full args array — the PUT's path is not args[1]. */
	function applyGh(overrides: { environments?: GhResult; put?: GhResult } = {}) {
		const puts: Array<{ path: string; stdin?: string }> = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			const path = args.find((a) => a.startsWith('repos/') || a === 'user') ?? ''
			if (args.includes('PUT')) {
				puts.push({ path, stdin })
				return overrides.put ?? ok('{}')
			}
			if (path === 'repos/{owner}/{repo}') return ok(COMPLIANT_REPO)
			if (path === 'user') return ok('12345\n')
			if (path.endsWith('/environments')) return overrides.environments ?? ok(NO_ENVIRONMENTS)
			return fail('unexpected call')
		})
		return { exec, puts }
	}

	it('creates the environment with the authenticated user and wires the job', async () => {
		const dir = publishRepo()
		const { exec, puts } = applyGh()

		const applied = await applyReleaseEnvironment(dir, exec)
		expect(puts).toHaveLength(1)
		expect(puts[0]?.path).toMatch(/\/environments\/release$/)
		expect(JSON.parse(puts[0]?.stdin ?? '')).toEqual({
			reviewers: [{ type: 'User', id: 12345 }],
		})
		const yaml = fs.readFileSync(join(dir, '.github/workflows/release.yml'), 'utf-8')
		expect(yaml).toContain('  release:\n    environment: release\n    runs-on:')
		expect(applied).toHaveLength(2)
	})

	it('adds reviewers to an existing unprotected release environment', async () => {
		const dir = publishRepo('release')
		const { exec, puts } = applyGh({
			environments: ok(
				JSON.stringify({
					total_count: 1,
					environments: [{ name: 'release', protection_rules: [] }],
				})
			),
		})

		const applied = await applyReleaseEnvironment(dir, exec)
		expect(puts).toHaveLength(1)
		expect(applied).toHaveLength(1)
	})

	it('is a no-op when the gate is already complete', async () => {
		const dir = publishRepo('release')
		const { exec, puts } = applyGh({
			environments: ok(
				JSON.stringify({
					total_count: 1,
					environments: [{ name: 'release', protection_rules: [{ type: 'required_reviewers' }] }],
				})
			),
		})

		expect(await applyReleaseEnvironment(dir, exec)).toEqual([])
		expect(puts).toHaveLength(0)
	})

	it('never renames a job already behind a different environment', async () => {
		const dir = publishRepo('production')
		const { exec, puts } = applyGh()

		expect(await applyReleaseEnvironment(dir, exec)).toEqual([])
		expect(puts).toHaveLength(0)
	})

	it('does nothing when nothing publishes', async () => {
		const { exec, puts } = applyGh()
		expect(await applyReleaseEnvironment(gitRepo(), exec)).toEqual([])
		expect(puts).toHaveLength(0)
	})
})
