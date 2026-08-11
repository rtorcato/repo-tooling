---
title: CLI Commands
description: Full reference for the repo-tooling CLI.
---

## setup / init

Launches the interactive wizard. `init` is an alias for `setup`.

```bash
npx @rtorcato/repo-tooling setup              # current directory
npx @rtorcato/repo-tooling setup -d ./my-app  # specific directory
npx @rtorcato/repo-tooling setup --skip-install  # skip npm/pnpm install
```

Add `--preset <name>` to skip the prompts entirely: `library`, `web-app`,
`node-api`, `nextjs-app`, `react-app`, or `swift-library`. The Swift preset
scaffolds a SwiftPM package rather than an npm one — see the
[Swift guide](./swift.md).

## copy \<name\>

Copies a standalone config file into the current directory without running the full wizard.

```bash
npx @rtorcato/repo-tooling copy biome     # → biome.json
npx @rtorcato/repo-tooling copy tsconfig  # → tsconfig.json
```

Available presets: `biome`, `tsconfig`, `bun`, `nx`, `changesets`, `release-please`, `oxlint`, `claude-skill`, `mcp-example`, `docusaurus-sync-changelog`, `docusaurus-theme-tokens`, `docusaurus-theme`.

`copy` is for configs you must *own* rather than extend — Biome doesn't support configuration extension, and TypeScript configs resolve more reliably when local. Most other configs (ESLint, Prettier, Vitest, etc.) can be imported or extended directly — see the [Configuration Reference](../reference/biome.md) for usage.

## list / ls

Prints all available tooling configurations.

```bash
npx @rtorcato/repo-tooling list
```

## doctor

Audits an existing project against the presets and reports drift.

```bash
npx @rtorcato/repo-tooling doctor              # current dir
npx @rtorcato/repo-tooling doctor -d ./app     # specific dir
npx @rtorcato/repo-tooling doctor --json       # machine-readable output
```

Each row reports one of:

| Status | Meaning |
|---|---|
| `ok` | Config matches the preset (or required file present) |
| `drift` | Config exists but has diverged from the preset |
| `missing` | Config required but not found |
| `not configured` | Optional tool not present in the project |

### What gets checked

| Group | Checks |
|---|---|
| Environment | Node version (vs. minimum + LTS patch level), `engines.node` field |
| Repo baseline | `package.json`, `.editorconfig`, `.nvmrc` / `.node-version`, `.vscode/extensions.json` |
| Tooling presets | TypeScript, Biome, ESLint, Prettier, Vitest, Commitlint |
| Automation | Husky, `lint-staged`, `verify` script, semantic-release, knip |
| CI / supply chain | GitHub Actions, coverage upload, Dependabot, CodeQL, GitLab CI |
| Build / docs | TypeDoc, docs site (Docusaurus), size-limit |
| Ecosystem | Bun runtime, Turborepo / Nx, Tailwind / PostCSS |

After the per-row results, doctor prints a **Next steps:** footer listing the exact `fix` command to run for each non-ok item:

```ansi
  Next steps:
    - Run `npx @rtorcato/repo-tooling fix engines` to align engines.node
    - Run `npx @rtorcato/repo-tooling fix editorconfig` to scaffold EditorConfig
    - Run `npx @rtorcato/repo-tooling fix dependabot` to scaffold Dependabot
    - Run `npx @rtorcato/repo-tooling fix` to walk all findings interactively
```

Exits non-zero on `drift` or `missing` — useful as a CI gate.

## fix \[target\]

Applies scaffolders for items `doctor` flagged. Without a target it walks every non-ok result, prompting per item; with a target it applies just that one.

```bash
npx @rtorcato/repo-tooling fix                    # walk all findings interactively
npx @rtorcato/repo-tooling fix dependabot         # scaffold dependabot.yml + auto-merge workflow
npx @rtorcato/repo-tooling fix --yes              # apply every recommended fix without prompts
npx @rtorcato/repo-tooling fix biome --dry-run    # print what would change, write nothing
npx @rtorcato/repo-tooling fix biome --diff       # show the exact diff before confirming
```

### Flags

| Flag | Behaviour |
|---|---|
| `-d, --directory <path>` | Target directory (defaults to cwd) |
| `--yes` | Assume yes to every prompt, including drift overwrites |
| `--dry-run` | Print the files each fixer would write, without writing |
| `--diff` | Print a unified diff of each change before the confirm prompt |

### Drift policy

When a file exists but doesn't extend the preset, `fix` defaults the confirm prompt to **No** — your customisations are preserved unless you explicitly say yes (or pass `--yes`). The prompt always tells you which file is about to be overwritten.

### Diff preview (`--diff`)

When you want to see *exactly* what would change before saying yes, pass `--diff`. For each output the fixer would touch, you'll see:

- a `create <path>` header if the file is new (no diff body to show), or
- a `modify <path>` header followed by a unified diff comparing the current file to what the fixer would write.

```text
$ npx @rtorcato/repo-tooling fix biome --diff
🔧 biome — Biome is drift

  modify biome.json
    --- biome.json
    +++ biome.json
    @@ -1,3 +1,12 @@
    -{
    -  "rules": { "noConsole": "error" }
    -}
    +{
    +  "$schema": "https://biomejs.dev/schemas/2.5.0/schema.json",
    +  "extends": ["@rtorcato/repo-tooling/biome"],
    +  …
    +}
? ⚠️  Scaffold biome.json … — overwrite existing file? user customizations will be lost (y/N)
```

The diff:

- is suppressed in `--json` mode (the structured output stream stays clean),
- is suppressed for safe-add fixers (those never overwrite existing files),
- honours `NO_COLOR` and the standard terminal-colour detection chalk uses,
- works in both targeted (`fix biome --diff`) and walk-all (`fix --diff`) modes.

