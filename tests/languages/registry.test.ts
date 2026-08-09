import { describe, expect, it } from 'vitest'
import { LANGUAGES, resolveLanguageModule } from '../../src/languages/registry.js'

describe('resolveLanguageModule', () => {
	it('maps unknown (bare dir mid-setup) to the JS module', () => {
		expect(resolveLanguageModule('unknown')).toBe(LANGUAGES.js)
	})

	it.each(['js', 'swift', 'python', 'perl'] as const)('resolves %s to its own module', (id) => {
		expect(resolveLanguageModule(id).id).toBe(id)
	})

	it('every registered language now carries a module', () => {
		// Swift flipped with its module (#286), Python with #290, Perl with #289.
		// The flag stays as the on-ramp: a new language is registered with
		// `supported: false` and gets the base suite until its module lands.
		for (const language of Object.values(LANGUAGES)) {
			expect(language.supported, language.id).toBe(true)
		}
	})

	it('carries the CodeQL matrix identifier the code-scanning workflow uses', () => {
		expect(LANGUAGES.js.codeqlLanguages).toEqual(['javascript-typescript'])
		expect(LANGUAGES.perl.codeqlLanguages).toEqual([]) // CodeQL has no Perl analyzer
	})
})
