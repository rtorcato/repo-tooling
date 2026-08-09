import type { DetectedLanguage } from '../cli/utils/detect-language.js'

/**
 * The contract every per-language module implements. This is the seam the
 * multi-language milestone (#139) builds on: `doctor`/`fix`/`setup` resolve the
 * module matching the repo's detected language and merge it with the base suite.
 *
 * ponytail: only the fields with a real consumer today live here. `checks` /
 * `fixers` land when the JS suite is split into base vs language (#281); `ciSteps`
 * lands when the CI generators are de-noded (#283). Adding them now as empty
 * arrays nothing reads would be speculative scaffolding — the issues that fill
 * them extend this interface.
 */
export interface LanguageModule {
	id: Exclude<DetectedLanguage, 'unknown'>
	label: string
	/** CodeQL language identifiers for this language's code-scanning matrix (#287). */
	codeqlLanguages: readonly string[]
	/**
	 * Dependabot `package-ecosystem` for this language's manifests, or null when
	 * Dependabot has no support for it (Perl/CPAN). Null still gets the
	 * github-actions update block — that one applies to any repo with workflows.
	 */
	dependabotEcosystem: string | null
	/**
	 * Whether repo-tooling's doctor/fix suite covers this language yet. Every
	 * language in the registry does, as of the Perl module (#289) — the flag
	 * stays because the seam is what a *new* language arrives through.
	 */
	supported: boolean
}

export const LANGUAGES: Record<LanguageModule['id'], LanguageModule> = {
	js: {
		id: 'js',
		label: 'JavaScript/TypeScript',
		codeqlLanguages: ['javascript-typescript'],
		dependabotEcosystem: 'npm',
		supported: true,
	},
	swift: {
		id: 'swift',
		label: 'Swift',
		codeqlLanguages: ['swift'],
		dependabotEcosystem: 'swift',
		supported: true,
	},
	python: {
		id: 'python',
		label: 'Python',
		codeqlLanguages: ['python'],
		dependabotEcosystem: 'pip',
		supported: true,
	},
	perl: {
		id: 'perl',
		label: 'Perl',
		codeqlLanguages: [],
		dependabotEcosystem: null,
		supported: true,
	},
}

/**
 * Resolve the module for a detected language. `unknown` (a bare dir mid-setup)
 * maps to JS — the historical default so a fresh repo still gets the full suite.
 */
export function resolveLanguageModule(language: DetectedLanguage): LanguageModule {
	return language === 'unknown' ? LANGUAGES.js : LANGUAGES[language]
}
