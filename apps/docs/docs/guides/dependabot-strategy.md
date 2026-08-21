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
| `dev-minor` | `devDependencies` | minor, patch | ✅ on green, if nothing in it ships |
| `major-updates` | all packages | major | ❌ manual |
| `github-actions` | workflow actions | minor, patch | ✅ on green |
| `github-actions` | workflow actions | major | ❌ manual |

## 2. Auto-merge — dev dependencies and CI actions

Patch and minor updates **of `devDependencies`** and **of GitHub Actions** merge
themselves once CI is green — no human in the loop. Implemented by
`.github/workflows/dependabot-automerge.yml` using `dependabot/fetch-metadata` +
`gh pr merge --auto --squash`, gated on the consumer-facing check below, **either**
`dependency-group == 'dev-minor'` **or** `package-ecosystem == 'github-actions'`,
**and** `version-update:semver-patch` / `version-update:semver-minor`.

Everything else waits for a human, and the gate **fails closed**: an npm PR
outside a group reports an empty `dependency-group` and so never matches.

> **The group name is not the gate.** `dependency-type: development` is
> Dependabot's classification, and it files a package listed in *both*
> `devDependencies` and `peerDependencies` as development — so it lands in
> `dev-minor` while still being part of what a published package hands its
> consumers. This repo has 32 such packages; 13 of them once rode a single
> "dev-only" group PR. The workflow therefore resolves every bumped name against
> the tracked manifests (`dependencies` + `optionalDependencies` +
> `peerDependencies` of every non-private `package.json`) and stands down if any
> of them ships. A PR reporting no dependency names at all is also refused —
> nothing verified means nothing waved through.
>
> This step is npm-specific. A repo with no `package.json` finds nothing and
> falls back to the group + semver gate alone.

> **Production bumps are deliberately excluded.** A minor bump to a runtime
> dependency of a published package ships to every consumer on the next release.
> Auto-merging those on green CI alone means the 7-day `cooldown` is the only
> thing between a compromised upstream release and `main`.
>
> The gate names the group that `dependabot.yml` declares, so the two files are
> a paired unit: rename a group in one and auto-merge silently stops (which is
> the safe direction, but still drift — `doctor` flags it).

> **CI actions auto-merge; the counter-argument is real** (#452). Action bumps
> are ungrouped, so they are matched on `package-ecosystem` rather than a group
> name. They reach no consumer of the published package, and the scaffolded
> `commit-message.prefix: ci` means the squash subject is `ci(deps): …`, which
> cuts no release under semantic-release.
>
> Against that: a compromised action runs *in CI holding `GITHUB_TOKEN`*, which
> is arguably a sharper surface than a dev dependency, not a softer one. The
> mitigations relied on instead are the majors exclusion (an
> `actions/checkout@v7 → v8` still waits for a human) and required status checks.
> Note that `cooldown` is declared per `updates:` entry and the canonical
> `github-actions` entry does not declare one, so it does **not** delay an action
> bump the way it delays an npm bump.
>
> The alternative — leaving them to a human — was weighed and rejected: routine
> `actions/checkout` bumps waiting on a human across every scaffolded repo is the
> friction that ends in rubber-stamping, which weakens the gate for everything
> else too.

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

**Semver precedent** (#452): narrowing what auto-merges goes out as `fix` — the
old behaviour was the bug, so removing it is a fix rather than a feature removal.
That is how #447 shipped and how the next security narrowing should ship.

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
