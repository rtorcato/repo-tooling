---
title: Supported stack
description: What repo-tooling supports, what is partial, and what is unsupported.
sidebar_position: 1
---

# Supported stack

repo-tooling is maintained by one person, so it supports one stack well instead of many stacks loosely. This page says which is which. Anything not listed as supported is **unsupported**: it may still work, but nothing is promised.

## Supported

| Area | Supported choice |
| --- | --- |
| Language | JavaScript and TypeScript |
| Package manager | pnpm |
| Lint and format | Biome |
| Tests | Vitest |
| Build | tsup |
| Releases | Changesets |
| CI | GitHub Actions |
| Branch flows | Trunk (`main` only) and staged (`dev` into `main`), see [Git flow](./git-flow.md) |

The `setup` presets, `doctor` checks and `fix` targets for these are tested and kept current. Bugs here get fixed.

Commitlint, Husky, Dependabot and CodeQL are part of what the default presets scaffold on this stack, so they are supported with it.

## Partial

| Language | Detected from | What you get |
| --- | --- | --- |
| Swift | `Package.swift` | `doctor`, `fix` and the `swift-library` preset. See the [Swift guide](./swift.md). |
| Python | `pyproject.toml` | `doctor` and `fix`. No `setup` preset. See [Python](../reference/python.md). |
| Perl | `cpanfile`, `Makefile.PL`, `dist.ini` | `doctor` and `fix`. No `setup` preset. See [Perl](../reference/perl.md). |

Partial means the module is kept and still works, with no guarantees. It will not get `setup` parity with JS and TypeScript. Dropping a partial module would be a breaking change, and none is planned.

A repo with no language marker gets neutral templates only. It never gets JS defaults.

## Unsupported

These are still usable. Nothing is promised about them, and bug reports against them may be closed.

| Area | Unsupported |
| --- | --- |
| Package managers | npm, Yarn, [Bun](../reference/bun.md) |
| Lint and format | [ESLint](../reference/eslint.md), [oxlint](../reference/oxlint.md), [Prettier](../reference/prettier.md) |
| Tests | [Jest](../reference/jest.md), [Cypress](../reference/cypress.md) |
| Build | [esbuild](../reference/esbuild.md), [Rollup](../reference/rollup.md), [Rolldown](../reference/rolldown.md), [Vite+](./vite-plus.md) |
| Releases | [semantic-release](../reference/semantic-release.md), [release-please](../reference/release-please.md) |
| Monorepo tools | [Nx](../reference/nx.md), [Turborepo](../reference/turborepo.md) |
| CI | Any provider other than GitHub Actions |

To use one of these without `doctor` flagging it as drift, declare it in [`rules.exceptions`](../reference/repo-tooling-json.mdx#rulesexceptions--declared-deviations) with a reason. The exception keeps `doctor` quiet and carries no support promise.

## Why the line is here

Every extra bundler, release tool or language is another set of checks and fixers to keep passing. Removing code paths is a separate decision from this page. This page only says where support stops today.
