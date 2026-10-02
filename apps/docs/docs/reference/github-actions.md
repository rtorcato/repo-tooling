---
title: GitHub Actions
description: Run doctor as a GitHub Action, plus the CI workflow scaffolded by setup and the optional deploy workflows you can add with fix.
---

## Run `doctor` as a GitHub Action

This repo is itself a **composite action**, so a consumer repo can gate on the
audit without hand-writing the step:

```yaml
- uses: actions/checkout@v7
- uses: rtorcato/repo-tooling@v5.4.1
```

That fails the job when `doctor` finds drift or missing config — the same exit
code you get from the CLI.

### Inputs

| Input | Default | What it does |
|---|---|---|
| `directory` | `.` | Directory to diagnose, relative to the workspace. |
| `fail-on` | `drift` | `drift` fails on drift **or** missing; `missing` fails only on missing config; `none` annotates and never fails. |

Every finding becomes a job annotation regardless of `fail-on`, so `none` is the
report-only mode for a repo adopting the audit before it's clean:

```yaml
- uses: rtorcato/repo-tooling@v5.4.1
  with:
    directory: packages/app
    fail-on: none
```

### Outputs

| Output | What it is |
|---|---|
| `json` | The full `doctor --json` payload — feed it to a PR comment or a report. |

```yaml
- uses: rtorcato/repo-tooling@v5.4.1
  id: doctor
  with:
    fail-on: none
- run: jq '.results' <<< '${{ steps.doctor.outputs.json }}'
```

### Versioning