Implementation note: the preview is computed by shadow-running the fixer in a temp copy of your project directory — your real files are never touched until you confirm.

### Available targets

`doctor` and `list --json` are the source of truth — run them for the exact set in the version you have; new targets are added regularly. The current set:

**Core config**

| Target | Scaffolds |
|---|---|
| `package-json` | adds `@rtorcato/repo-tooling` to `devDependencies` |
| `engines` | `engines.node` in `package.json` (never overwrites) |
| `tsconfig` | `tsconfig.json` |
| `biome` | `biome.json` |
| `eslint` | `eslint.config.mjs` |
| `prettier` | `prettier.config.mjs` |
| `editorconfig` | `.editorconfig` |
| `vscode-extensions` | `.vscode/extensions.json` (merge-friendly) |
| `nvmrc` | `.nvmrc` pinned to Node 22 |
| `node-version` | points CI at `node-version-file: .nvmrc` (one Node source of truth) |

**Testing & verify**

| Target | Scaffolds |
|---|---|
| `vitest` | `vitest.config.ts` (preserves existing `vitest.setup.ts`) |
| `cypress` | `cypress.config.ts` + `cypress/support` + `tests/e2e` boilerplate |
| `commitlint` | `commitlint.config.mjs` |
| `husky` | `.husky/pre-commit`, `.husky/pre-push`, package.json `lint-staged` (deep-merges) |
| `verify` | unified `verify` script (typecheck && lint && tests) in `package.json` |
| `knip` | `knip.json` |

**Release**

| Target | Scaffolds |
|---|---|
| `semantic-release` | `release.config.mjs` + plugins (skipped on private packages) |
| `changesets` | `.changeset/config.json` (alternative to semantic-release) |
| `release-please` | `release-please-config.json` + manifest + workflow (alternative) |
| `attw` | `@arethetypeswrong/cli` + an `attw` script, wired into `verify` |
| `publint` | `publint` + a `publint --strict` script, wired into `verify` |
| `badges` | status-badge row (CI, npm, coverage, license) in `README.md` |

**CI & supply chain**

| Target | Scaffolds |
|---|---|
| `github-actions` | `.github/workflows/ci.yml` (+ `codecov.yml`; Vitest jobs upload coverage). A `ci.yml` that no longer matches the preset is left as-is unless the finding being fixed is the `GitHub Actions` drift itself — your edits are never silently reverted |
| `gitlab-ci` | `.gitlab-ci.yml` (lint/typecheck/test/build mirrored from GitHub Actions) |
| `dependabot` | `.github/dependabot.yml` (monthly, grouped: production-minor/dev-minor/major-updates) + the `dependabot-automerge.yml` workflow — see [Dependabot strategy](./dependabot-strategy.md) |
| `renovate` | `renovate.json` (alternative to Dependabot) |
| `codeql` | `.github/workflows/codeql.yml` (security scanning) |
| `github-settings` | branch protection + auto-merge + workflow permissions + a code-scanning branch ruleset (when CodeQL is on) via `gh api` (mutates the remote repo) |
| `codeowners` | `.github/CODEOWNERS` with commented examples |
| `community-health` | `CONTRIBUTING.md`, `SECURITY.md`, PR + issue templates |
| `lockfile` | records current tool choices in the repo-tooling lockfile |

**Build, bundling & monorepo**

| Target | Scaffolds |
|---|---|
| `bun` | `bunfig.toml` + a Bun-typed `tsconfig.json` for Bun runtime/test users |
| `rollup` | `rollup.config.mjs` re-exporting the shared library preset |
| `rolldown` | `rolldown.config.mjs` re-exporting the shared library preset |
| `size-limit` | a size-limit budget (`.size-limit.cjs`/`.json`), plus the `size-limit` script and devDependency that run it |
| `treeshake-check` | `apps/treeshake-check` — esbuild + metafile bundle assertion |
| `pnpm-workspace` | merges the family-wide pnpm settings into `pnpm-workspace.yaml` (`verifyDepsBeforeRun`, `minimumReleaseAgeExclude`, esbuild's build approval) — never rewrites the file |
| `turborepo` | `turbo.json` task pipeline (pnpm-workspace monorepos) |
| `nx` | `nx.json` task orchestrator (alternative to Turborepo) |
| `tailwind` | Tailwind CSS v4 (`postcss.config.mjs` + `src/styles/globals.css`) |
| `postcss` | `postcss.config.mjs` with autoprefixer (non-Tailwind pipelines) |

**Docs**

| Target | Scaffolds |
|---|---|
| `typedoc` | `typedoc.json` + `.github/workflows/docs.yml` (GitHub Pages) |
| `docs-site` | a Docusaurus site under `apps/docs` (config/sidebars/tokens + Pages deploy) — see [Docs site](./docs-site.md) |
| `brand` | `brand/` — banner, mobile-banner and social-card SVG sources + `render.sh`, and repoints a README still on root-level banner paths — see [Brand assets](./brand-assets.md) |

**AI agents** _(opt-in)_

| Target | Scaffolds |
|---|---|
| `ai` | all AI agent files at once (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill, MCP example) |
| `claude-skill` | the Claude Code skill at `.claude/skills/repo-tooling.md` |
| `cursor-rules` | the rules for Cursor at `.cursor/rules/repo-tooling.mdc` |
| `copilot-instructions` | the rules block in `.github/copilot-instructions.md` |
| `agents-md` | the rules block in `AGENTS.md` (universal) |

### Typical workflow

```bash
npx @rtorcato/repo-tooling doctor   # see what's missing
npx @rtorcato/repo-tooling fix      # walk the list, accept defaults
npx @rtorcato/repo-tooling doctor   # confirm everything is now ok
```
