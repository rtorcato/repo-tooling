import { join } from 'node:path'
import fs from 'fs-extra'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FixerAbort } from '../../src/base/fixer-abort.js'
import {
	addJobEnvironment,
	applyGithubSettings,
	applyReleaseEnvironment,
	buildGhApplyCommands,
	checkGitHubSettings,
	departuresFromStandard,
	type GhExec,
	type GhResult,
	jobEnvironment,
	readGithubSnapshot,
	releaseUsesGitPlugin,
	removeWorkflowJob,
	workflowJobs,
} from '../../src/base/github-settings.js'
import type { GithubRules } from '../../src/cli/utils/lockfile.js'
import { useTmpDir } from '../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** A git repo (doctor's cheap .git gate must pass before gh runs). */
function gitRepo(): string {
	const dir = newTmpDir()
	fs.ensureDirSync(join(dir, '.git'))
	return dir
}

/** A git repo whose CI has the `ci` gate job, so requiring `ci` is safe (#816). */
function gitRepoWithGate(): string {
	const dir = gitRepo()
	fs.outputFileSync(
		join(dir, '.github/workflows/ci.yml'),
		'jobs:\n  ci:\n    runs-on: ubuntu-latest\n'
	)
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
	required_status_checks: { strict: false, contexts: ['ci'] },
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
	/** `repos/owner/repo/branches/main`, the non-admin fallback (#816). */
	branch?: GhResult
	workflow?: GhResult
	defaultSetup?: GhResult
	rulesets?: GhResult
	rulesetDetail?: GhResult
	environments?: GhResult
	alerts?: GhResult
	securityFixes?: GhResult
	/** `private-vulnerability-reporting`; unreadable (so unchecked) by default (#904). */
	reporting?: GhResult
	repoSecrets?: GhResult
	releaseSecrets?: GhResult
}

const FIXES_ON = JSON.stringify({ enabled: true, paused: false })

/** No environments configured — the shape the REST endpoint returns. */
const NO_ENVIRONMENTS = JSON.stringify({ total_count: 0, environments: [] })

/** Route canned responses by which gh api path is invoked. */
function fakeGh(overrides: GhOverrides = {}): GhExec {
	return vi.fn(async (args: string[]) => {
		const p = args[1]
		if (p === 'repos/{owner}/{repo}') return overrides.repo ?? ok(COMPLIANT_REPO)
		if (p?.includes('/protection')) return overrides.protection ?? ok(COMPLIANT_PROTECTION)
		if (p === 'repos/owner/repo/branches/main')
			return overrides.branch ?? ok(JSON.stringify({ protected: false }))
		if (p?.includes('/actions/permissions/workflow'))
			return overrides.workflow ?? ok(COMPLIANT_WORKFLOW)
		if (p?.includes('/code-scanning/default-setup')) return overrides.defaultSetup ?? ok(CODEQL_OFF)
		if (p?.includes('/rulesets/')) return overrides.rulesetDetail ?? ok('{}')
		if (p?.endsWith('/rulesets')) return overrides.rulesets ?? ok('[]')
		if (p?.endsWith('/environments')) return overrides.environments ?? ok(NO_ENVIRONMENTS)
		if (p?.startsWith('repos/owner/repo/actions/secrets'))
			return overrides.repoSecrets ?? fail('gh: (HTTP 403)')
		if (p?.startsWith('repos/owner/repo/environments/release/secrets'))
			return overrides.releaseSecrets ?? fail('gh: Not Found (HTTP 404)')
		if (p?.endsWith('/vulnerability-alerts')) return overrides.alerts ?? ok('')
		if (p?.endsWith('/automated-security-fixes')) return overrides.securityFixes ?? ok(FIXES_ON)
		if (p?.endsWith('/private-vulnerability-reporting') && overrides.reporting)
			return overrides.reporting
		return fail('unexpected call')
	})
}

const byName = (results: { check: string }[], name: string) => results.find((r) => r.check === name)

describe('checkGitHubSettings — skip paths', () => {
	it('never spawns gh outside a git repo', async () => {
		const exec = fakeGh()
		const results = await checkGitHubSettings(newTmpDir(), exec)
		expect(exec).not.toHaveBeenCalled()
		expect(results).toHaveLength(8)
		expect(results.every((r) => r.status === 'skipped' && r.detail.includes('skipped'))).toBe(true)
	})

	it('skips all checks as skipped (not ok) when gh is not installed', async () => {
		const exec = fakeGh({ repo: fail('spawn gh ENOENT', null) })
		const results = await checkGitHubSettings(gitRepo(), exec)
		expect(results.every((r) => r.status === 'skipped')).toBe(true)
		expect(byName(results, 'Branch protection')?.detail).toContain('gh not installed')
	})

	it('skips when the probe fails (no GitHub remote / not authed)', async () => {
		const exec = fakeGh({ repo: fail('gh auth login required') })
		const results = await checkGitHubSettings(gitRepo(), exec)
		expect(results.every((r) => r.status === 'skipped' && r.detail.includes('skipped'))).toBe(true)
		expect(byName(results, 'Branch protection')?.detail).toContain('gh not authenticated')
	})
})

