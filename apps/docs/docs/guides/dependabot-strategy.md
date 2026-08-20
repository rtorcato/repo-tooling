---
title: Dependabot Strategy
description: The standard Dependabot setup every @rtorcato repo follows — grouping, auto-merge, major-bump triage, and staleness policy.
---

This is the agreed dependency-update standard for all `@rtorcato/*` repos.
repo-tooling ships the canonical `dependabot.yml` and auto-merge workflow and
scaffolds both into new projects, so every repo converges by re-running
`repo-tooling fix`.

The goal: **safe updates land untouched, risky ones are batched and triaged on
a fixed cadence, and the backlog can never go stale.**

## Why this exists

Before this standard, ungrouped major bumps accumulated for weeks until they
went stale and conflicted on `pnpm-lock.yaml`, while auto-merge silently never
fired (it needs branch protection — see the branch-protection requirement
below). The result was a pile of un-mergeable PRs. This strategy removes both
failure modes.

## 1. Grouping — few PRs, not dozens

Dependabot opens roughly **3–4 PRs per cycle** instead of one per package:

| Group | Contents | Update types | Auto-merge |
| --- | --- | --- | --- |
| `production-minor` | runtime `dependencies` | minor, patch | ❌ manual |
| `dev-minor` | `devDependencies` | minor, patch | ✅ on green |
| `major-updates` | all packages | major | ❌ manual |
| `github-actions` | workflow actions | all | ❌ manual |

## 2. Auto-merge — dev dependencies only

Patch and minor updates **of `devDependencies`** merge themselves once CI is
green — no human in the loop. Implemented by
`.github/workflows/dependabot-automerge.yml` using `dependabot/fetch-metadata` +
`gh pr merge --auto --squash`, gated on **both** `dependency-group == 'dev-minor'`
and `version-update:semver-patch` / `version-update:semver-minor`.

Everything else waits for a human, and the gate **fails closed**: a PR outside a
group reports an empty `dependency-group` and so never matches.

> **Production bumps are deliberately excluded.** A minor bump to a runtime
> dependency of a published package ships to every consumer on the next release.
> Auto-merging those on green CI alone means the 7-day `cooldown` is the only
> thing between a compromised upstream release and `main`. GitHub Actions bumps
> are excluded for the same reason — a compromised action runs in CI holding
> `GITHUB_TOKEN`.
>
> The gate names the group that `dependabot.yml` declares, so the two files are
> a paired unit: rename a group in one and auto-merge silently stops (which is
> the safe direction, but still drift — `doctor` flags it).

> **Requires branch protection.** `gh pr merge --auto` only gates correctly when
> the repo has auto-merge enabled and `main` has required status checks
> (`lint`, `typecheck`, `build`, `test`). Without it, auto-merge never fires and
> safe updates pile up. This is a hard prerequisite of the strategy.
>
> **Needs a public repo or a paid plan.** Both auto-merge (`allow_auto_merge`)
> and classic branch protection are unavailable on **private repos on the free
> tier** — GitHub returns 403 for branch protection and silently ignores
> `allow_auto_merge`. On such repos `repo-tooling fix github-settings` applies what
> it can (squash-only merging, delete-branch-on-merge, workflow permissions) but leaves
> auto-merge and protection off, so `doctor` keeps reporting them as drift. Make
> the repo public or upgrade the plan to converge fully.

## 3. Major bumps — batched, triaged, never auto-merged

All majors arrive as a **single `major-updates` PR per ecosystem**, labeled
`major-update`, reviewed on the monthly cadence:

1. Rebase the PR, let CI run.
2. Merge what's green.
3. If one package in the batch breaks the build, exclude it (temporary `ignore`
   entry for that version) so the rest of the batch can land; revisit when the
   upstream issue is resolved.

Majors are never auto-merged — a major is a breaking change by definition and
deserves a human read.

## 4. Staleness policy

**Any Dependabot PR that is conflicting or red at the next cycle gets closed.**
Dependabot recreates it fresh and rebased against current `main`, with current
CI. Closing stale PRs is the normal, expected hygiene step — not a loss of work.

## 5. Cadence & ceiling

- **Monthly** version updates (batched → low noise). Security updates remain
  always-on and are not subject to the monthly schedule.
- `open-pull-requests-limit: 5` — grouping makes this ample and caps the backlog.
- `cooldown: { default-days: 7 }` so brand-new releases settle before a PR
  opens. This is required, not optional, on repos that enforce pnpm's
  `minimumReleaseAge` supply-chain policy: without it Dependabot bumps a
  same-day release into the lockfile and the frozen-lockfile install fails CI
  (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`), so the PR can never go green.

## 6. Single source of truth

- repo-tooling ships the canonical `.github/dependabot.yml` **and**
  `.github/workflows/dependabot-automerge.yml`, and its generator scaffolds
  **both** into new projects.
- `repo-tooling doctor` flags drift from the canonical config; `repo-tooling fix`
  re-applies it. A strategy change propagates to every repo via `fix`.

## 7. Repo-local `ignore:` rules

`fix dependabot` writes the file wholesale, and the canonical config has no
`ignore:` block — so a hand-added ignore rule (a dependency held back on purpose,
usually with the reason in a comment above it) would be deleted by the next `fix`
with nothing left to report the loss.

It isn't. `fix dependabot` **refuses** when the existing config carries `ignore:`
rules, naming each one, and `doctor` reports them in the Dependabot detail line so
they're visible beforehand. Deliberate ignore rules are not drift: the check still
reads `ok`.

To proceed anyway, deal with the block by hand — copy it back into the regenerated
file, or delete it to accept the loss — then re-run `fix dependabot`.

## Canonical `dependabot.yml`

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: monthly
      time: "06:00"
      timezone: Etc/UTC
    cooldown:
      default-days: 7
    open-pull-requests-limit: 5
    versioning-strategy: increase
    commit-message:
      prefix: chore
      include: scope
    groups:
      production-minor:
        dependency-type: production
        update-types:
          - minor
          - patch
      dev-minor:
        dependency-type: development
        update-types:
          - minor
          - patch
      major-updates:
        update-types:
          - major

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: monthly
    commit-message:
      prefix: ci
      include: scope
```

## Rollout

1. Apply branch protection on `main` (prerequisite for auto-merge).
2. Update repo-tooling's own `dependabot.yml` + `dependabot-automerge.yml` to the
   above.
3. Update the generator and add a `doctor` / `fix dependabot` target.
4. Roll out to other repos via `repo-tooling fix`.
