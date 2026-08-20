import { createHash } from 'node:crypto'
import path from 'node:path'
import fs from 'fs-extra'
import { recordAssetHash } from './lockfile.js'

export type PresetName =
	| 'biome'
	| 'bun'
	| 'nx'
	| 'changesets'
	| 'release-please'
	| 'oxlint'
	| 'tsconfig'
	| 'swiftlint'
	| 'swift-format'
	| 'periphery'
	| 'ruff'
	| 'mypy'
	| 'pytest'
	| 'perlcritic'
	| 'perltidy'
	| 'claude-skill'
	| 'claude-sync-agents'
	| 'mcp-example'
	| 'docusaurus-sync-changelog'
	| 'docusaurus-docs-helpers'
	| 'docusaurus-theme-tokens'
	| 'docusaurus-theme'

export interface PresetDefinition {
	source: string
	target: string
	desc: string
	/** Pre-rename path removed after a successful copy, so consumers migrate cleanly. */
	legacyTarget?: string
}

export const PRESETS: Record<PresetName, PresetDefinition> = {
	biome: {
		source: 'tooling/biome/biome.json',
		target: 'biome.json',
		desc: 'Biome formatter and linter configuration',
	},
	bun: {
		source: 'tooling/bun/bunfig.toml',
		target: 'bunfig.toml',
		desc: 'Bun runtime/test-runner configuration',
	},
	nx: {
		source: 'tooling/nx/nx.json',
		target: 'nx.json',
		desc: 'Nx monorepo task-orchestrator configuration',
	},
	changesets: {
		source: 'tooling/changesets/config.json',
		target: '.changeset/config.json',
		desc: 'Changesets release-tool configuration',
	},
	'release-please': {
		source: 'tooling/release-please/release-please-config.json',
		target: 'release-please-config.json',
		desc: 'Release Please release-tool configuration',
	},
	oxlint: {
		source: 'tooling/oxlint/oxlintrc.json',
		target: '.oxlintrc.json',
		desc: 'Oxlint linter configuration (additive to Biome)',
	},
	tsconfig: {
		source: 'tooling/typescript/tsconfig.base.json',
		target: 'tsconfig.json',
		desc: 'TypeScript base configuration',
	},
	swiftlint: {
		source: 'tooling/swift/swiftlint.yml',
		target: '.swiftlint.yml',
		desc: 'SwiftLint configuration (lint + --fix; the standard swift-common runs)',
	},
	'swift-format': {
		source: 'tooling/swift/swift-format.json',
		target: '.swift-format',
		desc: "Apple swift-format configuration (4-space, 120 columns — matches the module's .editorconfig)",
	},
	periphery: {
		source: 'tooling/swift/periphery.yml',
		target: '.periphery.yml',
		desc: 'Periphery dead-code scan configuration (retains public API)',
	},
	ruff: {
		source: 'tooling/python/ruff.toml',
		target: 'ruff.toml',
		desc: 'Ruff configuration (lint + format — replaces flake8, isort, pyupgrade and black)',
	},
	mypy: {
		source: 'tooling/python/mypy.ini',
		target: 'mypy.ini',
		desc: 'mypy configuration (strict on your code, lenient on untyped dependencies)',
	},
	pytest: {
		source: 'tooling/python/pytest.ini',
		target: 'pytest.ini',
		desc: 'pytest configuration (strict markers and config, warnings as errors)',
	},
	perlcritic: {
		source: 'tooling/perl/perlcriticrc',
		target: '.perlcriticrc',
		desc: 'Perl::Critic configuration (severity 3, with the family rule exceptions)',
	},
	perltidy: {
		source: 'tooling/perl/perltidyrc',
		target: '.perltidyrc',
		desc: 'perltidy configuration (Perl Best Practices layout at 100 columns)',
	},
	'claude-skill': {
		source: 'tooling/claude/repo-tooling.md',
		target: '.claude/skills/repo-tooling.md',
		desc: 'Claude Code skill for driving the repo-tooling CLI',
		legacyTarget: '.claude/skills/js-tooling.md',
	},
	'claude-sync-agents': {
		source: 'tooling/claude/sync-agents.mjs',
		target: 'scripts/sync-agents.mjs',
		desc: 'Canonical SKILL.md → AGENTS.md sync script (zero-config; --check mode for CI)',
	},
	'mcp-example': {
		source: 'tooling/mcp/mcp.json.example',
		target: '.mcp.json.example',
		desc: 'Commented MCP server template (copy to .mcp.json to activate)',
	},
	'docusaurus-sync-changelog': {
		source: 'tooling/docusaurus/sync-changelog.mjs',
		target: 'scripts/sync-changelog.mjs',
		desc: 'Canonical CHANGELOG → docs sync script for Docusaurus sites',
	},
	'docusaurus-docs-helpers': {
		source: 'tooling/docusaurus/docs-helpers.mjs',
		target: 'scripts/docs-helpers.mjs',
		desc: 'Docs-generator helpers (markdown-table escaping, export parser, generated-block splice)',
	},
	'docusaurus-theme-tokens': {
		source: 'tooling/docusaurus/theme-tokens.css',
		target: 'apps/docs/src/css/_jt-tokens.css',
		desc: 'Shared Docusaurus design tokens (Geist + navy surfaces; accent per-project)',
	},
	'docusaurus-theme': {
		source: 'tooling/docusaurus/theme.css',
		target: 'apps/docs/src/css/theme.css',
		desc: 'Shared Docusaurus component theme (navbar, cards, sidebar, footer, tables; accent-agnostic — @import after docusaurus-theme-tokens)',
	},
}

export function getPackageRoot(): string {
	const cliFile = new URL(import.meta.url).pathname
	return path.dirname(path.dirname(path.dirname(path.dirname(cliFile))))
}

export interface CopyPresetResult {
	source: string
	target: string
	targetPath: string
	desc: string
}

/** sha256 of a file's bytes, or null when it doesn't exist / can't be read. */
export async function hashFile(filepath: string): Promise<string | null> {
	try {
		return createHash('sha256')
			.update(await fs.readFile(filepath))
			.digest('hex')
	} catch {
		return null
	}
}

export async function copyPreset(
	name: PresetName,
	targetDir: string = process.cwd()
): Promise<CopyPresetResult> {
	const preset = PRESETS[name]
	const packageRoot = getPackageRoot()
	const sourcePath = path.join(packageRoot, preset.source)
	const targetPath = path.join(targetDir, preset.target)

	await fs.copy(sourcePath, targetPath)

	// Remove the pre-rename artifact so a re-run migrates it instead of leaving both.
	if (preset.legacyTarget) {
		const legacyPath = path.join(targetDir, preset.legacyTarget)
		if (legacyPath !== targetPath) await fs.remove(legacyPath)
	}

	// Stamp what was copied, so doctor can later tell a local edit from a copy
	// the package has moved past (#428). No-ops when the repo has no lockfile.
	const hash = await hashFile(sourcePath)
	if (hash) await recordAssetHash(targetDir, name, hash)

	return {
		source: preset.source,
		target: preset.target,
		targetPath,
		desc: preset.desc,
	}
}
