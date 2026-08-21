import fs from 'fs-extra'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateSwiftProject } from '../../languages/swift/scaffold.js'
import type { ProjectConfig } from '../commands/setup.js'
import { installAiSetup } from './agent-rules.js'
import { bundlerNeedsEsbuild, ensureBuildApprovals, generateBuildConfigs } from './build.js'
import { ensurePnpmSettings, familyGlob } from './pnpm-workspace.js'
import { generateGitConfigs } from './git.js'
import { generateGitHubActions } from './github-actions.js'
import { generateLintingConfigs } from './linting.js'
import {
	generateKnipConfig,
	generateMiscBaseline,
	generateSizeLimitConfig,
	generateVscodeExtensions,
} from './misc.js'
import { generatePackageJson } from './package-json.js'
import { generateReadme } from './readme.js'
import { generateSecurityConfigs } from './security.js'
import { generateTestingConfigs } from './testing.js'
import { generateTreeshakeCheck, inferSubpathsFromExports } from './treeshake.js'
import { generateTSConfig } from './tsconfig.js'
import { generateTailwind } from './tailwind.js'
import { generateTurborepo } from './turborepo.js'
import { generateNx } from './nx.js'
import { generateBun } from './bun.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export async function generateConfigs(config: ProjectConfig, targetDir: string) {
	// Swift takes its own path (#288) rather than opting out of each step below.
	// Everything from here down is rooted in package.json — the file a Swift repo
	// is defined by not having.
	if (config.language === 'swift') {
		return generateSwiftProject(config, targetDir)
	}

	// Generate package.json (must run before generateMiscBaseline,
	// which sets engines.node on the resulting file)
	await generatePackageJson(config, targetDir)

	// Universal baseline: .editorconfig, .nvmrc, engines.node, knip.json
	await generateMiscBaseline(targetDir)

	// Bundle-size budget for publishable libraries. getScripts() emits the
	// matching `size-limit` script, so the budget is runnable from the first
	// commit rather than an inert file implying enforcement (#382).
	if (config.projectType === 'library') {
		await generateSizeLimitConfig(targetDir)
	}

	// Recommend the editor extensions matching the enabled tools
	await generateVscodeExtensions(config, targetDir)

	// Generate TypeScript configuration
	if (config.typescript.enabled) {
		await generateTSConfig(config, targetDir)
	}

	// Generate linting configurations
	if (config.linting.tool !== 'none') {
		await generateLintingConfigs(config, targetDir)
	}

	// Generate testing configurations
	if (config.testing.framework !== 'none') {
		await generateTestingConfigs(config, targetDir)
	}

	// Unconditional: generateGitConfigs already gates husky and commitlint on
	// their own flags, and the .gitignore it also writes has nothing to do with
	// either. Gating the whole call meant any scaffold that declined git hooks —
	// which is every `minimal` run (#461) — got no .gitignore at all.
	await generateGitConfigs(config, targetDir)

	// Generate GitHub Actions workflow
	await generateGitHubActions(config, targetDir)

	// Generate security automation (Dependabot + CodeQL)
	if (config.securityAutomation) {
		await generateSecurityConfigs(targetDir)
	}

	// Generate build configurations
	if (config.bundler !== 'none') {
		await generateBuildConfigs(config, targetDir)
	}

	// Tree-shake verification check (libraries only, when opted-in)
	if (config.treeshakeCheck && config.projectType === 'library') {
		const pkgPath = path.join(targetDir, 'package.json')
		const pkg = (await fs.readJson(pkgPath)) as Record<string, unknown>
		const { allCandidates, defaultAllowed } = inferSubpathsFromExports(pkg)
		if (defaultAllowed && allCandidates.length >= 2) {
			await generateTreeshakeCheck(targetDir, {
				workspaceName: config.projectName,
				allowedSubpath: defaultAllowed,
				forbiddenSubpaths: allCandidates.filter((s) => s !== defaultAllowed),
			})
			// treeshake-check writes pnpm-workspace.yaml; regenerate knip so it
			// picks up the workspaces form (the baseline pass above ran before the
			// workspace file existed and emitted the flat single-package form).
			await generateKnipConfig(targetDir)
		}
	}

	// Approve esbuild's build script for pnpm 11 via pnpm-workspace.yaml. Runs
	// after the treeshake-check path so its richer workspace file (if written)
	// is never clobbered.
	await ensureBuildApprovals(config, targetDir)

	// Family-wide pnpm settings (#314). Runs last of the workspace writers so it
	// merges into whatever they wrote rather than racing them for the file.
	await ensurePnpmSettings(targetDir, bundlerNeedsEsbuild(config), familyGlob(config.projectName))

	// Turborepo task pipeline (pnpm-workspace monorepos, when opted-in)
	if (config.turborepo) {
		await generateTurborepo(targetDir)
	}

	// Nx task orchestrator (alternative to Turborepo, when opted-in)
	if (config.nx) {
		await generateNx(targetDir)
	}

	// Tailwind CSS v4 (frontend projects, when opted-in)
	if (config.tailwind) {
		await generateTailwind(targetDir)
	}

	// Bun runtime (#225): bunfig.toml (the Bun-typed tsconfig is already emitted
	// by generateTSConfig above when config.bun, so generateBun only adds bunfig).
	if (config.bun) {
		await generateBun(targetDir)
	}

	// AI agent files (AGENTS.md, CLAUDE.md, Cursor/Copilot, Claude skill, MCP example)
	if (config.aiSetup) {
		await installAiSetup(targetDir)
	}

	// Generate README
	await generateReadme(config, targetDir)

	// Copy ts-reset if TypeScript is enabled
	if (config.typescript.enabled) {
		await copyTSReset(targetDir)
	}
}

async function copyTSReset(targetDir: string) {
	const toolingRoot = path.resolve(__dirname, '../../../tooling')
	const resetPath = path.join(toolingRoot, 'typescript', 'reset.d.ts')
	const targetPath = path.join(targetDir, 'reset.d.ts')

	if (await fs.pathExists(resetPath)) {
		await fs.copy(resetPath, targetPath)
	}
}
