---
title: Release Please
description: Google's release-PR-driven release tool. Alternative to semantic-release and Changesets.
---

:::caution Unsupported
release-please is outside the [supported stack](../guides/supported-stack.md). It still works through `rules.exceptions`, with no guarantees.
:::


[Release Please](https://github.com/googleapis/release-please) automates
releases by maintaining a "release PR" that accumulates conventional-commit
changes into a changelog and version bump. Merging that PR tags the release and
creates the GitHub release. It's a peer to [semantic-release](./semantic-release.md)
and [Changesets](./changesets.md).

**Pick one** release tool per repo. The `doctor` check flags repos configured
for more than one of {semantic-release, Changesets, Release Please}.

## Setup

The wizard offers Release Please for library projects:

```text
? 🚀 Automated release tool?
  📦 semantic-release (commit-message-driven)
  📝 Changesets (changeset-file-driven, monorepo-friendly)
> 🙏 Release Please (Google, release-PR-driven)
  ❌ None
```

Choosing it scaffolds three files:

```
release-please-config.json        # what to release and how
.release-please-manifest.json     # current version per package (starts at 0.0.0)
.github/workflows/release-please.yml
```

## Adding to an existing project

```bash
npx @rtorcato/repo-tooling fix release-please
```

The config is a single-package `node` release at the repo root:

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": { "release-type": "node", "changelog-path": "CHANGELOG.md" }
  }
}
```

## How it works

The scaffolded workflow runs `googleapis/release-please-action` on every push to
`main`:

```yaml
- uses: googleapis/release-please-action@v4
  with:
    token: ${{ secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN }}
    config-file: release-please-config.json
    manifest-file: .release-please-manifest.json
```

1. On each push, the action opens or updates a **release PR** containing the next
   version bump and changelog entries derived from your conventional commits.
2. When you merge that PR, the action **tags** the release and creates the GitHub
   release. Publishing to npm (if desired) is a follow-up step you add to the
   workflow.

`RELEASE_TOKEN` (falling back to `GITHUB_TOKEN`) is used so the release PR's
checks run — the same token pattern as the semantic-release setup.

## Choosing a release tool

- **Release Please** — you want an always-open, reviewable release PR and a
  changelog-first flow; popular in Google/OSS projects.
- **semantic-release** — single-package repo, disciplined conventional commits,
  release straight from CI with no intermediate PR.
- **Changesets** — monorepo with multiple publishable packages, intent captured
  in markdown at PR time.

## Doctor behaviour

- If only Release Please is configured, `doctor` reports `semantic-release` as ok
  with "using Release Please instead".
- If more than one release tool is configured, `doctor` flags drift listing which
  tools conflict — remove all but one.
