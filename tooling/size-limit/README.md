# size-limit preset

Bundle-size budget enforcement for TypeScript/JavaScript libraries, powered by [size-limit](https://github.com/ai/size-limit) + `@size-limit/preset-small-lib` (rolldown + brotli as of v14, esbuild before — measures what a downstream consumer actually downloads).

## Installation

```bash
pnpm add -D @rtorcato/repo-tooling size-limit @size-limit/preset-small-lib
```

`size-limit` and `@size-limit/preset-small-lib` are listed as peer deps of `@rtorcato/repo-tooling`.

## Usage

### Scaffolded by the CLI

```bash
npx @rtorcato/repo-tooling fix size-limit
```

Writes a default `.size-limit.json` to your project root (or you can use a `"size-limit"` field in `package.json` — both work).

### Manual

Copy [`.size-limit.json`](./.size-limit.json) to your project root, then customize per-subpath (one entry per importable module is the recommended pattern for tree-shakeable libraries):

```json
[
  {
    "name": "@your-pkg/clipboard",
    "path": "dist/clipboard/index.js",
    "limit": "500 B"
  },
  {
    "name": "@your-pkg/dom",
    "path": "dist/dom/index.js",
    "limit": "1 kB"
  }
]
```

Add a script to `package.json`:

```json
{
  "scripts": {
    "size": "size-limit"
  }
}
```

Run locally with `pnpm size`. Enforce in CI by adding a `pnpm size` step after the build job.

## Why per-subpath budgets

For a tree-shakeable library with multiple subpath exports (`@your-pkg/foo`, `@your-pkg/bar`), per-subpath budgets catch the *actual* regression a consumer would feel — bundling a single import shouldn't pull in unrelated modules. A single "whole package" budget hides import-graph leakage.

## Recommended budgets

| Module shape | Suggested limit |
|---|---|
| Thin API wrapper (1-4 functions) | 300 B – 500 B |
| Medium helper (5-10 functions) | 500 B – 1 kB |
| Larger feature (DOM, canvas, observers) | 1 kB – 2 kB |

All budgets are brotli-compressed. Adjust based on your library's actual baseline + ~50% headroom.
