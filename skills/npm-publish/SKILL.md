---
name: npm-publish
description: Use before releasing or publishing any package in a repo set up by @rtorcato/repo-tooling. Triggers on "publish", "cut a release", "bump the version", "tag a release", "npm publish", "how do releases work here". The hard rule — releases are automated by the repo's release tool (semantic-release, Changesets, or Release Please); an agent must NEVER run `npm publish`, `npm version`, or `git tag`, or hand-edit the version in package.json. NOT for the day-to-day tooling audit/fix flow — that's the repo-tooling skill.
---

# npm-publish

A repo set up by `@rtorcato/repo-tooling` releases through **automation on merge to
`main`** — one of semantic-release, Changesets, or Release Please. Versioning, the
git tag, the GitHub release, the CHANGELOG, and the npm publish all come from that
pipeline. There is no manual release step under any of them.

## The rule

**Never** run any of these — they fight the automation and corrupt the version line:

- `npm publish` / `pnpm publish`
- `npm version` (or editing `"version"` in `package.json`)
- `git tag` / pushing tags
- hand-editing `CHANGELOG.md`

This holds for all three tools. Only the "what to do instead" differs, so first
work out which tool the repo uses.

## Which release tool is this repo on?

Check the repo root, in this order — these are the same signals the CLI's
`doctor` check uses (`usesChangesets` / `checkSemanticRelease` in
`src/languages/js/checks.ts`):

| Signal | Tool |
|---|---|
| `.changeset/config.json` exists | **Changesets** |
| `release-please-config.json` exists | **Release Please** |
| `.releaserc*` / `release.config.*` exists, or a `"release"` key in `package.json` | **semantic-release** |

Or just ask the tooling: `npx @rtorcato/repo-tooling doctor --json` reports the
`semantic-release` check as ok with a detail naming the tool actually in use.

If more than one is configured that's drift, not a choice — stop and flag it.

## What to do instead, per tool

### semantic-release

The bump is derived from the commit history, so the commit type *is* the release
decision:

- `fix:` → patch
- `feat:` → minor
- `feat!:` / `BREAKING CHANGE:` → major
- `chore:` / `docs:` / `refactor:` / `test:` → **no release**

To ship a change: give it the right commit type and merge to `main`.

### Changesets

The bump is declared in a changeset file, **not** inferred from commits. A PR with
no changeset publishes nothing, silently — so this is a required step, not an
optional one:

```bash
pnpm changeset        # pick the packages + bump level, write the summary
```

That writes `.changeset/<name>.md`. Commit it with the change. On merge to `main`
the release action opens (or updates) a "Version Packages" PR; merging *that* is
what publishes. Hand-authoring `.changeset/*.md` is fine — it is the one file in
this flow you are meant to write. `CHANGELOG.md` is still generated; don't touch it.

### Release Please

Also commit-driven, same Conventional Commit → bump mapping as semantic-release.
On merge to `main` it opens a release PR that carries the version bump and the
CHANGELOG entry; merging that PR tags and publishes. Don't edit
`.release-please-manifest.json` by hand.

## What an agent should do

- To ship a change: right commit type, plus a changeset if the repo is on Changesets.
- To check the last release: `git tag --sort=-creatordate | head -1`, or the GitHub
  Releases page — don't infer it from `package.json` (under semantic-release that's
  `0.0.0-development` / a placeholder until CI stamps it).
- If a release seems stuck, inspect the release workflow run, and check for an open
  release / "Version Packages" PR waiting to be merged — do **not** publish by hand.

## Why

Manual publishes skip provenance, the CHANGELOG, and the tag/version invariant the
pipeline maintains, and a stray `npm version` commit derails the next automated bump.
One automated path per repo keeps releases reproducible and reviewable.
