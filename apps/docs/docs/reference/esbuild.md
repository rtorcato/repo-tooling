---
title: esbuild
description: esbuild bundler helper functions.
---

## Usage

```javascript
// build.mjs
import { buildCode, getEntryPoints, getEntrypointFolders } from '@rtorcato/repo-tooling/esbuild'

const folders = await getEntrypointFolders('src')
const entryPoints = (await Promise.all(folders.map(getEntryPoints))).flat()

await buildCode(entryPoints)
```

## API

### `buildCode(entryPoints)`

Runs an esbuild build with opinionated defaults:

| Option | Value |
|---|---|
| `outdir` | `dist` |
| `platform` | `node` |
| `format` | `esm` |
| `target` | `esnext` |
| `bundle` | `true` |
| `splitting` | `true` |
| `sourcemap` | development only |
| `minify` | production only |
| `plugins` | `esbuild-node-externals`, only when `package.json` declares `dependencies`, `peerDependencies` or `optionalDependencies` |

### `getEntryPoints(dir, fileExtension?, excludeTestFiles?)`

Returns all `.ts` files in `dir`, excluding test files by default.

### `getEntrypointFolders(dir)`

Returns subdirectories of `dir` that contain an `index.ts`.
