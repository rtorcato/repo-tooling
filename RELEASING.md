# Releasing

This package releases with [Changesets](https://github.com/changesets/changesets)
(#940; it used semantic-release until 6.1.1). A merge to `main` never publishes.
Shipping is one Version Packages PR merge plus one `release` approval.

Asking an agent "how do I release" or "cut a release"? The `npm-publish` skill
(`skills/npm-publish/SKILL.md`) covers this flow.

## How a release happens

1. **Every PR that changes the published package adds a changeset**:
   `pnpm changeset`, pick patch/minor/major, and commit the file under
   `.changeset/`. Docs-, CI- and test-only PRs need none. Never edit `version`
   in `package.json` or tag by hand.
2. **Merging to `main` publishes nothing.** Each push runs the ungated `version`
   job in `.github/workflows/release.yml`, which opens or updates the
   **Version Packages** PR (`chore(release): version packages`). That PR
   consumes the pending changesets, bumps `package.json` and writes
   `CHANGELOG.md`.
3. **Merging the Version Packages PR is the release.** Its push finds no
   pending changesets and a version not on npm yet, so the `publish` job runs.
   That job waits for one approval on the `release` environment, then builds,
   tests, publishes to npm with `changeset publish`, pushes the `vX.Y.Z` tag and
   creates the GitHub Release. It then dispatches `docs.yml`, so the docs
   changelog page (built from GitHub Releases) picks the release up.

Any other push skips `publish`, so an ordinary merge never queues an approval.
`publish` checks out the commit that triggered the run, not `main`'s tip, so a
changeset merged while it waits for approval cannot turn it back into a Version
Packages PR update. Publishes queue behind each other rather than cancel
(#790).

**Re-running a failed publish:** fix the cause, then re-run the failed job, or
dispatch the workflow (`gh workflow run release.yml`). A dispatch publishes any
version not yet on npm; with changesets pending it updates the Version Packages
PR instead.

## The GitHub Action tag (#315)

`action.yml` at the repo root is consumed by **git ref**, not by npm, so it needs
no extra release step: consumers pin an exact release tag (`rtorcato/repo-tooling@v6.1.1`),
which `changeset publish` creates on the Version Packages merge commit. The
action resolves the CLI version from that pinned ref, so the git tag and the
CLI version can't diverge.

**No floating `v6` tag is maintained**, deliberately. A moving major is a second
release channel to operate — every `action.yml` change becomes a breaking-change
judgement on a tag consumers can't pin below — for a benefit Dependabot's
`github-actions` ecosystem already delivers by bumping exact tags. Revisit only
if consumers ask for it; adding a floating tag later is backwards-compatible,
removing one is not.

## Before an API-changing release

Changesets owns the version, tag, CHANGELOG, and npm publish — **never bump or
tag by hand.** But it can't write the human-facing docs, so any PR that adds or
changes a public surface (a CLI command/flag, a preset, a config field, or the
JSON output contract) must also carry these in the **same PR**:

- [ ] **Changeset** — `pnpm changeset`, with the bump that matches the change.
- [ ] **Docs site** — update `apps/docs/docs/` for the new/changed command, flag, preset, or field.
- [ ] **README** — update the command table / examples / options if the public surface changed.
- [ ] **AGENTS.md + `skills/*/SKILL.md`** — keep the agent guidance in sync when the CLI contract changes (agents read these; they must not drift from reality).

## Secrets and tokens

npm publishing uses **OIDC trusted publishing**; there is no `NPM_TOKEN`. The
`publish` job requests `id-token: write`, and npm's trusted publisher for
`@rtorcato/repo-tooling` is bound to the workflow file `release.yml` **and** the
environment `release`. Rename either and the publish fails with `E404`, so keep
both names. OIDC needs npm >= 11.5.1, which the job installs.

`RELEASE_TOKEN` (optional admin PAT) lets the `version` job push the Version
Packages branch so its PR runs CI; a PR opened with `GITHUB_TOKEN` starts no
workflows. The `version` job has no environment, so it sees `RELEASE_TOKEN`
only as a repository secret; stored on `release` as below, only `publish`
gets it. Without it the job falls back to `GITHUB_TOKEN`, which needs
"Allow GitHub Actions to create and approve pull requests" on (Settings →
Actions → General; `doctor` checks it for Changesets repos, #946).

### Release secrets belong on the `release` environment

Store any secret the publishing job reads (an admin PAT such as
`RELEASE_TOKEN`) as an **environment secret** on `release`
(Settings → Environments → release → Environment secrets), not as a repository
secret. Every job in every workflow can read a repository secret, which gets
around the `release` environment's required reviewer, the only step in a release
that needs a person. `doctor`'s **Release secrets** check reports a publishing-job
secret that is set at repo level and not on `release` as `drift`. Listing
secrets needs admin, so without admin the check reports `optional-missing` and
leaves the exit code alone. It has no fixer because secret values can't be read
back. Re-enter the value on the environment
(`gh secret set NAME --env release`), then delete the repo secret
(`gh secret delete NAME`).

Docs: https://docs.npmjs.com/trusted-publishers.

## Local preview

To see what the next Version Packages PR would bump, without changing anything:

```bash
pnpm changeset status --verbose
```
