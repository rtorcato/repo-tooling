---
title: TypeScript
description: TypeScript configuration presets.
---

## Usage

Extend a preset in your `tsconfig.json`:

```json
{
  "extends": "@rtorcato/repo-tooling/typescript/base"
}
```

## Available presets

| Export | Use case |
|---|---|
| `typescript/base` | Base config for all projects |
| `typescript/react` | React component libraries |
| `typescript/vite-app` | React apps built with Vite |
| `typescript/next` | Next.js apps |
| `typescript/node` | Node.js servers and scripts |
| `typescript/express` | Express.js APIs |

### `next` and path aliases

`typescript/next` sets no `~/*` or `@/*` alias. The other presets anchor `paths` with `${configDir}`, which Turbopack doesn't expand, so `next build` failed with `Can't resolve '@/…'`. Declare the aliases in your own `tsconfig.json`, where `./src/*` resolves against your project (`setup` and `fix tsconfig` write this for you):

```json
{
  "extends": "@rtorcato/repo-tooling/typescript/next",
  "compilerOptions": { "paths": { "@/*": ["./src/*"], "~/*": ["./src/*"] } }
}
```

### `react` vs `vite-app`

`typescript/react` is library-shaped: its `types` omit `vite/client`, and it excludes
`**/*.test.ts` / `**/*.spec.ts` because a library's `tsc` run is a build that emits `dist/`.

`typescript/vite-app` extends it for applications, where `typecheck` is the CI gate rather than a
build. It adds `vite/client` to `types` — without which `import.meta.env` and the `?url` / `?raw`
import suffixes don't compile — and puts the tests back in `include`, since they're the code most
likely to drift after a signature change.

Staying on `typescript/react` for a Vite app means restating both, and `types` replaces rather than
merges, so all four entries have to be listed:

```jsonc
{
  "extends": "@rtorcato/repo-tooling/typescript/react",
  "compilerOptions": { "types": ["react", "react-dom", "vitest", "vite/client"] },
  "include": ["src", "index.d.ts", "types", "tests"],
  "exclude": ["node_modules", "dist", "build", "out"]
}
```

## ts-reset

The wizard copies a `reset.d.ts` that imports `@total-typescript/ts-reset`, giving you stricter array and JSON types out of the box. `copy` has no target for it, so in an existing project add it by hand:

```bash
pnpm add -D @total-typescript/ts-reset
echo "import '@total-typescript/ts-reset'" > reset.d.ts
```

Then add `reset.d.ts` to `include` in your `tsconfig.json`.
