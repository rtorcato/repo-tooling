# ADR 0001: Reference model instead of copy-and-audit for generated files

- **Status:** Proposed
- **Date:** 2026-11-17
- **Issue:** [#1018](https://github.com/rtorcato/repo-tooling/issues/1018)
- **Research:** [Findings and plan](https://github.com/rtorcato/repo-tooling/issues/1018#issuecomment-6965482620) (read on `origin/main` at `fa901ca` and the consumers' default branches on 2026-11-17)
- **Related:** [#1000](https://github.com/rtorcato/repo-tooling/issues/1000) (`extends`), [#1001](https://github.com/rtorcato/repo-tooling/issues/1001) (reusable workflows), [#1003](https://github.com/rtorcato/repo-tooling/issues/1003) (umbrella), [#1011](https://github.com/rtorcato/repo-tooling/issues/1011) (settings drift)

## Context

repo-tooling generates files into each consumer repo and then audits them for drift. The generated set includes `ci.yml`, `release.yml`, `dependabot.yml`, community health files and `.editorconfig`.

This is copy-and-audit. It has two costs:

- **Every template change creates drift in every consumer.** Each one then needs a `fix` run per repo ([#1011](https://github.com/rtorcato/repo-tooling/issues/1011)).
- **A large share of recent work repairs the tool's own output** for repos it did not anticipate (the [#1003](https://github.com/rtorcato/repo-tooling/issues/1003) umbrella).

The check is less strict than "byte-for-byte". `checkGitHubActions` (`src/base/checks.ts`) compares action pin majors plus a few structural checks (gate job, changeset job, release from CI). The cost comes from `fix github-actions` regenerating whole files and from structural checks that must track every preset change.

The reference model is already half shipped:

- `docs-deploy.yml` and `docs-deploy-cloudflare.yml` are `workflow_call` reusable workflows. Ten of eleven torcato.dev consumers checked call `docs-deploy-cloudflare.yml` (shared-docs has no `docs.yml`).
- **Every one of those callers is pinned to v6.1.1**, while the package is at 6.3.1 or 6.4.0. All eleven have the `github-actions` Dependabot ecosystem.
- Since the move to Changesets, releases are tagged `@rtorcato/repo-tooling@x.y.z` instead of `vX.Y.Z`. The last `v*` tag is `v6.1.1`. Dependabot most likely cannot resolve scoped-name tags (inferred, not tested).
- `extends` shipped for `rules` in 6.3.0 (`src/cli/utils/extends.ts`). No repo uses it yet.

## Decision

Adopt a **reference model** for generated CI. Copy only what cannot be referenced.

1. **Reusable workflows for CI jobs.** `lint`, `typecheck`, `test`, `build`, `commitlint` and the changeset check become jobs in a reusable `ci.yml`. They need no secrets beyond `GITHUB_TOKEN`.
2. **A composite action for shared setup.** Checkout, pnpm, Node, install and cache move into one action. It keeps job and check names unchanged.
3. **The caller keeps its shell.** Triggers (including `merge_group`), `concurrency`, top-level `permissions` and the **`ci` gate job** stay in each repo's own `ci.yml`. Branch protection requires the check context `ci` (`protectionBody` in `src/base/github-settings.ts`). A gate moved into the callee would be reported as `ci / ci` and would block every PR.
4. **Community health files move to the public `rtorcato/.github` repo.** It already holds `CODE_OF_CONDUCT.md`, `SECURITY.md` and `FUNDING.yml`. GitHub uses them as defaults for repos with none of their own. `CONTRIBUTING.md`, `SECURITY.md` and issue templates move there, and per-repo copies are deleted.
5. **Still copied and audited:** `dependabot.yml` and `.editorconfig` (neither has an include or `extends` mechanism), plus the thin caller files.
6. **Callers pin a full commit SHA with a version comment** (`@<sha> # v7.0.0`). Dependabot updates both. This needs semver-shaped tags (step 1 below).
7. **`doctor` changes meaning.** It checks that a repo calls the reference at a version at or above the minimum supported, plus the caller-side structure. It stops comparing job bodies. `fix github-actions` rewrites the caller and refuses to inline job bodies.
8. **The callee interface is public API.** Changes to inputs, outputs or job names change check names and caller files. They require a major version of this package.
9. **Ship as the next major.** Generated output changes for every consumer.

### Order of work

1. **Tag scheme.** Push a `v<version>` tag on each release alongside the Changesets tag. Confirm Dependabot proposes `docs-deploy-cloudflare.yml` bumps on one consumer. Independent of this ADR and can ship first.
2. **This ADR.**
3. **Composite setup action**, used first by the existing reusable docs workflows. Low risk, no check-name changes.
4. **Reusable `ci.yml`** ([#1001](https://github.com/rtorcato/repo-tooling/issues/1001) part 2), gate kept in the caller. Pilot on one repo (brand-kit or db-common are suggested), then roll out.
5. **Community health** into `rtorcato/.github`. The generator and `doctor` stop writing and checking those files for repos under that owner.
6. **Reusable `release.yml` last**, after a dry-run publish on a low-risk package proves trusted publishing and the `release` environment through `workflow_call`.

## Non-goals

**Repo settings and token drift.** Most of [#1003](https://github.com/rtorcato/repo-tooling/issues/1003) is settings drift, not file drift: no-TTY skips, admin-only checks skipped, a missing `RELEASE_TOKEN`, and "Actions can create PRs" off on shared-docs and brand-kit. These live in the GitHub API, so no `uses:` reference can carry them. This ADR does not address them.

[#1011](https://github.com/rtorcato/repo-tooling/issues/1011) was closed before this was clear. Whether it is reopened is **pending**. Hound's suggestion is to reopen it as a scheduled doctor, which could itself be a reusable workflow that consumers call. That would need an admin-capable credential.

Orthogonal and also out of scope: non-JS repos (`language: "none"`, [#1003](https://github.com/rtorcato/repo-tooling/issues/1003) item C).

## Consequences

**Positive**

- Job-logic drift (new steps, action pin bumps, release-from-CI and gate findings) becomes one release here plus one low-risk ref-bump PR per consumer, which Dependabot can open once tags are semver-shaped.
- Action pins live in one place, the callee. `doctor`'s pin check then only covers caller files and consumer additions.
- Community health files stop drifting, with no versioning needed.

**Negative and risks**

- **Migration cost.** Twelve torcato.dev repos plus app repos each need a rewritten `ci.yml`, and later `release.yml`. Every PR touches `.github/**`, so each is in the risky review tier. Budget roughly 24 risky reviews across two waves.
- **Customised jobs stay in the caller as extra jobs.** Examples are js-common's `runtime-smoke` and `docs-build`, swift-common's `periphery.yml`, and codeql on six repos. The callee needs a way to include them in the gate, likely a `needs:` list built by the gate job in the caller.
- **GitHub reusable-workflow constraints.** Permissions can only be kept or reduced. Secrets pass only one hop. The `environment:` key cannot be set on the caller job (see trusted publishing below). Nesting is limited to ten levels.
- **Trusted publishing is untested.** npm validates the *calling* workflow's name, so a thin `release.yml` should keep the current trusted-publisher config, with `id-token: write` on both caller and callee. The `release` environment must move into the callee job. It remains the caller repo's environment, so its required reviewers still apply. This has not been tried on a real publish, hence it goes last.
- **`RELEASE_TOKEN` fallback.** `secrets.RELEASE_TOKEN || secrets.GITHUB_TOKEN` ([#1003](https://github.com/rtorcato/repo-tooling/issues/1003) A) should become a required secret in the callee. `required` only checks that the caller passes it, not that it has a value, so keep a runtime check too.
- **Community health only works under one owner.** The `infra-zero/*` repos would need their own `.github` repo.
- **Floating major tags** (`v7`) are optional. They give tag-pinning callers patches automatically but lose the supply-chain property of SHA pins. Do not use one for `release.yml`.

## Open questions

Both are for the repo owner and are **not answered here**.

1. **Where does the `extends` rules base live?** (The open question from [#1000](https://github.com/rtorcato/repo-tooling/issues/1000).)
2. **Can the next major drop the generator's full-file `ci.yml` output** for consumers outside the torcato.dev repos?

## Alternatives considered

- **Keep copy-and-audit (status quo).** No migration cost, but every template change keeps creating drift in every consumer, and the fix-run and repair work continues.
- **Composite actions only.** Composite actions run steps inside the caller's job. They cannot carry whole jobs (runners, matrix, services, `needs`), so job-level drift stays in each repo. They are kept for shared setup only.
- **Reusable workflow for everything, including the gate.** Moving the `ci` gate into the callee renames the required check to `ci / ci` and breaks branch protection on every repo. Rejected.
- **Floating tag or branch pin** (`@v7`, `@main`). Less churn, but loses the SHA-pin supply-chain property. Rejected for `release.yml`, optional elsewhere.
- **Reference the community health files per repo.** Not possible without copying. The `rtorcato/.github` defaults are the real reference mechanism for them.

## Sources

| Claim | Source |
|---|---|
| Reusable workflow limits: nesting, permissions, secrets, caller cannot set `environment`, SHA pin is safest | [Reusing workflows](https://docs.github.com/en/actions/sharing-automations/reusing-workflows) |
| Composite action scope | [Creating a composite action](https://docs.github.com/en/actions/sharing-automations/creating-actions/creating-a-composite-action) |
| Default community health files | [Creating a default community health file](https://docs.github.com/en/communities/setting-up-your-project-for-healthy-contributions/creating-a-default-community-health-file) |
| Trusted publishing checks the calling workflow's name | [npm trusted publishers](https://docs.npmjs.com/trusted-publishers) |
| Full research, per-job fit and migration estimate | [Hound's findings](https://github.com/rtorcato/repo-tooling/issues/1018#issuecomment-6965482620) |
