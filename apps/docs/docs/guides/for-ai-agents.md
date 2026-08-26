---
title: For AI Agents
description: Use @rtorcato/repo-tooling non-interactively from automated agents, CI bots, and scripts.
---

This page is for autonomous agents (Claude Code, Cursor, GitHub Copilot, CI bots, self-hosted assistants) that need to scaffold, audit, or fix JS/TS projects without human prompts. Every CLI command supports a non-interactive mode and emits structured JSON.

Quick orientation: [llms.txt](pathname:///llms.txt) is a single-file index of every doc URL. The repo also ships an [AGENTS.md](https://github.com/rtorcato/repo-tooling/blob/main/AGENTS.md) for agents working from a checkout.

## Agent-friendly command catalog

All commands take `-d <path>` for the target directory (defaults to `process.cwd()`).

### `setup` — scaffold a new project

```bash
# Sane defaults per project type. --yes guarantees no prompts even from a terminal.
npx @rtorcato/repo-tooling setup --preset library -d ./my-lib --skip-install --yes
npx @rtorcato/repo-tooling setup --preset react-app -d ./my-app --skip-install --yes
npx @rtorcato/repo-tooling setup --preset nextjs-app -d ./my-site --skip-install --yes

# Full control via a JSON config file
npx @rtorcato/repo-tooling setup --config ./project.json --skip-install

# Get the JSON Schema for the config file
npx @rtorcato/repo-tooling setup --config-schema > project-config.schema.json

# Preview without writing
npx @rtorcato/repo-tooling setup --preset library --dry-run
```

Available presets: `minimal`, `library`, `web-app`, `node-api`, `nextjs-app`, `react-app`, `swift-library`.

`minimal` is tsconfig + Biome + Vitest and nothing else. Pass `--yes` whenever a
human might be at the terminal: without it, `--preset` prints its file list and
opens a deselection prompt. A piped or redirected stream is treated as CI and
never prompts.

`swift-library` scaffolds a SwiftPM package — no `package.json`, no install step, and the file list is entirely different. See the [Swift guide](./swift.md).

**`--dry-run` output:**

```json
{
  "directory": "/Users/x/projects/my-lib",
  "config": { "projectName": "my-lib", "projectType": "library", "...": "..." },
  "files": [
    "package.json",
    ".editorconfig",
    ".nvmrc",
    "knip.json",
    "tsconfig.json",
    "biome.json",
    "vitest.config.ts",
    "tsup.config.ts",
    "release.config.mjs",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    ".github/workflows/codeql.yml",
    "..."
  ]
}
```

### `doctor` — audit an existing project

```bash
npx @rtorcato/repo-tooling doctor --json -d ./existing-repo
```

**Output shape:**

```json
{
  "directory": "/path/to/repo",
  "results": [
    { "check": "Node", "status": "ok", "detail": "v24.16.0" },
    { "check": "TypeScript", "status": "ok", "detail": "tsconfig.json extends \"@rtorcato/repo-tooling/typescript/*\"" },
    { "check": "Biome", "status": "drift", "detail": "biome.json found but does not extend \"@rtorcato/repo-tooling/biome\"", "hint": "Run `npx @rtorcato/repo-tooling copy biome` to scaffold" },
    { "check": "Dependabot", "status": "optional-missing", "detail": "no .github/dependabot.yml", "hint": "Run `npx @rtorcato/repo-tooling fix dependabot` to scaffold weekly dep updates" }
  ]
}
```

Status values: `ok`, `drift` (file exists but doesn't extend the preset), `missing` (required file absent), `optional-missing` (optional convention absent), `declared` (a real deviation `.repo-tooling.json` `exceptions` records on purpose, with its reason — don't fix it).

### `fix` — apply fixers for items doctor flagged

```bash
# Walk every doctor finding, apply each (no prompts, no surprises)
npx @rtorcato/repo-tooling fix --yes --json -d ./repo

# Apply a single fixer
npx @rtorcato/repo-tooling fix dependabot --yes --json
npx @rtorcato/repo-tooling fix engines --yes --json

# Preview without writing
npx @rtorcato/repo-tooling fix --yes --dry-run --json
```

**Output shape (`FixJsonResult`):**

```json
{
  "directory": "/path/to/repo",
  "target": null,
  "actions": [
    { "target": "engines", "check": "engines.node", "status": "applied", "doctorStatus": "drift", "filesWritten": ["package.json"] },
    { "target": "dependabot", "check": "Dependabot", "status": "applied", "doctorStatus": "optional-missing", "filesWritten": [".github/dependabot.yml"] },
    { "target": null, "check": "GitLab CI", "status": "unsupported", "doctorStatus": "optional-missing", "filesWritten": [] }
  ]
}
```

Action statuses: `applied` (fixer ran, files written), `dry-run` (would have written), `skipped` (user declined or fixer chose to skip), `already-ok` (no action needed), `unsupported` (no fixer registered for this check).

**Drift policy:** without `--yes`, drift cases default to "No" in the confirm prompt — your customisations are preserved. With `--yes`, drift IS overwritten. Safe-merge fixers (`engines`, `husky`, `package-json`) never overwrite even with `--yes` — they only add/merge.

### `list` — enumerate the library's surface area

```bash
npx @rtorcato/repo-tooling list --json
```

**Output shape:**

```json
{
  "tools": [
    {
      "name": "TypeScript",
      "description": "Base, React, Next.js, Node.js, Express tsconfig presets",
      "exports": [
        "@rtorcato/repo-tooling/typescript/base",
        "@rtorcato/repo-tooling/typescript/react",
        "..."
      ],
      "fixTarget": "tsconfig"
    },
    {
      "name": "Biome",
      "description": "Fast formatter and linter configuration",
      "exports": ["@rtorcato/repo-tooling/biome"],
      "fixTarget": "biome"
    }
  ]
}
```

Use this to discover what's available and to map between named tools and the `fix <target>` command that scaffolds each.

## Recommended workflows

### "Set up tooling for this new repo"

```bash
# 1. Decide the project type (or read from existing pkg deps)
PRESET=library  # or minimal, web-app, node-api, nextjs-app, react-app, swift-library

# 2. Preview
npx @rtorcato/repo-tooling setup --preset $PRESET --dry-run

# 3. Scaffold
npx @rtorcato/repo-tooling setup --preset $PRESET -d . --skip-install --yes

# 4. Install deps yourself (the CLI skips install when --skip-install is set)
pnpm install
```

### "Bring this existing repo up to spec"

```bash
# 1. Audit
DOCTOR=$(npx @rtorcato/repo-tooling doctor --json -d .)

# 2. Parse, decide whether to fix everything or specific items
#    (For agents: filter results where status !== "ok" && status !== "optional-missing" && status !== "declared")

# 3. Apply all fixable findings
npx @rtorcato/repo-tooling fix --yes --json -d .

# 4. Confirm
npx @rtorcato/repo-tooling doctor --json -d .
```

### "Add Dependabot to this repo (and nothing else)"

```bash
npx @rtorcato/repo-tooling fix dependabot --yes --json -d .
```

## Exit codes

- `setup` — `0` on success, `1` on failure (validation error, write failure).
- `doctor` — `0` if every check is `ok`, `optional-missing`, or `declared`; `1` if any `drift` or `missing`.
- `fix` — always `0` (intent expressed; rerun `doctor` to confirm state). Unknown target → `1` with a JSON error payload.
- `list` — `0`.
- `copy` — `0` on success, `1` on unknown config name.

## Stable JSON shapes

The TypeScript types for every JSON payload are exported from the package:

- `import type { CheckResult, CheckStatus } from '@rtorcato/repo-tooling/...'` (doctor)
- `import type { FixActionRecord, FixJsonResult } from '@rtorcato/repo-tooling/...'` (fix)
- `setup --config-schema` ships the canonical `ProjectConfig` JSON Schema

Versions of these shapes follow semver (additive changes only within a major).
