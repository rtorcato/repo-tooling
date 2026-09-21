# `tsconfig`

These are base shared `tsconfig.json` files from which all other `tsconfig.json`'s inherit.

## Usage

1. **Install this package** (if published as a package):
   ```sh
   pnpm add -D @your-org/tsconfig
   # or
   npm install --save-dev @your-org/tsconfig
   # or
   yarn add -D @your-org/tsconfig
   ```

2. **Extend the relevant config in your project `tsconfig.json`:**
   ```jsonc
   {
     "extends": "./path/to/tooling/typescript/tsconfig.base.json", // or tsconfig.react.jsonc, etc.
     // ...your overrides
   }
   ```
   Replace the path with the config that matches your project type:
   - `tsconfig.base.jsonc`: General base config
   - `tsconfig.build.jsonc`: For npm package/library builds
   - `tsconfig.react.jsonc`: For React component libraries
   - `tsconfig.vite-app.jsonc`: For React apps built with Vite — adds `vite/client`
     to `types` (so `import.meta.env` and `?url` imports compile) and type-checks the
     tests, both of which the library-shaped react preset leaves out
   - `tsconfig.next.jsonc`: For Next.js apps
   - `tsconfig.node.jsonc`: For Node.js/Express APIs
   - `tsconfig.express.jsonc`: (If used) For Express APIs

3. **Customizing:**
   You can override or add any settings in your own `tsconfig.json` as needed.

## Example

```jsonc
{
  "extends": "../tooling/typescript/tsconfig.react.json",
  // `~/*` and `@/*` → `./src/*` are inherited from the preset, anchored to this
  // project via ${configDir} — no `baseUrl`/`paths` needed (baseUrl is deprecated
  // in TS 5.9, removed in TS 7.0).
  "include": ["src"]
}
```

## Notes
- These configs are meant to be shared and extended, not used directly.
- Pick the config that matches your project type for best results.

