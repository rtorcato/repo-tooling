---
title: Bun
description: Bun runtime/test-runner support — a Bun-typed tsconfig preset and a bunfig.toml template.
---

:::caution Unsupported
Bun is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::

[Bun](https://bun.sh) is a JavaScript runtime, test runner, and bundler. Even
teams shipping Node-targeted libraries increasingly use Bun for the dev loop.
repo-tooling ships a Bun-typed TypeScript preset and a `bunfig.toml` template so
`bun test` / `bun run` work against the same source tree.

Bun support is **opt-in and additive** — it doesn't change your package manager,
build, or release setup. Most consumers still target Node-compatible libraries
and just want Bun's fast dev loop.

## Usage

**New projects** — the `setup` wizard asks "Target the Bun runtime?" for library
and Node-API projects. Answer yes and it emits `bunfig.toml` and a Bun-typed
`tsconfig.json` as part of the scaffold (or set `"bun": true` in a
`--config` file).

**Existing projects** — scaffold the Bun toolchain files with the fixer:

```bash
npx @rtorcato/repo-tooling fix bun
```

This is **safe-add** — it writes:

- `bunfig.toml` — only if one doesn't already exist.
- `tsconfig.json` extending the Bun preset — **only when no `tsconfig.json`
  exists yet**. In an existing project, point your tsconfig at the preset by hand
  (below).

Install Bun's types:

```bash
bun add -d @types/bun
```

## TypeScript preset

The Bun preset extends the shared base and adds `types: ["bun"]`:

```json
// tsconfig.json
{ "extends": "@rtorcato/repo-tooling/typescript/bun" }
```

which resolves to:

```json
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["bun"]
  },
  "include": ["src", "index.d.ts"],
  "exclude": ["node_modules", "dist", "build", "test", "**/*.test.ts", "**/*.spec.ts"]
}
```

## `bunfig.toml`

A minimal, library-friendly default — tune to taste:

```toml
[install]
frozenLockfile = false
exact = true

[test]
coverage = false
root = "."
```

## Testing under Bun

You have two options:

- **`bun test`** — Bun's built-in Jest-style runner. Fast, zero-config, uses the
  `bun:test` API. Good when Bun is your primary runtime.
- **Vitest under Bun** — Vitest runs under Bun (`bun run vitest`), so the shipped
  [Vitest preset](./vitest.md) works unchanged if you want a single test runner
  across Node and Bun. This is the safer choice for libraries that must also pass
  on Node CI.

## Import path

| Export | Use case |
|---|---|
| `@rtorcato/repo-tooling/typescript/bun` | Bun-typed tsconfig (`types: ["bun"]`) |
