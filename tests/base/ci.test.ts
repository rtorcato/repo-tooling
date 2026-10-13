import { describe, expect, it } from 'vitest'
import {
	type CiJob,
	renderCodeQLWorkflow,
	renderGitHubWorkflow,
	renderGitLabCI,
} from '../../src/base/ci.js'

// The point of the skeleton (#283) is that it carries no Node in it. These tests
// drive it with Swift-shaped steps — if a `setup-node` or `pnpm` ever leaks back
// into src/base/ci.ts, they fail. The JS output itself is covered byte-for-byte
// by tests/cli/generators/{github-actions,gitlab-ci,security}.test.ts.

const SWIFT_JOB: CiJob = {
	id: 'test',
	needs: ['build'],
	steps: `      - name: Run tests
        run: swift test`,
}

describe('renderGitHubWorkflow', () => {
	it('emits no language-specific tooling of its own', () => {
		const yaml = renderGitHubWorkflow([SWIFT_JOB])
		expect(yaml).not.toMatch(/setup-node|pnpm|npm|node_modules/)
		expect(yaml).toContain('run: swift test')
	})

	it('appends check-skip to every job and gates on the skip output', () => {
		const yaml = renderGitHubWorkflow([SWIFT_JOB])
		expect(yaml).toContain('needs: [build, check-skip]')
		expect(yaml).toContain("if: needs.check-skip.outputs.should-skip != 'true'\n")
	})

	it('renders a lone dependency as a scalar, not a one-item list', () => {
		const yaml = renderGitHubWorkflow([{ id: 'build', steps: '      - run: swift build' }])
		expect(yaml).toContain('needs: check-skip\n')
	})

	it('ANDs an extra condition onto the skip gate', () => {
		const yaml = renderGitHubWorkflow([
			{ ...SWIFT_JOB, id: 'release', if: "github.ref == 'refs/heads/main'" },
		])
		expect(yaml).toContain(
			"if: needs.check-skip.outputs.should-skip != 'true' && github.ref == 'refs/heads/main'"
		)
	})

	it('places job-level extras between if: and steps:', () => {
		const yaml = renderGitHubWorkflow([
			{ ...SWIFT_JOB, extra: '    permissions:\n      id-token: write' },
		])
		expect(yaml).toMatch(/if: .*\n {4}permissions:\n {6}id-token: write\n {4}steps:/)
	})

	it('separates jobs by one blank line and ends with a single newline', () => {
		const yaml = renderGitHubWorkflow([
			{ id: 'build', steps: '      - run: swift build' },
			SWIFT_JOB,
		])
		expect(yaml).not.toMatch(/\n\n\n/)
		expect(yaml.endsWith('cancelled "* ]]\n')).toBe(true)
	})

	it('ends with a `ci` gate that needs every job and runs even when one fails (#816)', () => {
		const yaml = renderGitHubWorkflow([
			{ id: 'build', steps: '      - run: swift build' },
			SWIFT_JOB,
		])
		const gate = yaml.slice(yaml.indexOf('\n  ci:\n'))
		expect(gate).toContain('needs: [check-skip, build, test]')
		expect(gate).toContain('if: always()')
		// Not skip-guarded: a skipped required check would pass a red run.
		expect(gate).not.toContain('should-skip')
		expect(gate).toContain('[[ " $RESULTS " != *" failure "* && " $RESULTS " != *" cancelled "* ]]')
	})
})

describe('renderCodeQLWorkflow', () => {
	it('takes its matrix from the caller', () => {
		expect(renderCodeQLWorkflow(['swift'])).toContain('language: [swift]')
		expect(renderCodeQLWorkflow(['javascript-typescript', 'python'])).toContain(
			'language: [javascript-typescript, python]'
		)
	})
})

describe('renderGitLabCI', () => {
	const spec = {
		image: 'swift:6.0',
		preamble: 'default:\n  before_script:\n    - swift --version',
		jobs: [
			{ id: 'lint', stage: 'test', script: ['swift format lint .'] },
			{
				id: 'build',
				stage: 'build',
				script: ['swift build'],
				extra: '  artifacts:\n    paths:\n      - .build/',
			},
		],
	}

	it('derives stages from the jobs in first-appearance order', () => {
		expect(renderGitLabCI(spec)).toContain('stages:\n  - test\n  - build\n')
	})

	it('de-duplicates a stage shared by several jobs', () => {
		const yaml = renderGitLabCI({
			...spec,
			jobs: [
				{ id: 'lint', stage: 'test', script: ['a'] },
				{ id: 'unit', stage: 'test', script: ['b'] },
			],
		})
		expect(yaml).toContain('stages:\n  - test\n\n')
	})

	it('still emits a valid stages: key with no jobs', () => {
		const yaml = renderGitLabCI({ ...spec, jobs: [] })
		expect(yaml).toContain('stages:\n  - test\n')
		expect(yaml).not.toMatch(/\n\n\n/)
	})

	it('renders scripts and job extras', () => {
		const yaml = renderGitLabCI(spec)
		expect(yaml).toContain('image: swift:6.0')
		expect(yaml).toContain('build:\n  stage: build\n  script:\n    - swift build\n  artifacts:')
	})
})
