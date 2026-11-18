---
title: Releasing
description: How a change ships on a Changesets repo. Add a changeset in your PR, merge the Version Packages PR, approve the release deployment.
---

On a repo that uses Changesets, a merge never publishes. A release is two steps: merge the Version Packages PR, then approve the `release` deployment. Only the approval needs a person.

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

Merging the Version Packages PR is the release. Its CI runs on its own when the repo has release credentials (see below), so anyone with write access can merge it once it is green, an agent included.

## 4. Approve the release deployment

The merge's push runs the `publish` job, which waits for one approval on the `release` environment. After approval it publishes every package whose version is not on npm yet and creates the GitHub releases.

Keep the `release` environment's required reviewers to humans only, never the account your agents run as. Then an agent can merge the Version Packages PR but cannot publish it.

## Release credentials

A PR opened with `GITHUB_TOKEN` starts no workflows, so without credentials the Version Packages PR waits on **Approve and run workflows**. `release.yml` opens it with the first of these that is set:

1. A GitHub App token, from the `RELEASE_APP_ID` and `RELEASE_APP_PRIVATE_KEY` secrets. One App installed on all of your repos covers every one. It needs **Contents** and **Pull requests** read and write.
2. `RELEASE_TOKEN`, a fine-grained PAT.
3. `GITHUB_TOKEN`, with a `No release credentials` warning on the run.

Set the App secrets at organization level, or per repo:

```bash
gh secret set RELEASE_APP_ID
gh secret set RELEASE_APP_PRIVATE_KEY < key.pem
```

`doctor` flags a Changesets repo with neither the App secrets nor `RELEASE_TOKEN`.

## Retrying a failed publish, or shipping a hotfix

Dispatch the workflow to retry a failed publish:

```bash
gh workflow run release.yml
```

If changesets are still pending, a dispatch updates the Version Packages PR instead of publishing. To ship a hotfix, merge the fix with its changeset, then merge the Version Packages PR.

## Repos with no npm package (Swift)

The procedure is the same: add a changeset, merge the Version Packages PR, approve the `release` environment. Nothing else releases. A hand-pushed tag, a merge, a closed milestone and a bare dispatch do not.

A repo that publishes no package uses Changesets for versioning only. `setup --preset swift-library` scaffolds a private root `package.json` that carries the version and has no entry points, a `.changeset/config.json` with `privatePackages: { version: true, tag: true }`, and `version-packages.yml`. Merging the Version Packages PR bumps the version and creates the `vX.Y.Z` tag. The tag runs `release.yml`, whose releasing job sits in the `release` environment.

Commit the `package-lock.json` the scaffold writes: `version-packages.yml` installs with `npm ci`, so the dependency tree that runs beside the write token is the reviewed one. If npm was unreachable when you scaffolded, run `npm install --package-lock-only --ignore-scripts` and commit the result. Pushing the mirror `vX.Y.Z` tag that `fix swift-release` creates for an unprefixed tag starts a release run for a version that already shipped; reject it at the `release` approval.

A tag pushed with `GITHUB_TOKEN` starts no workflow, so set a `RELEASE_TOKEN` secret (a PAT or GitHub App token). Without it the Version Packages PR gets no CI and the tag runs no release. The first step of `version-packages.yml` warns when it is unset.

To convert a repo that releases from a hand-pushed tag, run `fix swift-release`. It writes the files above and seeds `version` from your latest semver tag. `doctor` reports the repo as drifted until then.

## Pre-releases

In pre mode (`pnpm changeset pre enter beta`), the Version Packages PR bumps to `x.y.z-beta.N`, and the publish job releases it under the `beta` tag.

## See also

- [Changesets reference](../reference/changesets.md): setup, authoring, and the doctor checks.
- [GitHub Actions: Changesets releases](../reference/github-actions.md#changesets-releases): the two-job `release.yml`.
