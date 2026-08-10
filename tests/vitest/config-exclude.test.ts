import { describe, expect, it } from 'vitest'
import { configDefaults } from 'vitest/config'
// @ts-expect-error — .mjs preset ships no types; we only read runtime values here.
import config from '../../tooling/vitest/vitest.config.mjs'

describe('vitest preset exclude', () => {
	it('ignores Claude Code worktrees so mirrored test files are not collected twice', () => {
		const exclude = config.test?.exclude ?? []
		expect(exclude).toContain('.claude/**')
		// still keeps vitest's built-in defaults (node_modules, dist, …).
		for (const def of configDefaults.exclude) {
			expect(exclude).toContain(def)
		}
	})

	it('declares no resolve.alias — generated configs import this preset now', () => {
		// An alias built from the preset's own __dirname points inside
		// node_modules, so it would resolve `@/…` to a directory that doesn't
		// exist in any consumer (#387).
		expect(config.resolve?.alias).toBeUndefined()
	})

	it('emits lcov so the CI we generate has something to upload to Codecov', () => {
		expect(config.test?.coverage?.reporter).toContain('lcov')
	})
})
