import { BASE_FIXERS, type Fixer } from '../../base/fixers.js'
import { FIXERS } from '../../languages/js/fixers.js'
import { PERL_FIXERS } from '../../languages/perl/fixers.js'
import { PYTHON_FIXERS } from '../../languages/python/fixers.js'
import { SWIFT_FIXERS } from '../../languages/swift/fixers.js'

/** The module-specific fixer set per detected language (#286, #289, #290, #303). */
const LANGUAGE_FIXERS: Record<string, Fixer[]> = {
	js: FIXERS,
	swift: SWIFT_FIXERS,
	python: PYTHON_FIXERS,
	perl: PERL_FIXERS,
}

/**
 * The fixers that apply to a repo, by detected language: the language-agnostic
 * base set plus the module's own. A repo with no marker gets the base set only —
 * the JS fixers would run against a missing package.json (#632). Doctor reads it
 * too, so it never suggests a target `fix` would call unknown (#827).
 */
export function fixersForLanguage(language: string): Fixer[] {
	return [...BASE_FIXERS, ...(LANGUAGE_FIXERS[language] ?? [])]
}

/** Every fixer across every language — for `--list` and the unknown-target hint. */
export const ALL_FIXERS: Fixer[] = [
	...BASE_FIXERS,
	...FIXERS,
	...SWIFT_FIXERS,
	...PYTHON_FIXERS,
	...PERL_FIXERS,
]
