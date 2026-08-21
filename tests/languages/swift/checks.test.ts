import fs from 'fs-extra'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
	checkDocC,
	checkPackageSwift,
	checkSwiftGitignore,
	checkSwiftRelease,
	checkSwiftTests,
	runSwiftChecks,
} from '../../../src/languages/swift/checks.js'
import { useTmpDir } from '../../helpers/tmp-dir.js'

const newTmpDir = useTmpDir()

const VALID_MANIFEST = `// swift-tools-version: 5.9

import PackageDescription

let package = Package(
    name: "Demo",
    platforms: [.iOS(.v16), .macOS(.v13)],
    products: [.library(name: "Demo", targets: ["Demo"])],
    targets: [.target(name: "Demo")]
)
`

describe('checkPackageSwift', () => {
	it('is missing without a manifest', async () => {
		const result = await checkPackageSwift(newTmpDir())
		expect(result.status).toBe('missing')
	})

	it('passes a manifest with a tools version and explicit platforms', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), VALID_MANIFEST)
		const result = await checkPackageSwift(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('5.9')
	})

	it('flags a manifest with no swift-tools-version comment', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), 'import PackageDescription\n')
		const result = await checkPackageSwift(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toMatch(/swift-tools-version/)
	})

	it('flags a manifest with no platforms clause', async () => {
		const dir = newTmpDir()
		await fs.writeFile(
			join(dir, 'Package.swift'),
			'// swift-tools-version: 5.9\nlet package = Package(name: "Demo")\n'
		)
		const result = await checkPackageSwift(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toMatch(/platforms/)
	})

	it('accepts the tools-version comment without a space after the colon', async () => {
		const dir = newTmpDir()
		await fs.writeFile(
			join(dir, 'Package.swift'),
			'//swift-tools-version:6.0\nlet package = Package(name: "D", platforms: [.iOS(.v16)])\n'
		)
		expect((await checkPackageSwift(dir)).status).toBe('ok')
	})
})

describe('checkSwiftGitignore', () => {
	it('is missing without a .gitignore', async () => {
		expect((await checkSwiftGitignore(newTmpDir())).status).toBe('missing')
	})

	it('passes when the build artefacts are covered', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/.build\nDerivedData/\nxcuserdata/\n')
		expect((await checkSwiftGitignore(dir)).status).toBe('ok')
	})

	it('names the entries that are missing', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.gitignore'), '/.build\n')
		const result = await checkSwiftGitignore(dir)
		expect(result.status).toBe('drift')
		expect(result.detail).toContain('DerivedData')
		expect(result.detail).toContain('xcuserdata')
		expect(result.detail).not.toContain('.build,')
	})
})

describe('checkSwiftTests', () => {
	const CI = 'jobs:\n  build:\n    steps:\n      - run: swift test\n'

	it('is missing without a manifest', async () => {
		expect((await checkSwiftTests(newTmpDir())).status).toBe('missing')
	})

	it('is missing when the manifest declares no test target', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), VALID_MANIFEST)
		const result = await checkSwiftTests(dir)
		expect(result.status).toBe('missing')
		expect(result.detail).toContain('.testTarget(')
	})

	// A test target nothing runs is the failure mode this half exists for.
	it('drifts when a test target exists but no CI runs swift test', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), `${VALID_MANIFEST}\n// .testTarget(name: "T")\n`)
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), 'jobs:\n  build:\n    steps: []\n')
		const result = await checkSwiftTests(dir)
		expect(result.status).toBe('drift')
		expect(result.hint).toContain('fix swift-ci')
	})

	it('passes when a workflow runs swift test', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), `${VALID_MANIFEST}\n// .testTarget(name: "T")\n`)
		await fs.outputFile(join(dir, '.github/workflows/ci.yml'), CI)
		expect((await checkSwiftTests(dir)).status).toBe('ok')
	})

	// GitLab is the only pipeline on a repo mirrored off GitHub.
	it('accepts .gitlab-ci.yml as the runner', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), `${VALID_MANIFEST}\n// .testTarget(name: "T")\n`)
		await fs.writeFile(join(dir, '.gitlab-ci.yml'), 'test:\n  script:\n    - swift test\n')
		expect((await checkSwiftTests(dir)).status).toBe('ok')
	})
})

