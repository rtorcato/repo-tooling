import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'
import { parseJsonc } from '../utils/jsonc.js'

export async function generateLintingConfigs(config: ProjectConfig, targetDir: string) {
	// Generate Biome config
	if (config.linting.tool === 'biome' || config.linting.tool === 'both') {
		await generateBiomeConfig(targetDir)
	}

	// Generate ESLint config
	if (config.linting.tool === 'eslint' || config.linting.tool === 'both') {
		await generateESLintConfig(config, targetDir)
	}

	// Generate Prettier config if using ESLint
	if (config.linting.tool === 'eslint') {
		await generatePrettierConfig(targetDir)
	}

	// Generate Oxlint config (additive — runs alongside Biome/ESLint)
	if (config.oxlint) {
		await generateOxlintConfig(targetDir)
	}
}

export async function generateOxlintConfig(targetDir: string) {
	// Oxlint's `extends` resolution from npm packages isn't reliably supported,
	// so we copy the full preset rather than write a thin pointer file.
	const { copyPreset } = await import('../utils/copy-preset.js')
	await copyPreset('oxlint', targetDir)
}

/** The one Biome config filename every code path writes. See BIOME_LEGACY_CONFIG. */
export const BIOME_CONFIG = 'biome.json'

/**
 * The name this generator used to write. Biome resolves `biome.json` first and
 * says nothing about a `biome.jsonc` sitting next to it, so a repo that had run
 * both `fix biome` (biome.json) and `fix --resync` (biome.jsonc) ended up with
 * two configs, one of them silently dead (#365). Both paths now write
 * BIOME_CONFIG and delete this on the way past, so the ambiguity can't persist.
 */
export const BIOME_LEGACY_CONFIG = 'biome.jsonc'

/**
 * Unversioned on purpose (#468). A `$schema` naming an exact version is only
 * ever right until the next `@biomejs/biome` bump, at which point Biome prints
 * "The configuration schema version does not match the CLI version" on every
 * invocation and doctor reports drift — so every Dependabot bump needed a hand
 * edit before it could go green. Biome accepts `latest` and says nothing about
 * it (verified against 2.5.5), which removes the failure class outright.
 *
 * `latest` rather than dropping the key: editors still resolve a real schema
 * for autocomplete and validation, which is the only reason the key is there.
 */
const BIOME_SCHEMA_URL = 'https://biomejs.dev/schemas/latest/schema.json'

/** The preset pointer this generator guarantees, and what already counts as it. */
const BIOME_PRESET = '@rtorcato/repo-tooling/biome'
/** Kept in step with doctor's matcher — the old js-tooling path still counts. */
const BIOME_PRESET_REF = /@rtorcato\/(?:js|repo)-tooling\/biome/

/**
 * The thin pointer config — the same shape this repo dogfoods. `fix biome` used
 * to copy the whole preset inline instead, which meant the scaffolded file
 * carried no `@rtorcato/repo-tooling/biome` reference for doctor's Biome check
 * to match, and preset improvements never reached consumers.
 *
 * A merge, not a rewrite (#587): only `$schema`, `extends` and a
 * `linter.enabled: false` kill switch are this generator's to own, so every
 * other key an existing biome.json carries — `files.includes`, a css parser
 * flag, rule overrides — survives. Returns null and writes nothing when the
 * existing file doesn't parse, since there is no way to merge into it and
 * overwriting would destroy settings we cannot even read.
 */
export async function generateBiomeConfig(targetDir: string): Promise<string | null> {
	const file = path.join(targetDir, BIOME_CONFIG)
	let existing: Record<string, any> = {}
	if (await fs.pathExists(file)) {
		const parsed = parseJsonc(await fs.readFile(file, 'utf-8'))
		if (!parsed) return null
		existing = parsed
	}

	// Biome 2.x schema + shape. The base preset (extends) already defines the
	// file globs via `files.includes`; emitting the old 1.x `include`/`ignore`
	// keys here forced consumers to run `biome migrate` before `biome check`
	// would run at all.
	const { $schema: _schema, extends: prevExtends, linter, ...rest } = existing
	const prev = Array.isArray(prevExtends)
		? prevExtends
		: typeof prevExtends === 'string'
			? [prevExtends]
			: []
	const extendsList = prev.some((e) => typeof e === 'string' && BIOME_PRESET_REF.test(e))
		? prev
		: [BIOME_PRESET, ...prev]

	// The one consumer key that isn't kept: `linter.enabled: false` is precisely
	// the drift doctor flags, so preserving it would leave the repo red after a
	// run that reported success. Rule overrides under `linter.rules` stay.
	const nextLinter = linter && typeof linter === 'object' ? { ...linter } : undefined
	if (nextLinter?.enabled === false) delete nextLinter.enabled

	const biomeConfig = {
		$schema: BIOME_SCHEMA_URL,
		extends: extendsList,
		...(nextLinter && Object.keys(nextLinter).length > 0 ? { linter: nextLinter } : {}),
		...rest,
	}

	await fs.writeJson(file, biomeConfig, { spaces: 2 })
	await fs.remove(path.join(targetDir, BIOME_LEGACY_CONFIG))
	return BIOME_CONFIG
}

export async function generateESLintConfig(config: ProjectConfig, targetDir: string) {
	const eslintConfigPath = path.join(targetDir, 'eslint.config.mjs')

	const configType = config.linting.eslintConfig || 'base'

	// eslint/nextjs is a fragment: it registers the @next/next plugin and its
	// rules but sets no parser, so on its own it can't even parse .tsx ("Parsing
	// error: Unexpected token <"). It has to be layered onto the base config,
	// which is what brings typescript-eslint.
	const eslintConfig =
		configType === 'nextjs'
			? `import base from '@rtorcato/repo-tooling/eslint/base'
import nextjs from '@rtorcato/repo-tooling/eslint/nextjs'

export default [...base, ...nextjs]
`
			: `import { default as config } from '@rtorcato/repo-tooling/eslint/${configType}'

export default config
`

	await fs.writeFile(eslintConfigPath, eslintConfig)
}

export async function generatePrettierConfig(targetDir: string) {
	const prettierConfigPath = path.join(targetDir, 'prettier.config.mjs')

	const prettierConfig = `export { default } from '@rtorcato/repo-tooling/prettier'
`

	await fs.writeFile(prettierConfigPath, prettierConfig)
}
