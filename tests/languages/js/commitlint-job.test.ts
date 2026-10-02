import { describe, expect, it } from 'vitest'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { githubJobs, hasCommitlint } from '../../../src/languages/js/ci.js'

const config = buildPresetConfig('library', 'x')
const render = (commitlint?: boolean, commitLint = true) =>
	renderGitHubWorkflow(githubJobs({ ...config, commitLint }, { commitlint }))

describe('commitlint CI job (#777)', () => {
	it('lints the PR title plus its squash suffix, title via env', () => {
		const yaml = render()
		expect(yaml).toContain('  commitlint:')
		expect(yaml).toContain('PR_TITLE: ${{ github.event.pull_request.title }}')
		expect(yaml).toContain(`printf '%s (#%s)\\n' "$PR_TITLE" "$PR_NUMBER" | npx commitlint`)
		expect(yaml).not.toMatch(/run:.*\$\{\{ github\.event\.pull_request\.title/)
		expect(yaml).toContain('types: [opened, synchronize, reopened, edited]')
	})

	it('is left out, with no `edited` trigger, when commitlint is off or not installed', () => {
		for (const yaml of [render(false), render(undefined, false)]) {
			expect(yaml).not.toContain('  commitlint:')
			expect(yaml).not.toContain('edited')
		}
	})

	it('hasCommitlint reads package.json', () => {
		expect(hasCommitlint({ devDependencies: { '@commitlint/cli': '^20.0.0' } })).toBe(true)
		expect(hasCommitlint({})).toBe(false)
		expect(hasCommitlint(null)).toBeUndefined()
	})
})
