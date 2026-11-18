---
title: Rollup
description: Rollup bundler configuration factory for TypeScript libraries.
---

:::caution Unsupported
Rollup is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::


Rollup is the de-facto library bundler, offered as a peer to [tsup](./tsup.md)
and [esbuild](./esbuild.md). The preset produces unbundled, per-file ESM + CJS
output with `.d.ts` declarations — the same shape as the tsup preset — and
leaves every dependency external so the published library stays thin.

## Usage

Re-export the default config:

```javascript
// rollup.config.mjs
export { default } from '@rtorcato/repo-tooling/rollup'
```

…or customize the entry point:

```javascript
// rollup.config.mjs
import { getConfig } from '@rtorcato/repo-tooling/rollup'

export default getConfig({ input: 'src/main.ts' })
```

Then wire it into `package.json`:

```json
{
  "scripts": {
    "build": "rollup -c",
    "build:watch": "rollup -c --watch"
  }
}
```

`setup --preset library` scaffolds this for you when you pick Rollup, and
`npx @rtorcato/repo-tooling fix rollup` drops the `rollup.config.mjs` into an
existing project.

## Peer dependencies

The preset expects these in your `devDependencies` (added automatically by
`setup`/`fix`):

- `rollup`
- `@rollup/plugin-typescript`
- `tslib`

## API

### `getConfig(options?)`

Returns an array of two Rollup configs (ESM + CJS). Declarations are emitted
once, from the ESM pass.

| Option | Default | Meaning |
|---|---|---|
| `input` | `src/index.ts` | Library entry point |
| `outDir` | `dist` | Output directory for JS + declarations |
| `sourcemap` | `true` | Emit sourcemaps |
| `external` | every bare import | Which ids to leave external |
| `tsconfig` | `./tsconfig.json` | tsconfig for `@rollup/plugin-typescript` |
