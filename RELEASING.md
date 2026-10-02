# Releasing

This package publishes to npm via [semantic-release](https://semantic-release.gitbook.io/) **on demand, not on every merge** (#740). The CI workflow lives in `.github/workflows/ci.yml` (`release` job).

## Release trigger

The `release` job runs only when:

- **a milestone is closed**: closing it means "ship this batch", or
- **the workflow is dispatched**: `gh workflow run ci.yml --ref main`, or the "Run workflow" button, for hotfixes and ad hoc releases.

Either one releases everything merged since the last tag, in one run. Pushes and PRs run the checks only. Merging a burst of PRs no longer queues a release run per merge, each one stale as soon as the next merge landed.

What gets released is decided by the **conventional commit** messages on `main` since the last tag:

| Commit prefix | Release type |
| --- | --- |
| `fix:` | patch (e.g. `2.0.1`) |
| `feat:` | minor (e.g. `2.1.0`) |
| `feat!:` / footer `BREAKING CHANGE:` | major (e.g. `3.0.0`) |
| `chore:`, `docs:`, `test:`, `ci:`, `refactor:`, `style:` | no release |

If no release-worthy commits exist since the last tag, semantic-release exits without publishing — that's expected, not a failure.

## The GitHub Action tag (#315)

`action.yml` at the repo root is consumed by **git ref**, not by npm, so it needs
no extra release step: consumers pin an exact release tag (`rtorcato/repo-tooling@v3.2.5`),
which semantic-release already creates on the commit that bumps `package.json`.
The action reads its own `package.json` at runtime and runs that exact npm
version, so the git tag and the CLI version can't diverge.

**No floating `v3` tag is maintained**, deliberately. A moving major is a second
release channel to operate — every `action.yml` change becomes a breaking-change
judgement on a tag consumers can't pin below — for a benefit Dependabot's
`github-actions` ecosystem already delivers by bumping exact tags. Revisit only
if consumers ask for it; adding a floating tag later is backwards-compatible,
removing one is not.

## Before an API-changing release

semantic-release owns the version, tag, CHANGELOG, and npm publish — **never bump
or tag by hand.** But the automation can't write the human-facing docs, so any PR
that adds or changes a public surface (a CLI command/flag, a preset, a config
field, or the JSON output contract) must also carry these in the **same PR**:

- [ ] **Docs site** — update `apps/docs/docs/` for the new/changed command, flag, preset, or field.
- [ ] **README** — update the command table / examples / options if the public surface changed.
- [ ] **AGENTS.md + `skills/*/SKILL.md`** — keep the agent guidance in sync when the CLI contract changes (agents read these; they must not drift from reality).
- [ ] **GitHub issue/milestone** — close the issue the change resolves and, if it completes a themed goal, the matching [milestone](https://github.com/rtorcato/repo-tooling/milestones). (Direction is tracked on GitHub, not in a roadmap file.)

Version bumps are automated; this checklist is only for the API- and doc-facing
work that isn't.

## Required secrets

Configured at **Settings → Secrets and variables → Actions**.

| Secret | Purpose | How to rotate |
| --- | --- | --- |
| `NPM_TOKEN` | npm authentication for `npm publish` | See "Rotating NPM_TOKEN" below |
| `GITHUB_TOKEN` | Tagging, GitHub Releases, PR comments | Auto-provided by Actions; no action needed |

### Release secrets belong on the `release` environment

Store any secret the publishing job reads (an admin PAT such as
`RELEASE_TOKEN`, an `NPM_TOKEN`) as an **environment secret** on `release`
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

The `release` job also requests `id-token: write` so OIDC can be used if the package is configured as a Trusted Publisher (see below) — otherwise it falls back to `NPM_TOKEN`.

## Rotating NPM_TOKEN

The token is an npm **Automation** token scoped to the `@rtorcato` namespace.

1. Go to https://www.npmjs.com/settings/rtorcato/tokens.
2. Click **Generate New Token → Automation**.
3. Scope: limit to packages matching `@rtorcato/*` if available; otherwise full publish access.
4. Copy the token (`npm_...`).
5. In GitHub, edit `Settings → Secrets and variables → Actions → NPM_TOKEN` and paste the new value.
6. Revoke the previous token from the npmjs.com tokens page.
7. Re-run the most recent failed `release` job (Actions → failed run → **Re-run all jobs**) to verify.

A 401 `EINVALIDNPMTOKEN` in the `release` job means the token is invalid, expired, or revoked.

## Trusted Publisher (OIDC) — recommended

OIDC eliminates the long-lived `NPM_TOKEN`. To set it up:

1. On npmjs.com, open the package page for `@rtorcato/repo-tooling` → **Settings → Trusted Publishers**.
2. Add a publisher with:
   - Provider: **GitHub Actions**
   - Repository: `rtorcato/repo-tooling`
   - Workflow filename: `ci.yml`
   - Environment: *(leave blank unless one is configured)*
3. The `release` job already has `permissions: id-token: write`, which is all OIDC requires from CI.
4. Once configured, remove `NPM_TOKEN` from the workflow env and delete the secret from GitHub.

The current `release` job tries OIDC first and falls back to `NPM_TOKEN` if no trusted publisher is registered — a `404 package not found` during OIDC token exchange means the trusted publisher hasn't been registered yet, and the workflow then uses `NPM_TOKEN`.

Docs: https://docs.npmjs.com/trusted-publishers.

## Re-running a failed release

If the `release` job failed but the underlying commits still warrant a release (e.g. a `feat:` or `fix:` is still in the log since the last tag):

1. Fix the root cause (rotate the token, add the trusted publisher, etc.).
2. Actions → failed workflow run → **Re-run all jobs**.

A re-run is safe: semantic-release is idempotent — it checks tags before publishing and will skip if the version already exists on npm.

## Local dry-run

To preview what semantic-release will do without publishing:

```bash
pnpm exec semantic-release --dry-run --no-ci
```

Requires `GITHUB_TOKEN` and `NPM_TOKEN` in the environment if you want full simulation, but the dry-run mode will still report the next version based on commits without them.
