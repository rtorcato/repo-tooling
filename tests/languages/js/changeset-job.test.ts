import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checkGitHubActions } from '../../../src/base/checks.js'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { workflowJobs } from '../../../src/base/github-settings.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { githubJobs } from '../../../src/languages/js/ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()
const lib = buildPresetConfig('library', 'x')
const render = (changesets: boolean) =>
	renderGitHubWorkflow(githubJobs({ ...lib, changesets, semanticRelease: !changesets }))

/** The job's `run: |` block, dedented, so the test runs the script CI runs. */
function script(): string {
	const job = workflowJobs(render(true)).get('changeset') ?? ''
	const body = job.slice(job.indexOf('run: |\n') + 'run: |\n'.length)
	return body
		.split('\n')
		.filter((l) => l.startsWith('          '))
		.map((l) => l.slice(10))
		.join('\n')
}

// No inherited GIT_CONFIG_* (a runtime may force signing), no user config.
const gitEnv = (home: string) => ({
	PATH: process.env.PATH ?? '',
	HOME: home,
	GIT_CONFIG_NOSYSTEM: '1',
	GIT_CONFIG_GLOBAL: '/dev/null',
})

/** A repo whose HEAD is a merge commit, like the PR checkout, adding `files`. */
async function prMerge(files: string[]): Promise<string> {
	const dir = newTmpDir()
	const git = (...args: string[]) =>
		execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], {
			cwd: dir,
			env: gitEnv(dir),
		})
	git('init', '-q', '-b', 'main')
	await fs.outputFile(join(dir, 'src/index.ts'), 'export {}\n')
	await fs.outputFile(join(dir, '.changeset/README.md'), 'x\n')
	git('add', '.')
	git('commit', '-qm', 'base')
	git('checkout', '-qb', 'pr')
	for (const f of files) await fs.outputFile(join(dir, f), `${f}\n`)
	git('add', '.')
	git('commit', '-qm', 'change')
	git('checkout', '-q', 'main')
	git('merge', '-q', '--no-ff', '-m', 'merge', 'pr')
	return dir
}

const run = (dir: string, title = 'feat: x') =>
	spawnSync('bash', ['-e', '-c', script()], {
		cwd: dir,
		env: { ...gitEnv(dir), PR_TITLE: title },
		encoding: 'utf-8',
	})

describe('changeset CI job (#968)', () => {
	it('is rendered for a Changesets repo, PR-only, never on the Version Packages PR', () => {
		const job = workflowJobs(render(true)).get('changeset') ?? ''
		expect(job).toContain("github.event_name == 'pull_request'")
		expect(job).toContain("!startsWith(github.head_ref, 'changeset-release/')")
		expect(job).toContain('PR_TITLE: ${{ github.event.pull_request.title }}')
		expect(job).toContain('fetch-depth: 2')
		expect(render(true)).toMatch(/^ {4}needs: \[check-skip, .*changeset/m)
	})

	it('is not rendered for a semantic-release repo', () => {
		expect(workflowJobs(render(false)).has('changeset')).toBe(false)
	})

	it('fails a PR that changes src/ with no changeset', async () => {
		const r = run(await prMerge(['src/a.ts']))
		expect(r.status).toBe(1)
		expect(r.stdout).toContain('::error::This PR changes published source')
	})

	it('fails on a workspace package src/ too', async () => {
		expect(run(await prMerge(['packages/core/src/a.ts'])).status).toBe(1)
	})

	it('passes with a changeset, on docs-only changes, and on a chore title', async () => {
		expect(run(await prMerge(['src/a.ts', '.changeset/brave-cats.md'])).status).toBe(0)
		expect(run(await prMerge(['README.md', 'apps/docs/x.md'])).status).toBe(0)
		expect(run(await prMerge(['src/a.ts']), 'chore(deps): bump x').status).toBe(0)
	})

	it('a breaking title never skips', async () => {
		expect(run(await prMerge(['src/a.ts']), 'refactor!: drop x').status).toBe(1)
	})

	it('doctor flags a Changesets ci.yml without the job, not a semantic-release one', async () => {
		const dir = newTmpDir()
		const ci = render(false)
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), ci)
		const flagged = await checkGitHubActions(dir, render(true))
		expect(flagged.status).toBe('drift')
		expect(flagged.detail).toContain('no `changeset` job')
		expect((await checkGitHubActions(dir, ci)).status).toBe('ok')
	})
})
