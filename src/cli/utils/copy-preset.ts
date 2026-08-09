import path from 'node:path'
import fs from 'fs-extra'

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
	| 'claude-skill'
	| 'mcp-example'
	| 'docusaurus-sync-changelog'
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
	'claude-skill': {
		source: 'tooling/claude/repo-tooling.md',
		target: '.claude/skills/repo-tooling.md',
		desc: 'Claude Code skill for driving the repo-tooling CLI',
		legacyTarget: '.claude/skills/js-tooling.md',
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

	return {
		source: preset.source,
		target: preset.target,
		targetPath,
		desc: preset.desc,
	}
}