describe('checkGitHubSettings — compliant repo', () => {
	it('reports all three ok when settings match the standard', async () => {
		const results = await checkGitHubSettings(gitRepo(), fakeGh())
		expect(results).toHaveLength(8)
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

	it('skips when rulesets cannot be read', async () => {
		const exec = fakeGh({ defaultSetup: ok(CODEQL_ON), rulesets: fail('gh: (HTTP 403)') })
		const g = gate(await checkGitHubSettings(gitRepo(), exec))
		expect(g?.status).toBe('skipped')
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

	it('checks a private monorepo root whose workspace package publishes (#808)', async () => {
		const dir = repoWithWorkflow(
			`name: Release

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: changesets/action@v1
        with:
          publish: pnpm release
`,
			{ private: true }
		)
		fs.outputFileSync(join(dir, 'pnpm-workspace.yaml'), "packages:\n  - 'packages/*'\n")
		fs.outputJsonSync(join(dir, 'packages/a/package.json'), { name: 'a', private: true })
		fs.outputJsonSync(join(dir, 'packages/b/package.json'), { name: 'b' })
		const g = gate(await checkGitHubSettings(dir, fakeGh()))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('no `environment:`')
	})

	it('is not applicable when every workspace package is private too (#808)', async () => {
		const dir = repoWithWorkflow(workflow(), { private: true, workspaces: ['packages/**'] })
		fs.outputJsonSync(join(dir, 'packages/a/package.json'), { name: 'a', private: true })
		// A public package under node_modules is a dependency, not a workspace.
		fs.outputJsonSync(join(dir, 'packages/a/node_modules/dep/package.json'), { name: 'dep' })
		expect(gate(await checkGitHubSettings(dir, fakeGh()))?.detail).toContain('not applicable')
	})

	it('audits from the git root when run on a workspace package (#811)', async () => {
		const dir = repoWithWorkflow(workflow(), { private: true, workspaces: ['packages/*'] })
		fs.outputJsonSync(join(dir, 'packages/a/package.json'), { name: 'a' })
		const g = gate(await checkGitHubSettings(join(dir, 'packages/a'), fakeGh()))
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('ci.yml')
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

	it('skips when the environments endpoint cannot be read', async () => {
		const dir = repoWithWorkflow(workflow())
		const exec = fakeGh({ environments: fail('gh: (HTTP 403)') })
		const results = await checkGitHubSettings(dir, exec)
		expect(gate(results)?.status).toBe('skipped')
		expect(gate(results)?.detail).toContain('skipped')
		expect(env(results)?.status).toBe('skipped')
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

describe('checkGitHubSettings — release secrets (#754)', () => {
	function repoWithReleaseJob(): string {
		const dir = gitRepo()
		fs.outputFileSync(
			join(dir, '.github/workflows/ci.yml'),
			`name: CI

on: workflow_dispatch

jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - run: npx semantic-release
        env:
          GITHUB_TOKEN: \${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
`
		)
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		return dir
	}
	const secrets = (...names: string[]) =>
		ok(JSON.stringify({ total_count: names.length, secrets: names.map((name) => ({ name })) }))
	const check = (r: { check: string; status: string; hint?: string }[]) =>
		r.find((x) => x.check === 'Release secrets')

	it('drifts when the release job reads a repo-level secret', async () => {
		const exec = fakeGh({ repoSecrets: secrets('RELEASE_TOKEN', 'API_KEY') })
		const c = check(await checkGitHubSettings(repoWithReleaseJob(), exec))
		expect(c?.status).toBe('drift')
		expect(c?.hint).toContain('RELEASE_TOKEN')
		expect(c?.hint).toContain('Settings → Environments → release')
		expect(c?.hint).not.toContain('API_KEY')
	})

	it('is ok when the secret lives on the release environment', async () => {
		const exec = fakeGh({
			repoSecrets: secrets('API_KEY'),
			releaseSecrets: secrets('RELEASE_TOKEN'),
		})
		expect(check(await checkGitHubSettings(repoWithReleaseJob(), exec))?.status).toBe('ok')
	})

	it('is optional-missing without admin access to list secrets', async () => {
		const c = check(await checkGitHubSettings(repoWithReleaseJob(), fakeGh()))
		expect(c?.status).toBe('optional-missing')
		expect(c?.detail).toContain('needs admin')
	})

	it('does not read a 404 on repo secrets as "none set"', async () => {
		const exec = fakeGh({ repoSecrets: fail('gh: Not Found (HTTP 404)') })
		const c = check(await checkGitHubSettings(repoWithReleaseJob(), exec))
		expect(c?.status).toBe('optional-missing')
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
		expect(bp?.status).toBe('skipped')
		expect(bp?.detail).toContain('skipped')
	})

	it('drifts when the `ci` gate is not required', async () => {
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
		expect(bp?.detail).toContain('missing required checks: ci')
	})

	/** Protection requiring exactly `contexts`, everything else per the standard. */
	const requiring = (contexts: string[]) =>
		ok(
			JSON.stringify({
				required_status_checks: { strict: false, contexts },
				enforce_admins: { enabled: false },
				allow_force_pushes: { enabled: false },
				allow_deletions: { enabled: false },
			})
		)

	it('flags a matrix leg required by name (#816)', async () => {
		const protection = requiring(['ci', 'test (node 22)', 'test (24)'])
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ protection })),
			'Branch protection'
		)
		expect(bp?.status).toBe('drift')
		expect(bp?.detail).toContain('requires matrix legs by name: test (node 22), test (24)')
	})

	it('flags a required check that no CI job produces (#816)', async () => {
		const dir = gitRepo()
		fs.outputFileSync(
			join(dir, '.github/workflows/ci.yml'),
			`jobs:
  lint:
    runs-on: ubuntu-latest
  types:
    name: typecheck # tsc
    runs-on: ubuntu-latest
  ci:
    runs-on: ubuntu-latest
`
		)
		const protection = requiring(['ci', 'lint', 'typecheck', 'build', 'codecov/patch'])
		const bp = byName(await checkGitHubSettings(dir, fakeGh({ protection })), 'Branch protection')
		expect(bp?.status).toBe('drift')
		// `typecheck` is the `types` job's static name, and `codecov/patch` is an
		// external status no job id makes, so only `build` is orphaned.
		expect(bp?.detail).toContain('requires checks no CI job produces: build')
		expect(bp?.detail).not.toMatch(/produces: [^;]*(typecheck|codecov)/)
	})

	it('reads the required checks from the branch endpoint without admin (#816)', async () => {
		// A non-admin token gets a 404 on /protection even when the branch is protected.
		const exec = fakeGh({
			protection: fail('gh: Not Found (HTTP 404)'),
			branch: ok(
				JSON.stringify({
					protected: true,
					protection: { required_status_checks: { contexts: ['test (node 22)'] } },
				})
			),
		})
		const bp = byName(await checkGitHubSettings(gitRepo(), exec), 'Branch protection')
		expect(bp?.status).toBe('drift')
		expect(bp?.detail).toContain('missing required checks: ci')
		expect(bp?.detail).toContain('test (node 22)')
		expect(bp?.detail).toContain('required checks only')
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
		expect(ms?.status).toBe('skipped')
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

describe('checkGitHubSettings — security updates (#692)', () => {
	it('reports alerts and security fixes disabled as optional-missing', async () => {
		const results = await checkGitHubSettings(
			gitRepo(),
			fakeGh({
				alerts: fail('gh: Not Found (HTTP 404)'),
				securityFixes: fail('gh: Not Found (HTTP 404)'),
			})
		)
		const r = byName(results, 'Security updates')
		expect(r?.status).toBe('optional-missing')
		expect(r?.detail).toBe('vulnerability alerts disabled; automated security fixes disabled')
	})

	it('flags security fixes off while alerts are on', async () => {
		const results = await checkGitHubSettings(
			gitRepo(),
			fakeGh({ securityFixes: ok(JSON.stringify({ enabled: false, paused: false })) })
		)
		expect(byName(results, 'Security updates')?.detail).toBe('automated security fixes disabled')
	})

	it('skips when the token lacks admin access', async () => {
		const results = await checkGitHubSettings(
			gitRepo(),
			fakeGh({ alerts: fail('gh: Forbidden (HTTP 403)') })
		)
		expect(byName(results, 'Security updates')?.status).toBe('skipped')
		expect(byName(results, 'Security updates')?.detail).toContain('skipped')
	})
})

describe('private vulnerability reporting (#904)', () => {
	const ON = ok(JSON.stringify({ enabled: true }))
	const OFF = ok(JSON.stringify({ enabled: false }))
	const security = (results: { check: string }[]) =>
		byName(results, 'Security updates') as { status: string; detail: string; hint?: string }

	it('flags it off as optional-missing with a fix github-settings hint', async () => {
		const r = security(await checkGitHubSettings(gitRepo(), fakeGh({ reporting: OFF })))
		expect(r.status).toBe('optional-missing')
		expect(r.detail).toBe('private vulnerability reporting disabled')
		expect(r.hint).toContain('fix github-settings')
	})

	it('reports ok with all three on', async () => {
		const r = security(await checkGitHubSettings(gitRepo(), fakeGh({ reporting: ON })))
		expect(r.status).toBe('ok')
		expect(r.detail).toBe(
			'vulnerability alerts, automated security fixes and private vulnerability reporting on'
		)
	})

	it('leaves it unchecked when the endpoint 404s (private repo) or 403s', async () => {
		for (const reporting of [fail('gh: Not Found (HTTP 404)'), fail('gh: Forbidden (HTTP 403)')]) {
			const r = security(await checkGitHubSettings(gitRepo(), fakeGh({ reporting })))
			expect(r.status).toBe('ok')
			expect(r.detail).toBe('vulnerability alerts and automated security fixes on')
		}
	})

	it('respects a declared false and flags a repo that does not match it', async () => {
		const rules = { privateVulnerabilityReporting: false }
		const off = security(await checkGitHubSettings(gitRepo(), fakeGh({ reporting: OFF }), rules))
		expect(off.status).toBe('ok')
		expect(off.detail).toContain('private vulnerability reporting off per rules.github')
		const on = security(await checkGitHubSettings(gitRepo(), fakeGh({ reporting: ON }), rules))
		expect(on.status).toBe('drift')
		expect(on.detail).toBe(
			'private vulnerability reporting enabled (rules.github.privateVulnerabilityReporting: false)'
		)
	})

	it('builds a PUT to enable and a DELETE when the rules say false', () => {
		const base = {
			nwo: 'owner/repo',
			branch: 'main',
			merge: false,
			protection: false,
			workflow: false,
		}
		expect(buildGhApplyCommands({ ...base, reporting: true }).map((c) => c.args)).toEqual([
			['api', '-X', 'PUT', 'repos/owner/repo/private-vulnerability-reporting'],
		])
		const off = buildGhApplyCommands({
			...base,
			reporting: true,
			rules: { privateVulnerabilityReporting: false },
		})
		expect(off.map((c) => [c.label, ...c.args])).toEqual([
			[
				'private vulnerability reporting off (rules.github)',
				'api',
				'-X',
				'DELETE',
				'repos/owner/repo/private-vulnerability-reporting',
			],
		])
	})

	it('fix github-settings enables it only when it is off', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const run = async (reporting: GhResult, rules = {}) => {
			const calls: string[][] = []
			const fallback = fakeGh({ reporting })
			const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
				if (args.includes('-X')) {
					calls.push(args)
					return ok('')
				}
				return fallback(args, stdin)
			})
			return { applied: await applyGithubSettings(gitRepo(), exec, rules), calls }
		}
		expect(await run(OFF)).toEqual({
			applied: ['private vulnerability reporting'],
			calls: [['api', '-X', 'PUT', 'repos/owner/repo/private-vulnerability-reporting']],
		})
		expect(await run(ON)).toEqual({ applied: [], calls: [] })
		expect(await run(OFF, { privateVulnerabilityReporting: false })).toEqual({
			applied: [],
			calls: [],
		})
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
		expect(body.required_status_checks).toEqual({ strict: false, contexts: ['ci'] })
		expect(body.enforce_admins).toBe(false)
		expect(body.required_pull_request_reviews).toBeNull()
	})

	it('enables alerts before security fixes (#692)', () => {
		const cmds = buildGhApplyCommands({
			...state,
			merge: false,
			protection: false,
			workflow: false,
			alerts: true,
			securityFixes: true,
		})
		expect(cmds.map((c) => c.args)).toEqual([
			['api', '-X', 'PUT', 'repos/owner/repo/vulnerability-alerts'],
			['api', '-X', 'PUT', 'repos/owner/repo/automated-security-fixes'],
		])
	})

	it('never passes a non-boolean rules.github value to gh -F (#949, #956)', () => {
		const rules = {
			autoMerge: '@/etc/passwd',
			deleteOnMerge: '@/etc/passwd',
			actionsCanCreatePullRequests: '@/etc/passwd',
		} as unknown as GithubRules
		// A merge run refuses outright; nothing reaches gh.
		expect(() => buildGhApplyCommands({ ...state, rules, merge: true })).toThrow(FixerAbort)
		// The workflow write doesn't read the merge toggles, so it still builds clean.
		const args = buildGhApplyCommands({ ...state, rules, merge: false, workflow: true }).flatMap(
			(c) => c.args
		)
		expect(args.join(' ')).not.toContain('@')
		expect(args).toContain('can_approve_pull_request_reviews=false')
	})

	it.each([
		['autoMerge', 'false'],
		['deleteOnMerge', 0],
	])('refuses a non-boolean rules.github.%s instead of turning it on (#956)', (field, value) => {
		const rules = { [field]: value } as unknown as GithubRules
		const run = () => buildGhApplyCommands({ ...state, rules, merge: true })
		expect(run).toThrow(FixerAbort)
		expect(run).toThrow(
			`rules.github.${field} must be true or false in .repo-tooling.json, not ${JSON.stringify(value)}`
		)
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
			if (args[1] === 'repos/owner/repo/branches/main')
				return ok(JSON.stringify({ protected: false }))
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
		const labels = await applyGithubSettings(gitRepoWithGate(), exec)
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

	it('leaves protection alone while no CI job reports `ci` (#816)', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const { exec, calls } = recordingGh({ protection: fail('gh: Not Found (HTTP 404)') })
		expect(await applyGithubSettings(gitRepo(), exec)).not.toContain('branch protection on main')
		expect(
			calls.some((c) => c.args.includes('--input') && c.args[3]?.endsWith('/protection'))
		).toBe(false)
	})

	// #865: GitHub reports a matrix job only as its legs, and a named job only by
	// its name, so neither job id may satisfy the "some job reports it" guard.
	it.each([
		['a matrix job', 'strategy:\n      matrix:\n        node: [22, 24]\n'],
		['a flow-style matrix', 'strategy: { matrix: { node: [22, 24] } }\n'],
		['a templated name', 'name: test (node ${{ inputs.node }})\n'],
		['a static name', 'name: Unit tests\n'],
	])('will not require `test` when its only job is %s (#865)', async (_, extra) => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const dir = gitRepo()
		fs.outputFileSync(
			join(dir, '.github/workflows/ci.yml'),
			`jobs:\n  test:\n    runs-on: ubuntu-latest\n    ${extra}`
		)
		const { exec, calls } = recordingGh({ protection: fail('gh: Not Found (HTTP 404)') })
		const labels = await applyGithubSettings(dir, exec, { requiredChecks: ['test'] })
		expect(labels).not.toContain('branch protection on main')
		expect(
			calls.some((c) => c.args.includes('--input') && c.args[3]?.endsWith('/protection'))
		).toBe(false)
	})

	it('still requires a plain job by its id (#865)', async () => {
		const dir = gitRepo()
		fs.outputFileSync(
			join(dir, '.github/workflows/ci.yml'),
			'jobs:\n  test:\n    runs-on: ubuntu-latest\n'
		)
		const { exec } = recordingGh({ protection: fail('gh: Not Found (HTTP 404)') })
		expect(await applyGithubSettings(dir, exec, { requiredChecks: ['test'] })).toContain(
			'branch protection on main'
		)
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

describe('removeWorkflowJob (#761)', () => {
	it('prunes needs: lists but not a same-named branch or a trigger another job uses', () => {
		const yaml = `on:
  push:
    branches:
      - release
  milestone:
    types: [closed]
jobs:
  a:
    needs:
      - b
      - release
    if: github.event_name == 'milestone'
  b:
    runs-on: x
  release:
    if: github.event_name == 'milestone'
`
		expect(removeWorkflowJob(yaml, 'release')).toBe(`on:
  push:
    branches:
      - release
  milestone:
    types: [closed]
jobs:
  a:
    needs:
      - b
    if: github.event_name == 'milestone'
  b:
    runs-on: x
`)
	})

	it('drops a needs: the removal empties, in every form (#763)', () => {
		const job = (needs: string) => `jobs:
  a:
${needs}
    runs-on: x
  release:
    runs-on: x
`
		const bare = 'jobs:\n  a:\n    runs-on: x\n'
		expect(removeWorkflowJob(job('    needs:\n      - release'), 'release')).toBe(bare)
		expect(removeWorkflowJob(job('    needs: [release]'), 'release')).toBe(bare)
		expect(removeWorkflowJob(job('    needs: release'), 'release')).toBe(bare)
		expect(removeWorkflowJob(job("    needs: ['release']"), 'release')).toBe(bare)
		expect(removeWorkflowJob(job('    needs: [build, release]'), 'release')).toBe(
			'jobs:\n  a:\n    needs: [build]\n    runs-on: x\n'
		)
		// Block form as the job's last key, emptied at end of file.
		expect(
			removeWorkflowJob(
				'jobs:\n  release:\n    x: 1\n  a:\n    needs:\n      - release\n',
				'release'
			)
		).toBe('jobs:\n  a:\n')
		// A bare needs: the removal didn't empty is not ours to touch.
		expect(removeWorkflowJob('jobs:\n  a:\n    needs:\n  release:\n    x: 1\n', 'release')).toBe(
			'jobs:\n  a:\n    needs:\n'
		)
	})

	it('returns the input untouched when the job is absent', () => {
		expect(removeWorkflowJob('jobs:\n  a:\n    x: 1\n', 'release')).toBe('jobs:\n  a:\n    x: 1\n')
	})
})

describe('rules.github (#817)', () => {
	const RELEASE_JOB = `name: CI

on:
  push:
    branches: [main]

jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - run: npx semantic-release
`

	function releaseRepo(): string {
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows/release.yml'), RELEASE_JOB)
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		return dir
	}

	/** A gated `release` environment whose required reviewers are `logins`. */
	const releaseEnv = (...logins: string[]) =>
		ok(
			JSON.stringify({
				total_count: 1,
				environments: [
					{
						name: 'release',
						protection_rules: [
							{
								type: 'required_reviewers',
								reviewers: logins.map((login) => ({ type: 'User', reviewer: { login } })),
							},
						],
					},
				],
			})
		)

	const protection = (contexts: string[], strict = false) =>
		ok(
			JSON.stringify({
				...JSON.parse(COMPLIANT_PROTECTION),
				required_status_checks: { strict, contexts },
			})
		)

	it('accepts declared required checks that replace the standard ones', async () => {
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ protection: protection(['lint', 'e2e']) }), {
				requiredChecks: ['lint', 'e2e'],
			}),
			'Branch protection'
		)
		expect(bp?.status).toBe('ok')
	})

	it('flags missing and undeclared checks against the declared list', async () => {
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh(), { requiredChecks: ['lint', 'e2e'] }),
			'Branch protection'
		)
		expect(bp?.status).toBe('drift')
		expect(bp?.detail).toContain('missing required checks: lint, e2e')
		expect(bp?.detail).toContain('undeclared required checks: ci')
		expect(bp?.detail).toContain('rules.github.requiredChecks')
		expect(bp?.hint).toContain('rules.github')
	})

	it('keeps the standard a floor: extra live checks pass without a declared list', async () => {
		const bp = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ protection: protection(['ci', 'e2e']) })),
			'Branch protection'
		)
		expect(bp?.status).toBe('ok')
	})

	it('diffs strict against the declared value', async () => {
		const results = await checkGitHubSettings(gitRepo(), fakeGh(), { strict: true })
		expect(byName(results, 'Branch protection')?.detail).toBe(
			'strict status checks off (rules.github.strict: true)'
		)
	})

	it('accepts merge settings the rules turn off, and names the field when live differs', async () => {
		const off = ok(JSON.stringify({ ...JSON.parse(COMPLIANT_REPO), allow_auto_merge: false }))
		const ok1 = byName(
			await checkGitHubSettings(gitRepo(), fakeGh({ repo: off }), { autoMerge: false }),
			'Merge settings'
		)
		expect(ok1?.status).toBe('ok')
		expect(ok1?.detail).toContain('auto-merge off')

		const drift = byName(
			await checkGitHubSettings(gitRepo(), fakeGh(), { autoMerge: false }),
			'Merge settings'
		)
		expect(drift?.status).toBe('drift')
		expect(drift?.detail).toBe('auto-merge enabled (rules.github.autoMerge: false)')
	})

	it.each([
		['autoMerge', 'false'],
		['deleteOnMerge', 0],
	])(
		'reports a non-boolean rules.github.%s as a config error, not as on (#956)',
		async (field, value) => {
			const merge = byName(
				await checkGitHubSettings(gitRepo(), fakeGh(), {
					[field]: value,
				} as unknown as GithubRules),
				'Merge settings'
			)
			expect(merge?.status).toBe('drift')
			expect(merge?.detail).toBe(
				`rules.github.${field} must be true or false in .repo-tooling.json, not ${JSON.stringify(value)}`
			)
		}
	)

	it('reports a declared security setting the repo does not match as drift', async () => {
		const results = await checkGitHubSettings(gitRepo(), fakeGh(), { vulnerabilityAlerts: false })
		const s = byName(results, 'Security updates')
		expect(s?.status).toBe('drift')
		expect(s?.detail).toContain(
			'vulnerability alerts enabled (rules.github.vulnerabilityAlerts: false)'
		)
	})

	it('accepts declared release reviewers case-insensitively, in any order', async () => {
		const g = byName(
			await checkGitHubSettings(
				releaseRepo(),
				fakeGh({ environments: releaseEnv('bob', 'Alice') }),
				{
					releaseReviewers: ['alice', 'BOB'],
				}
			),
			'Release gate'
		)
		expect(g?.status).toBe('ok')
	})

	it('drifts when the release environment has other reviewers than declared', async () => {
		const g = byName(
			await checkGitHubSettings(releaseRepo(), fakeGh({ environments: releaseEnv('alice') }), {
				releaseReviewers: ['bob'],
			}),
			'Release gate'
		)
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('reviewers are alice (rules.github.releaseReviewers: ["bob"])')
		expect(g?.hint).toContain('fix release-environment')
	})

	it('builds commands from the declared values', () => {
		const cmds = buildGhApplyCommands({
			nwo: 'owner/repo',
			branch: 'main',
			merge: true,
			protection: true,
			workflow: false,
			alerts: true,
			securityFixes: true,
			rules: {
				requiredChecks: ['ci'],
				strict: true,
				deleteOnMerge: false,
				vulnerabilityAlerts: false,
				automatedSecurityFixes: false,
			},
		})
		expect(cmds[0]?.args).toContain('delete_branch_on_merge=false')
		expect(cmds[0]?.args).toContain('allow_auto_merge=true')
		expect(JSON.parse(cmds[1]?.stdin ?? '{}').required_status_checks).toEqual({
			strict: true,
			contexts: ['ci'],
		})
		// Disabling runs fixes first: GitHub refuses fixes on a repo with alerts off.
		expect(cmds.slice(2).map((c) => c.args)).toEqual([
			['api', '-X', 'DELETE', 'repos/owner/repo/automated-security-fixes'],
			['api', '-X', 'DELETE', 'repos/owner/repo/vulnerability-alerts'],
		])
	})

	it('applies only the fields that deviate from the rules', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const calls: string[][] = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			const fallback = fakeGh()
			if (args.includes('-X')) {
				calls.push(args)
				return ok('')
			}
			return fallback(args, stdin)
		})
		const applied = await applyGithubSettings(gitRepo(), exec, {
			requiredChecks: ['lint', 'typecheck', 'build', 'test'],
			automatedSecurityFixes: false,
		})
		expect(applied).toEqual(['automated security fixes off (rules.github)'])
		expect(calls).toEqual([['api', '-X', 'DELETE', 'repos/owner/repo/automated-security-fixes']])
	})

	it('says a 404 on a write means the token lacks admin rights', async () => {
		const errors: string[] = []
		vi.spyOn(console, 'error').mockImplementation((m: string) => {
			errors.push(m)
		})
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) =>
			args.includes('-X') ? fail('gh: Not Found (HTTP 404)') : fakeGh()(args, stdin)
		)
		expect(await applyGithubSettings(gitRepoWithGate(), exec, { strict: true })).toEqual([])
		expect(errors.join('\n')).toContain('admin')
	})

	it('re-applies declared release reviewers over an existing rule', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const puts: Array<{ args: string[]; stdin?: string }> = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			if (args.includes('PUT')) {
				puts.push({ args, stdin })
				return ok('{}')
			}
			if (args[1] === 'users/bob') return ok('42\n')
			if (args[1] === 'repos/{owner}/{repo}') return ok(COMPLIANT_REPO)
			if (args[1]?.endsWith('/environments')) return releaseEnv('alice')
			return fail('unexpected call')
		})
		const applied = await applyReleaseEnvironment(releaseRepo(), exec, {
			releaseReviewers: ['bob'],
		})
		expect(puts).toHaveLength(1)
		expect(JSON.parse(puts[0]?.stdin ?? '')).toEqual({ reviewers: [{ type: 'User', id: 42 }] })
		expect(applied[0]).toContain('rules.github.releaseReviewers (bob)')
	})
})

