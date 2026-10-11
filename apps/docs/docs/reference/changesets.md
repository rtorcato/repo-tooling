---
title: Changesets
description: Monorepo-friendly release tool. Alternative to semantic-release.
---

[Changesets](https://github.com/changesets/changesets) is a release tool that captures release intent in markdown files at PR time rather than parsing it from commit messages. It's the monorepo-friendly alternative to [semantic-release](./semantic-release.md).

**Pick one** — Changesets or semantic-release — per repo. The `doctor` check flags repos configured for both.

## Setup

The wizard offers Changesets as a peer to semantic-release for library projects:

```text
? 🚀 Automated release tool?
  📦 semantic-release (commit-message-driven)
> 📝 Changesets (changeset-file-driven, monorepo-friendly)
  ❌ None
```

If you pick Changesets, the wizard drops `.changeset/config.json` at the project root.

## Adding to an existing project

```bash
npx @rtorcato/repo-tooling copy changesets
```

Install Changesets and the GitHub Action:

```bash
pnpm add -D @changesets/cli
```

## Authoring changesets

For every change that should ship in a release, the author runs:

```bash
pnpm changeset
```

This is an interactive prompt that writes a markdown file under `.changeset/`, like:

```markdown
---
'@rtorcato/my-pkg': minor
---

Add the new sparkle widget.
```

Commit the changeset file alongside the change. The release process consumes it later.

## Releasing

```bash
pnpm changeset version   # consume changesets, bump versions, write CHANGELOG.md
pnpm changeset publish   # publish to npm
```

In CI, the [Changesets release bot](https://github.com/changesets/action) opens a "Version Packages" PR whenever changesets are pending and publishes on merge.

## Choosing between Changesets and semantic-release

**Pick Changesets** when you have:
- A monorepo with multiple publishable packages.
- A team that finds commit-message conventions hard to enforce.
- A workflow that benefits from `--snapshot` releases or `pre enter <tag>` prerelease modes.

**Pick semantic-release** when you have:
- A single-package repo.
- A team already disciplined on conventional commits.
- An existing CI built around `pnpm run release`.

Both tools share the same shape: CI consumes intent, bumps versions, writes a changelog, and publishes to npm. The difference is *where* the intent lives.

## Doctor behaviour

- If only `.changeset/config.json` exists, `doctor` reports `semantic-release` as ok with "using Changesets instead".
- If both exist, `doctor` flags drift — you have two release tools fighting for the same job. Remove one.
- "Publishes on merge" means nothing stands between a merge and npm. The [Release gate](../guides/cli.md#release-gate) check flags a `changesets/action` job with no protected `environment:`. That holds in a monorepo with a private root too, as long as a workspace package isn't private. `fix release-environment` adds the gate.
