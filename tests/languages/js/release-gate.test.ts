import { describe, expect, it } from 'vitest'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { pushReleaseJob, workflowJobs } from '../../../src/base/github-settings.js'
import { githubJobs } from '../../../src/languages/js/ci.js'

const render = (releaseEnvironment?: string) =>
	renderGitHubWorkflow(githubJobs(buildPresetConfig('library', 'x'), { releaseEnvironment }))

describe('generated release job (#690, #740)', () => {
	it('releases only on dispatch or a closed milestone, never on push', () => {
		const yml = render()
		expect(yml).toContain(
			"(github.event_name == 'workflow_dispatch' || github.event_name == 'milestone')"
		)
		expect(yml).toContain('  milestone:\n    types: [closed]\n')
		expect(yml).not.toContain('head_commit.message, ')
		expect(pushReleaseJob(yml)).toBeNull()
		// bash -e has no pipefail; without it a failed release piped to tee goes green.
		expect(yml).toContain('set -o pipefail\n          npx semantic-release 2>&1 | tee release.log')
		expect(yml).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
	})

	it('only a workflow with a release job listens for milestones', () => {
		const yml = renderGitHubWorkflow(githubJobs(buildPresetConfig('web-app', 'x')))
		expect(yml).not.toContain('milestone:')
	})

	it('carries the release environment into a regenerated workflow', () => {
		expect(workflowJobs(render('release')).get('release')).toContain('    environment: release\n')
		expect(workflowJobs(render()).get('release')).not.toContain('environment:')
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
