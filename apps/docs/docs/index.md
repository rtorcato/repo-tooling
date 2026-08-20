---
title: repo-tooling
description: JavaScript and TypeScript tooling for Node.js, React, Next.js, and Vitest.
sidebar_position: 0
---

# repo-tooling

One package. Full dev toolchain. TypeScript, linting, testing, commits, releases — wired together and validated against each other.

[![CI](https://github.com/rtorcato/repo-tooling/actions/workflows/ci.yml/badge.svg)](https://github.com/rtorcato/repo-tooling/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@rtorcato%2Frepo-tooling.svg)](https://badge.fury.io/js/@rtorcato%2Frepo-tooling)
[![Bundle size](https://img.shields.io/bundlephobia/minzip/@rtorcato/repo-tooling)](https://bundlephobia.com/package/@rtorcato/repo-tooling)
[![Coverage](https://codecov.io/gh/rtorcato/repo-tooling/branch/main/graph/badge.svg)](https://codecov.io/gh/rtorcato/repo-tooling)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why this exists

Most tooling libraries give you one piece — just TypeScript configs, or just an ESLint preset. **repo-tooling** covers the entire lifecycle: TypeScript, Biome/ESLint, Vitest/Jest, Commitlint, Husky, Semantic Release, GitHub Actions CI, and supply-chain security (Dependabot + CodeQL) — all wired together and validated against each other.

The interactive `setup` wizard scaffolds all of it in one shot for a new project, `doctor` checks an existing project for drift, and `fix` applies the missing pieces incrementally without overwriting your work.

## Quick install

```bash
npx @rtorcato/repo-tooling setup
```

## What's included

- **TypeScript** — base configs for library, React, Next.js, Node, and Express projects.
- **Biome & ESLint** — opinionated linting and formatting presets. Biome recommended for new projects.
- **Vitest & Jest** — testing framework configs and Jest presets for browser and Node environments.
- **Commitlint & Husky** — conventional commit enforcement with git hooks pre-wired.
- **Semantic Release** — automated versioning, changelog, and npm publishing pipelines.
- **Supply-chain security** — Dependabot for weekly dep updates and CodeQL for security scanning, scaffolded as opt-in workflows.
- **CLI** — `setup` wizard for new projects, `doctor` drift checker, `fix` for incremental upgrades, and `copy` for individual files.

## Use with Claude Code

This repo is a self-hosted Claude Code marketplace. Install the plugin to get two
skills — `repo-tooling` (adopt/audit the presets via the CLI) and `npm-publish`
(never hand-cut a release):

```
/plugin marketplace add rtorcato/repo-tooling
/plugin install repo-tooling@repo-tooling
```

## Use with other AI tools

[`AGENTS.md`](https://github.com/rtorcato/repo-tooling/blob/main/AGENTS.md) carries the
same guidance in the cross-tool convention Cursor, Copilot, and Codex read, and ships
in the npm tarball. See [For AI agents](./guides/for-ai-agents.md) for the
non-interactive CLI contract.

## Next steps

- [Get started](./guides/getting-started.mdx) — install and scaffold a project.
- [CLI reference](./guides/cli.md) — every command and flag.
- [For AI agents](./guides/for-ai-agents.md) — non-interactive usage from automated agents and CI bots.
- [Library style guide](./guides/library-style.md) — JSDoc shape and type-test conventions for TypeScript libraries.