describe('checkDocC', () => {
	const PLUGIN = '.package(url: "https://github.com/apple/swift-docc-plugin", from: "1.4.0")'

	const withCatalogue = async (dir: string) =>
		fs.outputFile(join(dir, 'Sources/Demo/Demo.docc/Demo.md'), '# ``Demo``\n')

	it('is optional-missing with neither catalogue nor plugin', async () => {
		const result = await checkDocC(newTmpDir())
		expect(result.status).toBe('optional-missing')
		expect(result.hint).toContain('fix docc')
	})

	it('passes with a catalogue and the plugin declared', async () => {
		const dir = newTmpDir()
		await withCatalogue(dir)
		await fs.writeFile(join(dir, 'Package.swift'), `${VALID_MANIFEST}\n// ${PLUGIN}\n`)
		const result = await checkDocC(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('Sources/Demo/Demo.docc')
	})

	// Docs nobody can build.
	it('drifts on a catalogue with no plugin', async () => {
		const dir = newTmpDir()
		await withCatalogue(dir)
		await fs.writeFile(join(dir, 'Package.swift'), VALID_MANIFEST)
		const result = await checkDocC(dir)
		expect(result.status).toBe('drift')
		expect(result.hint).toContain('swift-docc-plugin')
	})

	// A build command with nothing to say.
	it('drifts on a plugin with no catalogue', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, 'Package.swift'), `${VALID_MANIFEST}\n// ${PLUGIN}\n`)
		expect((await checkDocC(dir)).status).toBe('drift')
	})
})

describe('checkSwiftRelease', () => {
	const workflow = (triggers: string) =>
		`name: x\n\non:\n${triggers}\njobs:\n  release:\n    runs-on: macos-latest\n`

	it('is optional-missing with no workflows at all', async () => {
		const result = await checkSwiftRelease(newTmpDir())
		expect(result.status).toBe('optional-missing')
		expect(result.hint).toContain('fix swift-release')
	})

	it('passes on a workflow triggered by a tag push', async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, '.github/workflows/release.yml'),
			workflow("  push:\n    tags:\n      - '[0-9]+.[0-9]+.[0-9]+'\n")
		)
		const result = await checkSwiftRelease(dir)
		expect(result.status).toBe('ok')
		expect(result.detail).toContain('release.yml')
	})

	it('does not count a branch-triggered CI workflow', async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, '.github/workflows/ci.yml'),
			workflow('  push:\n    branches: [main]\n')
		)
		expect((await checkSwiftRelease(dir)).status).toBe('optional-missing')
	})

	// `tags:` inside a step (docker/metadata-action emits one) is not a trigger.
	it('does not count `tags:` appearing inside a job', async () => {
		const dir = newTmpDir()
		await fs.outputFile(
			join(dir, '.github/workflows/ci.yml'),
			`${workflow('  push:\n    branches: [main]\n')}    steps:\n      - uses: docker/metadata-action@v5\n        with:\n          tags: latest\n`
		)
		expect((await checkSwiftRelease(dir)).status).toBe('optional-missing')
	})
})

describe('runSwiftChecks', () => {
	it('covers the manifest, tools, tests, docs and releases', async () => {
		const names = (await runSwiftChecks(newTmpDir())).map((r) => r.check)
		expect(names).toEqual([
			'Package.swift',
			'SwiftLint',
			'Periphery',
			'swift-format',
			'Swift .gitignore',
			'Swift tests',
			'DocC',
			'Release automation',
		])
	})

	it('treats Periphery and swift-format as optional but SwiftLint as required', async () => {
		const results = await runSwiftChecks(newTmpDir())
		const byName = Object.fromEntries(results.map((r) => [r.check, r.status]))
		expect(byName.SwiftLint).toBe('missing')
		expect(byName.Periphery).toBe('optional-missing')
		expect(byName['swift-format']).toBe('optional-missing')
	})

	it('accepts the configs the swiftlint/periphery fixers write', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.swiftlint.yml'), 'disabled_rules:\n  - line_length\n')
		await fs.writeFile(join(dir, '.periphery.yml'), 'retain_public: true\n')
		const byName = Object.fromEntries((await runSwiftChecks(dir)).map((r) => [r.check, r.status]))
		expect(byName.SwiftLint).toBe('ok')
		expect(byName.Periphery).toBe('ok')
	})

	it('flags a SwiftLint file that carries no recognisable config', async () => {
		const dir = newTmpDir()
		await fs.writeFile(join(dir, '.swiftlint.yml'), '# TODO: fill this in\n')
		const results = await runSwiftChecks(dir)
		expect(results.find((r) => r.check === 'SwiftLint')?.status).toBe('drift')
	})
})
