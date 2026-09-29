import { describe, expect, it } from 'vitest'
import { renderGitHubWorkflow } from '../../../src/base/ci.js'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import { githubJobs, hasBin } from '../../../src/languages/js/ci.js'

const render = (bin?: boolean) =>
	renderGitHubWorkflow(githubJobs(buildPresetConfig('library', 'x'), { bin }))

describe('packed-tarball smoke test (#693)', () => {
	it('is emitted only for a package with a bin', () => {
		expect(render(true)).toContain('Smoke-test the packed tarball')
		expect(render(true)).toContain('npm pack')
		expect(render(false)).not.toContain('npm pack')
		expect(render()).not.toContain('npm pack')
	})

	it('hasBin reads package.json', () => {
		expect(hasBin({ bin: { x: 'a.js' } })).toBe(true)
		expect(hasBin({})).toBe(false)
		expect(hasBin(null)).toBe(false)
	})
})
