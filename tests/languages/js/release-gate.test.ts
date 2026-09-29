import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain .mjs preset, no types
import preset from '../../../tooling/semantic-release/github.mjs'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { githubJobs, RELEASE_TYPES } from '../../../src/languages/js/ci.js'

describe('generated release job (#690)', () => {
	it('RELEASE_TYPES matches the preset release rules', () => {
		const rules = preset.plugins.find(
			(p: unknown) => Array.isArray(p) && p[0].includes('commit-analyzer')
		)[1].releaseRules as { type?: string; release: unknown; scope?: string }[]
		const releasing = rules.filter((r) => r.type && r.release && !r.scope).map((r) => r.type)
		// perf releases by conventional-commits default, so it is not listed as a rule.
		expect([...releasing, 'perf'].sort()).toEqual([...RELEASE_TYPES].sort())
	})

	it('gates on the subject start and never cancels on main', () => {
		const yml = renderGitHubWorkflow(githubJobs(buildPresetConfig('library', 'x')))
		expect(yml).toContain("startsWith(github.event.head_commit.message, 'feat')")
		expect(yml).not.toContain('BREAKING')
		// bash -e has no pipefail; without it a failed release piped to tee goes green.
		expect(yml).toContain('set -o pipefail\n          npx semantic-release 2>&1 | tee release.log')
		expect(yml).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}")
	})
})
