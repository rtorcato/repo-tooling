---
title: Semantic Release
description: Automated versioning and publishing configuration.
---

## Usage

```javascript
// release.config.js
import config from '@rtorcato/repo-tooling/semantic-release/github'
export default config
```

## Available presets

| Export | Use case |
|---|---|
| `semantic-release/github` | npm publish + GitHub release |
| `semantic-release/docker` | Docker image + GitHub release |

## Required secrets

| Secret | Purpose |
|---|---|
| `NPM_TOKEN` | Publish to npm registry |
| `GITHUB_TOKEN` | Create GitHub releases (auto-provided) |

## What it does on merge to `main`

1. Analyses commit messages since the last release
2. Determines the next semver version (`patch` / `minor` / `major`)
3. Publishes to npm
4. Creates a git tag and a GitHub Release with the notes

## What it deliberately does *not* do

It does not commit anything back to `main`. `@semantic-release/git` and
`@semantic-release/changelog` are not in the preset, so **`CHANGELOG.md` and the
`version` field in `package.json` stop moving on the default branch.**

That is not an oversight. `fix github-settings` installs a `code-scanning-main`
ruleset requiring CodeQL results on the default branch; a release commit created
seconds earlier can never have them, so the push fails with `GH013` — and it
fails *silently*, because a merge that produces no release goes green either way.
See [#417](https://github.com/rtorcato/repo-tooling/issues/417).

The tag, the npm publish and the GitHub Release are unaffected and are the source
of truth for what shipped. Build any user-facing changelog from GitHub Releases:

```bash
npx @rtorcato/repo-tooling copy docusaurus-sync-changelog
```

That script reads the Releases API, so it cannot freeze the way a file does. Its
docs workflow needs a `release: types: [published]` trigger — with no release
commit landing on `main`, a `push` trigger never fires after a release.

:::warning Adding a bypass actor is not the fix
Exempting the release bot from the ruleset would also make the push succeed. It
exempts the one commit nobody reviews.
:::
