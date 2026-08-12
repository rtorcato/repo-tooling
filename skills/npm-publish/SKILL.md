---
name: npm-publish
description: Use before releasing or publishing any @rtorcato/* package (repo-tooling and the whole family publish the same way). Triggers on "publish", "cut a release", "bump the version", "tag a release", "npm publish", "how do releases work here". The hard rule — releases are automated by semantic-release on merge to main; an agent must NEVER run `npm publish`, `npm version`, or `git tag`, or hand-edit the version in package.json. NOT for the day-to-day tooling audit/fix flow — that's the repo-tooling skill.
---

# npm-publish

Every `@rtorcato/*` package releases through **semantic-release on push to `main`**.
Versioning, the git tag, the GitHub release, the CHANGELOG, and the npm publish are
all derived from the commit history. There is no manual release step.

## The rule

**Never** run any of these — they fight the automation and corrupt the version line:

- `npm publish` / `pnpm publish`
- `npm version` (or editing `"version"` in `package.json`)
- `git tag` / pushing tags
- hand-editing `CHANGELOG.md`

If asked to "release" or "bump the version", the correct action is to land a
**conventional commit** on `main` (via PR) and let the pipeline do the rest.

## How a release actually happens

1. Work on a branch; commit with Conventional Commits (header ≤ 100 chars).
2. Open a PR; merge to `main` after review + green CI.
3. semantic-release runs on `main` and decides the bump from the commits:
   - `fix:` → patch
   - `feat:` → minor
   - `feat!:` / `BREAKING CHANGE:` → major
   - `chore:` / `docs:` / `refactor:` / `test:` → **no release**
4. It writes the version, tag, GitHub release, CHANGELOG, and publishes to npm.

## What an agent should do

- To ship a change: make sure it carries the right commit type, then merge to `main`.
- To check the last release: `git tag --sort=-creatordate | head -1`, or the GitHub
  Releases page — don't infer it from `package.json` (that's `0.0.0-development` /
  the placeholder until CI stamps it).
- If a release seems stuck, inspect the release workflow run — do **not** publish by hand.

## Why

Manual publishes skip provenance, the CHANGELOG, and the tag/version invariant the
whole family relies on, and a stray `npm version` commit derails the next automated
bump. One automated path keeps every sibling repo publishing identically.
