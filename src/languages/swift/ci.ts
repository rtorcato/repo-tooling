/**
 * Swift CI generation (#287), built on the language-agnostic skeleton in
 * `src/base/ci.ts`. No `setup-node`, no `pnpm` — the Swift path runs on macOS
 * runners with Xcode, SwiftPM and Homebrew-installed tools.
 *
 * Unlike the JS path there's no `ProjectConfig` to read: everything the Swift
 * workflow needs (products, deployment platforms) is declared in Package.swift,
 * so the jobs are derived from the repo itself.
 */
import path from 'node:path'
import fs from 'fs-extra'
import { type CiJob, type GitLabSpec, renderGitHubWorkflow, renderGitLabCI } from '../../base/ci.js'

/** SwiftPM runs on macOS runners — Xcode isn't available anywhere else. */
const MACOS = 'macos-latest'

export interface SwiftPackage {
	/** Library product names. For a SwiftPM package these double as xcodebuild schemes. */
	products: string[]
	/** Deployment platforms declared in `platforms:`, as xcodebuild destination names. */
	platforms: string[]
	/** Declared target names, of every kind — the `Swift targets` check (#575) reads these. */
	targets: string[]
}

/**
 * Every SwiftPM target factory. `name:` is their first parameter and Swift
 * enforces argument order, so a literal name always follows the open paren.
 * `binaryTarget` owns no source directory but is matched anyway: the only
 * consumer uses this set to *suppress* a report, so over-matching costs a
 * missed finding while under-matching costs a false one.
 */
const TARGET_DECL =
	/\.(?:target|executableTarget|testTarget|macro|plugin|systemLibrary|binaryTarget)\(\s*name:\s*"([^"]+)"/g

/**
 * Pull the facts doctor and CI need out of a Package.swift. A regex rather than
 * a SwiftPM invocation: `swift package dump-package` would need a Swift
 * toolchain on the machine running `repo-tooling`, which is usually a Node
 * environment.
 *
 * ponytail: literal string arguments only. A manifest that builds its target
 * list in a loop, behind `#if`, or from a variable parses as fewer targets than
 * it declares — callers that act on the result must fail open. Upgrade path is
 * `swift package dump-package` on a machine that has Swift.
 */
export function parsePackageSwift(contents: string): SwiftPackage {
	const products = [...contents.matchAll(/\.library\(\s*name:\s*"([^"]+)"/g)].map(
		(m) => m[1] as string
	)
	const targets = [...contents.matchAll(TARGET_DECL)].map((m) => m[1] as string)

	// Only the `platforms:` array declares deployment targets — matching
	// `.iOS(` across the whole manifest would also catch `.iOS` in target
	// conditionals.
	const platformsClause = contents.match(/platforms:\s*\[([^\]]*)\]/s)?.[1] ?? ''
	const platforms = [...platformsClause.matchAll(/\.(iOS|macOS|tvOS|watchOS|visionOS)\s*\(/g)].map(
		(m) => m[1] as string
	)

	return { products, platforms: [...new Set(platforms)], targets }
}

export async function readSwiftPackage(dir: string): Promise<SwiftPackage> {
	const filepath = path.join(dir, 'Package.swift')
	if (!(await fs.pathExists(filepath))) return { products: [], platforms: [], targets: [] }
	return parsePackageSwift(await fs.readFile(filepath, 'utf-8'))
}

/** Checkout + pin Xcode. Every Swift job needs both before it can do anything. */
const XCODE_SETUP = `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 🛠️  Select latest stable Xcode
        uses: maxim-lobanov/setup-xcode@v1
        with:
          xcode-version: latest-stable`

/**
 * SwiftPM's build products and the resolved-dependency clone are both expensive
 * to rebuild; key on Package.resolved so the cache invalidates with the graph.
 */
const SPM_CACHE = `      - name: 📦 Cache SwiftPM
        uses: actions/cache@v6
        with:
          path: |
            .build
            ~/Library/Caches/org.swift.swiftpm
            ~/Library/Developer/Xcode/DerivedData
          key: \${{ runner.os }}-spm-\${{ hashFiles('**/Package.resolved') }}
          restore-keys: |
            \${{ runner.os }}-spm-`

