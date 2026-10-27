import { describe, expect, it } from 'vitest'
import { baseOptions } from '../../tooling/tsup/index.mjs'

describe('tsup baseOptions bundle default (#942)', () => {
	it('keeps bundle: false with the default glob entry', () => {
		expect(baseOptions({}, 'production').bundle).toBe(false)
	})

	it('bundles when the caller narrows entry', () => {
		expect(baseOptions({ entry: ['src/index.ts'] }, 'production').bundle).toBe(true)
	})

	it('respects an explicit bundle: false with a narrowed entry', () => {
		expect(baseOptions({ entry: ['src/index.ts'], bundle: false }, 'production').bundle).toBe(false)
	})
})
