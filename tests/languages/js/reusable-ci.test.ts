import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { workflowJobs } from '../../../src/base/github-settings.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import {
	REUSABLE_JS_CI_PIN,
	REUSABLE_JS_CI_WORKFLOW,
	githubJobs,
	renderJsCiWorkflow,
	renderReusableJsCiWorkflow,
} from '../../../src/languages/js/ci.js'

const SHA = '0123456789abcdef0123456789abcdef01234567'
const pin = { sha: SHA, version: '6.6.0' }
const lib = buildPresetConfig('library', 'x')
const caller = (config = lib, opts = {}) => renderJsCiWorkflow(config, opts, pin)

describe('reusable JS CI workflow (#1037)', () => {
	const full = renderReusableJsCiWorkflow()
	// The header comment shows a sample caller; assertions are about the YAML itself.
	const yaml = full
		.split('\n')
		.filter((l) => !/^\s*#/.test(l))
		.join('\n')

	it('is the committed .github/workflows/js-ci.yml (run `pnpm sync:ci` after editing the generator)', () => {
		expect(readFileSync(REUSABLE_JS_CI_WORKFLOW, 'utf-8')).toBe(full)
	})

	it('is read-only: contents: read, no secrets block, no write permission', () => {
		expect(yaml).toMatch(/^permissions:\n {2}contents: read\n/m)
		expect(yaml).not.toMatch(/^\s*secrets:/m)
		expect(yaml).not.toContain('inherit')
		expect(yaml).not.toMatch(/(?:write|id-token)/)
	})

	it('moves dependencies, lint, commitlint, changeset, typecheck, test and build', () => {
		expect([...workflowJobs(yaml).keys()]).toEqual([
			'dependencies',
			'lint',
			'commitlint',
			'changeset',
			'typecheck',
			'test',
			'build',
		])
	})

	it('leaves triggers, check-skip and the ci gate to the caller', () => {
		expect(yaml).not.toMatch(/^ {2}(?:push|pull_request|workflow_dispatch):/m)
		expect(yaml).not.toContain('concurrency:')
		expect(workflowJobs(yaml).has('ci')).toBe(false)
		expect(workflowJobs(yaml).has('check-skip')).toBe(false)
	})

	it('never puts an input expression inside a run script', () => {
		for (const line of yaml.split('\n')) {
			if (/^\s+run:/.test(line)) expect(line).not.toContain('inputs.')
		}
	})

	it('pins every action it uses to a commit SHA', () => {
		for (const [, ref] of yaml.matchAll(/uses:\s*(\S+)/g)) {
			expect(ref).toMatch(/@[0-9a-f]{40}$/)
		}
	})

	it('takes the test matrix from an input', () => {
		expect(yaml).toContain('node: ${{ fromJSON(inputs.node-matrix) }}')
		expect(yaml).toContain("default: '[22,26]'")
	})
})

describe('thin caller (#1037)', () => {
	it('keeps the inline pipeline until a pin is set', () => {
		expect(REUSABLE_JS_CI_PIN).toBeNull()
		expect(renderJsCiWorkflow(lib, {})).toBe(renderGitHubWorkflow(githubJobs(lib, {})))
	})

	it('calls the reusable workflow at a full SHA with a version comment, passing no secrets', () => {
		const yaml = caller()
		expect(yaml).toContain(
			`uses: rtorcato/repo-tooling/.github/workflows/js-ci.yml@${SHA} # v6.6.0`
		)
		expect(yaml).not.toMatch(/secrets:/)
		expect(yaml).not.toContain('setup-node')
		expect(yaml).not.toContain('pnpm install')
	})

	it('keeps on:, concurrency, check-skip and a ci gate that needs the uses: job', () => {
		const yaml = caller()
		expect(yaml).toMatch(/^on:\n {2}push:/m)
		expect(yaml).toContain('concurrency:')
		const jobs = workflowJobs(yaml)
		expect([...jobs.keys()]).toEqual(['check-skip', 'checks', 'ci'])
		expect(jobs.get('checks')).toContain('needs: check-skip')
		expect(jobs.get('checks')).toContain("if: needs.check-skip.outputs.should-skip != 'true'")
		expect(jobs.get('checks')).toMatch(/permissions:\n {6}contents: read/)
		expect(jobs.get('ci')).toContain('needs: [check-skip, checks]')
		expect(jobs.get('ci')).toContain('if: always()')
	})

	it('passes changesets and commitlint, and re-runs on a retitled PR', () => {
		const yaml = caller({ ...lib, changesets: true, semanticRelease: false, commitLint: true })
		expect(yaml).toMatch(/with:\n(?: {6}.+\n)*? {6}changesets: true/)
		expect(yaml).toContain('      commitlint: true')
		expect(yaml).toContain('types: [opened, synchronize, reopened, edited]')
	})

	it('omits commitlint and the edited trigger when the repo has no commitlint', () => {
		const yaml = caller({ ...lib, commitLint: false })
		expect(yaml).not.toContain('commitlint')
		expect(yaml).not.toContain('edited')
	})

	it('gates inputs on the repo scripts, as the inline jobs do', () => {
		const yaml = caller(lib, { scripts: { test: 'vitest', check: 'biome check .' } })
		expect(yaml).toContain('      typecheck: false')
		expect(yaml).toContain('      build: false')
		expect(yaml).not.toContain('knip')
		const none = caller(lib, { scripts: {} })
		expect(none).toContain("lint-script: ''")
		expect(none).toContain("test-script: ''")
	})

	it('passes the repo’s own node floor as the test matrix', () => {
		expect(caller(lib, { nodeFloor: 24 })).toContain(`node-matrix: '[24,26]'`)
		expect(caller(lib, {})).not.toContain('node-matrix')
	})

	it('passes the library checks and the pack smoke test', () => {
		const yaml = caller({ ...lib, publint: true }, { bin: true })
		expect(yaml).toContain('      attw: true')
		expect(yaml).toContain('      publint: true')
		expect(yaml).toContain('      pack-smoke: true')
	})
})