export function swiftGithubJobs(pkg: SwiftPackage): CiJob[] {
	const jobs: CiJob[] = [
		{
			id: 'build-test',
			runsOn: MACOS,
			steps: `${XCODE_SETUP}

${SPM_CACHE}

      - name: 🏗️  swift build
        run: swift build

      - name: 🧪 swift test
        run: swift test`,
		},
		{
			id: 'lint',
			runsOn: MACOS,
			steps: `      - name: 📦 Checkout repository
        uses: actions/checkout@v7

      - name: 📦 Install SwiftLint
        run: brew install swiftlint

      - name: 🔍 swiftlint --strict
        run: swiftlint lint --strict --reporter github-actions-logging`,
		},
	]

	// Periphery is part of this module's standard (the `periphery` fixer ships
	// its config alongside), so the job is unconditional. Gating it on
	// .periphery.yml existing looked tidier but silently lost the job on a fresh
	// repo: `fix` walks doctor's findings in order, and GitHub Actions comes
	// before Periphery, so the CI file was written before the config existed.
	jobs.push({
		id: 'dead-code',
		runsOn: MACOS,
		// Informational: an established codebase almost always has unused
		// declarations on day one, and a red X there trains people to ignore CI.
		// Drop continue-on-error once the repo is clean.
		extra: '    continue-on-error: true',
		steps: `${XCODE_SETUP}

      - name: 📦 Install Periphery
        run: brew install periphery

      - name: 🔍 periphery scan
        run: periphery scan --strict --format github-actions`,
	})

	// xcodebuild per platform catches deployment-target breaks that `swift build`
	// (host-platform only) never sees. Needs both a scheme and declared platforms.
	const scheme = pkg.products[0]
	if (scheme && pkg.platforms.length > 0) {
		jobs.push({
			id: 'platforms',
			runsOn: MACOS,
			extra: `    name: xcodebuild \${{ matrix.platform }}
    strategy:
      fail-fast: false
      matrix:
        platform:
${pkg.platforms.map((p) => `          - ${p}`).join('\n')}`,
			steps: `${XCODE_SETUP}

      - name: 📦 Cache DerivedData
        uses: actions/cache@v6
        with:
          path: ~/Library/Developer/Xcode/DerivedData
          key: \${{ runner.os }}-derived-\${{ matrix.platform }}-\${{ hashFiles('**/Package.resolved') }}
          restore-keys: |
            \${{ runner.os }}-derived-\${{ matrix.platform }}-

      - name: 🏗️  Build for \${{ matrix.platform }}
        run: |
          set -o pipefail
          xcodebuild \\
            -scheme ${scheme} \\
            -destination "generic/platform=\${{ matrix.platform }}" \\
            -skipPackagePluginValidation \\
            build | xcbeautify --renderer github-actions`,
		})
	}

	return jobs
}

export function renderSwiftWorkflow(pkg: SwiftPackage): string {
	return renderGitHubWorkflow(swiftGithubJobs(pkg))
}

/**
 * The release pipeline (#310). SwiftPM has no registry publish step — a release
 * *is* a semver git tag that consumers resolve with `.package(url:from:)` — so
 * the workflow fires on the tag rather than on a merge, and its only output is
 * a GitHub Release with generated notes.
 *
 * The build/test gate runs before the release is cut because a tag is
 * effectively permanent: SwiftPM caches resolved tags, so re-pointing a bad one
 * doesn't reliably reach consumers who already resolved it.
 *
 * `gh` (preinstalled on the runner) rather than a release action: one fewer
 * third-party pin to track, and `--verify-tag` refuses to invent a tag that
 * isn't actually pushed.
 */
export function renderSwiftReleaseWorkflow(): string {
	return `name: 🏷️  Release

on:
  push:
    tags:
      - '[0-9]+.[0-9]+.[0-9]+'
      - 'v[0-9]+.[0-9]+.[0-9]+'

jobs:
  release:
    runs-on: ${MACOS}
    permissions:
      contents: write
    steps:
${XCODE_SETUP}

      - name: 🏗️  swift build
        run: swift build

      - name: 🧪 swift test
        run: swift test

      - name: 🏷️  Publish GitHub Release
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh release create "\${{ github.ref_name }}" --generate-notes --verify-tag
`
}

/**
 * GitLab runs Swift in the official Linux image. That rules out Xcode — so no
 * platform matrix and no SwiftLint (a Homebrew/macOS tool in practice); the
 * Linux-portable half of the pipeline is `swift build` + `swift test`.
 */
function swiftGitlabSpec(): GitLabSpec {
	return {
		image: 'swift:6.0',
		preamble: `cache:
  key:
    files:
      - Package.resolved
  paths:
    - .build`,
		jobs: [
			{ id: 'build', stage: 'build', script: ['swift build'] },
			{ id: 'test', stage: 'test', script: ['swift test'] },
		],
	}
}

export function renderSwiftGitLabCI(): string {
	return renderGitLabCI(swiftGitlabSpec())
}
