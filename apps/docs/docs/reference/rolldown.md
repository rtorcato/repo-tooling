---
title: Rolldown
description: Rolldown bundler configuration factory for TypeScript libraries. Rust-based, Rollup-API-compatible.
---

:::caution Unsupported
Rolldown is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::

[Rolldown](https://rolldown.rs) is the Rust-based, Rollup-API-compatible bundler
that Vite uses internally. It's offered as a bundler peer to [Rollup](./rollup.md),
[tsup](./tsup.md), and [esbuild](./esbuild.md). The preset produces unbundled,
per-file ESM + CJS output and leaves every dependency external so the published
library stays thin — the same shape as the Rollup preset, but Rolldown transpiles
TypeScript natively, so there's no `@rollup/plugin-typescript` to install.

## Usage

Re-export the default config:

```javascript
// rolldown.config.mjs
export { default } from '@rtorcato/repo-tooling/rolldown'
```

…or customize the entry point:

```javascript
// rolldown.config.mjs
import { getConfig } from '@rtorcato/repo-tooling/rolldown'

export default getConfig({ input: 'src/main.ts' })
```

Then wire it into `package.json`:

```json
{
  "scripts": {
    "build": "rolldown -c",
    "build:watch": "rolldown -c --watch"
  }
}
```

`setup` scaffolds this for you when you pick Rolldown, and
`npx @rtorcato/repo-tooling fix rolldown` drops the `rolldown.config.mjs` into an
existing project.

## Peer dependency

Only `rolldown` is needed (added automatically by `setup`/`fix`) — TypeScript is
transpiled natively.

## Type declarations

Rolldown's `.d.ts` output is still experimental, so the preset doesn't emit
declarations. Generate them with `tsc` alongside the bundle:

```json
{
  "scripts": {
    "build": "rolldown -c && tsc --emitDeclarationOnly --outDir dist"
  }
}
```

## API

### `getConfig(options?)`

Returns a Rolldown config with ESM + CJS outputs.

| Option | Default | Meaning |
|---|---|---|
| `input` | `src/index.ts` | Library entry point |
| `outDir` | `dist` | Output directory |
| `sourcemap` | `true` | Emit sourcemaps |
| `external` | every bare import | Which ids to leave external |
