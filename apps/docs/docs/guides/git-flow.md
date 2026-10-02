---
title: Git Flow & Branch Protection
description: The branching and release workflow every @rtorcato repo follows — GitHub Flow, a protected main, required checks, and how semantic-release fits in.
---

This is the agreed branching and release workflow for all `@rtorcato/*` repos.

The model is **GitHub Flow**, not Git Flow: there is **one long-lived branch,
`main`**, and it is always releasable. Every change lands through a short-lived
branch and a reviewed pull request. `main` is protected so nothing reaches it
except a green, reviewed PR — and the release bot.

## The flow

1. Branch off `main` with a prefix: `feat/`, `fix/`, `docs/`, `chore/`, or
   `refactor/` (see `CONTRIBUTING.md`).
2. Open a PR into `main`. CI runs lint, typecheck, build, and tests.
3. Get it green, then **squash-merge**. One conventional commit per change keeps
   history linear and lets `semantic-release` compute the next version.
4. Merging does **not** release. When a batch is ready, close its milestone (or
   run `gh workflow run release.yml` for a hotfix). After the `release`
   environment's approval, `semantic-release` bumps the version, updates
   `CHANGELOG.md`, tags, publishes to npm, and creates the GitHub release for
   everything merged since the last tag.

That's the whole loop. `main` is the trunk and the release branch at once.

## Why there is no `dev` branch

A long-lived `dev`/`develop` branch is deliberately **not** used:

- `semantic-release` treats `main` as the release trunk — it analyzes commits on
  `main` and releases from it. A `dev → main` gate adds a second integration
  step and recurring merge conflicts (notably on `pnpm-lock.yaml`) with **no
  safety gain**. Safety comes from branch protection, not from an extra branch.
- Prereleases don't need a permanent branch. `release.config.mjs` already maps
  `next`, `beta`, and `alpha` (and `dev`) to **prerelease** channels. When you
  actually need to stage an unreleased line, create one of those branches on
  demand; it produces `-beta`/`-alpha` tags and is deleted when the line ships.

The risk of "everything goes to `main`" is real, but the fix is **protecting
`main`**, below — not maintaining a parallel branch.

## Branch protection on `main`

`main` requires a pull request and passing checks; direct pushes, force-pushes,
and deletion are blocked.

| Setting | Value |
| --- | --- |
| Require a pull request before merging | ✅ |
| Required approving reviews | `0` for solo maintenance (the gate is "no direct human pushes"); raise it once there are other maintainers |
| Require status checks to pass | ✅ — see contexts below |
| Require linear history | ✅ (matches squash-merge) |
| Allow force pushes | ❌ |
| Allow deletions | ❌ |

### Merge method: squash, and only squash

`fix github-settings` turns `allow_merge_commit` and `allow_rebase_merge` **off**
as well as turning squash on, so the merge button offers one option. Leaving the
other two enabled means the rule lives only in this document, and one mis-click
puts every intermediate branch commit on `main`:

- **semantic-release reads them all.** Squash yields one commit per PR whose
  subject is the reviewed PR title. A merge commit lands subjects nobody
  reviewed — a stray `fix:` inside a docs-only PR cuts a release.
- **Agent worktrees leak.** repo-ai's `ai-issue-loop` ([optional](./ai-issue-loop.md)) confirms work landed by finding the
  `(#N)` squash subject on `main`; without it, cleanup silently finds nothing.

### Required status checks

The required contexts are exactly the jobs that run on **`pull_request → main`**:

- `lint`
- `typecheck`
- `build`
- `test (node 22)`
- `test (node 24)`

> **`commitlint` is intentionally not a required check.** It runs only on `push`
> events (`github.event_name == 'push'`), so it never reports a status on a PR.
> Marking it required would leave every PR waiting forever on a check that never
> arrives. Commit-message linting is still enforced — locally by the Husky
> `commit-msg` hook and on `main` by the push-triggered `commitlint` job.

## The semantic-release exception

After a PR merges, the `release` job runs on `main` and pushes a
`chore(release): … [skip ci]` commit **and a tag directly to `main`** — it does
not open a PR for the version bump. Because that commit carries `[skip ci]`, no
status checks run on it, so required-status-checks would otherwise **block** the
release push.

Branch protection must therefore let the release identity bypass the rules.
Use a repo **ruleset** for `main` mirroring the settings above and add the
release identity to its **bypass list**. (Alternatively, run the `release` job
under an admin's PAT / GitHub App token and leave "include administrators" off,
so that identity bypasses.) This bypass is for the release bot only — humans
always go through a PR.

## Milestones

A milestone is the **release unit**: the one open milestone is what ships next.
`feat` and `fix` issues belong in it; refactors, CI, dependency bumps and docs
ship with whatever release comes next and need no milestone. Milestones stay
optional — a repo with none is reported as `optional-missing`, never a failure.

`doctor` audits this as the `Milestones` check:

| Finding | Status | Why it matters |
| --- | --- | --- |
| 100% complete but still open | drift | "Open" stops meaning "in flight", so the milestone list carries no signal |
| No issues at all (when more than one is open) | drift | GitHub renders the bar as `closed / total`, so an empty milestone is a permanent 0%. The sole open milestone is exempt: it is the rolling one, waiting for work |
| No open milestone | optional-missing | Nothing marks what ships next |
| Titled `backlog` / `post-N` / `someday` | note | No completion criterion means it can never close — that is a label |
| Open `feat`/`fix` issues with no milestone | warning | They will ship without being planned into a release |
| Open milestone past its due date | warning | The plan and the calendar disagree |
| Closed milestone with open issues | warning | Work was left behind when the release was cut |
| More than one open milestone without a due date | warning | Which one ships next is unclear |

Warnings ride in the check's detail and never fail the run.

`fix milestones` closes 100%-complete milestones, then, if none is left open,
opens a rolling `next` milestone — so closing a release rolls the window
forward. It never deletes a milestone. If a closed milestone already holds the
title `next`, rename it to the version it shipped as and re-run. A bulk `fix`
skips the `optional-missing` case; name the target to opt in.

## Single source of truth

- This standard, `CONTRIBUTING.md` (branch prefixes, the ≤67-char PR-title
  rule), and `reference/semantic-release.md` (what the release job does) together
  describe the full workflow.
- Issue-triggered automation has its own gating — see
  [Public-Repo Issue Safety](./public-repo-issue-safety.md).

## Rollout

1. Apply the branch-protection ruleset on `main` (settings above) with the
   release identity in the bypass list.
2. Verify: a red PR can't merge; a green PR squash-merges; a direct
   `git push origin main` is rejected; the next merge still releases.
3. Roll the same ruleset out to other public `@rtorcato` repos.
