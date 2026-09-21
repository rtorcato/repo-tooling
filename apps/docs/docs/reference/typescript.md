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

The wizard copies a `reset.d.ts` that imports `@total-typescript/ts-reset`, giving you stricter array and JSON types out of the box. Available at:

```bash
npx @rtorcato/repo-tooling copy reset
```
