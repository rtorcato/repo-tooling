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

Add `--preset <name>` to skip the wizard: `minimal`, `library`, `web-app`,
`node-api`, `nextjs-app`, `react-app`, `swift-library`, `vite-plus`, or
`vite-plus-app`. `minimal` is tsconfig + Biome + Vitest and nothing else. The
Swift preset scaffolds a SwiftPM package rather than an npm one — see the
[Swift guide](./swift.md). The two Vite+ presets are opt-in and replace Biome,
tsup and a separate Vitest — see the [Vite+ guide](./vite-plus.md).

In a terminal, `--preset` prints the file list it resolved and lets you uncheck
the extras (git hooks, commitlint, releases, Dependabot/CodeQL, badges, AI agent
rules) before anything is written. Pass `--yes` to write it all in one shot. When
stdin or stdout is piped or redirected — CI — the review is skipped
automatically.

## copy \<name\>

Copies a standalone config file into the current directory without running the full wizard.

```bash
npx @rtorcato/repo-tooling copy biome     # → biome.json
npx @rtorcato/repo-tooling copy tsconfig  # → tsconfig.json
```

Available presets: `biome`, `tsconfig`, `bun`, `nx`, `changesets`, `release-please`, `oxlint`, `claude-skill`, `claude-sync-agents`, `mcp-example`.

`claude-sync-agents` copies `scripts/sync-agents.mjs`, which regenerates `AGENTS.md` from `skills/<package>/SKILL.md` so the two can't drift. It is zero-config — the skill directory comes from the root `package.json` `name` with the npm scope stripped (`@rtorcato/js-common` → `skills/js-common/`). Wire `node scripts/sync-agents.mjs --check` into CI to fail on a stale `AGENTS.md`.

`copy` is for configs you must *own* rather than extend — Biome doesn't support configuration extension, and TypeScript configs resolve more reliably when local. Most other configs (ESLint, Prettier, Vitest, etc.) can be imported or extended directly — see the [Configuration Reference](../reference/biome.md) for usage.

### Copied assets don't drift silently

A copy used to be a one-shot: nothing looked at the file again, so a repo could sit on an ancient copy of `scripts/sync-changelog.mjs` for a year without a signal. `copy` now records the asset's hash at copy time in `.repo-tooling.json`, and doctor's **Copied assets** check reads it back:

| State | Means | doctor |
|---|---|---|
| `stale` | Untouched since the copy, but the package ships a newer version | `drift` — `fix copied-assets` re-copies it, and can't lose anything, because nothing local is in it |
| `modified` | The file differs from what was copied — someone forked it deliberately | reported, never overwritten; a human decision |
| untracked | No recorded hash: the copy predates this, or the repo has no `.repo-tooling.json` | reported, never `drift` — a missing record isn't evidence of drift |

