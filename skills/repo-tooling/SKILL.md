---
name: repo-tooling
description: Use when adopting, auditing, or fixing TypeScript/JavaScript project tooling with @rtorcato/repo-tooling, or scaffolding a new project with it. Triggers on "audit my tooling", "fix tooling drift", "is my tsconfig/biome/vitest config right", "set up CI/semantic-release/dependabot", "scaffold a TS library/web-app/node-api", "run doctor", "run fix", or "/repo-tooling". Drives the CLI non-interactively (--json --yes). NOT for hand-editing configs the CLI owns — let the CLI scaffold them so they stay in sync with the presets.
---

# repo-tooling

`@rtorcato/repo-tooling` is a single-package TS/JS tooling distribution: every preset
(TypeScript, Biome, ESLint, Prettier, Vitest/Jest, Commitlint, semantic-release,
tsup/esbuild/Vite/Playwright) plus a CLI to scaffold and audit. **Adopt the presets
through the CLI, not by hand** — a manual edit drifts from the preset and `doctor`
will flag it.

Every command takes `--json` and a non-interactive mode; pair with `--yes` for
autonomous use. `--json` implies `--yes` (a prompt would corrupt the JSON). Run via
`npx @rtorcato/repo-tooling <cmd>`; `-d <dir>` targets a directory other than cwd.

## Audit → fix → confirm (existing repo)

```bash
npx @rtorcato/repo-tooling doctor --json                 # findings
npx @rtorcato/repo-tooling fix --yes --json              # apply every fixable finding
npx @rtorcato/repo-tooling doctor --json                 # confirm clean
```

`doctor` returns `{ directory, results: [{ check, status, detail, hint? }] }`. Status:

- `ok` — configured correctly, nothing to do.
- `drift` — file exists but doesn't extend our preset. `fix` defaults the overwrite
  prompt to **No**; `--yes` is required to overwrite. Show `fix <target> --diff` first.
- `missing` — required and absent → fix it.
- `optional-missing` — opt-in tool not configured. Only fix if the user wants that tool.
- `declared` — a real deviation the repo's `.repo-tooling.json` `rules.exceptions` records on
  purpose, with its reason. Leave it alone; it doesn't fail the run.

`fix` returns `FixActionRecord[]` with `status: applied | dry-run | skipped | already-ok | unsupported`.

## Targeted fix (one concern)

```bash
npx @rtorcato/repo-tooling list --json                   # enumerate targets (source of truth)
npx @rtorcato/repo-tooling fix <target> --yes --json     # e.g. biome, vitest, dependabot, attw
npx @rtorcato/repo-tooling fix <target> --dry-run --json # preview writes
npx @rtorcato/repo-tooling fix <target> --diff           # unified diff before confirming
```

`list --json` is the source of truth for valid targets — read it, don't guess.

## Scaffolding a new project

```bash
# Quick: from a named preset (minimal | library | web-app | node-api | nextjs-app | react-app | swift-library)
# --yes skips the interactive file-list review; without it, a terminal lets you deselect.
npx @rtorcato/repo-tooling setup --preset library -d ./my-lib --skip-install --yes

# Full control: validate a config against the schema, preview, then write
npx @rtorcato/repo-tooling setup --config-schema > project-config.schema.json
npx @rtorcato/repo-tooling setup --config project.json --dry-run    # preview file list
npx @rtorcato/repo-tooling setup --config project.json -d ./my-lib --skip-install
```

## Rules

- Let the CLI own its configs. If `doctor` says `drift`, fix via the CLI, don't hand-patch.
- Use `--json` whenever you'll parse the result; use `--dry-run`/`--diff` before any
  destructive overwrite.
- `optional-missing` ≠ broken. Don't install opt-in tools (typedoc, size-limit,
  treeshake-check, attw, codeql) unless the user asked for that capability.
- After a `fix`, re-run `doctor` to confirm the finding cleared.
- Releasing? See the **npm-publish** skill — never hand-cut a version or tag.

Full docs: https://rtorcato.github.io/repo-tooling/guides/cli/
