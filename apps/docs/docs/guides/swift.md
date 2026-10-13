---
title: Swift projects
description: Scaffold, audit, and fix a SwiftPM package with repo-tooling — the swift-library preset, what it writes, and how it differs from the JS path.
---

Swift is the first non-JavaScript language module. Everything the CLI does for a
JS repo — scaffold with `setup`, audit with `doctor`, repair with `fix` — it also
does for a SwiftPM package, using SwiftPM/SwiftLint/Periphery in place of
pnpm/Biome/Vitest.

The standard here is the one [`swift-common`](https://github.com/rtorcato/swift-common)
actually runs. For the config file contents and the full check/fix table, see the
[Swift reference](../reference/swift.md); this guide covers the project lifecycle.

## Scaffold a new package

```bash
npx @rtorcato/repo-tooling setup --preset swift-library -d ./my-swift-lib
```

Or run `setup` with no flags and pick **Swift** at the language prompt. Unlike
the JS wizard there's only one further question — the package name. SwiftLint,
Periphery and `swift test` aren't options here, they're the standard, and a
wizard whose every question has one answer is worse than no wizard.

`--skip-install` is accepted but redundant: nothing is installed either way.
SwiftPM resolves dependencies on the first `swift build`, and there's no
`node_modules` for the CLI to populate.

### What it writes

| File | Why |
|---|---|
| `Package.swift` | SwiftPM manifest — tools version 6.0, `platforms: [.iOS(.v17), .macOS(.v14)]`, one library product |
| `Sources/<Module>/<Module>.swift` | A placeholder public enum, so `swift build` succeeds |
| `Tests/<Module>Tests/<Module>Tests.swift` | One XCTest case, so `swift test` succeeds |
| `.swiftlint.yml` | Lint *and* format config |
| `.periphery.yml` | Dead-code scan config (`retain_public: true`) |
| `.gitignore` | `.build`, `DerivedData`, `xcuserdata` and friends |
| `.githooks/pre-commit` + `pre-push` | Node-free git hooks (SwiftLint, `swift build`/`test`) |
| `.editorconfig` | Shared baseline plus a `[*.swift]` 4-space override |
| `.github/workflows/ci.yml` | Swift CI on macOS runners |
| `.github/workflows/release.yml` | Build/test gate + GitHub Release on a version tag |
| `.github/workflows/codeql.yml` | CodeQL with `language: swift` |
| `.github/dependabot.yml` + auto-merge workflow | Grouped dependency updates |
| `AGENTS.md`, `CLAUDE.md`, Cursor/Copilot rules, Claude skill, `.mcp.json.example` | AI agent files (language-agnostic) |
| `README.md` | SwiftPM-flavoured README |
| `.repo-tooling.json` | Lockfile recording `language: "swift"` |

The module name is derived from the package name: `my-swift-lib` → `MySwiftLib`.
Swift target names are type identifiers, so hyphens, dots and spaces are stripped
and a leading digit gets a `Package` prefix.

Preview the list without writing anything:

```bash
npx @rtorcato/repo-tooling setup --preset swift-library -d ./my-swift-lib --dry-run
```

### The scaffold passes its own CI

The generated package builds, tests, and lints clean out of the box:

```bash
cd my-swift-lib
swift build
swift test
swiftlint lint --strict     # the exact command the generated CI runs
```

That last one is the reason `Package.swift` has no trailing commas in its
collection literals — the `.swiftlint.yml` written alongside leaves
`trailing_comma` enabled, so a manifest with them would fail the scaffold's own
lint job on the first push.

You'll need the tools locally:

```bash
brew install swiftlint periphery
```

## How the Swift path differs from JS

`setup` branches on the language before any generator runs, because everything
in the JS path is rooted in `package.json` — the file a Swift repo is defined by
not having. Concretely:

| | JavaScript/TypeScript | Swift |
|---|---|---|
| Manifest | `package.json` | `Package.swift` |
| Build | tsup/esbuild/Vite/Rollup | `swift build` |
| Test | Vitest/Jest/Playwright/Cypress | `swift test` (XCTest) |
| Lint + format | Biome or ESLint + Prettier | SwiftLint (both jobs), or swift-format for the formatter half |
| API docs | TypeDoc | DocC |
| Dead code | knip | Periphery |
| Install step | `pnpm install` | none — SwiftPM resolves on build |
| Git hooks | Husky + lint-staged (`.husky/`) | committed `.githooks/` + `core.hooksPath` |
| Release | semantic-release → npm | version tag → GitHub Release (`release.yml`) |
| CI runner | `ubuntu-latest` | `macos-latest` (Xcode) |
| CodeQL | `javascript-typescript` | `swift` |

The lockfile's JS-shaped fields (`linting.tool`, `testing.framework`, `bundler`)
are all recorded as `none` for a Swift package. That means "no *JS* tool", not
"no tooling" — SwiftLint and `swift test` are wired unconditionally, and the
Swift checks `doctor` runs never consult those fields.

## CI

The workflow is derived from `Package.swift` rather than from a config object,
which is why `setup` writes the manifest first and reads it back:

| Job | What it does |
|---|---|
| `build-test` | `swift build` + `swift test`, SwiftPM cache keyed on `Package.resolved` |
| `lint` | `swiftlint lint --strict` |
| `dead-code` | `periphery scan --strict`, `continue-on-error` |
| `platforms` | `xcodebuild` once per platform in the manifest's `platforms:` clause |

Every job runs on `macos-latest` — SwiftPM needs Xcode, and there's no
`setup-node` or `pnpm` anywhere in the file. The `platforms` matrix appears only
when the manifest declares both a `platforms:` clause and a library product (the
product name becomes the xcodebuild scheme); the `swift-library` preset emits
both, so a fresh scaffold gets iOS and macOS.

GitLab is available via `fix swift-gitlab-ci`, but covers the Linux-portable
half only — the official `swift:6.0` image has no Xcode, so no SwiftLint job and
no platform matrix.

## Existing packages: doctor + fix

Don't rerun `setup` on a repo that already exists — it's a fresh-project
scaffolder and would overwrite your manifest. Use `doctor` and `fix` instead:

```bash
npx @rtorcato/repo-tooling doctor              # audit
npx @rtorcato/repo-tooling fix swiftlint       # .swiftlint.yml
npx @rtorcato/repo-tooling fix periphery       # .periphery.yml
npx @rtorcato/repo-tooling fix swift-format    # .swift-format (optional formatter)
npx @rtorcato/repo-tooling fix docc            # Sources/<Target>/<Target>.docc
npx @rtorcato/repo-tooling fix swift-gitignore  # append build artefacts
npx @rtorcato/repo-tooling fix swift-git-hooks  # .githooks/ + core.hooksPath
npx @rtorcato/repo-tooling fix swift-ci         # .github/workflows/ci.yml
npx @rtorcato/repo-tooling fix swift-release    # .github/workflows/release.yml
npx @rtorcato/repo-tooling fix codeql           # .github/workflows/codeql.yml
npx @rtorcato/repo-tooling fix swift-gitlab-ci  # .gitlab-ci.yml
```

`doctor` detects Swift from `Package.swift` and runs the language-agnostic
checks (git hooks, commit linting, README badges, CI, CodeQL, Dependabot, GitHub
repo settings) plus the Swift ones. There is deliberately no fixer for
`Package.swift` — rewriting someone's manifest isn't safe, so `doctor` reports
and you edit.

:::note Not covered yet
The `README badges` check runs on a Swift repo but has no fixer — `fix badges`
derives every badge URL from a package.json `name` + `repository`, which a
SwiftPM repo hasn't got. `doctor` reports; you add the badges by hand.
:::