describe('rules.github.releaseReviewers validation (#817)', () => {
	it('refuses a reviewer that is not a GitHub login before calling gh', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const dir = gitRepo()
		fs.outputFileSync(
			join(dir, '.github/workflows/release.yml'),
			'jobs:\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx semantic-release\n'
		)
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		const calls: string[][] = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			calls.push(args)
			return fakeGh()(args, stdin)
		})
		expect(await applyReleaseEnvironment(dir, exec, { releaseReviewers: ['../orgs/x'] })).toEqual(
			[]
		)
		expect(calls.some((a) => a.some((x) => x.includes('orgs/x')))).toBe(false)
	})
})

describe('rules.github review fixes (#817)', () => {
	const RELEASE_JOB =
		'jobs:\n  release:\n    runs-on: ubuntu-latest\n    environment: release\n    steps:\n      - run: npx semantic-release\n'
	const gatedBy = (login: string) =>
		ok(
			JSON.stringify({
				environments: [
					{
						name: 'release',
						protection_rules: [
							{ type: 'required_reviewers', reviewers: [{ reviewer: { login } }] },
						],
					},
				],
			})
		)
	function releaseRepo(): string {
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows/release.yml'), RELEASE_JOB)
		fs.writeJsonSync(join(dir, 'package.json'), { name: 'thing' })
		return dir
	}

	it('reports an empty releaseReviewers as drift', async () => {
		const g = byName(
			await checkGitHubSettings(releaseRepo(), fakeGh({ environments: gatedBy('alice') }), {
				releaseReviewers: [],
			}),
			'Release gate'
		)
		expect(g?.status).toBe('drift')
		expect(g?.detail).toContain('releaseReviewers is empty')
	})

	it('never PUTs an empty reviewer list', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const puts: string[][] = []
		const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
			if (args.includes('PUT')) puts.push(args)
			if (args[1]?.endsWith('/environments')) return gatedBy('alice')
			return fakeGh()(args, stdin)
		})
		expect(await applyReleaseEnvironment(releaseRepo(), exec, { releaseReviewers: [] })).toEqual([])
		expect(puts).toEqual([])
	})

	it('turns fixes off with alerts when only vulnerabilityAlerts: false is declared', () => {
		const cmds = buildGhApplyCommands({
			nwo: 'owner/repo',
			branch: 'main',
			merge: false,
			protection: false,
			workflow: false,
			alerts: true,
			securityFixes: true,
			rules: { vulnerabilityAlerts: false },
		})
		expect(cmds.map((c) => c.args)).toEqual([
			['api', '-X', 'DELETE', 'repos/owner/repo/automated-security-fixes'],
			['api', '-X', 'DELETE', 'repos/owner/repo/vulnerability-alerts'],
		])
	})

	it('does not ask for fixes on a repo whose alerts are declared off', async () => {
		const results = await checkGitHubSettings(
			gitRepo(),
			fakeGh({
				alerts: fail('gh: Not Found (HTTP 404)'),
				securityFixes: ok(JSON.stringify({ enabled: false, paused: false })),
			}),
			{ vulnerabilityAlerts: false }
		)
		expect(byName(results, 'Security updates')?.status).toBe('ok')
	})
})

