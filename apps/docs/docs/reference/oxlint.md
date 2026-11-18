---
title: Oxlint
description: Rust-based linter additive to Biome. 50–100× faster than ESLint.
---

:::caution Unsupported
oxlint is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::


[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) is a Rust-based linter that's 50–100× faster than ESLint. We position it as **additive** to Biome — Biome stays the source of truth for formatting and the broad lint baseline; Oxlint adds a faster pass for type-aware and import rules Biome doesn't cover yet.

## Setup

The setup wizard offers Oxlint as an opt-in after the primary linter prompt:

```text
? 🔍 Which linting/formatting tool? ⚡ Biome
? 🦀 Also run Oxlint alongside (50–100× faster than ESLint)? Yes
```

If you opt in, the wizard drops `.oxlintrc.json` at the project root using the canonical preset.

## Adding to an existing project

```bash
npx @rtorcato/repo-tooling copy oxlint
```

Add a script to your `package.json`:

```json
{
  "scripts": {
    "oxlint": "oxlint",
    "verify": "pnpm typecheck && pnpm lint && pnpm oxlint && pnpm test --run"
  }
}
```

## Configuration

The shipped preset (`tooling/oxlint/oxlintrc.json`) enables:

| Category | Severity | Notes |
|---|---|---|
| `correctness` | error | bugs, type errors |
| `perf` | warn | known perf footguns |
| `suspicious` | warn | likely-wrong patterns |
| `pedantic` / `style` / `restriction` / `nursery` | off | overlaps with Biome / too noisy |

Plugins enabled: `typescript`, `unicorn`, `oxc`, `import`.

## Customising

Oxlint configs are project-owned (Oxlint's `extends` from npm packages isn't reliably supported), so once `.oxlintrc.json` is in your repo you fully own it. Drop the `categories` and `rules` you don't want.

## When to skip Oxlint

- Solo projects where Biome alone catches enough.
- Repos with very small surface area (the speed advantage doesn't matter under ~5k LOC).
- Projects that use ESLint as their primary linter — running both is redundant.