Pin an **exact release tag** (`@v5.4.1`), not a floating major. The action
picks the CLI version from the ref you pinned (`GITHUB_ACTION_REF`, #759):

- **A `v<semver>` tag runs that CLI version** — `@v5.4.1` runs CLI 5.4.1. The
  git ref is the only pin, and Dependabot's `github-actions` ecosystem bumps
  the tag for you.
- **A branch or SHA pin runs `latest`.** A SHA pins the action's code, not the
  CLI it runs.
- **Tags before v5.4.1 ran CLI 3.11.0 whatever the tag said.** They read the
  version from `package.json`, which is never bumped in git. Upgrade the pin to
  v5.4.1 or later.

The action runs `doctor --offline`, so checks that read live GitHub state are
skipped and never fail the step.

### Notes

- The action runs `actions/setup-node` internally to guarantee Node 22, since
  the CLI requires it. That also sets Node for later steps in the same job — put
  the audit in its own job if that matters.
- It's a composite action, not a Docker one: `doctor` is a read-only file audit
  already published as an npm CLI, so a container would only add an image to
  build, publish and pull.
- `doctor` never executes the audited project's code — it reads config files.

## Scaffolded workflows

Every scaffold gets a `ci.yml` (lint / typecheck / test / build) out of the box,
and a library that publishes with semantic-release also gets a `release.yml`.
The release runs only on `workflow_dispatch` or when a milestone is closed, never
on a plain push to `main`. One approval then ships a whole batch of merges
(#740). Since #753 it is its own workflow:

- **A newer request supersedes a waiting one** (`concurrency: release`,
  `cancel-in-progress: true`). A run still waiting for approval has published
  nothing, so cancelling it is safe — and CI on `main` can now cancel freely too.
- **It releases the branch's tip.** The job checks out the branch when it
  starts, i.e. after approval, not the commit that triggered it. A dispatch
  releases the branch it was dispatched from, so dispatch from the prerelease
  branch (e.g. `gh workflow run release.yml --ref beta`) to cut a prerelease. A
  closed milestone releases the default branch.
- **It does not re-run CI.** install → build → test, then semantic-release.
- **To stop a release, reject it** at the environment approval. Don't cancel
  it: a cancel after approval can land after `semantic-release` has published,
  and then the release has happened anyway.

`doctor` reports a release job still inside `ci.yml`, a `release.yml` without
superseding concurrency, or one that fires on push. `fix github-actions` migrates
the old layout, carrying the release job's `environment:` into `release.yml`.
Re-point the npm trusted publisher's workflow filename to `release.yml` when you
migrate, or OIDC publishing fails. Beyond that, repo-tooling ships **optional deploy
workflows** you add on demand — they're too deploy-target-specific to scaffold
by default, so the setup wizard never prompts for them.

### Moving an existing repo to `release.yml`

A repo scaffolded before #753 still releases from a job inside `ci.yml`. Move
it over in this order:

1. **Bump `@rtorcato/repo-tooling`** to a release that contains #763 (v5.4.2 or
   later).
2. **Run `npx @rtorcato/repo-tooling fix github-actions --yes`**
   ([`fix github-actions`](../guides/cli.md#available-targets)). It moves only
   the release job out of `ci.yml` and keeps every other job, trigger and
   comment. It drops a `needs:` the move empties, and keeps the job's
   `environment:`. Review the diff before you commit it. If the release job
   has steps the generated `release.yml` doesn't (a docs redeploy, a failure
   notification), it refuses with `release-job-custom-steps` and writes
   nothing; move those steps into `release.yml` by hand.
3. **Re-point the npm trusted publisher.** On npmjs.com → package → Settings →
   Trusted Publisher, set the workflow to `release.yml` and the environment to
   `release`. Do this in the same sitting as merging step 2. Releases only run
   when dispatched, so there's no window as long as you don't release in
   between.
4. **Move release secrets to the environment.** Secrets such as
   `RELEASE_TOKEN` go from repo secrets to `release` environment secrets.
   `doctor`'s `Release secrets` check
   ([#754](https://github.com/rtorcato/repo-tooling/issues/754)) flags any left
   at repo level.
5. **Dispatch the first release** with `gh workflow run release.yml --ref main`
   and approve it. After one successful OIDC publish, you can optionally set
   npm's Publishing access to "disallow bypass 2fa tokens".

### Why `ci.yml` is generated, not a reusable workflow

The alternative was for consumers to call one shared workflow instead of owning
a file:

```yaml
jobs:
  ci:
    uses: rtorcato/repo-tooling/.github/workflows/ci.yml@main
```

One source of truth, upgrades landing automatically. It was rejected:

- **It only works on GitHub.** repo-tooling also generates GitLab CI, which has
  no equivalent — so those repos would need the generated file regardless, and
  the family would run two different models.
- **The consumer stops owning its CI.** Adding a job, a matrix entry or a deploy
  step means either abandoning the shared workflow or growing an input for every
  knob anyone might want.
- **It pins every consumer to a ref of this repo.** `@main` runs whatever lands
  here on their runners; the generated file has no such surface.

The one thing it was meant to solve — a generated `ci.yml` drifting from the
preset with nobody noticing — is now covered by the audit instead. `doctor`
compares the workflow's action pins against the preset and reports the
disagreement, `fix github-actions --diff` shows the delta before anything is
overwritten, and the composite action above turns that into a CI gate. Drift is
visible and reconcilable, which was the only real gap in owning the file.

## Optional deploy workflows

Add any of these to an existing repo with `fix`:

```bash
npx @rtorcato/repo-tooling fix docker-publish
npx @rtorcato/repo-tooling fix vercel-deploy
npx @rtorcato/repo-tooling fix cloudflare-pages
npx @rtorcato/repo-tooling fix preview-deployments
```

Each is **safe-add** — it writes `.github/workflows/<name>.yml` only if that
file doesn't already exist, so it never clobbers a workflow you've customized.

| Target | Workflow | Trigger | Secrets |
|---|---|---|---|
| `docker-publish` | Build + push a Docker image to GHCR | tag push (`v*`) | none (uses `GITHUB_TOKEN`) |
| `vercel-deploy` | Production deploy to Vercel | push to `main` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |
| `cloudflare-pages` | Deploy a static build to Cloudflare Pages | push to `main` | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` |
| `preview-deployments` | Per-PR preview deploy + URL comment | `pull_request` | `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID` |

Each workflow ships with least-privilege `permissions:` and references its
secrets via `${{ secrets.* }}` — add them under **Settings → Secrets and
variables → Actions** in your repo. A couple carry a placeholder to fill in
(the Cloudflare Pages `--project-name`, for example).
