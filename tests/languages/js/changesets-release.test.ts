import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { checkGitHubActions } from '../../../src/base/checks.js'
import {
	isTwoJobChangesetsRelease,
	jobEnvironment,
	publishingJob,
	workflowJobs,
} from '../../../src/base/github-settings.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { renderReleaseWorkflow, UNPUBLISHED_CHECK } from '../../../src/languages/js/ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()
const render = () =>
	renderReleaseWorkflow({ ...buildPresetConfig('library', 'x'), changesets: true }) ?? ''

// The pre-#938 shape react-common, api-common and supabase-common run.
const ONE_JOB = `name: Release
on:
  workflow_dispatch:
  milestone:
    types: [closed]

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    runs-on: ubuntu-latest
    environment: release
    steps:
      - uses: actions/checkout@v7
      - name: Changesets release
        uses: changesets/action@v2.1.2
        with:
          version-script: pnpm changeset version
          publish-script: pnpm changeset publish
`

describe('generated Changesets release workflow (#938)', () => {
	it('versions on every push to main and keeps a manual publish path', () => {
		const yml = render()
		expect(yml).toContain('on:\n  push:\n    branches: [main]\n  workflow_dispatch:\n\n')
		expect(yml).not.toContain('milestone')
		// Job-level groups: a publish waiting for approval must not hold up the
		// version runs, or a Version Packages PR merge pending behind it is dropped.
		expect(yml).not.toMatch(/^concurrency:/m)
		const jobs = workflowJobs(yml)
		expect(jobs.get('version')).toContain(
			'    concurrency:\n      group: release-version\n      cancel-in-progress: false\n'
		)
		expect(jobs.get('publish')).toContain(
			'    concurrency:\n      group: release\n      cancel-in-progress: false\n'
		)
		expect([...workflowJobs(yml).keys()]).toEqual(['version', 'publish'])
	})

	it('an ordinary push only opens the Version Packages PR, with no approval', () => {
		const version = workflowJobs(render()).get('version') ?? ''
		expect(jobEnvironment(version)).toBeNull()
		expect(version).toContain('changesets/action@v2.1.2')
		expect(version).not.toMatch(/^\s*publish(-script)?:/m)
		expect(version).not.toContain('id-token')
		// Ungated with RELEASE_TOKEN in reach: no dependency install scripts.
		expect(version).toContain('pnpm install --frozen-lockfile --ignore-scripts\n')
		expect(version).toContain("if: steps.changesets.outputs.has-changesets == 'false'")
	})

	it('only the Version Packages PR merge or a dispatch reaches the gated publish job', () => {
		const yml = render()
		expect(publishingJob(yml)).toBe('publish')
		const publish = workflowJobs(yml).get('publish') ?? ''
		expect(publish).toContain('    needs: version\n')
		expect(publish).toContain(
			"    if: github.event_name == 'workflow_dispatch' || needs.version.outputs.release == 'true'\n"
		)
		expect(jobEnvironment(publish)).toBe('release')
		expect(publish).toContain('      id-token: write\n')
		expect(publish).toContain('publish-script: pnpm changeset publish')
		// The triggering commit, not the tip: a changeset merged during the
		// approval wait would turn the publish into a VPR update (react-common#261).
		expect(publish).not.toContain('ref:')
		expect(isTwoJobChangesetsRelease(yml)).toBe(true)
	})

	it('carries the release environment', () => {
		const yml = renderReleaseWorkflow(
			{ ...buildPresetConfig('library', 'x'), changesets: true },
			{ releaseEnvironment: 'npm' }
		)
		expect(jobEnvironment(workflowJobs(yml ?? '').get('publish') ?? '')).toBe('npm')
	})

	it('renders no bare #NNN refs', () => {
		expect(render()).not.toMatch(/(^|[^\w/])#\d+/m)
	})
})

describe('doctor on a Changesets release.yml (#938)', () => {
	const check = async (release: string) => {
		const dir = newTmpDir()
		await fs.outputFile(join(dir, '.github/workflows/release.yml'), release)
		return checkGitHubActions(dir, null, render())
	}

	it('passes the two-job shape', async () => {
		expect((await check(render())).status).toBe('ok')
	})

	it('flags the single-job shape as drift, with the migration path', async () => {
		const r = await check(ONE_JOB)
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('release.yml: one job opens the Version Packages PR and publishes')
		expect(r.hint).toContain('fix github-actions')
		expect(r.hint).toContain('`release` environment')
	})
})

// The step's shell, against stub `pnpm` (workspace listing) and `npm` (registry).
describe('the unpublished-version check (#938)', () => {
	const run = (published: string[], packages: object[]) => {
		const dir = newTmpDir()
		const bin = join(dir, 'bin')
		fs.outputFileSync(
			join(bin, 'pnpm'),
			`#!/bin/sh\ncat <<'JSON'\n${JSON.stringify(packages)}\nJSON\n`,
			{ mode: 0o755 }
		)
		fs.outputFileSync(
			join(bin, 'npm'),
			`#!/bin/sh\ncase " ${published.join(' ')} " in *" $2 "*) echo ok ;; *) echo "npm error code E404" >&2; exit 1 ;; esac\n`,
			{ mode: 0o755 }
		)
		const output = join(dir, 'out')
		execFileSync('bash', ['-e', '-c', UNPUBLISHED_CHECK], {
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_OUTPUT: output },
			stdio: 'pipe',
		})
		return fs.readFileSync(output, 'utf-8')
	}
	const workspace = (version: string) => [
		{ name: 'root', version: '0.0.0', private: true },
		{ name: '@x/a', version, private: false },
	]

	it('an ordinary push: every version is on npm, nothing to publish', () => {
		expect(run(['@x/a@1.2.0'], workspace('1.2.0'))).toBe('release=false\n')
	})

	it('the Version Packages PR merge: a version not on npm yet publishes', () => {
		expect(run(['@x/a@1.2.0'], workspace('1.3.0'))).toBe('release=true\n')
	})

	it('pre mode: the -beta.N version is what counts', () => {
		expect(run(['@x/a@1.3.0-beta.0'], workspace('1.3.0-beta.1'))).toBe('release=true\n')
		expect(run(['@x/a@1.3.0-beta.1'], workspace('1.3.0-beta.1'))).toBe('release=false\n')
	})

	it('ignores private packages', () => {
		expect(run([], [{ name: 'docs', version: '9.9.9', private: true }])).toBe('release=false\n')
	})

	it('fails on an npm error that is not a 404', () => {
		const dir = newTmpDir()
		const bin = join(dir, 'bin')
		fs.outputFileSync(
			join(bin, 'pnpm'),
			`#!/bin/sh\necho '${JSON.stringify(workspace('1.0.0'))}'\n`,
			{
				mode: 0o755,
			}
		)
		fs.outputFileSync(
			join(bin, 'npm'),
			'#!/bin/sh\necho "npm error code ETIMEDOUT" >&2\nexit 1\n',
			{
				mode: 0o755,
			}
		)
		expect(() =>
			execFileSync('bash', ['-e', '-c', UNPUBLISHED_CHECK], {
				env: {
					...process.env,
					PATH: `${bin}:${process.env.PATH}`,
					GITHUB_OUTPUT: join(dir, 'out'),
				},
				stdio: 'pipe',
			})
		).toThrow()
	})
})
