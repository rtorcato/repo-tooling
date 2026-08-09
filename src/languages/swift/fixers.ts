/**
 * Swift language module — fixers (#286). One per check in ./checks.ts.
 */
import path from 'node:path'
import chalk from 'chalk'
import fs from 'fs-extra'
import type { Fixer } from '../../base/fixers.js'
import { buildPresetConfig } from '../../cli/commands/setup-presets.js'
import { copyPreset } from '../../cli/utils/copy-preset.js'
import { LOCKFILE_NAME, writeLockfile } from '../../cli/utils/lockfile.js'
import { swiftSourceTargets } from './checks.js'
import {
	readSwiftPackage,
	renderSwiftGitLabCI,
	renderSwiftReleaseWorkflow,
	renderSwiftWorkflow,
} from './ci.js'
import { SWIFT_HOOKS_DIR, installSwiftGitHooks } from './git-hooks.js'
import { ensureSwiftGitignore } from './gitignore.js'

/**
 * A DocC module page. The heading is a symbol link (double backticks) because
 * that's what binds the article to the module — a plain `# Name` heading makes
 * DocC treat the file as a standalone article instead.
 */
function doccLandingPage(target: string): string {
	return `# \`\`${target}\`\`

Summary line for ${target} — replace this with what the module is for.

## Overview

Write the prose documentation for ${target} here. Anything else in this
catalogue (articles, tutorials, resources) is picked up automatically.

Build it with \`swift package generate-documentation\`, or preview it with
\`swift package --disable-sandbox preview-documentation --target ${target}\`.

## Topics

### Essentials
`
}

