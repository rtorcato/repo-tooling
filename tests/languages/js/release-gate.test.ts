import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { checkGitHubActions } from '../../../src/base/checks.js'
import { publishingJob, pushReleaseJob, workflowJobs } from '../../../src/base/github-settings.js'
import { githubJobs, renderReleaseWorkflow } from '../../../src/languages/js/ci.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()
const lib = () => buildPresetConfig('library', 'x')
const render = (releaseEnvironment?: string) =>
	renderReleaseWorkflow(lib(), { releaseEnvironment }) ?? ''

describe('generated release workflow (#690, #740, #753)', () => {
	it('releases only on dispatch or a closed milestone, never on push', () => {
		const yml = render()
		expect(yml).toContain('on:\n  workflow_dispatch:\n  milestone:\n    types: [closed]\n')
		expect(yml).not.toMatch(/^\s*push:/m)
		expect(pushReleaseJob(yml)).toBeNull()
		// bash -e has no pipefail; without it a failed release piped to tee goes green.
		expect(yml).toContain('set -o pipefail\n          npx semantic-release 2>&1 | tee release.log')
	})

	it('supersedes a waiting run and releases the dispatched branch tip', () => {
		const yml = render()
		expect(yml).toContain('concurrency:\n  group: release\n  cancel-in-progress: true\n')
		// A dispatch from `beta` releases beta (#771); a milestone, the default branch.
		expect(yml).toContain(
			"ref: ${{ github.event_name == 'workflow_dispatch' && github.ref || github.event.repository.default_branch }}"
		)
		// install → build → test only; no CI fan-out, no `needs:`.
		expect([...workflowJobs(yml).keys()]).toEqual(['release'])
		expect(yml).not.toContain('needs:')
		expect(yml).toContain('pnpm install --frozen-lockfile')
		expect(yml).toContain('npm install -g npm@^11.5.1')
		expect(yml).not.toContain('npm@latest')
	})

	it('CI no longer publishes, listens for milestones, or holds runs on main', () => {
		const ci = renderGitHubWorkflow(githubJobs(lib()))
		expect(publishingJob(ci)).toBeNull()
		expect(ci).not.toContain('milestone:')
		expect(ci).toContain('cancel-in-progress: true')
	})

	it('only a semantic-release library gets one', () => {
		expect(renderReleaseWorkflow(buildPresetConfig('web-app', 'x'))).toBeNull()
	})

	it('carries the release environment', () => {
		expect(workflowJobs(render('release')).get('release')).toContain('    environment: release\n')
		expect(workflowJobs(render()).get('release')).not.toContain('environment:')
	})
})

describe('doctor on the release layout (#753)', () => {
	const preset = renderGitHubWorkflow(githubJobs(lib()))
	const presetRelease = render()
	const setup = async (files: Record<string, string>) => {
		const dir = newTmpDir()
		for (const [f, body] of Object.entries(files)) {
			await fs.outputFile(join(dir, '.github', 'workflows', f), body)
		}
		return checkGitHubActions(dir, preset, presetRelease)
	}

	it('passes the generated pair', async () => {
		expect((await setup({ 'ci.yml': preset, 'release.yml': presetRelease })).status).toBe('ok')
	})

	it('flags a release job still inside ci.yml', async () => {
		const ci = `${preset}\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx semantic-release\n`
		const r = await setup({ 'ci.yml': ci })
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('ci.yml: `release` publishes from CI')
		expect(r.hint).toContain('fix github-actions --diff')
	})

	it('names the release job steps to move by hand (#771)', async () => {
		const ci = `${preset}\n  release:\n    runs-on: ubuntu-latest\n    steps:\n      - run: npx semantic-release\n      - name: 📘 Redeploy docs\n        run: gh workflow run docs.yml\n`
		const r = await setup({ 'ci.yml': ci })
		expect(r.status).toBe('drift')
		expect(r.hint).toContain('📘 Redeploy docs')
		expect(r.hint).toContain('into release.yml by hand')
	})

	it('flags a release.yml that does not supersede a waiting run', async () => {
		const stale = presetRelease.replace('cancel-in-progress: true', 'cancel-in-progress: false')
		const r = await setup({ 'ci.yml': preset, 'release.yml': stale })
		expect(r.status).toBe('drift')
		expect(r.detail).toContain('does not supersede a waiting one')
	})
})

describe('pushReleaseJob', () => {
	const on = (job: string) => `on:\n  push:\n    branches: [main]\njobs:\n${job}`

	it('flags a publishing job that a push fires', () => {
		const ungated = on('  release:\n    steps:\n      - run: npx semantic-release\n')
		expect(pushReleaseJob(ungated)).toBe('release')
		const pre740 = on(
			"  release:\n    if: github.event_name == 'workflow_dispatch' || github.event_name == 'push'\n    steps:\n      - run: npx semantic-release\n"
		)
		expect(pushReleaseJob(pre740)).toBe('release')
	})

	it('passes a dispatch-gated job and a workflow with no push trigger', () => {
		const gated = on(
			"  release:\n    if: github.event_name == 'workflow_dispatch'\n    steps:\n      - run: npx semantic-release\n"
		)
		expect(pushReleaseJob(gated)).toBeNull()
		const noPush =
			'on:\n  workflow_dispatch:\njobs:\n  release:\n    steps:\n      - run: npm publish\n'
		expect(pushReleaseJob(noPush)).toBeNull()
	})
})
