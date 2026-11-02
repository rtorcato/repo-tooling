---
title: Releasing
description: How a change ships on a Changesets repo. Add a changeset in your PR, merge the Version Packages PR, approve the release environment.
---

On a repo that uses Changesets, a merge never publishes. A release is one deliberate step: merging the Version Packages PR, then one approval on the `release` environment.

## 1. Add a changeset in your PR

Every change that should appear in a release gets a changeset. From your branch, run:

```bash
pnpm changeset
```

Pick the packages and the bump (`patch`, `minor` or `major`) and write a one-line summary. The command writes a markdown file under `.changeset/`. Commit it with the change.

## 2. Merge the PR

Merging publishes nothing. On every push to `main`, the `version` job of `release.yml` runs without an approval. It opens or updates the **Version Packages** PR, which consumes the pending changesets, bumps versions and writes `CHANGELOG.md`.

Changes pile up in that PR until you decide to ship.

## 3. Merge the Version Packages PR

Merging the Version Packages PR is the release. Its push runs the `publish` job, which waits for one approval on the `release` environment. After approval it publishes every package whose version is not on npm yet and creates the GitHub releases.

## Retrying a failed publish, or shipping a hotfix

Dispatch the workflow to retry a failed publish:

```bash
gh workflow run release.yml
```

If changesets are still pending, a dispatch updates the Version Packages PR instead of publishing. To ship a hotfix, merge the fix with its changeset, then merge the Version Packages PR.

## Pre-releases

In pre mode (`pnpm changeset pre enter beta`), the Version Packages PR bumps to `x.y.z-beta.N`, and the publish job releases it under the `beta` tag.

## See also

- [Changesets reference](../reference/changesets.md): setup, authoring, and the doctor checks.
- [GitHub Actions: Changesets releases](../reference/github-actions.md#changesets-releases): the two-job `release.yml`.
