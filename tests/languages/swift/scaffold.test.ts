import { join } from 'node:path'
import fs from 'fs-extra'
import { describe, expect, it } from 'vitest'
import { buildPresetConfig } from '../../../src/cli/commands/setup-presets.js'
import {
	generateSwiftProject,
	swiftFileList,
	swiftModuleName,
} from '../../../src/languages/swift/scaffold.js'
import { SWIFT_GIT_HOOKS, runSwiftChecks } from '../../../src/languages/swift/checks.js'
import { checkGitHooks, checkPrePushHook } from '../../../src/base/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

/** Scaffold the swift-library preset into a fresh dir and return it. */
async function scaffold(projectName = 'my-swift-lib') {
	const dir = newTmpDir()
	await generateSwiftProject(buildPresetConfig('swift-library', projectName), dir)
	return dir
}

describe('swiftModuleName', () => {
	it('upper-camels a hyphenated repo name', () => {
		expect(swiftModuleName('my-swift-lib')).toBe('MySwiftLib')
	})

	it('strips dots, spaces and underscores', () => {
		expect(swiftModuleName('swift.common_utils kit')).toBe('SwiftCommonUtilsKit')
	})

	it('leaves an already-camel name alone', () => {
		expect(swiftModuleName('SwiftCommon')).toBe('SwiftCommon')
	})

	// Swift target names are type identifiers, so neither of these can be used raw.
	it('prefixes a leading digit', () => {
		expect(swiftModuleName('2fa-kit')).toBe('Package2faKit')
	})

	it('falls back to Package when nothing usable survives', () => {
		expect(swiftModuleName('---')).toBe('Package')
	})
})

