---
title: Commitlint
description: Conventional commit message linting configuration.
---

## Usage

```javascript
// commitlint.config.js
import config from '@rtorcato/repo-tooling/commitlint/config'
export default config
```

The preset enforces [Conventional Commits](https://www.conventionalcommits.org/).

## Line lengths

- `header-max-length`: **100** — the conventional-commits/semantic-release
  default. Keep PR titles ≤ 93 chars so GitHub's ` (#N)` squash suffix still
  fits on the merged commit.
- `body-max-line-length` / `footer-max-line-length`: **off**. Machine-written
  commits don't wrap, and a `BREAKING CHANGE:` footer is the input
  semantic-release reads to cut a major — a length cap there is friction on the
  highest-stakes commit in the repo. The subject-line rules that decide the
  release type stay enforced.

## Skipped commits

Two kinds of commit are ignored outright:

- anything containing `[skip ci]` (semantic-release's own release commits)
- bot commits, matched on a `Signed-off-by: …[bot]` trailer — Dependabot and
  Renovate write the whole message, headers included

## With Husky

The `setup` wizard wires Husky + lint-staged + commitlint automatically. To add it manually:

```bash
npx husky init
echo "npx commitlint --edit \$1" > .husky/commit-msg
```