export const SWIFT_FIXERS: Fixer[] = [
	{
		target: 'swiftlint',
		description: 'Scaffold .swiftlint.yml (the SwiftLint config swift-common runs)',
		appliesTo: ['SwiftLint'],
		outputs: ['.swiftlint.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('swiftlint', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'periphery',
		description: 'Scaffold .periphery.yml (dead-code scan config, retains public API)',
		appliesTo: ['Periphery'],
		outputs: ['.periphery.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('periphery', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'swift-format',
		description: 'Scaffold .swift-format (Apple swift-format, the optional formatter slot)',
		appliesTo: ['swift-format'],
		outputs: ['.swift-format'],
		canFixDrift: true,
		async run({ targetDir }) {
			const result = await copyPreset('swift-format', targetDir)
			return { filesWritten: [result.target] }
		},
	},
	{
		target: 'docc',
		description: 'Scaffold a DocC catalogue (Sources/<Target>/<Target>.docc) for the first target',
		appliesTo: ['DocC'],
		// Path depends on the target name, so `fix --dry-run` shows no diff for
		// this one — the file it writes isn't knowable without reading Sources/.
		outputs: ['Sources/<Target>/<Target>.docc/<Target>.md'],
		riskLevel: 'safe-add',
		canFixDrift: true,
		async run({ targetDir }) {
			// The library product's target first — that's the API consumers read
			// docs for — falling back to whatever single target the package has.
			const targets = await swiftSourceTargets(targetDir)
			const { products } = await readSwiftPackage(targetDir)
			const target = products.find((p) => targets.includes(p)) ?? targets[0]
			if (!target) {
				throw new Error('no Sources/<Target>/ directory to put a DocC catalogue in')
			}

			const file = `Sources/${target}/${target}.docc/${target}.md`
			// safe-add: the catalogue is prose someone wrote, so a re-run (DocC
			// also drifts when the manifest lacks the plugin, which this fixer
			// can't repair) must not overwrite it.
			if (await fs.pathExists(path.join(targetDir, file))) return { filesWritten: [] }

			await fs.outputFile(path.join(targetDir, file), doccLandingPage(target))
			console.error(
				chalk.yellow(
					'   add swift-docc-plugin to Package.swift to build it: .package(url: "https://github.com/apple/swift-docc-plugin", from: "1.4.0")'
				)
			)
			return { filesWritten: [file] }
		},
	},
	{
		target: 'swift-gitignore',
		description:
			'Add the Swift/SwiftPM build artefacts (.build, DerivedData, xcuserdata) to .gitignore',
		appliesTo: ['Swift .gitignore'],
		// Appends what's missing; never clobbers a project's own entries.
		riskLevel: 'safe-merge',
		outputs: ['.gitignore'],
		canFixDrift: true,
		async run({ targetDir }) {
			return { filesWritten: await ensureSwiftGitignore(targetDir) }
		},
	},
	{
		target: 'swift-git-hooks',
		description: `Scaffold ${SWIFT_HOOKS_DIR}/pre-commit + pre-push (SwiftLint, swift build/test) and point git at them via core.hooksPath`,
		appliesTo: ['Git hooks', 'Pre-push hook'],
		outputs: [`${SWIFT_HOOKS_DIR}/pre-commit`, `${SWIFT_HOOKS_DIR}/pre-push`],
		canFixDrift: true,
		async run({ targetDir }) {
			const { filesWritten, hooksPathSet } = await installSwiftGitHooks(targetDir)
			console.error(
				hooksPathSet
					? chalk.dim(`   git config core.hooksPath ${SWIFT_HOOKS_DIR}`)
					: chalk.yellow(
							`   run \`git config core.hooksPath ${SWIFT_HOOKS_DIR}\` once per clone — it's local git config, not a committed file`
						)
			)
			return { filesWritten }
		},
	},
	{
		target: 'swift-ci',
		description:
			'Scaffold .github/workflows/ci.yml for Swift (macOS runners: swift build/test, SwiftLint, xcodebuild per platform)',
		appliesTo: ['GitHub Actions'],
		outputs: ['.github/workflows/ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const workflowsDir = path.join(targetDir, '.github', 'workflows')
			await fs.ensureDir(workflowsDir)
			const workflow = renderSwiftWorkflow(await readSwiftPackage(targetDir))
			await fs.writeFile(path.join(workflowsDir, 'ci.yml'), workflow)
			return { filesWritten: ['.github/workflows/ci.yml'] }
		},
	},
	{
		target: 'swift-release',
		description:
			'Scaffold .github/workflows/release.yml (build + test on a version tag, then publish a GitHub Release)',
		appliesTo: ['Release automation'],
		outputs: ['.github/workflows/release.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			const workflowsDir = path.join(targetDir, '.github', 'workflows')
			await fs.ensureDir(workflowsDir)
			await fs.writeFile(path.join(workflowsDir, 'release.yml'), renderSwiftReleaseWorkflow())
			return { filesWritten: ['.github/workflows/release.yml'] }
		},
	},
	{
		target: 'swift-gitlab-ci',
		description: 'Scaffold .gitlab-ci.yml for Swift (swift build + test on the Linux Swift image)',
		appliesTo: ['GitLab CI'],
		outputs: ['.gitlab-ci.yml'],
		canFixDrift: true,
		async run({ targetDir }) {
			await fs.writeFile(path.join(targetDir, '.gitlab-ci.yml'), renderSwiftGitLabCI())
			return { filesWritten: ['.gitlab-ci.yml'] }
		},
	},
	{
		target: 'swift-lockfile',
		description: `Scaffold ${LOCKFILE_NAME} recording the Swift tool choices`,
		appliesTo: ['lockfile'],
		outputs: [LOCKFILE_NAME],
		riskLevel: 'safe-add',
		canFixDrift: false,
		async run({ targetDir }) {
			// A Swift repo has no package.json to infer from, so record what `setup
			// --preset swift-library` would have written — the same config, minus the
			// scaffolding.
			await writeLockfile(targetDir, buildPresetConfig('swift-library', path.basename(targetDir)))
			return { filesWritten: [LOCKFILE_NAME] }
		},
	},
]