describe('generateSwiftProject', () => {
	it('writes a manifest, source and test named after the module', async () => {
		const dir = await scaffold()
		expect(await fs.pathExists(join(dir, 'Package.swift'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'Sources/MySwiftLib/MySwiftLib.swift'))).toBe(true)
		expect(await fs.pathExists(join(dir, 'Tests/MySwiftLibTests/MySwiftLibTests.swift'))).toBe(true)
	})

	// The whole point of the Swift arm: none of the package.json-rooted generators run.
	it('writes no JS artefacts', async () => {
		const dir = await scaffold()
		for (const file of ['package.json', 'tsconfig.json', 'biome.json', 'vitest.config.ts']) {
			expect(await fs.pathExists(join(dir, file)), file).toBe(false)
		}
	})

	it('produces a manifest that passes the Package.swift check', async () => {
		const dir = await scaffold()
		const manifest = await fs.readFile(join(dir, 'Package.swift'), 'utf-8')
		expect(manifest).toMatch(/^\/\/ swift-tools-version:/)
		expect(manifest).toContain('platforms: [')
		expect(manifest).toContain('.library(name: "MySwiftLib", targets: ["MySwiftLib"])')
	})

	// Regression: the .swiftlint.yml written alongside leaves `trailing_comma`
	// enabled, so a manifest with them fails the `swiftlint lint --strict` job
	// this same scaffold generates.
	it('emits no trailing commas in the manifest collection literals', async () => {
		const dir = await scaffold()
		const manifest = await fs.readFile(join(dir, 'Package.swift'), 'utf-8')
		expect(manifest).not.toMatch(/,\s*\n\s*\]/)
	})

	// Everything the scaffold claims to wire is green. `swift-format` and `DocC`
	// are opt-in slots it deliberately doesn't write (SwiftLint `--fix` is the
	// formatter, and DocC needs a plugin dependency in the manifest), exactly as
	// a fresh JS scaffold leaves TypeDoc unconfigured.
	it('leaves the whole Swift doctor suite green bar the opt-in slots', async () => {
		const dir = await scaffold()
		const results = await runSwiftChecks(dir)
		expect(results.map((r) => `${r.check}: ${r.status}`)).toEqual([
			'Package.swift: ok',
			'SwiftLint: ok',
			'Periphery: ok',
			'swift-format: optional-missing',
			'Swift .gitignore: ok',
			'Swift targets: ok',
			'Swift tests: ok',
			'DocC: optional-missing',
			'Release automation: ok',
		])
	})

	// #310: SwiftPM has no registry, so the scaffold's release path is a
	// tag-triggered workflow rather than anything npm-shaped.
	it('writes a tag-triggered release workflow with no npm publish in it', async () => {
		const dir = await scaffold()
		const release = await fs.readFile(join(dir, '.github/workflows/release.yml'), 'utf-8')
		expect(release).toContain('tags:')
		expect(release).toContain('gh release create')
		expect(release).not.toMatch(/npm|semantic-release/)
	})

	it('omits the release workflow when release automation is declined', async () => {
		const dir = newTmpDir()
		await generateSwiftProject(
			{ ...buildPresetConfig('swift-library', 'demo'), semanticRelease: false },
			dir
		)
		expect(await fs.pathExists(join(dir, '.github/workflows/release.yml'))).toBe(false)
	})

	// #309: a fresh scaffold must satisfy the base hook checks it now gets, or
	// `doctor` nags about hooks on a repo `setup` just wrote.
	it('commits node-free git hooks the base checks accept', async () => {
		const dir = await scaffold()
		const profile = SWIFT_GIT_HOOKS
		expect((await checkGitHooks(dir, profile)).status).toBe('ok')
		expect((await checkPrePushHook(dir, profile)).status).toBe('ok')
		const preCommit = await fs.readFile(join(dir, '.githooks/pre-commit'), 'utf-8')
		expect(preCommit).toContain('swiftlint')
		expect(preCommit).not.toContain('npx')
	})

	it('renders Swift CI on macOS with no Node in sight', async () => {
		const dir = await scaffold()
		const workflow = await fs.readFile(join(dir, '.github/workflows/ci.yml'), 'utf-8')
		expect(workflow).toContain('runs-on: macos-latest')
		expect(workflow).toContain('swift build')
		expect(workflow).toContain('swift test')
		expect(workflow).not.toContain('setup-node')
		expect(workflow).not.toContain('pnpm')
	})

	// Package.swift declares platforms and a library product, so the workflow read
	// back off it must carry the matrix — this is what the write-order guarantees.
	it('derives the xcodebuild matrix from the manifest it just wrote', async () => {
		const dir = await scaffold()
		const workflow = await fs.readFile(join(dir, '.github/workflows/ci.yml'), 'utf-8')
		expect(workflow).toContain('-scheme MySwiftLib')
		expect(workflow).toContain('- iOS')
		expect(workflow).toContain('- macOS')
	})

	it('scans Swift, not JavaScript, in CodeQL', async () => {
		const dir = await scaffold()
		const codeql = await fs.readFile(join(dir, '.github/workflows/codeql.yml'), 'utf-8')
		expect(codeql).toContain('language: [swift]')
		expect(codeql).not.toContain('javascript-typescript')
	})

	it('overrides the tab-first editorconfig baseline for .swift files', async () => {
		const dir = await scaffold()
		const editorconfig = await fs.readFile(join(dir, '.editorconfig'), 'utf-8')
		expect(editorconfig).toContain('[*.swift]')
		expect(editorconfig).toMatch(/\[\*\.swift\][\s\S]*indent_style = space/)
	})

	// #574: Package.swift is source. Rewriting one that exists renames the package
	// after the directory and orphans Sources/<Target>/ — and `swift build` still
	// exits 0, so the loss is silent.
	describe('with a Package.swift already on disk', () => {
		const EXISTING = `// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Widget",
    products: [
        .library(name: "Widget", targets: ["Widget"])
    ],
    targets: [
        .target(name: "Widget")
    ]
)
`

		async function scaffoldOver() {
			const dir = newTmpDir()
			await fs.writeFile(join(dir, 'Package.swift'), EXISTING)
			await fs.outputFile(join(dir, 'Sources/Widget/Widget.swift'), 'public enum Widget {}\n')
			await generateSwiftProject(buildPresetConfig('swift-library', 'swiftlib'), dir)
			return dir
		}

		it('leaves the manifest byte-identical', async () => {
			const dir = await scaffoldOver()
			expect(await fs.readFile(join(dir, 'Package.swift'), 'utf-8')).toBe(EXISTING)
		})

		it('scaffolds no target the manifest does not declare', async () => {
			const dir = await scaffoldOver()
			expect(await fs.pathExists(join(dir, 'Sources/Swiftlib'))).toBe(false)
			expect(await fs.pathExists(join(dir, 'Tests/SwiftlibTests'))).toBe(false)
			expect(await fs.pathExists(join(dir, 'Sources/Widget/Widget.swift'))).toBe(true)
		})

		it('names the README after the manifest, not the directory', async () => {
			const dir = await scaffoldOver()
			const readme = await fs.readFile(join(dir, 'README.md'), 'utf-8')
			expect(readme).toContain('Sources/Widget/')
			expect(readme).not.toContain('Swiftlib')
		})

		// The rest of the standard still lands — preserving the manifest is not a
		// reason to skip the linter config or CI.
		it('still writes the surrounding tooling', async () => {
			const dir = await scaffoldOver()
			expect(await fs.pathExists(join(dir, '.swiftlint.yml'))).toBe(true)
			expect(await fs.pathExists(join(dir, '.github/workflows/ci.yml'))).toBe(true)
		})
	})

	it('omits security workflows when securityAutomation is off', async () => {
		const dir = newTmpDir()
		await generateSwiftProject(
			{ ...buildPresetConfig('swift-library', 'demo'), securityAutomation: false },
			dir
		)
		expect(await fs.pathExists(join(dir, '.github/dependabot.yml'))).toBe(false)
		expect(await fs.pathExists(join(dir, '.github/workflows/codeql.yml'))).toBe(false)
		// CI is not part of security automation and stays either way.
		expect(await fs.pathExists(join(dir, '.github/workflows/ci.yml'))).toBe(true)
	})
})

describe('swiftFileList', () => {
	// The list drives `setup --dry-run`; if it drifts from the writer, the preview
	// lies about what setup is going to do.
	it('matches what generateSwiftProject actually writes', async () => {
		const config = buildPresetConfig('swift-library', 'my-swift-lib')
		const dir = newTmpDir()
		await generateSwiftProject(config, dir)

		const written = (await listFilesRecursive(dir)).sort()
		// The lockfile is written by setupProject after the generator, so it's
		// declared but never on disk at this point.
		const declared = swiftFileList(config)
			.filter((f) => f !== '.repo-tooling.json')
			.sort()
		expect(written).toEqual(declared)
	})

	it('drops the AI files when aiSetup is off', () => {
		const config = { ...buildPresetConfig('swift-library', 'demo'), aiSetup: false }
		expect(swiftFileList(config)).not.toContain('AGENTS.md')
		expect(swiftFileList(config)).toContain('Package.swift')
	})
})

async function listFilesRecursive(dir: string, prefix = ''): Promise<string[]> {
	const entries = await fs.readdir(join(dir, prefix), { withFileTypes: true })
	const files: string[] = []
	for (const entry of entries) {
		const rel = prefix ? `${prefix}/${entry.name}` : entry.name
		if (entry.isDirectory()) files.push(...(await listFilesRecursive(dir, rel)))
		else files.push(rel)
	}
	return files
}