describe('readGithubSnapshot (#863)', () => {
	it('reads every field rules.github declares from a fully readable repo', async () => {
		const exec = fakeGh({
			repo: ok(JSON.stringify({ ...JSON.parse(COMPLIANT_REPO), permissions: { admin: true } })),
			reporting: ok(JSON.stringify({ enabled: true })),
			environments: ok(
				JSON.stringify({
					environments: [
						{
							name: 'release',
							protection_rules: [
								{
									type: 'required_reviewers',
									reviewers: [
										{ type: 'User', reviewer: { login: 'Rtorcato' } },
										{ type: 'Team', reviewer: { slug: 'maintainers' } },
									],
								},
							],
						},
					],
				})
			),
		})
		expect(await readGithubSnapshot(gitRepo(), exec)).toEqual({
			nwo: 'owner/repo',
			github: {
				requiredChecks: ['ci'],
				strict: false,
				autoMerge: true,
				deleteOnMerge: true,
				vulnerabilityAlerts: true,
				automatedSecurityFixes: true,
				privateVulnerabilityReporting: true,
				actionsCanCreatePullRequests: false,
				// Users only, lowercased: a team slug isn't a login the fixer can apply.
				releaseReviewers: ['rtorcato'],
			},
			omitted: [],
		})
	})

	it('omits what the token cannot read instead of writing it as off', async () => {
		const repo = JSON.parse(COMPLIANT_REPO)
		delete repo.allow_auto_merge
		const exec = fakeGh({
			repo: ok(JSON.stringify(repo)),
			protection: fail('gh: Not Found (HTTP 404)'),
			branch: ok(
				JSON.stringify({
					protected: true,
					protection: { required_status_checks: { contexts: ['ci', 'lint'] } },
				})
			),
			alerts: fail('gh: (HTTP 403)'),
			workflow: fail('gh: (HTTP 403)'),
		})
		const snap = await readGithubSnapshot(gitRepo(), exec)
		if ('skip' in snap) throw new Error(snap.skip)
		expect(snap.github).toEqual({ requiredChecks: ['ci', 'lint'] })
		expect(snap.omitted.join('\n')).toMatch(/strict: needs admin/)
		expect(snap.omitted.join('\n')).toMatch(/autoMerge, deleteOnMerge/)
		expect(snap.omitted.join('\n')).toMatch(/vulnerabilityAlerts.*needs admin/)
		expect(snap.omitted.join('\n')).toMatch(/releaseReviewers/)
		expect(snap.omitted.join('\n')).toMatch(/actionsCanCreatePullRequests: token lacks admin/)
	})

	it('never writes the security toggles a non-admin read as off', async () => {
		// The default fakeGh answers alerts and fixes, but the repo grants no admin.
		const exec = fakeGh({ alerts: fail('gh: Not Found (HTTP 404)') })
		const snap = await readGithubSnapshot(gitRepo(), exec)
		if ('skip' in snap) throw new Error(snap.skip)
		expect(snap.github.vulnerabilityAlerts).toBeUndefined()
		expect(snap.github.automatedSecurityFixes).toBeUndefined()
		expect(vi.mocked(exec).mock.calls.some(([a]) => a[1]?.endsWith('/vulnerability-alerts'))).toBe(
			false
		)
	})

	it('leaves out required checks on an unprotected branch', async () => {
		const exec = fakeGh({ protection: fail('gh: Not Found (HTTP 404)') })
		const snap = await readGithubSnapshot(gitRepo(), exec)
		if ('skip' in snap) throw new Error(snap.skip)
		expect(snap.github.requiredChecks).toBeUndefined()
		expect(snap.omitted[0]).toBe('requiredChecks, strict: main is unprotected')
	})

	it('skips outside a git repo and when gh is missing', async () => {
		expect(await readGithubSnapshot(newTmpDir(), fakeGh())).toEqual({
			skip: 'not a git repository',
		})
		expect(
			await readGithubSnapshot(gitRepo(), fakeGh({ repo: fail('spawn gh ENOENT', null) }))
		).toEqual({ skip: 'gh not installed' })
	})
})