`copy` never creates a lockfile just to have somewhere to write. Run `fix lockfile` first if you want a repo's copies tracked.

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
npx @rtorcato/repo-tooling doctor --offline    # skip checks that read live GitHub state
```

Each row reports one of:

| Status | Meaning |
|---|---|
| `ok` | Config matches the preset (or required file present) |
| `drift` | Config exists but has diverged from the preset |
| `missing` | Config required but not found |
| `not configured` | Optional tool not present in the project |
| `skipped` | Not run — `--offline` skips checks that read live GitHub state |

### `--offline` for CI gates

Some checks read live GitHub state over `gh`: branch protection, merge and security settings, the release environment, repository secrets, and milestones. Their result depends on timing (a milestone at 100% before it is closed) and on who runs them (a token without admin access can't read security settings). Pass `--offline` whenever `doctor` gates CI. Those checks then report `skipped` and never fail the run. Plain `doctor` still runs them. The composite action (`uses: rtorcato/repo-tooling@vX.Y.Z`) passes `--offline` for you.

### What gets checked

| Group | Checks |
|---|---|
| Environment | `Node` (vs. minimum + LTS patch level), `engines.node`, `Node version pin` (`.nvmrc` / `.node-version`), `Node version consistency` (the pin, `engines.node` and workflow Node versions agree on one major) |
| Repo baseline | `package.json`, `EditorConfig`, `VS Code extensions` (`.vscode/extensions.json`), `Git identity` (`user.email` is a real address), `Git author history`, `Community health` (`CONTRIBUTING.md`, `SECURITY.md`), `Declared exceptions` (`rules.exceptions` in `.repo-tooling.json`) |
| Tooling presets | TypeScript, Biome, ESLint, Prettier, Oxlint, Vitest, Commitlint |
| Automation | `Git hooks`, `Pre-push hook`, `lint-staged`, `verify script`, semantic-release, knip |
| CI / supply chain | `GitHub Actions`, `Release token` (semantic-release needs `RELEASE_TOKEN`, with `GITHUB_TOKEN` as fallback), `npm OIDC publish`, `npm trusted publisher`, Dependabot, CodeQL, `GitLab CI` |
| Build / docs | TypeDoc, `size-limit`, `Tree-shake check` |
| Ecosystem | Bun runtime, Turborepo / Nx, Tailwind / PostCSS |
| GitHub (live, over `gh`) | `Branch protection`, `Merge settings`, `Workflow permissions`, `Code-scanning gate`, `Security updates`, `Release gate`, `Release environment`, `Release secrets`, `Repository secrets`, `Milestones` |

### Release gate

The **Release gate** check looks for the workflow job that publishes (`semantic-release`, `changesets/action`, `changeset publish`, or `npm`/`pnpm`/`yarn publish`) and reports drift when nothing holds it before the registry:

- the job declares no `environment:` and the repo has no `release` environment
- the job names an environment the repo doesn't have (Actions creates it unprotected on first run)
- the job names an environment with no required reviewers

**Release environment** reports a `release` environment that no job references, and **Release secrets** reports publish secrets kept as repository secrets rather than on the environment. `fix release-environment` creates the environment with you as the required reviewer and adds `environment: release` to the job. It only runs when named.

A repo that publishes nothing is `ok`, reported as *not applicable*. A root `package.json` with `private: true` counts as publishing nothing, unless it is a monorepo root with a workspace package that isn't private. The workspace packages come from `pnpm-workspace.yaml` or the `workspaces` field. A pnpm or Changesets monorepo always has a private root while `packages/*` publish, so the check still runs there.

The **npm OIDC publish** and **npm trusted publisher** checks use the same publish matcher and the same private-root rule. In a monorepo, the trusted-publisher check reports one row per public workspace package, each prefixed with its directory. Running `doctor -d packages/x` on a single package reads the workflows and GitHub settings from the git root, since that's where they live.

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

`fix` aligns an existing project; it doesn't create one. In an empty directory (nothing but dotfiles such as `.git`) the walk refuses and exits 1 with a pointer to `setup --preset <name>`, and `doctor`'s next steps say the same.

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
    +  "$schema": "https://biomejs.dev/schemas/latest/schema.json",
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
| `oxlint` | `.oxlintrc.json` (additive to Biome/ESLint; the `Oxlint` check) |
| `prettier` | `prettier.config.mjs` |
| `editorconfig` | `.editorconfig` |
| `vscode-extensions` | `.vscode/extensions.json` (merge-friendly) |
| `nvmrc` | `.nvmrc` pinned to Node 22 |
| `node-version` | points CI at `node-version-file: .nvmrc` (one Node source of truth); an extra `node-version:` step in a job that already reads `node-version-file` is test coverage and is left alone |

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
| `release-environment` | the `release` environment on GitHub with you as required reviewer, plus `environment: release` on the publishing job (see [Release gate](#release-gate)). Runs only when named, never under bare `fix` or `--yes` |
| `npm-trusted-publisher` | registers `release.yml` as the package's OIDC trusted publisher on npm via `npm trust github`. Refuses when the package isn't on npm yet, local npm is older than 11.15.0, or you aren't logged in. Runs only when named. In a monorepo, run it once per package with `-d packages/x` |
| `attw` | `@arethetypeswrong/cli` + an `attw` script, wired into `verify` |
| `publint` | `publint` + a `publint --strict` script, wired into `verify` |
| `badges` | status-badge row (CI, npm, license) in `README.md` |

**CI & supply chain**

| Target | Scaffolds |
|---|---|
| `github-actions` | `.github/workflows/ci.yml` (+ `release.yml` for a semantic-release library; Vitest jobs run `pnpm coverage`). A `ci.yml` that still has a release job gets just that job moved out into `release.yml` (its `environment:` carried over, `needs:` references and the `workflow_dispatch`/`milestone` triggers only it used dropped) — every other job, trigger and comment in `ci.yml` stays byte-for-byte. Otherwise a `ci.yml` that no longer matches the preset is left as-is unless the finding being fixed is the `GitHub Actions` drift itself — your edits are never silently reverted |
| `gitlab-ci` | `.gitlab-ci.yml` (lint/typecheck/test/build mirrored from GitHub Actions) |
| `dependabot` | `.github/dependabot.yml` (monthly, grouped: production-minor/dev-minor/major-updates) + the `dependabot-automerge.yml` workflow — see [Dependabot strategy](./dependabot-strategy.md) |
| `renovate` | `renovate.json` (alternative to Dependabot) |
| `codeql` | `.github/workflows/codeql.yml` (security scanning) |
| `github-settings` | branch protection + auto-merge + workflow permissions + Dependabot vulnerability alerts, automated security fixes and private vulnerability reporting (the `Security updates` check) + a code-scanning branch ruleset (when CodeQL is on, the `Code-scanning gate` check) via `gh api` (mutates the remote repo). Applies [`rules.github`](../reference/repo-tooling-json.mdx#rulesgithub--the-github-settings-this-repo-should-have) when the repo declares it |
| `milestones` | closes 100%-complete open milestones, then opens a rolling `next` one if none is left, via `gh api` (mutates the remote repo). Never deletes one. Explicit-only, and refuses to close anything when a workflow, in the working tree or on the default branch, runs on milestone close, since that publishes — see [milestone hygiene](./git-flow.md#milestones) |
| `codeowners` | `.github/CODEOWNERS` with commented examples |
| `community-health` | `CONTRIBUTING.md`, `SECURITY.md`, PR + issue templates |
| `lockfile` | records current tool choices in the repo-tooling lockfile |

**Build, bundling & monorepo**

| Target | Scaffolds |
|---|---|
| `bun` | `bunfig.toml` + a Bun-typed `tsconfig.json` for Bun runtime/test users |
| `rollup` | `rollup.config.mjs` re-exporting the shared library preset |
| `rolldown` | `rolldown.config.mjs` re-exporting the shared library preset |
| `size-limit` | a size-limit budget (`.size-limit.cjs`/`.json`), plus the `size` script and the `size-limit` + `@size-limit/preset-small-lib` devDependencies that run it |
| `treeshake-check` | `apps/treeshake-check` — esbuild + metafile bundle assertion |
| `pnpm-workspace` | merges the shared pnpm settings into `pnpm-workspace.yaml` (`verifyDepsBeforeRun`, `minimumReleaseAgeExclude`, esbuild's build approval) — never rewrites the file |
| `turborepo` | `turbo.json` task pipeline (pnpm-workspace monorepos) |
| `nx` | `nx.json` task orchestrator (alternative to Turborepo) |
| `tailwind` | Tailwind CSS v4 (`postcss.config.mjs` + `src/styles/globals.css`) |
| `postcss` | `postcss.config.mjs` with autoprefixer (non-Tailwind pipelines) |

**Docs**

| Target | Scaffolds |
|---|---|
| `typedoc` | `typedoc.json` + `.github/workflows/docs.yml` (GitHub Pages) |

**AI agents** _(opt-in)_

| Target | Scaffolds |
|---|---|
| `ai` | all AI agent files at once (AGENTS.md, CLAUDE.md, Cursor, Copilot, Claude skill, MCP example) |
| `claude-skill` | the Claude Code skill at `.claude/skills/repo-tooling/SKILL.md` |
| `cursor-rules` | the rules for Cursor at `.cursor/rules/repo-tooling.mdc` |
| `copilot-instructions` | the rules block in `.github/copilot-instructions.md` |
| `agents-md` | the rules block in `AGENTS.md` (universal) |

### Typical workflow

```bash
npx @rtorcato/repo-tooling doctor   # see what's missing
npx @rtorcato/repo-tooling fix      # walk the list, accept defaults
npx @rtorcato/repo-tooling doctor   # confirm everything is now ok
```
