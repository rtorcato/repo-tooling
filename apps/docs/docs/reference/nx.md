---
title: Nx
description: Starter nx.json task orchestrator for pnpm-workspace monorepos. Alternative to Turborepo.
---

:::caution Unsupported
Nx is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::

[Nx](https://nx.dev) is a monorepo task orchestrator with an affected-build model
and a deep plugin ecosystem. repo-tooling scaffolds a minimal `nx.json` with a
`targetDefaults` pipeline covering build/lint/typecheck/test — a peer to
[Turborepo](./turborepo.md). Plugin generators are deferred; start from the
minimal pnpm-workspace shape and add plugins as you need them.

Like Turborepo, it only makes sense in a monorepo, so the setup wizard offers a
**Monorepo task orchestrator?** choice — Turborepo (default), Nx, or none — only
when the target directory contains `pnpm-workspace.yaml`. Pick one; `doctor`
flags a repo running both.

## Usage

Scaffold it into an existing monorepo:

```bash
npx @rtorcato/repo-tooling fix nx
```

The fixer is **safe-add** — it never overwrites an existing `nx.json`.

## Generated `nx.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/nrwl/nx/master/packages/nx/schemas/nx-schema.json",
  "namedInputs": {
    "default": ["{projectRoot}/**/*", "sharedGlobals"],
    "production": ["default"],
    "sharedGlobals": []
  },
  "targetDefaults": {
    "build": { "dependsOn": ["^build"], "outputs": ["{projectRoot}/dist"], "cache": true },
    "lint": { "cache": true },
    "typecheck": { "dependsOn": ["^build"], "cache": true },
    "test": { "dependsOn": ["^build"], "cache": true }
  }
}
```

- `dependsOn: ["^build"]` — a target waits for the same target in upstream
  workspace dependencies (the `^` means "dependencies first").
- `outputs` — the files Nx caches per target. Adjust `{projectRoot}/dist` to what
  each package emits.
- `cache: true` — enables Nx's local (and, if configured, remote) task cache.

## Peer dependency

Add `nx` to the workspace root `devDependencies` and run tasks through it:

```bash
pnpm add -Dw nx
pnpm nx run-many -t build
pnpm nx affected -t test   # only projects touched by your changes
```

## Choosing between Nx and Turborepo

- **Nx** — affected-graph builds, a large plugin/generator ecosystem, and
  distributed task execution for big monorepos.
- **Turborepo** — a lighter, config-first pipeline when you mainly want caching
  and parallelism without the plugin surface.

## Doctor behaviour

- In a pnpm workspace, `doctor` reports the orchestrator check ok when either
  `turbo.json` or `nx.json` is present — no preference.
- If **both** are present, it flags drift — pick one and remove the other.
