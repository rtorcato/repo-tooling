---
title: GitHub Actions
description: Run doctor as a GitHub Action, plus the CI workflow scaffolded by setup and the optional deploy workflows you can add with fix.
---

## Run `doctor` as a GitHub Action

This repo is itself a **composite action**, so a consumer repo can gate on the
audit without hand-writing the step:

```yaml
- uses: actions/checkout@v7
- uses: rtorcato/repo-tooling@v3.2.5
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
- uses: rtorcato/repo-tooling@v3.2.5
  with:
    directory: packages/app
    fail-on: none
```

### Outputs

| Output | What it is |
|---|---|
| `json` | The full `doctor --json` payload — feed it to a PR comment or a report. |

```yaml
- uses: rtorcato/repo-tooling@v3.2.5
  id: doctor
  with:
    fail-on: none
- run: jq '.results' <<< '${{ steps.doctor.outputs.json }}'
```

### Versioning

Pin an **exact release tag** (`@v3.2.5`), not a floating major. The action runs
the npm package at the version recorded in the tag it was checked out from, so
the git ref is the only pin — there's no second channel that can drift out from
under you, and Dependabot's `github-actions` ecosystem bumps the tag for you.

### Notes

- The action runs `actions/setup-node` internally to guarantee Node 22, since
  the CLI requires it. That also sets Node for later steps in the same job — put
  the audit in its own job if that matters.
- It's a composite action, not a Docker one: `doctor` is a read-only file audit
  already published as an npm CLI, so a container would only add an image to
  build, publish and pull.
- `doctor` never executes the audited project's code — it reads config files.

## Scaffolded workflows

Every scaffold gets a `ci.yml` (lint / typecheck / test / build, and release for
libraries) out of the box. Beyond that, repo-tooling ships **optional deploy
workflows** you add on demand — they're too deploy-target-specific to scaffold
by default, so the setup wizard never prompts for them.

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
