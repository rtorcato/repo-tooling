import fs from 'fs-extra'
import path from 'node:path'
import type { ProjectConfig } from '../commands/setup.js'

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
 * Used when nothing in the target repo says which Biome will read the config —
 * a bare directory mid-`setup`, before `pnpm install` has run. Matches the
 * `$schema` the shipped preset carries.
 */
const BIOME_SCHEMA_FALLBACK = '2.5.0'

async function readJsonOrNull(filepath: string): Promise<Record<string, unknown> | null> {
	try {
		return (await fs.readJson(filepath)) as Record<string, unknown>
	} catch {
		return null
	}
}

/**
 * The Biome version the scaffolded `$schema` URL should name (#363).
 *
 * A hardcoded version drifts the moment the consumer's Biome moves, and Biome
 * reports the mismatch on *every* invocation ("The configuration schema version
 * does not match the CLI version 2.5.7") — noise on a file the consumer never
 * wrote. The installed package wins because it is literally the binary that
 * will parse the file and emit that warning; the declared range is the next
 * best statement of intent when node_modules isn't populated yet.
 */
export async function resolveBiomeSchemaVersion(targetDir: string): Promise<string> {
	const installed = await readJsonOrNull(
		path.join(targetDir, 'node_modules', '@biomejs', 'biome', 'package.json')
	)
	const pkg = await readJsonOrNull(path.join(targetDir, 'package.json'))
	const deps = {
		...((pkg?.dependencies as Record<string, string> | undefined) ?? {}),
		...((pkg?.devDependencies as Record<string, string> | undefined) ?? {}),
	}

	// Both an exact version ("2.5.7") and a range ("^2.5.0") carry the x.y.z we
	// need, so one pattern covers every source.
	for (const candidate of [installed?.version, deps['@biomejs/biome']]) {
		const match = typeof candidate === 'string' ? /(\d+\.\d+\.\d+)/.exec(candidate) : null
		if (match?.[1]) return match[1]
	}
	return BIOME_SCHEMA_FALLBACK
}

/**
 * The thin pointer config — the same shape this repo dogfoods. `fix biome` used
 * to copy the whole preset inline instead, which meant the scaffolded file
 * carried no `@rtorcato/repo-tooling/biome` reference for doctor's Biome check
 * to match, and preset improvements never reached consumers.
 */
export async function generateBiomeConfig(targetDir: string): Promise<string> {
	// Biome 2.x schema + shape. The base preset (extends) already defines the
	// file globs via `files.includes`; emitting the old 1.x `include`/`ignore`
	// keys here forced consumers to run `biome migrate` before `biome check`
	// would run at all.
	const version = await resolveBiomeSchemaVersion(targetDir)
	const biomeConfig = {
		$schema: `https://biomejs.dev/schemas/${version}/schema.json`,
		extends: ['@rtorcato/repo-tooling/biome'],
	}

	await fs.writeJson(path.join(targetDir, BIOME_CONFIG), biomeConfig, { spaces: 2 })
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
