---
title: Vite+ preset
description: Opt-in setup presets that put a repo on Vite+ (vite-plus, the vp CLI) instead of Biome, tsup and a separate Vitest, and what doctor does differently on one.
---

[Vite+](https://viteplus.dev) (`vite-plus`, the `vp` CLI) bundles Vite and
Rolldown (build), Oxlint, Oxfmt and tsgo (`vp check`), Vitest (`vp test`) and
tsdown (`vp pack`), all configured from one `vite.config.ts`. repo-tooling can
scaffold a repo on it, and `doctor` and `fix` understand one.

It is **opt-in**. No existing preset changes, and nothing here moves the
torcato.dev repos off Biome, tsup and esbuild.

## Scaffold

```bash
git init   # first, so `vp config` can install the git hooks

# A published library (ESM + CJS, .d.ts, exports map, publint, attw, semantic-release)
npx @rtorcato/repo-tooling setup --preset vite-plus -d ./my-lib --yes

# An app (index.html, vp dev / vp build / vp preview)
npx @rtorcato/repo-tooling setup --preset vite-plus-app -d ./my-app --yes
```

Without a git repo the install still succeeds, but `vp config` reports
`.git can't be found` and the hooks stay off until you run `pnpm install` again.

The interactive wizard (`setup` with no preset) offers it too: pick `library` or
`web-app` and it asks "Use Vite+?". Answer yes and it skips the lint, format,
test-framework and bundler questions, because Vite+ owns all four.

`--config` works too. Set `"vitePlus": true`, `"linting": { "tool": "none" }`,
`"formatting": { "tool": "none" }` and `"bundler": "vite"`; `projectType` is
`library` or `web-app`.

## What it replaces

| Biome repo | Vite+ repo |
|---|---|
| `biome.json`, `pnpm check` runs `biome check .` | `lint` and `fmt` keys of `vite.config.ts`, `pnpm check` runs `vp check` |
| `tsc --noEmit` as `pnpm typecheck` | `lint.options.typeCheck`, run by `vp check`. There is no `typecheck` script |
| `vitest.config.ts`, `vitest` | the `test` key of `vite.config.ts`, `vp test`. Tests import from `vite-plus/test` |
| `tsup.config.ts`, `tsup` | the `pack` key of `vite.config.ts`, `vp pack` (a library) or `vp build` (an app) |
| Husky + lint-staged, `.husky/` | `vp config` + `vp staged`, `.vite-hooks/`, the `staged` key |
| `pnpm-workspace.yaml` with the managed settings | the same, plus the `vite-plus` catalog and the `vite@*` override Vite+ needs |

The one thing a Biome repo has that this does not: `husky` and `lint-staged`
are not installed. Commitlint stays, as `.vite-hooks/commit-msg`.

## A library keeps the same publish contract

`vp pack` is tsdown. Out of the box it names files `.mjs` and `.d.mts`, which
would not match the exports map every other library preset writes. The preset
sets `fixedExtension: false`, so the output is the same as tsup's:

```text
dist/index.js      dist/index.d.ts      (ESM)
dist/index.cjs     dist/index.d.cts     (CJS)
```

`package.json` carries the same dual `exports`, and `publint --strict` and
`attw --pack` both pass on the result. It does not set `exports: true`, which
would have `vp pack` rewrite `package.json` on every build.

`vp build` is the app builder. On a library it fails with
`UNRESOLVED_ENTRY ... index.html`, so the library's `build` script is `vp pack`.

TypeScript stays on the version our tsconfig preset supports (the Vite+
template pins 7.x, which `vp pack` warns is experimental).

## Choosing between Vite+ and the other tools

Setup refuses the mixes. A `--config` file with `vitePlus: true` is invalid if
it also sets:

- `linting.tool` or `formatting.tool` to anything but `none` (Biome, ESLint or
  Prettier would format the same files a second time),
- `oxlint: true` (Vite+ pins its own Oxlint, so a `.oxlintrc.json` would be a
  second source of lint rules),
- a `testing.framework` other than `vitest`, a `bundler` other than `vite`, or a
  `projectType` other than `library` or `web-app`.

There is no silent precedence rule. The existing Oxlint add-on is unchanged for
Biome repos.

## CI

The generated `ci.yml` uses plain pnpm, the same steps as every other preset:
`setup-node` from `.nvmrc`, `pnpm/action-setup`, `pnpm install --frozen-lockfile`,
then `pnpm check`, `pnpm test` and `pnpm build`. Those call the local `vp`, so CI
runs the version in your lockfile and no remote install script runs.

[`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) is not used.
It installs a global `vp` from a script fetched at run time, and its moving `v1`
tag is frozen at v1.15.0. If you want it anyway, pin an exact commit and set
`node-manager: false` after `setup-node`, so `.nvmrc` stays the source of truth.

There is no `typecheck` job (`vp check` already type-checks) and no coverage run.

## Node

Vite+ declares `engines.node` as `^22.18.0 || ^24.11.0 || >=26.0.0`. The preset
writes that into `package.json`, pins `.nvmrc` to `22`, and tests on Node 22
and 26.

## doctor and fix

`doctor` reads `vitePlus` from `.repo-tooling.json`. With it set:

- **Biome, ESLint, Prettier, Vitest, Oxlint and Turborepo** are reported as
  intentionally declined. Their config lives in `vite.config.ts`, and `vp run`
  is the task runner.
- **Git hooks and Pre-push hook** look in `.vite-hooks/` when `prepare` is
  `vp config`, not in `.husky/`. **lint-staged** passes when
  `.vite-hooks/pre-commit` runs `vp staged`.
- **verify script** accepts `vp test` as the test step.
- **Exports buildable** knows `vp pack`.
- **GitHub Actions** compares `ci.yml` against the Vite+ shape: `pnpm check`,
  no typecheck job.
- **VS Code extensions** recommend the Oxc extension.

`fix husky` on a Vite+ repo writes `.vite-hooks/` instead of `.husky/`, and
`fix verify` composes `pnpm check && pnpm exec vp test run`.

The preset writes `packageManager`, which is what the `packageManager` check
and the generated workflow read. Vite+'s own templates write
`devEngines.packageManager` instead; `doctor` does not treat that as a
substitute.