describe('departuresFromStandard (#863)', () => {
	it('names each value that differs from the standard', () => {
		expect(
			departuresFromStandard({
				requiredChecks: ['test (22)'],
				strict: true,
				autoMerge: true,
				vulnerabilityAlerts: false,
			})
		).toEqual([
			'requiredChecks leaves out ci',
			'strict: true (standard: false)',
			'vulnerabilityAlerts: false (standard: true)',
		])
	})

	it('is empty for the standard, and for absent fields', () => {
		expect(departuresFromStandard({})).toEqual([])
		expect(departuresFromStandard({ requiredChecks: ['ci', 'lint'], strict: false })).toEqual([])
	})
})

describe('actionsCanCreatePullRequests (#946)', () => {
	const PRS_ON = ok(
		JSON.stringify({ default_workflow_permissions: 'read', can_approve_pull_request_reviews: true })
	)
	/** A repo whose release.yml runs changesets/action, the Version Packages PR opener. */
	function changesetsRepo(): string {
		const dir = gitRepoWithGate()
		fs.outputFileSync(
			join(dir, '.github/workflows/release.yml'),
			'jobs:\n  version:\n    steps:\n      - uses: changesets/action@v2.1.2\n'
		)
		return dir
	}
	const wp = async (dir: string, workflow?: GhResult, rules = {}, changesets?: boolean) =>
		byName(
			await checkGitHubSettings(dir, fakeGh({ workflow }), rules, changesets),
			'Workflow permissions'
		) as { status: string; detail: string; hint?: string }

	it('a Changesets repo with the setting off is drift, naming the setting path', async () => {
		const r = await wp(changesetsRepo())
		expect(r.status).toBe('drift')
		expect(r.detail).toBe(
			'workflows cannot create and approve PRs (should be on: the Changesets release opens the Version Packages PR)'
		)
		expect(r.hint).toContain(
			'Settings → Actions → General → Workflow permissions pick "Read repository contents and packages permissions", turn "Allow GitHub Actions to create and approve pull requests" on → Save'
		)
	})

	it('a Changesets repo with it on is ok, from the workflow or the lockfile flag', async () => {
		expect((await wp(changesetsRepo(), PRS_ON)).status).toBe('ok')
		const r = await wp(gitRepo(), PRS_ON, {}, true)
		expect(r).toMatchObject({
			status: 'ok',
			detail: 'read-only default, workflows can create PRs (Changesets)',
		})
	})

	it('a semantic-release repo with it on is still drift', async () => {
		const r = await wp(gitRepo(), PRS_ON)
		expect(r.status).toBe('drift')
		expect(r.detail).toBe('workflows can create and approve PRs (should be off)')
	})

	it('a commented-out changesets/action does not count', async () => {
		const dir = gitRepo()
		fs.outputFileSync(join(dir, '.github/workflows/release.yml'), '# uses: changesets/action\n')
		expect((await wp(dir)).status).toBe('ok')
	})

	it('an explicit rules.github value wins in both directions', async () => {
		const off = { actionsCanCreatePullRequests: false }
		expect((await wp(changesetsRepo(), undefined, off)).status).toBe('ok')
		expect((await wp(changesetsRepo(), PRS_ON, off)).detail).toBe(
			'workflows can create and approve PRs (rules.github.actionsCanCreatePullRequests: false)'
		)
		const on = { actionsCanCreatePullRequests: true }
		expect((await wp(gitRepo(), PRS_ON, on)).detail).toBe(
			'read-only default, workflows can create PRs per rules.github'
		)
		expect((await wp(gitRepo(), undefined, on)).status).toBe('drift')
	})

	it('fix github-settings turns it on for a Changesets repo, keeping the read default', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {})
		const run = async (dir: string, workflow?: GhResult, rules = {}) => {
			const calls: string[][] = []
			const fallback = fakeGh({ workflow })
			const exec: GhExec = vi.fn(async (args: string[], stdin?: string) => {
				if (args.includes('-X')) {
					calls.push(args)
					return ok('')
				}
				return fallback(args, stdin)
			})
			return { applied: await applyGithubSettings(dir, exec, rules), calls }
		}
		const put = (on: boolean) => [
			'api',
			'-X',
			'PUT',
			'repos/owner/repo/actions/permissions/workflow',
			'-f',
			'default_workflow_permissions=read',
			'-F',
			`can_approve_pull_request_reviews=${on}`,
		]
		expect(await run(changesetsRepo())).toEqual({
			applied: ['workflow permissions (read-only, Actions can create PRs)'],
			calls: [put(true)],
		})
		expect(await run(changesetsRepo(), PRS_ON)).toEqual({ applied: [], calls: [] })
		expect(await run(gitRepoWithGate(), PRS_ON)).toEqual({
			applied: ['workflow permissions (read-only)'],
			calls: [put(false)],
		})
		expect(
			await run(changesetsRepo(), PRS_ON, { actionsCanCreatePullRequests: false })
		).toMatchObject({ calls: [put(false)] })
	})

	it('departuresFromStandard compares against the repo-derived standard', () => {
		const on = { actionsCanCreatePullRequests: true }
		expect(departuresFromStandard(on)).toEqual([
			'actionsCanCreatePullRequests: true (standard: false)',
		])
		expect(departuresFromStandard(on, true)).toEqual([])
		expect(departuresFromStandard({ actionsCanCreatePullRequests: false }, true)).toEqual([
			'actionsCanCreatePullRequests: false (standard: true)',
		])
	})
})
