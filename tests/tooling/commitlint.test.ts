import { describe, expect, it } from 'vitest'
import config from '../../tooling/commitlint/commitlint.mjs'

const isIgnored = (commit: string) => (config.ignores ?? []).some((predicate) => predicate(commit))

describe('commitlint ignores', () => {
	it('ignores release commits marked [skip ci]', () => {
		expect(isIgnored('chore(release): 3.2.2 [skip ci]')).toBe(true)
	})

	it('ignores dependabot commits with unwrappable YAML bodies', () => {
		const commit = [
			'chore(deps): bump @docusaurus/types from 3.9.2 to 3.9.3',
			'',
			'Updates `@docusaurus/types` from 3.9.2 to 3.9.3.',
			'',
			'updated-dependencies:',
			'- dependency-name: "@docusaurus/types"',
			'  dependency-version: 3.9.3',
			'  dependency-type: direct:development',
			'  update-type: version-update:semver-patch',
			'',
			'Signed-off-by: dependabot[bot] <support@github.com>',
		].join('\n')
		expect(isIgnored(commit)).toBe(true)
	})

	it('ignores renovate commits', () => {
		expect(
			isIgnored('chore(deps): update node\n\nSigned-off-by: renovate[bot] <bot@renovateapp.com>')
		).toBe(true)
	})

	it('still lints a human commit that merely mentions a bot', () => {
		expect(isIgnored('fix(ci): stop dependabot[bot] from reopening the same PR')).toBe(false)
	})

	it('still lints an ordinary commit', () => {
		expect(isIgnored('feat(swift): add DocC check\n\nCloses #311')).toBe(false)
	})
})

describe('commitlint line-length rules', () => {
	// Six sibling repos consume this preset with no override, so a stray
	// re-tightening here silently breaks every agent-written BREAKING CHANGE
	// footer downstream.
	it('leaves body and footer line length unenforced', () => {
		expect(config.rules['body-max-line-length']).toEqual([0])
		expect(config.rules['footer-max-line-length']).toEqual([0])
	})

	it('caps the header at 100 so squash suffixes fit', () => {
		expect(config.rules['header-max-length']).toEqual([2, 'always', 100])
	})
})
