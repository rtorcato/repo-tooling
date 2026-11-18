---
title: Turborepo
description: Starter turbo.json task pipeline for pnpm-workspace monorepos.
---

:::caution Unsupported
Turborepo is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::


[Turborepo](https://turborepo.com) caches and parallelizes tasks across a
pnpm-workspace monorepo. repo-tooling scaffolds a starter `turbo.json` with a
sensible build/lint/typecheck/test/dev pipeline — you tune the `outputs` to
match what each package emits.

Because it only makes sense in a monorepo, the setup wizard offers it **only
when the target directory already contains `pnpm-workspace.yaml`**, and
`doctor` only reports on it inside a workspace.

## Usage

Scaffold it into an existing monorepo:

```bash
npx @rtorcato/repo-tooling fix turborepo
```

`setup` also offers it interactively when it detects a `pnpm-workspace.yaml`.
The fixer is **safe-add** — it never overwrites an existing `turbo.json`.

## Generated `turbo.json`

```json
{
  "$schema": "https://turborepo.com/schema.json",
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"]
    },
    "lint": {},
    "typecheck": { "dependsOn": ["^build"] },
    "test": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"]
    },
    "dev": { "cache": false, "persistent": true }
  }
}
```

- `dependsOn: ["^build"]` — a task waits for the same task in its workspace
  dependencies to finish first (the `^` means "upstream packages").
- `outputs` — the files Turborepo caches per task. Trim these to what your
  packages actually produce (e.g. drop `.next/**` if you have no Next.js app).
- `dev` is `cache: false` + `persistent: true` — long-running, never cached.

## Peer dependency

Add `turbo` to the workspace root `devDependencies` and wire the scripts:

```json
{
  "scripts": {
    "build": "turbo run build",
    "test": "turbo run test",
    "lint": "turbo run lint"
  },
  "devDependencies": {
    "turbo": "^2"
  }
}
```

Then `doctor` reports `Turborepo — ok` once `turbo.json` is present.
